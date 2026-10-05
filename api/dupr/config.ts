import type { VercelRequest, VercelResponse } from '@vercel/node';
import { configDupr, urlLogin } from '../_lib/dupr.js';

// Le dice a la web si mostrar "Conectar con DUPR" y qué página de DUPR abrir. Sin las claves
// cargadas en Vercel responde habilitado: false y la web queda como antes (campo de DUPR ID
// a mano). La URL de login lleva la client key en base64: es pública por diseño de DUPR.
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const c = configDupr(process.env);
  res.setHeader('Cache-Control', 'public, max-age=60');
  if (!c) return res.status(200).json({ habilitado: false });
  return res.status(200).json({ habilitado: true, entorno: c.entorno, login: urlLogin(c), conClub: c.clubId !== null });
}
