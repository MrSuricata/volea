import type { VercelRequest, VercelResponse } from '@vercel/node';
import { mapearEstadoMP, mpConfigurado, validarFirmaWebhook } from '../_lib/mp';
import { clienteAdmin } from '../_lib/supabaseAdmin';

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
  const pago = await respMP.json();

  const estado = mapearEstadoMP(pago.status);
  const orderId: string | undefined = pago.external_reference;
  if (!estado || !orderId) return res.status(200).json({ ignorado: true });

  const patch: Record<string, unknown> = {
    payment_status: estado,
    payment_provider: 'mp',
    mp_payment_id: String(pago.id),
  };
  if (estado === 'aprobado') {
    patch.paid_at = pago.date_approved ?? new Date().toISOString();
    patch.paid_amount = pago.transaction_amount ?? null;
  }

  const db = clienteAdmin(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let q = db.from('orders').update(patch).eq('id', orderId);
  if (estado === 'pendiente' || estado === 'rechazado') {
    // Un reintento tardío de un pago viejo no puede pisar un pedido ya pagado/devuelto.
    q = q.not('payment_status', 'in', '("aprobado","devuelto")');
  }
  const { error } = await q;
  if (error) {
    console.error('Webhook MP: no se pudo actualizar el pedido', orderId, error.message);
    return res.status(500).end();
  }
  return res.status(200).json({ ok: true });
}
