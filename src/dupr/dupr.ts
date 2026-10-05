import { supabase } from '../services/supabaseClient';

// Lado web de la integración con DUPR. El servidor (api/dupr/*) es el que habla con DUPR;
// acá solo se pregunta si está activa, se recibe lo que devuelve la página de login de DUPR
// y se le pasa al servidor para que lo compruebe. Guía: docs/DUPR.md.

export type ConfigDuprWeb =
  | { habilitado: false }
  | { habilitado: true; entorno: 'uat' | 'prod'; login: string; conClub: boolean };

const APAGADO: ConfigDuprWeb = { habilitado: false };

/** Lo que contestó /api/dupr/config, o "apagado" si no es lo esperado (en dev local no hay funciones). */
export function leerConfig(json: unknown): ConfigDuprWeb {
  if (typeof json !== 'object' || json === null) return APAGADO;
  const j = json as Record<string, unknown>;
  if (j.habilitado !== true || typeof j.login !== 'string' || !/^https?:\/\//.test(j.login)) return APAGADO;
  return { habilitado: true, entorno: j.entorno === 'prod' ? 'prod' : 'uat', login: j.login, conClub: j.conClub === true };
}

let pedida: Promise<ConfigDuprWeb> | null = null;

/** ¿La web tiene DUPR conectado? Se pregunta una sola vez; ante cualquier falla vale "no" y todo queda como antes. */
export function configDupr(): Promise<ConfigDuprWeb> {
  pedida ??= fetch('/api/dupr/config')
    .then((r) => (r.ok ? r.json() : null))
    .then(leerConfig)
    .catch(() => APAGADO);
  return pedida;
}

export type SesionDupr = { userToken: string; refreshToken: string | null };

/**
 * Lo que manda la página de login de DUPR (dentro del iframe) cuando la persona termina de
 * iniciar sesión. Solo vale si viene del origen de DUPR: cualquier otra ventana puede mandar
 * mensajes a la página.
 */
export function leerMensajeDeLogin(evento: { origin: string; data: unknown }, login: string): SesionDupr | null {
  let origen: string;
  try { origen = new URL(login).origin; } catch { return null; }
  if (evento.origin !== origen) return null;
  let d = evento.data;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return null; }
  }
  if (typeof d !== 'object' || d === null) return null;
  const j = d as Record<string, unknown>;
  const userToken = typeof j.userToken === 'string' ? j.userToken : typeof j.accessToken === 'string' ? j.accessToken : '';
  if (userToken.trim() === '') return null;
  return { userToken: userToken.trim(), refreshToken: typeof j.refreshToken === 'string' && j.refreshToken.trim() !== '' ? j.refreshToken.trim() : null };
}

/** Una cuenta DUPR ya comprobada por el servidor. El ticket es lo que canjea la inscripción. */
export type ConexionDupr = {
  ticket: string;
  duprId: string;
  nombre: string | null;
  singles: number | null;
  dobles: number | null;
  anioNacimiento: number | null;
  /** false = DUPR no la habilita para partidos con rating; null = no se pudo consultar. */
  habilitado: boolean | null;
  premium: boolean | null;
};

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

async function tokenDelPanel(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function post<T>(url: string, cuerpo: unknown, conSesion: boolean): Promise<Resultado<T>> {
  try {
    const token = conSesion ? await tokenDelPanel() : null;
    if (conSesion && !token) return { ok: false, error: 'Tu sesión del panel venció: entrá de nuevo' };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(cuerpo),
    });
    const json = await r.json().catch(() => null) as (T & { error?: unknown }) | null;
    if (!r.ok || json === null) {
      return { ok: false, error: typeof json?.error === 'string' ? json.error : 'No pudimos comunicarnos con el servidor. Probá de nuevo.' };
    }
    return { ok: true, datos: json };
  } catch {
    return { ok: false, error: 'No pudimos comunicarnos con el servidor. Probá de nuevo.' };
  }
}

/** Le pasa al servidor la sesión que entregó DUPR para que compruebe de quién es. */
export function conectarConDupr(sesion: SesionDupr, opciones: { comoEquipo?: boolean } = {}): Promise<Resultado<ConexionDupr>> {
  return post<ConexionDupr>('/api/dupr/conectar', { ...sesion, comoEquipo: opciones.comoEquipo === true }, opciones.comoEquipo === true);
}

/** Deja la inscripción recién hecha asociada a la cuenta DUPR conectada. */
export async function asociarInscripcion(inscripcionId: string, ticket: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Sin conexión con el servidor' };
  const { data, error } = await supabase.rpc('inscripcion_conectar_dupr', { p_inscripcion_id: inscripcionId, p_ticket: ticket });
  if (error) {
    console.error('Error asociando la inscripción con DUPR:', error);
    return { ok: false, error: 'No pudimos asociar tu cuenta DUPR a la inscripción' };
  }
  return { ok: data?.ok === true, error: typeof data?.error === 'string' ? data.error : undefined };
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export type EstadoDupr =
  | { configurado: false }
  | {
    configurado: true;
    entorno: 'uat' | 'prod';
    clubId: number | null;
    webhook: string;
    conexiones: number;
    sinSuscribir: number;
    miCuenta: { duprId: string; nombre: string | null; club: 'ok' | 'sin-rol' | 'vencida' | 'sin-club' } | null;
  };

export type EstadoPartido = 'subido' | 'por subir' | 'cambió' | 'por borrar' | 'no va';

export type RevisionTorneo = {
  torneo: string;
  partidos: { partidoId: string; fase: string; a: string; b: string; puntos: [number, number] | null; motivo: string | null; estado: EstadoPartido; error: string | null }[];
  resumen: { subidos: number; porSubir: number; cambiaron: number; porBorrar: number; noVan: number };
  hecho?: { subidos: number; actualizados: number; borrados: number; errores: { partidoId: string; error: string }[]; pendientes: number };
};

export type PedidoTorneo = { torneoId: string; fecha: string; lugar: string; evento: string; puntaje: 'SIDEOUT' | 'RALLY' };

/** Acciones del equipo sobre DUPR (van con la sesión del panel). */
export const panelDupr = {
  estado: () => post<EstadoDupr>('/api/dupr/admin', { accion: 'estado' }, true),
  registrarWebhook: () => post<{ ok: true }>('/api/dupr/admin', { accion: 'registrar-webhook' }, true),
  suscribirPendientes: () => post<{ ok: true; suscriptos: number }>('/api/dupr/admin', { accion: 'suscribir-pendientes' }, true),
  revisar: (p: PedidoTorneo) => post<RevisionTorneo>('/api/dupr/admin', { accion: 'torneo', ...p }, true),
  sincronizar: (p: PedidoTorneo) => post<RevisionTorneo>('/api/dupr/admin', { accion: 'sincronizar', ...p }, true),
};
