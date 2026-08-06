import type { VercelRequest, VercelResponse } from '@vercel/node';
import { armarUrlRetorno } from '../_lib/mp';

// Puente entre la vuelta de Checkout Pro y el HashRouter de la SPA.
export default function handler(req: VercelRequest, res: VercelResponse) {
  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = req.query as Record<string, string | string[] | undefined>;
  // BASE_URL es opcional: solo hace falta si el dominio cambia.
  res.redirect(302, armarUrlRetorno(process.env.BASE_URL || 'https://volea.vercel.app', {
    status: uno(q.status),
    collection_status: uno(q.collection_status),
    external_reference: uno(q.external_reference),
    payment_id: uno(q.payment_id),
  }));
}
