import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  columnaInexistente,
  funcionInexistente,
  mapearEstadoMP,
  mpConfigurado,
  planificarWebhook,
  validarFirmaWebhook,
  type PagoMP,
  type PedidoWebhook,
} from '../_lib/mp.js';
import { clienteAdmin } from '../_lib/supabaseAdmin.js';

type ClienteAdmin = ReturnType<typeof clienteAdmin>;

// Escribe el plan en orders. Si la columna requiere_revision todavía no existe
// (migración v24 sin aplicar), guarda el resto igual: el motivo ya quedó en
// el log y lo importante —no marcar 'aprobado'— no depende de esa columna.
async function escribirPedido(db: ClienteAdmin, id: string, patch: Record<string, unknown>, soloSiNoCerrado: boolean) {
  const correr = (p: Record<string, unknown>) => {
    let q = db.from('orders').update(p).eq('id', id);
    // Un reintento tardío de un pago viejo no puede pisar un pedido ya
    // pagado/devuelto. Con .or y no con .not a secas: NOT IN deja afuera las
    // filas con payment_status NULL (NULL NOT IN (...) es NULL, no true).
    if (soloSiNoCerrado) q = q.or('payment_status.is.null,payment_status.not.in.(aprobado,devuelto)');
    return q;
  };
  const { error } = await correr(patch);
  if (!error || !('requiere_revision' in patch) || !columnaInexistente(error)) return error;
  console.error('Webhook MP: falta orders.requiere_revision (migración v24); se guarda el resto del pedido', id);
  const { requiere_revision: _omitida, ...resto } = patch;
  if (Object.keys(resto).length === 0) return null;
  return (await correr(resto)).error;
}

// Notificaciones de pago de MP. Valida la firma, consulta el pago REAL a la
// API (nunca confía en el payload) y marca el pedido. Idempotente: la misma
// notificación dos veces escribe lo mismo. Ante error responde no-200 y MP
// reintenta solo.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!mpConfigurado(process.env)) return res.status(503).end();

  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const dataId = uno(req.query['data.id'] as string | string[] | undefined)
    ?? (typeof req.body?.data?.id !== 'undefined' ? String(req.body.data.id) : '');
  const tipo = uno(req.query['type'] as string | string[] | undefined) ?? String(req.body?.type ?? '');

  // MP también manda notificaciones merchant_order/topic sin data.id a esta
  // misma URL. Ignorarlas acá no lee ni escribe nada, así que no debilita
  // nada saltear la firma en este camino: el único camino que escribe sigue
  // exigiendo firma válida más abajo.
  if (tipo !== 'payment' || !dataId) return res.status(200).json({ ignorado: true });

  const firma = validarFirmaWebhook({
    xSignature: req.headers['x-signature'] as string | undefined,
    xRequestId: req.headers['x-request-id'] as string | undefined,
    dataId: dataId || undefined,
    secreto: process.env.MP_WEBHOOK_SECRET!,
  });
  if (!firma.ok) {
    console.warn('Webhook MP con firma inválida:', firma.motivo);
    return res.status(401).end();
  }

  let respMP: Response;
  try {
    respMP = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return res.status(502).end(); // MP reintenta solo
  }
  if (!respMP.ok) return res.status(502).end();
  const pago = (await respMP.json()) as PagoMP;

  const estado = mapearEstadoMP(pago.status);
  const orderId = pago.external_reference || undefined;
  if (!estado || !orderId) return res.status(200).json({ ignorado: true });

  const db = clienteAdmin(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // select('*') a propósito: trae mp_monto_esperado si la migración v24 ya
  // está y no falla si todavía no (una columna nombrada que no existe sí falla).
  const { data: pedido, error: errPedido } = await db.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (errPedido) {
    console.error('Webhook MP: no se pudo leer el pedido', orderId, errPedido.message);
    return res.status(500).end(); // MP reintenta solo
  }
  if (!pedido) {
    console.warn('Webhook MP: pago', pago.id, 'con external_reference', orderId, 'que no es un pedido');
    return res.status(200).json({ ignorado: true });
  }

  const plan = planificarWebhook(pago, pedido as PedidoWebhook, new Date().toISOString());
  if (!plan) return res.status(200).json({ ok: true });
  if (plan.revision) console.error('Webhook MP: pedido', orderId, 'queda para revisión:', plan.revision);

  const errEscritura = await escribirPedido(db, orderId, plan.patch, plan.soloSiNoCerrado);
  if (errEscritura) {
    console.error('Webhook MP: no se pudo actualizar el pedido', orderId, errEscritura.message);
    return res.status(500).end();
  }

  if (plan.descontarStock) {
    // Atómica e idempotente en la base (FOR UPDATE + orders.stock_descontado_at):
    // la misma notificación dos veces descuenta una sola vez. Sin stock
    // suficiente no deja negativos: marca el pedido para revisión.
    const { data: r, error: errStock } = await db.rpc('descontar_stock_pedido', { p_order_id: orderId });
    if (errStock) {
      if (funcionInexistente(errStock)) {
        // Código desplegado antes que la migración v24: el pago queda
        // acreditado y el stock se descuenta a mano, como con WhatsApp.
        console.error('Webhook MP: falta la RPC descontar_stock_pedido (migración v24); NO se descontó stock del pedido', orderId);
      } else {
        // Error real: 500 para que MP reintente; el pago ya quedó escrito y
        // la RPC es idempotente, así que el reintento solo completa el stock.
        console.error('Webhook MP: falló descontar_stock_pedido en', orderId, errStock.message);
        return res.status(500).end();
      }
    } else if (r && typeof r === 'object' && (r as { ok?: unknown }).ok === false) {
      console.error('Webhook MP: no se descontó stock del pedido', orderId, JSON.stringify(r));
    }
  }
  return res.status(200).json({ ok: true });
}
