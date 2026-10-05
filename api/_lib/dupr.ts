// Integración con DUPR como partner (https://dupr.gitbook.io/dupr-raas).
// Helpers puros y llamadas a las dos APIs de DUPR. Sin entorno ni base: los handlers
// inyectan la configuración y el fetch, así todo esto se testea solo.
//
// DUPR tiene DOS APIs con credenciales distintas:
//  · la de partner (uat.mydupr.com / prod.mydupr.com): se entra con un token que sale de
//    nuestra client key + secret. Suscribe jugadores a los avisos de rating y sube partidos.
//  · la pública (api.uat.dupr.gg / api.dupr.gg): se entra con el token de CADA jugador, el
//    que entrega "Login with DUPR". Dice quién es, si está habilitado y sus clubes.
// Las formas de pedidos y respuestas salen de los OpenAPI publicados por DUPR
// (…/api/v3/api-docs y …/v3/api-docs/public), leídos el 5/10/2026.
import { createHash, timingSafeEqual } from 'node:crypto';

export type Entorno = 'uat' | 'prod';

export interface ConfigDupr {
  entorno: Entorno;
  clientKey: string;
  clientSecret: string;
  /** Club de DUPR a nombre del que se suben los partidos. null = se suben como partner, sin club. */
  clubId: number | null;
  /** Va en la URL del webhook que se registra en DUPR: es lo que prueba que un aviso viene de ellos. */
  secretoWebhook: string;
  urls: { partner: string; publico: string; login: string };
}

const URLS: Record<Entorno, ConfigDupr['urls']> = {
  uat: { partner: 'https://uat.mydupr.com/api', publico: 'https://api.uat.dupr.gg', login: 'https://uat.dupr.gg' },
  prod: { partner: 'https://prod.mydupr.com/api', publico: 'https://api.dupr.gg', login: 'https://dashboard.dupr.com' },
};
const V = 'v1.0';

/** Configuración desde las variables de entorno, o null si faltan las claves (la web queda como antes). */
export function configDupr(env: Record<string, string | undefined>): ConfigDupr | null {
  const clientKey = env.DUPR_CLIENT_KEY?.trim();
  const clientSecret = env.DUPR_CLIENT_SECRET?.trim();
  const secretoWebhook = env.DUPR_WEBHOOK_SECRET?.trim();
  if (!clientKey || !clientSecret || !secretoWebhook) return null;
  // Producción solo si se pide con todas las letras: ante la duda, el ambiente de prueba.
  const entorno: Entorno = env.DUPR_ENTORNO?.trim().toLowerCase() === 'prod' ? 'prod' : 'uat';
  const club = Number(env.DUPR_CLUB_ID);
  const base = URLS[entorno];
  const url = (propia: string | undefined, porDefecto: string) => (propia?.trim() || porDefecto).replace(/\/+$/, '');
  return {
    entorno, clientKey, clientSecret, secretoWebhook,
    clubId: Number.isSafeInteger(club) && club > 0 ? club : null,
    // Las tres URL se pueden pisar para probar contra un DUPR simulado.
    urls: {
      partner: url(env.DUPR_URL_PARTNER, base.partner),
      publico: url(env.DUPR_URL_PUBLICO, base.publico),
      login: url(env.DUPR_URL_LOGIN, base.login),
    },
  };
}

/** Página de DUPR que se muestra en el iframe de "Conectar con DUPR". La client key va en base64, como pide DUPR. */
export const urlLogin = (c: ConfigDupr) =>
  `${c.urls.login}/login-external-app/${Buffer.from(c.clientKey).toString('base64')}`;

export class ErrorDupr extends Error {
  constructor(mensaje: string, readonly status: number, readonly cuerpo: unknown) {
    super(mensaje);
    this.name = 'ErrorDupr';
  }
}

type Fetch = typeof fetch;
type Respuesta = { status: number; json: unknown };
type Obj = Record<string, unknown>;

const esObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const texto = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x.trim() : null);
/** Lo que DUPR dice que salió mal, para el log y para mostrarle al equipo. */
export function mensajeDe(json: unknown): string {
  if (typeof json === 'string') return json.slice(0, 300);
  if (!esObj(json)) return '';
  const errores = Array.isArray(json.errors) ? json.errors.map((e) => (esObj(e) ? texto(e.message) : texto(e))).filter(Boolean).join(' · ') : '';
  return (texto(json.message) ?? texto(json.error) ?? errores).slice(0, 300);
}

async function pedir(fetchFn: Fetch, url: string, init: RequestInit): Promise<Respuesta> {
  const r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(12000) });
  const crudo = await r.text();
  let json: unknown = null;
  try { json = crudo ? JSON.parse(crudo) : null; } catch { json = crudo; }
  return { status: r.status, json };
}

// ─── API de partner ──────────────────────────────────────────────────────────

// El token de partner dura 1 hora y sirve para todos: se guarda mientras viva la función.
let tokenGuardado: { clave: string; token: string; vence: number } | null = null;
export function olvidarToken(): void { tokenGuardado = null; }

export async function tokenPartner(c: ConfigDupr, fetchFn: Fetch = fetch, ahora = Date.now()): Promise<string> {
  const clave = `${c.urls.partner}|${c.clientKey}`;
  if (tokenGuardado && tokenGuardado.clave === clave && tokenGuardado.vence - ahora > 5 * 60_000) return tokenGuardado.token;
  const r = await pedir(fetchFn, `${c.urls.partner}/auth/${V}/token`, {
    method: 'POST',
    // tal cual, sin "Basic" adelante (así lo pide DUPR)
    headers: { 'x-authorization': Buffer.from(`${c.clientKey}:${c.clientSecret}`).toString('base64') },
  });
  const resultado = esObj(r.json) && esObj(r.json.result) ? r.json.result : null;
  const token = resultado ? texto(resultado.token) : null;
  if (r.status !== 200 || !token) throw new ErrorDupr('DUPR no entregó el token de partner', r.status, r.json);
  const vence = Date.parse(texto(resultado?.expiry) ?? '');
  tokenGuardado = { clave, token, vence: Number.isFinite(vence) ? vence : ahora + 55 * 60_000 };
  return token;
}

