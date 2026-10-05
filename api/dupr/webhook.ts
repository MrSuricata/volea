import type { VercelRequest, VercelResponse } from '@vercel/node';
import { configDupr, interpretarAviso, secretoValido } from '../_lib/dupr.js';
import { clienteAdmin } from '../_lib/supabaseAdmin.js';

// Avisos de DUPR: cada vez que a un jugador conectado le cambia el rating (RATING), y la foto
// inicial apenas se lo suscribe (RATING_SEED). DUPR no firma los avisos: lo que prueba que
// vienen de ellos es el secreto `k` de la URL, que solo conocen DUPR (se le pasa al registrar
// el webhook) y Vercel. Tiene que contestar 200 en pocos segundos, también a la prueba de
// registro (REGISTRATION).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const c = configDupr(process.env);
  if (!c) return res.status(503).end();

  const k = req.query.k;
  if (!secretoValido(Array.isArray(k) ? k[0] : k, c.secretoWebhook)) {
    console.warn('Webhook DUPR con secreto inválido');
    return res.status(401).end();
  }

  const aviso = interpretarAviso(req.body);
  const db = clienteAdmin(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // Bitácora: mejor esfuerzo, un fallo acá no puede hacer que DUPR vea un error.
  const evento = typeof (req.body as { event?: unknown } | null)?.event === 'string' ? String((req.body as { event: string }).event).slice(0, 40) : 'DESCONOCIDO';
  const { error: errBitacora } = await db.from('dupr_eventos').insert({
    entorno: c.entorno, evento, dupr_id: aviso.tipo === 'rating' ? aviso.duprId : null, cuerpo: req.body ?? {},
  });
  if (errBitacora) console.error('Webhook DUPR: no se anotó el aviso en la bitácora:', errBitacora.message);

  if (aviso.tipo === 'registro') return res.status(200).json({ ok: true });
  if (aviso.tipo === 'ignorado') {
    console.warn('Webhook DUPR ignorado:', aviso.motivo);
    return res.status(200).json({ ignorado: true });
  }

  const { data, error } = await db.rpc('dupr_aplicar_rating', {
    p_entorno: c.entorno, p_dupr_id: aviso.duprId,
    p_singles: aviso.singles, p_dobles: aviso.dobles,
    p_fiabilidad_singles: aviso.fiabilidadSingles, p_fiabilidad_dobles: aviso.fiabilidadDobles,
  });
  if (error) {
    console.error('Webhook DUPR: no se pudo guardar el rating de', aviso.duprId, error.message);
    return res.status(500).end();
  }
  // Que llegue un aviso de este jugador confirma que la suscripción está viva.
  await db.from('dupr_conexiones').update({ suscripto: true }).eq('entorno', c.entorno).eq('dupr_id', aviso.duprId);
  return res.status(200).json({ ok: true, ...(data as Record<string, unknown> | null ?? {}) });
}
