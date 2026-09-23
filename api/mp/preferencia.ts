import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  armarItemsPreferencia,
  hoyMontevideo,
  motivoPedidoNoPagable,
  mpConfigurado,
  promoVigenteHoy,
  validarDisponibilidad,
  type ItemPedidoRow,
} from '../_lib/mp.js';
import { clienteAdmin } from '../_lib/supabaseAdmin.js';

// BASE_URL es opcional: solo hace falta si el dominio cambia.
const baseUrl = () => process.env.BASE_URL || 'https://volea.vercel.app';

// Crea la preferencia de Checkout Pro para un pedido ya insertado en orders.
// Los precios se releen de products: acá no se confía en nada del cliente.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!mpConfigurado(process.env)) return res.status(503).json({ error: 'Mercado Pago no está configurado' });

  const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId : '';
  if (!orderId) return res.status(400).json({ error: 'Falta orderId' });
  // Mismo 404 para TODO pedido que no se pueda pagar (no existe, es de
  // WhatsApp, es viejo, ya está pago, items rotos): si las respuestas
  // difirieran, probar ids revelaría qué pedidos existen y cuáles se pagaron.
  const noEncontrado = () => res.status(404).json({ error: 'Pedido no encontrado' });
  // Mismo formato que exige el trigger v22 al alta: descarta basura sin ir a la base.
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(orderId)) return noEncontrado();

  const db = clienteAdmin(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: pedido, error } = await db
    .from('orders')
    .select('id, items, payment_status, payment_provider, source, created_at')
    .eq('id', orderId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'No se pudo leer el pedido' });
  const motivo = motivoPedidoNoPagable(pedido);
  if (motivo || !pedido) {
    console.warn('MP preferencia: pedido', orderId, 'no se puede pagar:', motivo);
    return noEncontrado();
  }
  const itemsPedido = pedido.items as ItemPedidoRow[];

  // Solo ids string van al .in(): el pedido lo armó el cliente y un id con
  // otra forma rompería el filtro; validarDisponibilidad lo reporta como
  // producto inexistente.
  const ids = [...new Set(itemsPedido.map(i => i?.product?.id).filter((id): id is string => typeof id === 'string' && id !== ''))];
  const { data: catalogo, error: errCat } = await db
    .from('products')
    .select('id, name, price, active, stock_by_size')
    .in('id', ids);
  if (errCat || !catalogo) return res.status(500).json({ error: 'No se pudo leer el catálogo' });

  // Promo vigente (tabla promos, la misma fuente que muestra el carrito): el
  // descuento se aplica ACÁ, sobre los precios del catálogo, para que MP cobre
  // exactamente el total que el cliente vio. Si esta lectura falla se CORTA con
  // 500 en vez de seguir sin descuento: seguir cobraría de MÁS respecto de lo
  // que el carrito mostró, que es el peor desenlace posible de un checkout.
  const { data: promos, error: errPromo } = await db
    .from('promos')
    .select('id, percent, starts_on, ends_on, active')
    .eq('active', true);
  if (errPromo) return res.status(500).json({ error: 'No se pudo verificar las promociones' });
  const promo = promoVigenteHoy(promos ?? [], hoyMontevideo());

  // Precios SIEMPRE del catálogo (armarItemsPreferencia); antes, que cada
  // producto siga visible, en esa variante y con stock. Los mensajes van tal
  // cual al toast del checkout.
  let items;
  try {
    validarDisponibilidad(itemsPedido, catalogo);
    items = armarItemsPreferencia(itemsPedido, catalogo, promo?.percent ?? 0);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : 'Pedido inválido' });
  }

  let respMP: Response;
  try {
    respMP = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items,
        // Las preferencias de MP no vencen por defecto: una creada a las 23:50 del
        // último día de una promo se podía pagar con descuento días después. 24h
        // alcanza de sobra para terminar un checkout.
        expires: true,
        expiration_date_to: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        external_reference: pedido.id,
        back_urls: {
          success: `${baseUrl()}/api/mp/retorno`,
          pending: `${baseUrl()}/api/mp/retorno`,
          failure: `${baseUrl()}/api/mp/retorno`,
        },
        auto_return: 'approved',
        notification_url: `${baseUrl()}/api/mp/webhook`,
        statement_descriptor: 'VOLEA',
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return res.status(502).json({ error: 'Mercado Pago no respondió' });
  }
  if (!respMP.ok) {
    console.error('MP rechazó la preferencia:', respMP.status, await respMP.text());
    return res.status(502).json({ error: 'Mercado Pago rechazó la preferencia' });
  }
  const pref = await respMP.json();

  const { error: errPref } = await db
    .from('orders')
    .update({ mp_preference_id: pref.id, payment_provider: 'mp' })
    .eq('id', pedido.id);
  if (errPref) console.error('No se pudo guardar mp_preference_id en', pedido.id, errPref.message);

  // 'iniciado' solo si el pago no avanzó por otro lado (carrera con el webhook).
  const { error: errIni } = await db
    .from('orders')
    .update({ payment_status: 'iniciado' })
    .eq('id', pedido.id)
    .is('payment_status', null);
  if (errIni) console.error('No se pudo marcar iniciado en', pedido.id, errIni.message);

  return res.status(200).json({ initPoint: pref.init_point });
}
