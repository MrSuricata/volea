import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  actualizarPartido, borrarPartido, clubesDe, configDupr, crearPartidos, habilitacionDe, huellaDe, partidosParaDupr,
  planificarSubida, puedeSubirPorElClub, refrescarToken, registrarWebhook, suscribirRating,
  type Accion, type ConfigDupr, type FilaSubida, type JugadorParaDupr, type OpcionesSubida, type TorneoParaDupr,
} from '../_lib/dupr.js';
import { equipoDe } from '../_lib/equipo.js';
import { clienteAdmin } from '../_lib/supabaseAdmin.js';

type Db = ReturnType<typeof clienteAdmin>;

// Todo lo que el equipo hace con DUPR desde el panel, en UNA función (el plan de Vercel
// limita la cantidad de funciones): ver el estado, registrar el webhook, suscribir lo que
// quedó pendiente, y revisar / subir / corregir / borrar los partidos de un cuadro.
// Siempre exige una sesión de owner o admin.

const UN_DIA = 24 * 60 * 60 * 1000;
// Las funciones tienen pocos segundos: lo que no entra en una pasada se termina en la siguiente.
const PRESUPUESTO_MS = 7000;

// URL que se registra en DUPR. El secreto va como parámetro: es lo que valida cada aviso.
function urlWebhook(req: VercelRequest, c: ConfigDupr): string {
  const propia = process.env.DUPR_WEBHOOK_URL?.trim();
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const base = propia || `https://${Array.isArray(host) ? host[0] : host}/api/dupr/webhook`;
  return `${base}${base.includes('?') ? '&' : '?'}k=${encodeURIComponent(c.secretoWebhook)}`;
}

// Token de la cuenta DUPR de quien hace el pedido, renovándolo si venció.
async function conLaCuentaDe<T>(
  db: Db, c: ConfigDupr, email: string, usar: (token: string) => Promise<T | null>,
): Promise<{ cuenta: { duprId: string; nombre: string | null } | null; resultado: T | null }> {
  const { data: con } = await db.from('dupr_conexiones').select('dupr_id, nombre')
    .eq('entorno', c.entorno).eq('admin_email', email).order('actualizado_at', { ascending: false }).limit(1).maybeSingle();
  if (!con) return { cuenta: null, resultado: null };
  const cuenta = { duprId: con.dupr_id as string, nombre: (con.nombre as string | null) ?? null };
  const { data: tok } = await db.from('dupr_tokens').select('access_token, refresh_token')
    .eq('entorno', c.entorno).eq('dupr_id', cuenta.duprId).maybeSingle();
  if (!tok) return { cuenta, resultado: null };
  let resultado = await usar(tok.access_token as string).catch(() => null);
  if (resultado === null && tok.refresh_token) {
    const nuevo = await refrescarToken(c, tok.refresh_token as string).catch(() => null);
    if (nuevo) {
      await db.from('dupr_tokens').update({
        access_token: nuevo.accessToken, refresh_token: nuevo.refreshToken ?? tok.refresh_token, actualizado_at: new Date().toISOString(),
      }).eq('entorno', c.entorno).eq('dupr_id', cuenta.duprId);
      resultado = await usar(nuevo.accessToken).catch(() => null);
    }
  }
  return { cuenta, resultado };
}

type OpcionesPedido = { torneoId: string; opciones: Omit<OpcionesSubida, 'clubId'> };
function leerOpciones(cuerpo: Record<string, unknown>): OpcionesPedido | string {
  const s = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  const torneoId = s(cuerpo.torneoId);
  const fecha = s(cuerpo.fecha);
  const lugar = s(cuerpo.lugar);
  const evento = s(cuerpo.evento);
  const puntaje = s(cuerpo.puntaje).toUpperCase();
  if (!torneoId) return 'Elegí un cuadro';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) return 'Poné la fecha en que se jugó';
  if (Date.parse(fecha) > Date.now() + UN_DIA) return 'DUPR no acepta partidos con fecha futura';
  if (!lugar || lugar.length > 120) return 'Poné dónde se jugó';
  if (!evento || evento.length > 120) return 'Poné el nombre del evento';
  if (puntaje !== 'SIDEOUT' && puntaje !== 'RALLY') return 'Elegí cómo se contó el puntaje';
  return { torneoId, opciones: { fecha, lugar, evento, puntaje } };
}

