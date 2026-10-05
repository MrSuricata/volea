import type { VercelRequest, VercelResponse } from '@vercel/node';
import { configDupr, habilitacionDe, infoBasica, suscribirRating, usuarioPartner } from '../_lib/dupr.js';
import { equipoDe } from '../_lib/equipo.js';
import { clienteAdmin } from '../_lib/supabaseAdmin.js';

// "Conectar con DUPR": el navegador manda los tokens que le entregó el login de DUPR y acá se
// comprueba CONTRA DUPR de quién son (nunca se confía en el DUPR ID que diga el navegador).
// Deja guardada la conexión, anota al jugador al aviso de cambios de rating y devuelve un
// ticket: es lo que después canjea la inscripción para quedar asociada a esa cuenta.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const c = configDupr(process.env);
  if (!c) return res.status(503).json({ error: 'La conexión con DUPR todavía no está activa' });

  const cuerpo = (req.body ?? {}) as Record<string, unknown>;
  const userToken = typeof cuerpo.userToken === 'string' ? cuerpo.userToken.trim() : '';
  const refreshToken = typeof cuerpo.refreshToken === 'string' && cuerpo.refreshToken.trim() !== '' ? cuerpo.refreshToken.trim() : null;
  if (userToken === '' || userToken.length > 6000 || (refreshToken?.length ?? 0) > 6000) {
    return res.status(400).json({ error: 'Faltan los datos de la sesión de DUPR' });
  }

  let info, habilitacion, usuario;
  try {
    info = await infoBasica(c, userToken);
    if (!info) return res.status(401).json({ error: 'DUPR no reconoció la sesión. Probá conectar de nuevo.' });
    // La habilitación sale con el token del jugador; el rating, con el nuestro de partner
    // (DUPR ya nos deja verlo porque el jugador acaba de aceptar). Si alguno falla no se
    // frena la conexión: el rating llega igual con el primer aviso y la habilitación se
    // vuelve a pedir antes de subir un partido.
    [habilitacion, usuario] = await Promise.all([
      habilitacionDe(c, userToken).catch(() => null),
      usuarioPartner(c, info.duprId).catch(() => null),
    ]);
  } catch (e) {
    console.error('DUPR conectar: no se pudo hablar con DUPR', e instanceof Error ? e.message : e);
    return res.status(502).json({ error: 'No pudimos comunicarnos con DUPR. Probá de nuevo en un rato.' });
  }

  // Cuenta de alguien del equipo (la que va a subir partidos a nombre del club): solo si
  // el pedido trae una sesión válida del panel.
  const delEquipo = cuerpo.comoEquipo === true ? await equipoDe(req) : null;
  if (cuerpo.comoEquipo === true && !delEquipo) return res.status(403).json({ error: 'Tu sesión del panel venció: entrá de nuevo' });

  const db = clienteAdmin(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const ahora = new Date().toISOString();
  const { error: errConexion } = await db.from('dupr_conexiones').upsert({
    entorno: c.entorno,
    dupr_id: info.duprId,
    nombre: info.nombre ?? usuario?.nombre ?? null,
    genero: info.genero,
    anio_nacimiento: info.anioNacimiento,
    ubicacion: info.ubicacion,
    // lo que no se pudo consultar ahora NO se manda: así no pisa lo que ya estaba guardado
    ...(usuario ? {
      rating_singles: usuario.singles, rating_dobles: usuario.dobles,
      fiabilidad_singles: usuario.fiabilidadSingles, fiabilidad_dobles: usuario.fiabilidadDobles, rating_at: ahora,
    } : {}),
    ...(habilitacion ? {
      habilitado: habilitacion.habilitado, premium: habilitacion.premium, entitlements: habilitacion.crudo, entitlements_at: ahora,
    } : {}),
    ...(delEquipo ? { admin_email: delEquipo } : {}),
    actualizado_at: ahora,
  }, { onConflict: 'entorno,dupr_id' });
  if (errConexion) {
    console.error('DUPR conectar: no se pudo guardar la conexión', info.duprId, errConexion.message);
    return res.status(500).json({ error: 'No pudimos guardar la conexión. Probá de nuevo.' });
  }
  const { error: errTokens } = await db.from('dupr_tokens').upsert({
    entorno: c.entorno, dupr_id: info.duprId, access_token: userToken, refresh_token: refreshToken, actualizado_at: ahora,
  }, { onConflict: 'entorno,dupr_id' });
  if (errTokens) console.error('DUPR conectar: no se guardaron los tokens de', info.duprId, errTokens.message);

  // Aviso de cambios de rating. Si falla (por ejemplo, el webhook todavía sin registrar) la
  // conexión vale igual: queda como pendiente y el equipo la reintenta desde el panel.
  const suscripcion = await suscribirRating(c, [info.duprId]).catch((e: unknown) => ({ ok: false, detalle: e instanceof Error ? e.message : String(e) }));
  if (suscripcion.ok) {
    await db.from('dupr_conexiones').update({ suscripto: true }).eq('entorno', c.entorno).eq('dupr_id', info.duprId);
  } else {
    console.warn('DUPR conectar: no se pudo suscribir a', info.duprId, suscripcion.detalle);
  }

  const { data: ticket, error: errTicket } = await db.from('dupr_tickets')
    .insert({ entorno: c.entorno, dupr_id: info.duprId }).select('ticket').single();
  if (errTicket || !ticket) {
    console.error('DUPR conectar: no se pudo emitir el ticket de', info.duprId, errTicket?.message);
    return res.status(500).json({ error: 'No pudimos terminar la conexión. Probá de nuevo.' });
  }

  return res.status(200).json({
    ticket: ticket.ticket as string,
    duprId: info.duprId,
    nombre: info.nombre ?? usuario?.nombre ?? null,
    singles: usuario?.singles ?? null,
    dobles: usuario?.dobles ?? null,
    anioNacimiento: info.anioNacimiento,
    habilitado: habilitacion ? habilitacion.habilitado : null,
    premium: habilitacion ? habilitacion.premium : null,
    delEquipo: delEquipo !== null,
  });
}
