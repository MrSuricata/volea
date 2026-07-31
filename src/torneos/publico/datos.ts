import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../services/supabaseClient';
import { conLimite } from '../../utils/arranque';
import type { ConfigPuntos, Jugador, Torneo } from '../engine/tipos';
import { CONFIG_PUNTOS_DEFAULT } from '../engine/tipos';

// Lectura pública (anónima, sin auth) de las tablas rk_*, para /ranking, /torneos y
// /torneos/:id. Este módulo NUNCA escribe. La visibilidad la decide RLS del lado del
// server (rk_torneos: SELECT anon solo con visible = true) — acá NO se repite ese filtro
// a mano ni se lo trata como si fuera la seguridad real: lo que la consulta no devuelve,
// para este módulo directamente no existe (ver spec §5).

const MSG_SIN_SERVICIO = 'No se pudo conectar con el servidor. Probá de nuevo en un rato.';
const TIMEOUT_MS = 8000;

export type ListaTorneosResultado = { torneos: Torneo[]; error: string | null };
export type TorneoResultado = { torneo: Torneo | null; updatedAt: string | null; error: string | null };
export type JugadoresResultado = { jugadores: Jugador[]; error: string | null };

// Cada función pública de este módulo usa conLimite (src/utils/arranque.ts, ya probado y
// usado para el techo de 4s del arranque general): un pedido colgado (Supabase frío, red
// mala) NUNCA deja la página pública en "Cargando…" para siempre — a los TIMEOUT_MS se
// resuelve con un resultado de error, visible y accionable (botón "Reintentar").

async function cargarTorneos(client: SupabaseClient): Promise<ListaTorneosResultado> {
  const { data: filas, error } = await client.from('rk_torneos').select('id, data, updated_at');
  if (error) {
    console.error('[torneos publico] no se pudo listar torneos', error);
    return { torneos: [], error: MSG_SIN_SERVICIO };
  }
  const torneos = (filas ?? [])
    .map((f) => f.data as Torneo)
    .filter((t): t is Torneo => !!t && typeof t.id === 'string');
  return { torneos, error: null };
}

export async function listarTorneosPublicos(): Promise<ListaTorneosResultado> {
  if (!supabase) return { torneos: [], error: MSG_SIN_SERVICIO };
  return conLimite(cargarTorneos(supabase), TIMEOUT_MS, { torneos: [], error: MSG_SIN_SERVICIO });
}

async function cargarTorneo(client: SupabaseClient, id: string): Promise<TorneoResultado> {
  const { data: fila, error } = await client.from('rk_torneos').select('data, updated_at').eq('id', id).maybeSingle();
  if (error) {
    console.error('[torneos publico] no se pudo leer el torneo', id, error);
    return { torneo: null, updatedAt: null, error: MSG_SIN_SERVICIO };
  }
  // fila === null: no existe o RLS lo filtró por estar oculto — "no encontrado", no es un error.
  if (!fila) return { torneo: null, updatedAt: null, error: null };
  return { torneo: fila.data as Torneo, updatedAt: fila.updated_at as string, error: null };
}

export async function obtenerTorneoPublico(id: string): Promise<TorneoResultado> {
  if (!supabase) return { torneo: null, updatedAt: null, error: MSG_SIN_SERVICIO };
  return conLimite(cargarTorneo(supabase, id), TIMEOUT_MS, { torneo: null, updatedAt: null, error: MSG_SIN_SERVICIO });
}

async function cargarJugadores(client: SupabaseClient): Promise<JugadoresResultado> {
  const { data: filas, error } = await client.from('rk_jugadores').select('id, nombre, alias');
  if (error) {
    console.error('[torneos publico] no se pudo listar jugadores', error);
    return { jugadores: [], error: MSG_SIN_SERVICIO };
  }
  const jugadores = (filas ?? []).map((f) => ({
    id: f.id as string,
    nombre: f.nombre as string,
    alias: (f.alias as string[] | null) ?? [],
  }));
  return { jugadores, error: null };
}

export async function listarJugadoresPublicos(): Promise<JugadoresResultado> {
  if (!supabase) return { jugadores: [], error: MSG_SIN_SERVICIO };
  return conLimite(cargarJugadores(supabase), TIMEOUT_MS, { jugadores: [], error: MSG_SIN_SERVICIO });
}

async function cargarConfig(client: SupabaseClient): Promise<ConfigPuntos> {
  const { data: fila, error } = await client.from('rk_config').select('data').eq('id', 1).maybeSingle();
  if (error || !fila) return CONFIG_PUNTOS_DEFAULT;
  const cfg = fila.data as Partial<ConfigPuntos> | null;
  if (!cfg || !Array.isArray(cfg.escalera) || cfg.escalera.length !== 6 || typeof cfg.offsetB !== 'number') {
    return CONFIG_PUNTOS_DEFAULT;
  }
  return cfg as ConfigPuntos;
}

// Nunca falla "hacia afuera": sin fila en el server (sin conexión, o timeout), cae al
// default de la app (el mismo que usa el gestor cuando arranca de cero). Así el ranking
// público siempre puede calcularse con algo razonable en vez de quedar bloqueado por la config.
export async function obtenerConfigPublico(): Promise<ConfigPuntos> {
  if (!supabase) return CONFIG_PUNTOS_DEFAULT;
  return conLimite(cargarConfig(supabase), TIMEOUT_MS, CONFIG_PUNTOS_DEFAULT);
}