// Lee el cuadro, el padrón y lo que ya se subió, y arma qué va, qué no (y por qué) y qué falta hacer.
async function revisarTorneo(db: Db, c: ConfigDupr, pedido: OpcionesPedido) {
  const { data: fila, error } = await db.from('rk_torneos').select('data').eq('id', pedido.torneoId).maybeSingle();
  if (error) throw new Error(`no se pudo leer el cuadro: ${error.message}`);
  if (!fila?.data) return null;
  const t = fila.data as TorneoParaDupr;
  const jugadorIds = [...new Set(t.parejas.flatMap((p) => p.jugadorIds ?? []))];
  const { data: jugadores } = jugadorIds.length > 0
    ? await db.from('rk_jugadores').select('id, nombre, dupr_id').in('id', jugadorIds)
    : { data: [] as { id: string; nombre: string; dupr_id: string | null }[] };
  const duprIds = [...new Set((jugadores ?? []).map((j) => (j.dupr_id as string | null)?.trim().toUpperCase()).filter((x): x is string => !!x))];
  const { data: conexiones } = duprIds.length > 0
    ? await db.from('dupr_conexiones').select('dupr_id, habilitado').eq('entorno', c.entorno).in('dupr_id', duprIds)
    : { data: [] as { dupr_id: string; habilitado: boolean | null }[] };
  const conexion = new Map((conexiones ?? []).map((x) => [x.dupr_id as string, x]));
  const padron = new Map<string, JugadorParaDupr>((jugadores ?? []).map((j) => {
    const duprId = (j.dupr_id as string | null)?.trim().toUpperCase() || null;
    const con = duprId ? conexion.get(duprId) : undefined;
    return [j.id as string, { nombre: j.nombre as string, duprId, conectado: !!con, habilitado: con ? (con.habilitado as boolean | null) : null }];
  }));
  const { data: filas } = await db.from('dupr_partidos')
    .select('partido_id, intento, identifier, match_code, huella, estado, error').eq('entorno', c.entorno).eq('torneo_id', pedido.torneoId);
  const partidos = partidosParaDupr(t, padron, { ...pedido.opciones, clubId: c.clubId });
  const subidas = (filas ?? []) as FilaSubida[];
  const plan = planificarSubida(partidos, subidas, c.entorno, pedido.torneoId);
  const errorDe = new Map(subidas.filter((f) => f.error).map((f) => [f.partido_id, f.error as string]));
  return {
    torneo: t.nombre,
    plan,
    partidos: partidos.map((p) => ({
      partidoId: p.partidoId, fase: p.fase, a: p.a, b: p.b, puntos: p.puntos, motivo: p.motivo,
      estado: plan.estados[p.partidoId], error: errorDe.get(p.partidoId) ?? null,
    })),
    resumen: {
      subidos: partidos.filter((p) => plan.estados[p.partidoId] === 'subido').length,
      porSubir: plan.acciones.filter((a) => a.tipo === 'subir').length,
      cambiaron: plan.acciones.filter((a) => a.tipo === 'actualizar').length,
      porBorrar: plan.acciones.filter((a) => a.tipo === 'borrar').length,
      noVan: partidos.filter((p) => plan.estados[p.partidoId] === 'no va').length,
    },
  };
}

// La habilitación de un jugador (BASIC_L1) vale 24 horas: antes de subir se vuelve a pedir la
// de los que la tienen vencida. Si no se puede (token vencido) queda la última conocida y DUPR
// la controla de nuevo al recibir el partido.
async function refrescarHabilitaciones(db: Db, c: ConfigDupr, duprIds: string[], hasta: number): Promise<void> {
  if (duprIds.length === 0) return;
  const { data: conexiones } = await db.from('dupr_conexiones').select('dupr_id, entitlements_at').eq('entorno', c.entorno).in('dupr_id', duprIds);
  const vencidas = (conexiones ?? []).filter((x) => !x.entitlements_at || Date.now() - Date.parse(x.entitlements_at as string) > UN_DIA).map((x) => x.dupr_id as string);
  if (vencidas.length === 0) return;
  const { data: tokens } = await db.from('dupr_tokens').select('dupr_id, access_token').eq('entorno', c.entorno).in('dupr_id', vencidas);
  for (const t of tokens ?? []) {
    if (Date.now() > hasta) return;
    const h = await habilitacionDe(c, t.access_token as string).catch(() => null);
    if (!h) continue;
    await db.from('dupr_conexiones').update({
      habilitado: h.habilitado, premium: h.premium, entitlements: h.crudo, entitlements_at: new Date().toISOString(),
    }).eq('entorno', c.entorno).eq('dupr_id', t.dupr_id as string);
  }
}

