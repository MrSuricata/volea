import type { VercelRequest, VercelResponse } from '@vercel/node';
import { mpConfigurado } from '../_lib/mp';

// Le dice al checkout si mostrar el botón de Mercado Pago. Sin credenciales
// cargadas en Vercel (o en dev local), responde false y la web queda como antes.
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  res.status(200).json({ disponible: mpConfigurado(process.env) });
}
