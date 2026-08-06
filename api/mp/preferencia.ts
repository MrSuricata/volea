import type { VercelRequest, VercelResponse } from '@vercel/node';
import { armarItemsPreferencia, mpConfigurado } from '../_lib/mp';
import { clienteAdmin } from '../_lib/supabaseAdmin';

// BASE_URL es opcional: solo hace falta si el dominio cambia.
const baseUrl = () => process.env.BASE_URL || 'https://volea.vercel.app';

// Crea la preferencia de Checkout Pro para un pedido ya insertado en orders.
// Los precios se releen de products: acá no se confía en nada del cliente.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!mpConfigurado(process.env)) return res.status(503).json({ error: 'Mercado Pago no está configurado' });

  const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId : '';
  if (!orderId) return res.status(400).json({ error: 'Falta orderId' });

  const db = clienteAdmin(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: pedido, error } = await db
    .from('orders')
    .select('id, items, payment_status')
    .eq('id', orderId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'No se pudo leer el pedido' });
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (pedido.payment_status === 'aprobado') return res.status(409).json({ error: 'Este pedido ya está pagado' });

  const ids = [...new Set((pedido.items ?? []).map((i: { product?: { id?: string } }) => i.product?.id).filter(Boolean))];
  const { data: catalogo, error: errCat } = await db.from('products').select('id, name, price').in('id', ids as string[]);
  if (errCat || !catalogo) return res.status(500).json({ error: 'No se pudo leer el catálogo' });

  let items;
  try {
    items = armarItemsPreferencia(pedido.items ?? [], catalogo);
  } catch (e) {
    return res.status(422).json({ error: e instanceof Error ? e.message : 'Pedido inválido' });
  }

  const respMP = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items,
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
  });
  if (!respMP.ok) {
    console.error('MP rechazó la preferencia:', respMP.status, await respMP.text());
    return res.status(502).json({ error: 'Mercado Pago rechazó la preferencia' });
  }
  const pref = await respMP.json();

  await db
    .from('orders')
    .update({ mp_preference_id: pref.id, payment_provider: 'mp', payment_status: pedido.payment_status ?? 'iniciado' })
    .eq('id', pedido.id);

  return res.status(200).json({ initPoint: pref.init_point });
}
