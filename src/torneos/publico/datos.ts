import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../services/supabaseClient';
import { conLimite, conReintento } from '../../utils/arranque';
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
// Y ANTES de mostrar ese error se reintenta UNA vez solo (conReintento): una conexión
// trabada suele andar al segundo intento con socket nuevo — visto en la práctica en la
// PC del trabajo de Brian, donde la primera tanda de consultas a veces se queda muda.

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
  const sb = supabase;
  if (!sb) return { torneos: [], error: MSG_SIN_SERVICIO };
  return conReintento(
    () => conLimite(cargarTorneos(sb), TIMEOUT_MS, { torneos: [], error: MSG_SIN_SERVICIO }),
    (r) => r.error !== null,
  );
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
  const sb = supabase;
  if (!sb) return { torneo: null, updatedAt: null, error: MSG_SIN_SERVICIO };
  return conReintento(
    () => conLimite(cargarTorneo(sb, id), TIMEOUT_MS, { torneo: null, updatedAt: null, error: MSG_SIN_SERVICIO }),
    (r) => r.error !== null,
  );
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
  const sb = supabase;
  if (!sb) return { jugadores: [], error: MSG_SIN_SERVICIO };
  return conReintento(
    () => conLimite(cargarJugadores(sb), TIMEOUT_MS, { jugadores: [], error: MSG_SIN_SERVICIO }),
    (r) => r.error !== null,
  );
}

// `confiable: false` = no se pudo leer la config del server y se está usando el default.
// Importa porque si algún día se edita la escalera desde el admin, calcular con el default
// daría puntajes DISTINTOS a los del gestor, presentados con total seguridad bajo el título
// "Ranking VOLEA". El que muestra decide qué hacer con esa duda (hoy: avisar).
export type ConfigResultado = { config: ConfigPuntos; confiable: boolean };

async function cargarConfig(client: SupabaseClient): Promise<ConfigResultado> {
  const { data: fila, error } = await client.from('rk_config').select('data').eq('id', 1).maybeSingle();
  if (error) return { config: CONFIG_PUNTOS_DEFAULT, confiable: false };
  // Sin fila: el server no tiene config propia y el default ES la verdad (mismo caso que
  // el gestor arrancando de cero). Eso sí es confiable, a diferencia de un fetch fallido.
  if (!fila) return { config: CONFIG_PUNTOS_DEFAULT, confiable: true };
  const cfg = fila.data as Partial<ConfigPuntos> | null;
  if (!cfg || !Array.isArray(cfg.escalera) || cfg.escalera.length !== 6 || typeof cfg.offsetB !== 'number') {
    return { config: CONFIG_PUNTOS_DEFAULT, confiable: false }; // fila corrupta: no sabemos con qué se calculó
  }
  return { config: cfg as ConfigPuntos, confiable: true };
}

export async function obtenerConfigPublico(): Promise<ConfigResultado> {
  const respaldo: ConfigResultado = { config: CONFIG_PUNTOS_DEFAULT, confiable: false };
  const sb = supabase;
  if (!sb) return respaldo;
  return conReintento(
    () => conLimite(cargarConfig(sb), TIMEOUT_MS, respaldo),
    (r) => !r.confiable,
  );
}