async function sincronizar(db: Db, c: ConfigDupr, pedido: OpcionesPedido, acciones: Accion[], email: string, hasta: number) {
  const clave = { entorno: c.entorno, torneo_id: pedido.torneoId };
  const ahora = () => new Date().toISOString();
  const errores: { partidoId: string; error: string }[] = [];
  const hecho = { subidos: 0, actualizados: 0, borrados: 0 };
  let pendientes = 0;

  const aSubir = acciones.filter((a): a is Extract<Accion, { tipo: 'subir' }> => a.tipo === 'subir');
  for (let i = 0; i < aSubir.length; i += 100) {
    const lote = aSubir.slice(i, i + 100);
    if (Date.now() > hasta) { pendientes += aSubir.length - i; break; }
    const r = await crearPartidos(c, lote.map((a) => ({ ...a.cuerpo, identifier: a.identifier })));
    const creado = new Map(r.creados.map((x) => [x.identifier, x]));
    const rechazo = new Map(r.errores.map((x) => [x.identifier, x.error]));
    for (const a of lote) {
      const ok = creado.get(a.identifier);
      const error = ok ? null : rechazo.get(a.identifier) ?? 'DUPR no confirmó este partido';
      await db.from('dupr_partidos').upsert({
        ...clave, partido_id: a.partidoId, intento: a.intento, identifier: a.identifier,
        match_code: ok?.matchCode ?? null, hashed_match_code: ok?.hashedMatchCode ?? null,
        huella: huellaDe(a.cuerpo), payload: a.cuerpo, estado: ok ? 'subido' : 'error', error,
        subido_at: ok ? ahora() : null, actualizado_at: ahora(), por: email,
      }, { onConflict: 'entorno,torneo_id,partido_id' });
      if (ok) hecho.subidos += 1; else errores.push({ partidoId: a.partidoId, error: error! });
    }
  }

  for (const a of acciones) {
    if (a.tipo === 'subir') continue;
    if (Date.now() > hasta) { pendientes += 1; continue; }
    const donde =<Q extends { eq: (col: string, v: string) => Q }>(q: Q) => q.eq('entorno', c.entorno).eq('torneo_id', pedido.torneoId).eq('partido_id', a.partidoId);
    if (a.tipo === 'actualizar') {
      const r = await actualizarPartido(c, a.matchCode, { ...a.cuerpo, identifier: a.identifier });
      await donde(db.from('dupr_partidos').update(r.ok
        ? { huella: huellaDe(a.cuerpo), payload: a.cuerpo, error: null, actualizado_at: ahora(), por: email }
        : { error: r.detalle, actualizado_at: ahora() }));
      if (r.ok) hecho.actualizados += 1; else errores.push({ partidoId: a.partidoId, error: r.detalle });
    } else {
      const r = await borrarPartido(c, a.matchCode, a.identifier);
      await donde(db.from('dupr_partidos').update(r.ok
        ? { estado: 'borrado', error: null, actualizado_at: ahora(), por: email }
        : { error: r.detalle, actualizado_at: ahora() }));
      if (r.ok) hecho.borrados += 1; else errores.push({ partidoId: a.partidoId, error: r.detalle });
    }
  }
  return { ...hecho, errores, pendientes };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const email = await equipoDe(req);
  if (!email) return res.status(401).json({ error: 'Tu sesión del panel venció: entrá de nuevo' });

  const cuerpo = (req.body ?? {}) as Record<string, unknown>;
  const accion = typeof cuerpo.accion === 'string' ? cuerpo.accion : '';
  const c = configDupr(process.env);
  if (!c) {
    return accion === 'estado'
      ? res.status(200).json({ configurado: false })
      : res.status(503).json({ error: 'Faltan cargar las claves de DUPR en Vercel' });
  }
  const db = clienteAdmin(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const hasta = Date.now() + PRESUPUESTO_MS;

  try {
    if (accion === 'estado') {
      const { data: conexiones } = await db.from('dupr_conexiones').select('dupr_id, suscripto').eq('entorno', c.entorno);
      const mia = await conLaCuentaDe(db, c, email, (token) => clubesDe(c, token));
      return res.status(200).json({
        configurado: true, entorno: c.entorno, clubId: c.clubId,
        webhook: urlWebhook(req, c).replace(encodeURIComponent(c.secretoWebhook), '•••'),
        conexiones: (conexiones ?? []).length,
        sinSuscribir: (conexiones ?? []).filter((x) => !x.suscripto).length,
        miCuenta: mia.cuenta ? {
          ...mia.cuenta,
          // sin club configurado los partidos van como partner y no hace falta ningún rol
          club: c.clubId === null ? 'sin-club' : mia.resultado === null ? 'vencida' : puedeSubirPorElClub(mia.resultado, c.clubId) ? 'ok' : 'sin-rol',
        } : null,
      });
    }

    if (accion === 'registrar-webhook') {
      const r = await registrarWebhook(c, urlWebhook(req, c));
      return res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true } : { error: `DUPR no aceptó el aviso: ${r.detalle}` });
    }

    if (accion === 'suscribir-pendientes') {
      const { data: pendientes } = await db.from('dupr_conexiones').select('dupr_id').eq('entorno', c.entorno).eq('suscripto', false);
      const ids = (pendientes ?? []).map((x) => x.dupr_id as string);
      let suscriptos = 0;
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100);
        const r = await suscribirRating(c, lote);
        if (!r.ok) return res.status(502).json({ error: `DUPR no aceptó la suscripción: ${r.detalle}`, suscriptos });
        await db.from('dupr_conexiones').update({ suscripto: true }).eq('entorno', c.entorno).in('dupr_id', lote);
        suscriptos += lote.length;
      }
      return res.status(200).json({ ok: true, suscriptos });
    }

    if (accion === 'torneo' || accion === 'sincronizar') {
      const pedido = leerOpciones(cuerpo);
      if (typeof pedido === 'string') return res.status(400).json({ error: pedido });
      let revision = await revisarTorneo(db, c, pedido);
      if (!revision) return res.status(404).json({ error: 'No encontramos ese cuadro' });
      if (accion === 'torneo') {
        const { plan: _plan, ...paraElPanel } = revision;
        return res.status(200).json(paraElPanel);
      }

      // Subir a nombre de un club exige que quien sube sea director u organizador de ESE club
      // (requisito de DUPR), comprobado con su propia cuenta DUPR.
      if (c.clubId !== null) {
        const mia = await conLaCuentaDe(db, c, email, (token) => clubesDe(c, token));
        if (!mia.cuenta) return res.status(403).json({ error: 'Antes de subir partidos conectá tu cuenta DUPR (la que dirige u organiza el club)' });
        if (mia.resultado === null) return res.status(403).json({ error: 'Tu conexión con DUPR venció: conectá tu cuenta de nuevo' });
        if (!puedeSubirPorElClub(mia.resultado, c.clubId)) {
          return res.status(403).json({ error: `Tu cuenta DUPR no es directora ni organizadora del club ${c.clubId}` });
        }
      }

      // Con las habilitaciones al día se vuelve a armar el plan (alguien puede haber dejado de estar habilitado).
      const enJuego = new Set<string>();
      for (const a of revision.plan.acciones) {
        if (a.tipo === 'borrar') continue;
        for (const id of [a.cuerpo.teamA.player1, a.cuerpo.teamA.player2, a.cuerpo.teamB.player1, a.cuerpo.teamB.player2]) if (id) enJuego.add(id);
      }
      await refrescarHabilitaciones(db, c, [...enJuego], hasta);
      revision = (await revisarTorneo(db, c, pedido))!;

      const hecho = await sincronizar(db, c, pedido, revision.plan.acciones, email, hasta);
      const { plan: _plan, ...despues } = (await revisarTorneo(db, c, pedido))!;
      return res.status(200).json({ ...despues, hecho });
    }

    return res.status(400).json({ error: 'Acción desconocida' });
  } catch (e) {
    console.error('DUPR admin:', accion, e instanceof Error ? e.message : e);
    return res.status(502).json({ error: e instanceof Error ? e.message : 'No pudimos comunicarnos con DUPR' });
  }
}