async function partner(c: ConfigDupr, fetchFn: Fetch, metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta> {
  const hacer = async () => pedir(fetchFn, `${c.urls.partner}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${await tokenPartner(c, fetchFn)}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const r = await hacer();
  if (r.status !== 401) return r;
  olvidarToken(); // venció antes de lo que decía: se pide otro y se reintenta una vez
  return hacer();
}

const salioBien = (r: Respuesta) => r.status === 200 && esObj(r.json) && r.json.status === 'SUCCESS';

/** Registra la URL donde DUPR avisa los cambios de rating. DUPR la prueba en el momento con un POST. */
export async function registrarWebhook(c: ConfigDupr, webhookUrl: string, fetchFn: Fetch = fetch): Promise<{ ok: boolean; detalle: string }> {
  const r = await partner(c, fetchFn, 'POST', `/${V}/webhook`, { webhookUrl, topics: ['RATING'] });
  return { ok: salioBien(r), detalle: mensajeDe(r.json) || `HTTP ${r.status}` };
}

/** Anota jugadores al aviso de rating. Por cada uno DUPR manda enseguida un RATING_SEED con su rating actual. */
export async function suscribirRating(c: ConfigDupr, duprIds: string[], fetchFn: Fetch = fetch): Promise<{ ok: boolean; detalle: string }> {
  if (duprIds.length === 0) return { ok: true, detalle: '' };
  const r = await partner(c, fetchFn, 'POST', `/user/${V}/subscribe/webhook-event`, { duprIds, topic: 'RATING' });
  return { ok: salioBien(r), detalle: mensajeDe(r.json) || `HTTP ${r.status}` };
}

export interface UsuarioDupr {
  duprId: string;
  nombre: string | null;
  singles: number | null;
  dobles: number | null;
  fiabilidadSingles: number | null;
  fiabilidadDobles: number | null;
}

/** "4.125" → 4.125 · "NR", vacío o cualquier otra cosa → null. */
export function aRating(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x.trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}
const aNumero = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Datos y rating de un jugador conectado. null si DUPR no lo deja ver (403: todavía no conectó) o no existe. */
export async function usuarioPartner(c: ConfigDupr, duprId: string, fetchFn: Fetch = fetch): Promise<UsuarioDupr | null> {
  const r = await partner(c, fetchFn, 'GET', `/user/${V}/${encodeURIComponent(duprId)}`);
  const u = salioBien(r) && esObj(r.json) && esObj(r.json.result) ? r.json.result : null;
  if (!u) return null;
  const ratings = esObj(u.ratings) ? u.ratings : {};
  return {
    duprId: texto(u.id) ?? duprId,
    nombre: texto(u.fullName),
    singles: aRating(ratings.singles),
    dobles: aRating(ratings.doubles),
    fiabilidadSingles: aNumero(ratings.singlesReliabilityScore),
    fiabilidadDobles: aNumero(ratings.doublesReliabilityScore),
  };
}

export interface EquipoDupr { player1: string; player2?: string; game1: number }
/** Un partido como lo pide DUPR (sin el identifier, que depende del intento). */
export interface CuerpoPartido {
  location: string;
  matchDate: string;
  teamA: EquipoDupr;
  teamB: EquipoDupr;
  format: 'SINGLES' | 'DOUBLES';
  event: string;
  bracket: string;
  matchType: 'SIDEOUT' | 'RALLY';
  matchSource: 'CLUB' | 'PARTNER';
  clubId?: number;
  matchPlayType: 'TOURNAMENT';
}
export interface PartidoCreado { identifier: string; matchCode: string; hashedMatchCode: string | null }

/** Sube hasta 100 partidos de una. Un partido rechazado no frena a los demás: vuelven por separado. */
export async function crearPartidos(
  c: ConfigDupr, partidos: (CuerpoPartido & { identifier: string })[], fetchFn: Fetch = fetch,
): Promise<{ creados: PartidoCreado[]; errores: { identifier: string; error: string }[] }> {
  if (partidos.length === 0) return { creados: [], errores: [] };
  if (partidos.length > 100) throw new Error('DUPR acepta hasta 100 partidos por pedido');
  const r = await partner(c, fetchFn, 'POST', `/match/${V}/batch`, partidos);
  const resultado = esObj(r.json) && esObj(r.json.result) ? r.json.result : null;
  if (r.status !== 200 || !resultado) throw new ErrorDupr(`DUPR rechazó la subida: ${mensajeDe(r.json) || `HTTP ${r.status}`}`, r.status, r.json);
  const creados = (Array.isArray(resultado.matchCodes) ? resultado.matchCodes : []).flatMap((m): PartidoCreado[] => {
    const identifier = esObj(m) ? texto(m.identifier) : null;
    const matchCode = esObj(m) ? texto(m.matchCode) ?? (typeof m.matchCode === 'number' ? String(m.matchCode) : null) : null;
    return identifier && matchCode ? [{ identifier, matchCode, hashedMatchCode: esObj(m) ? texto(m.hashedMatchCode) : null }] : [];
  });
  const errores = (Array.isArray(resultado.errors) ? resultado.errors : []).flatMap((e) => {
    if (!esObj(e)) return [];
    const porCampo = esObj(e.errors)
      ? Object.entries(e.errors).map(([campo, msgs]) => `${campo}: ${Array.isArray(msgs) ? msgs.join(', ') : String(msgs)}`).join(' · ')
      : '';
    return [{ identifier: texto(e.identifier) ?? '', error: [texto(e.error), porCampo].filter(Boolean).join(' · ') || 'DUPR lo rechazó sin decir por qué' }];
  });
  return { creados, errores };
}

/** Corrige un partido ya subido (equipos, puntos o fecha): DUPR deshace y recalcula los ratings. */
export async function actualizarPartido(
  c: ConfigDupr, matchCode: string, partido: CuerpoPartido & { identifier: string }, fetchFn: Fetch = fetch,
): Promise<{ ok: boolean; detalle: string }> {
  const r = await partner(c, fetchFn, 'POST', `/match/${V}/update`, { matchId: Number(matchCode), ...partido });
  return { ok: salioBien(r), detalle: mensajeDe(r.json) || `HTTP ${r.status}` };
}

/** Borra un partido subido: DUPR deshace su efecto en los ratings. El identifier no se puede volver a usar. */
export async function borrarPartido(c: ConfigDupr, matchCode: string, identifier: string, fetchFn: Fetch = fetch): Promise<{ ok: boolean; detalle: string }> {
  const r = await partner(c, fetchFn, 'DELETE', `/match/${V}/delete`, { matchCode, identifier });
  return { ok: salioBien(r), detalle: mensajeDe(r.json) || `HTTP ${r.status}` };
}

// ─── API pública, con el token de cada jugador ───────────────────────────────

const conToken = (userToken: string) => ({ Authorization: `Bearer ${userToken}` });

export interface InfoBasica { duprId: string; nombre: string | null; genero: string | null; anioNacimiento: number | null; ubicacion: string | null }

/** Quién es el dueño de un token de jugador y qué datos aceptó compartir. null si el token no sirve. */
export async function infoBasica(c: ConfigDupr, userToken: string, fetchFn: Fetch = fetch): Promise<InfoBasica | null> {
  const r = await pedir(fetchFn, `${c.urls.publico}/public/user/info`, { method: 'GET', headers: conToken(userToken) });
  // un fallo "de adentro" llega como HTTP 200 con status FAILURE: hay que mirar las dos cosas
  if (!salioBien(r) || !esObj(r.json)) return null;
  const u = Array.isArray(r.json.results) && esObj(r.json.results[0]) ? r.json.results[0] : null;
  const duprId = u ? texto(u.duprId) : null;
  if (!u || !duprId) return null;
  return {
    duprId: duprId.toUpperCase(),
    nombre: texto(u.fullName),
    genero: texto(u.gender),
    anioNacimiento: typeof u.birthYear === 'number' && Number.isInteger(u.birthYear) ? u.birthYear : null,
    ubicacion: texto(u.location),
  };
}

export interface Habilitacion { habilitado: boolean; premium: boolean; verificado: boolean; crudo: unknown }

/** BASIC_L1 = puede jugar partidos con rating; PREMIUM_L1 = DUPR+. Acepta la respuesta con o sin la lista `subscriptions`. */
export function leerHabilitacion(json: unknown): Habilitacion {
  const items = esObj(json) && Array.isArray(json.subscriptions) ? json.subscriptions : [json];
  const torneos = new Set<string>();
  for (const s of items) {
    const ent = esObj(s) && esObj(s.entitlements) ? s.entitlements.tournaments : null;
    if (Array.isArray(ent)) for (const e of ent) if (typeof e === 'string') torneos.add(e);
  }
  return { habilitado: torneos.has('BASIC_L1'), premium: torneos.has('PREMIUM_L1'), verificado: torneos.has('VERIFIED_L1'), crudo: json };
}

export async function habilitacionDe(c: ConfigDupr, userToken: string, fetchFn: Fetch = fetch): Promise<Habilitacion | null> {
  const r = await pedir(fetchFn, `${c.urls.publico}/subscription/active`, { method: 'POST', headers: conToken(userToken) });
  return r.status === 200 ? leerHabilitacion(r.json) : null;
}

export interface ClubDupr { clubId: number; clubName: string; role: string }

/** Clubes del jugador y su rol. DUPR no documenta el envoltorio de esta respuesta: se aceptan las formas posibles. */
export function leerClubes(json: unknown): ClubDupr[] {
  const lista = Array.isArray(json) ? json
    : esObj(json) ? [json.membership, json.result, json.results, json.clubs].find(Array.isArray) ?? [] : [];
  return (lista as unknown[]).flatMap((m): ClubDupr[] => {
    if (!esObj(m)) return [];
    const clubId = Number(m.clubId);
    return Number.isSafeInteger(clubId) ? [{ clubId, clubName: texto(m.clubName) ?? '', role: (texto(m.role) ?? '').toUpperCase() }] : [];
  });
}

export async function clubesDe(c: ConfigDupr, userToken: string, fetchFn: Fetch = fetch): Promise<ClubDupr[] | null> {
  const r = await pedir(fetchFn, `${c.urls.publico}/user/club/membership`, { method: 'GET', headers: conToken(userToken) });
  return r.status === 200 ? leerClubes(r.json) : null;
}

/** Solo DIRECTOR u ORGANIZER pueden subir partidos a nombre de un club. */
export const puedeSubirPorElClub = (clubes: ClubDupr[], clubId: number) =>
  clubes.some((x) => x.clubId === clubId && (x.role === 'DIRECTOR' || x.role === 'ORGANIZER'));

/** Cambia el refresh token por un par nuevo (DUPR rota los dos). null si también venció: hay que conectar de nuevo. */
export async function refrescarToken(c: ConfigDupr, refreshToken: string, fetchFn: Fetch = fetch): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  const r = await pedir(fetchFn, `${c.urls.publico}/auth/v2.0/refresh`, { method: 'GET', headers: { 'x-refresh-token': refreshToken } });
  if (!salioBien(r) || !esObj(r.json)) return null;
  // v2.0 devuelve { accessToken, refreshToken }; v1.0, el token pelado
  const res = r.json.result;
  const accessToken = esObj(res) ? texto(res.accessToken) : texto(res);
  return accessToken ? { accessToken, refreshToken: esObj(res) ? texto(res.refreshToken) : null } : null;
}

// ─── Avisos (webhook) ────────────────────────────────────────────────────────

/** Compara el secreto de la URL sin filtrar por tiempo cuántos caracteres acertó. */
export function secretoValido(recibido: string | undefined, esperado: string): boolean {
  if (!recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type Aviso =
  | { tipo: 'registro' }
  | {
    tipo: 'rating'; evento: 'RATING' | 'RATING_SEED'; duprId: string;
    singles: number | null; dobles: number | null; fiabilidadSingles: number | null; fiabilidadDobles: number | null;
  }
  | { tipo: 'ignorado'; motivo: string };

/** Qué pide un aviso de DUPR. REGISTRATION es la prueba que hacen al registrar la URL. */
export function interpretarAviso(cuerpo: unknown): Aviso {
  if (!esObj(cuerpo)) return { tipo: 'ignorado', motivo: 'cuerpo vacío o que no es un objeto' };
  const evento = (texto(cuerpo.event) ?? '').toUpperCase();
  if (evento === 'REGISTRATION') return { tipo: 'registro' };
  if (evento !== 'RATING' && evento !== 'RATING_SEED') return { tipo: 'ignorado', motivo: `evento ${evento || 'sin nombre'}` };
  const m = esObj(cuerpo.message) ? cuerpo.message : null;
  const duprId = m ? texto(m.duprId) : null;
  if (!m || !duprId) return { tipo: 'ignorado', motivo: 'aviso de rating sin jugador' };
  // un jugador que nunca jugó llega con rating null: se anota igual que está suscripto
  const r = esObj(m.rating) ? m.rating : {};
  return {
    tipo: 'rating', evento, duprId: duprId.toUpperCase(),
    singles: aRating(r.singles), dobles: aRating(r.doubles),
    fiabilidadSingles: aNumero(r.singlesReliability), fiabilidadDobles: aNumero(r.doublesReliability),
  };
}

// ─── De un cuadro del gestor a partidos de DUPR ──────────────────────────────

// Lo mínimo del torneo que hace falta acá (el tipo completo vive en src/torneos/engine/tipos.ts;
// las funciones de api/ no pueden importar de src/: sus imports no llevan extensión).
type Slot = { tipo: 'seed'; parejaId: string } | { tipo: 'ganadorDe' | 'perdedorDe'; partidoId: string } | null;
export interface TorneoParaDupr {
  id: string;
  nombre: string;
  parejas: { id: string; nombre: string; jugadorIds?: string[] }[];
  grupos: { id: string; nombre: string }[];
  partidosGrupo: { id: string; grupoId: string; aId: string; bId: string; puntosA: number | null; puntosB: number | null; wo?: boolean }[];
  partidosLlave: { id: string; ronda: number; a: Slot; b: Slot; puntosA: number | null; puntosB: number | null; esTercerPuesto: boolean; wo?: boolean }[] | null;
}

/** Lo que se sabe de cada persona del padrón para decidir si su partido puede ir a DUPR. */
export interface JugadorParaDupr { nombre: string; duprId: string | null; conectado: boolean; habilitado: boolean | null }

export interface OpcionesSubida {
  fecha: string;        // yyyy-MM-dd
  lugar: string;
  evento: string;
  puntaje: 'SIDEOUT' | 'RALLY';
  clubId: number | null;
}

export interface PartidoDupr {
  partidoId: string;
  fase: string;
  a: string;
  b: string;
  puntos: [number, number] | null;
  /** Por qué NO va a DUPR. null = va. */
  motivo: string | null;
  cuerpo: CuerpoPartido | null;
}

type Llave = NonNullable<TorneoParaDupr['partidosLlave']>;
const puntosDe = (p: { puntosA: number | null; puntosB: number | null }): [number, number] | null =>
  (p.puntosA !== null && p.puntosB !== null && Number.isInteger(p.puntosA) && Number.isInteger(p.puntosB)
    && p.puntosA >= 0 && p.puntosB >= 0 && p.puntosA !== p.puntosB ? [p.puntosA, p.puntosB] : null);

// Mismas reglas que src/torneos/engine/llave.ts (resolverSlot / ganadorPartido).
function parejaDeSlot(slot: Slot, llave: Llave): string | null {
  if (slot === null) return null;
  if (slot.tipo === 'seed') return slot.parejaId;
  const previo = llave.find((p) => p.id === slot.partidoId);
  if (!previo) return null;
  const ganador = ganadorDe(previo, llave);
  if (ganador === null) return null;
  if (slot.tipo === 'ganadorDe') return ganador;
  const a = parejaDeSlot(previo.a, llave);
  return ganador === a ? parejaDeSlot(previo.b, llave) : a;
}
function ganadorDe(p: Llave[number], llave: Llave): string | null {
  const a = parejaDeSlot(p.a, llave);
  const b = parejaDeSlot(p.b, llave);
  if (p.a === null && b !== null) return b;
  if (p.b === null && a !== null) return a;
  if (a === null || b === null) return null;
  const r = puntosDe(p);
  return r ? (r[0] > r[1] ? a : b) : null;
}

/**
 * Todos los partidos de un cuadro, cada uno con lo que se le mandaría a DUPR o con el motivo
 * por el que no va: sin resultado, W.O., alguien sin DUPR o sin conectar, o un resultado que
 * DUPR no acepta. Decisión de Brian (3/10): los W.O. nunca van.
 */
export function partidosParaDupr(t: TorneoParaDupr, padron: Map<string, JugadorParaDupr>, o: OpcionesSubida): PartidoDupr[] {
  const pareja = new Map(t.parejas.map((p) => [p.id, p]));
  const nombre = (id: string | null) => (id ? pareja.get(id)?.nombre ?? '¿?' : 'A definir');

  // DUPR IDs de una pareja, o el motivo por el que no se pueden usar.
  const jugadoresDe = (id: string): { ids: string[] } | { falta: string } => {
    const p = pareja.get(id);
    const jugadorIds = p?.jugadorIds ?? [];
    if (!p || jugadorIds.length === 0) return { falta: `${p?.nombre ?? 'Una pareja'} no está vinculada al padrón` };
    const ids: string[] = [];
    for (const jid of jugadorIds) {
      const j = padron.get(jid);
      if (!j) return { falta: `${p.nombre}: hay un jugador que ya no está en el padrón` };
      if (!j.duprId) return { falta: `${j.nombre} no tiene DUPR` };
      if (!j.conectado) return { falta: `${j.nombre} todavía no conectó su cuenta DUPR` };
      if (j.habilitado === false) return { falta: `${j.nombre} no está habilitado en DUPR` };
      ids.push(j.duprId);
    }
    return { ids };
  };

  const armar = (partidoId: string, fase: string, aId: string | null, bId: string | null, p: { puntosA: number | null; puntosB: number | null; wo?: boolean }): PartidoDupr => {
    const puntos = puntosDe(p);
    const base = { partidoId, fase, a: nombre(aId), b: nombre(bId), puntos };
    const no = (motivo: string): PartidoDupr => ({ ...base, motivo, cuerpo: null });
    if (!aId || !bId || !puntos) return no('Sin resultado');
    if (p.wo) return no('W.O.: no se jugó');
    if (Math.max(...puntos) < 6) return no('DUPR no acepta un partido en el que el ganador hizo menos de 6 puntos');
    const ja = jugadoresDe(aId);
    if ('falta' in ja) return no(ja.falta);
    const jb = jugadoresDe(bId);
    if ('falta' in jb) return no(jb.falta);
    if (ja.ids.length !== jb.ids.length || ja.ids.length > 2) return no('Los dos lados no tienen la misma cantidad de jugadores');
    if (new Set([...ja.ids, ...jb.ids]).size !== ja.ids.length * 2) return no('Hay un jugador repetido en el partido');
    const equipo = (ids: string[], game1: number): EquipoDupr => ({ player1: ids[0], ...(ids[1] ? { player2: ids[1] } : {}), game1 });
    return {
      ...base, motivo: null,
      cuerpo: {
        location: o.lugar, matchDate: o.fecha,
        teamA: equipo(ja.ids, puntos[0]), teamB: equipo(jb.ids, puntos[1]),
        format: ja.ids.length === 1 ? 'SINGLES' : 'DOUBLES',
        event: o.evento, bracket: `${t.nombre} · ${fase}`,
        matchType: o.puntaje,
        ...(o.clubId ? { matchSource: 'CLUB' as const, clubId: o.clubId } : { matchSource: 'PARTNER' as const }),
        matchPlayType: 'TOURNAMENT',
      },
    };
  };

  const grupo = new Map(t.grupos.map((g) => [g.id, g.nombre]));
  const deGrupo = t.partidosGrupo.map((p) => armar(p.id, `Grupo ${grupo.get(p.grupoId) ?? '?'}`, p.aId, p.bId, p));
  const llave = t.partidosLlave ?? [];
  const maxRonda = Math.max(0, ...llave.filter((p) => !p.esTercerPuesto).map((p) => p.ronda));
  const deLlave = llave
    .filter((p) => p.a !== null && p.b !== null) // un pase directo no es un partido
    .map((p) => {
      const fase = p.esTercerPuesto ? '3er puesto' : p.ronda === maxRonda ? 'Final' : p.ronda === maxRonda - 1 ? 'Semifinal' : p.ronda === maxRonda - 2 ? 'Cuartos' : `Ronda ${p.ronda}`;
      return armar(p.id, fase, parejaDeSlot(p.a, llave), parejaDeSlot(p.b, llave), p);
    });
  return [...deGrupo, ...deLlave];
}

/** Hash de lo que se manda: si después cambia el resultado o un jugador, el partido figura como "cambió". */
export const huellaDe = (cuerpo: CuerpoPartido): string => createHash('sha256').update(JSON.stringify(cuerpo)).digest('hex').slice(0, 32);

/** El identifier tiene que ser único para siempre, incluso si el partido se borra: por eso lleva el intento. */
export const identifierDe = (entorno: Entorno, torneoId: string, partidoId: string, intento: number) =>
  `volea-${entorno}-${torneoId}-${partidoId}-${intento}`;

export interface FilaSubida {
  partido_id: string;
  intento: number;
  identifier: string;
  match_code: string | null;
  huella: string;
  estado: 'subido' | 'borrado' | 'error';
  error?: string | null;
}

export type Accion =
  | { tipo: 'subir'; partidoId: string; intento: number; identifier: string; cuerpo: CuerpoPartido }
  | { tipo: 'actualizar'; partidoId: string; intento: number; identifier: string; matchCode: string; cuerpo: CuerpoPartido }
  | { tipo: 'borrar'; partidoId: string; intento: number; identifier: string; matchCode: string };

export type EstadoEnDupr = 'subido' | 'por subir' | 'cambió' | 'por borrar' | 'no va';

/**
 * Compara el cuadro con lo que ya se mandó y dice qué hay que hacer: subir lo nuevo, actualizar
 * lo que cambió y borrar lo que dejó de corresponder (se le quitó el resultado, pasó a W.O.,
 * se rearmó la llave).
 */
export function planificarSubida(
  partidos: PartidoDupr[], filas: FilaSubida[], entorno: Entorno, torneoId: string,
): { acciones: Accion[]; estados: Record<string, EstadoEnDupr> } {
  const fila = new Map(filas.map((f) => [f.partido_id, f]));
  const acciones: Accion[] = [];
  const estados: Record<string, EstadoEnDupr> = {};
  const vistos = new Set<string>();
  for (const p of partidos) {
    vistos.add(p.partidoId);
    const f = fila.get(p.partidoId);
    const subido = f && f.estado === 'subido' && f.match_code ? f : null;
    if (!p.cuerpo) {
      if (subido) acciones.push({ tipo: 'borrar', partidoId: p.partidoId, intento: subido.intento, identifier: subido.identifier, matchCode: subido.match_code! });
      estados[p.partidoId] = subido ? 'por borrar' : 'no va';
      continue;
    }
    if (subido) {
      const igual = subido.huella === huellaDe(p.cuerpo);
      if (!igual) acciones.push({ tipo: 'actualizar', partidoId: p.partidoId, intento: subido.intento, identifier: subido.identifier, matchCode: subido.match_code!, cuerpo: p.cuerpo });
      estados[p.partidoId] = igual ? 'subido' : 'cambió';
      continue;
    }
    // Lo que se borró necesita un identifier nuevo; lo que falló se reintenta con el mismo.
    const intento = f ? (f.estado === 'borrado' ? f.intento + 1 : f.intento) : 1;
    acciones.push({ tipo: 'subir', partidoId: p.partidoId, intento, identifier: identifierDe(entorno, torneoId, p.partidoId, intento), cuerpo: p.cuerpo });
    estados[p.partidoId] = 'por subir';
  }
  // Partidos subidos que ya no existen en el cuadro (se rearmó la llave).
  for (const f of filas) {
    if (vistos.has(f.partido_id) || f.estado !== 'subido' || !f.match_code) continue;
    acciones.push({ tipo: 'borrar', partidoId: f.partido_id, intento: f.intento, identifier: f.identifier, matchCode: f.match_code });
    estados[f.partido_id] = 'por borrar';
  }
  return { acciones, estados };
}
