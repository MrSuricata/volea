import type { VercelRequest, VercelResponse } from '@vercel/node';
import { mpConfigurado } from '../_lib/mp';

// Le dice al checkout si mostrar el botón de Mercado Pago. Sin credenciales
// cargadas en Vercel (o en dev local), responde false y la web queda como antes.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ disponible: mpConfigurado(process.env) });
}
