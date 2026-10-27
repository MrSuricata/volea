// Acceso a la base del tanteador de árbitros. El árbitro no tiene sesión: todo pasa por RPC con el código.
import { supabase } from '../../services/supabaseClient';
import type { FormatoArbitraje, Torneo } from '../engine/tipos';
import type { Jugada, Marcador } from './motor';
import { esDobles, formatoDe, partidosArbitrables } from './partido';

export type PartidoDelArbitro = {
  torneoId: string; partidoId: string; formato: FormatoArbitraje; dobles: boolean;
  jugadas: Jugada[]; version: number; estado: 'pendiente' | 'en_juego' | 'terminado';
};
type Res<T> = { ok: true; valor: T } | { ok: false; error: string; jugadas?: Jugada[]; version?: number };

const sinConexion = { ok: false as const, error: 'Sin conexión con el servidor' };

export async function entrar(codigo: string): Promise<Res<PartidoDelArbitro>> {
  if (!supabase) return sinConexion;
  const { data, error } = await supabase.rpc('arbitro_entrar', { p_codigo: codigo });
  if (error) return { ok: false, error: 'No se pudo conectar. Probá de nuevo.' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'Código incorrecto' };
  return { ok: true, valor: {
    torneoId: data.torneo_id, partidoId: data.partido_id, formato: data.formato, dobles: data.dobles !== false,
    jugadas: (data.jugadas ?? []) as Jugada[], version: data.version ?? 0, estado: data.estado,
  } };
}

export async function marcar(codigo: string, version: number, jugadas: Jugada[], marcador: Marcador): Promise<Res<number>> {
  if (!supabase) return sinConexion;
  const { data, error } = await supabase.rpc('arbitro_marcar', { p_codigo: codigo, p_version: version, p_jugadas: jugadas, p_marcador: marcador });
  if (error) return { ok: false, error: 'red' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'error', jugadas: data?.jugadas, version: data?.version };
  return { ok: true, valor: data.version as number };
}

export async function terminar(codigo: string, version: number, jugadas: Jugada[], marcador: Marcador, resultado: { puntosA: number; puntosB: number; games?: { a: number; b: number }[] }): Promise<Res<null>> {
  if (!supabase) return sinConexion;
  const { data, error } = await supabase.rpc('arbitro_terminar', { p_codigo: codigo, p_version: version, p_jugadas: jugadas, p_marcador: marcador, p_resultado: resultado });
  if (error) return { ok: false, error: 'red' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'error', jugadas: data?.jugadas, version: data?.version };
  return { ok: true, valor: null };
}

/** Torneo leído como público (para los nombres). null si no se pudo (p. ej. torneo oculto). */
export async function leerTorneo(torneoId: string): Promise<Torneo | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('rk_torneos').select('data').eq('id', torneoId).maybeSingle();
  return (data?.data as Torneo | undefined) ?? null;
}

/** Gestor: crea/actualiza los códigos del torneo y los devuelve por partido. */
export async function codigosDelTorneo(t: Torneo): Promise<Res<Map<string, string>>> {
  if (!supabase) return sinConexion;
  const partidos = partidosArbitrables(t).map((p) => ({ partido_id: p.partidoId, formato: formatoDe(t, p.fase) }));
  const { data, error } = await supabase.rpc('admin_codigos_torneo', { p_torneo_id: t.id, p_dobles: esDobles(t), p_partidos: partidos });
  if (error) return { ok: false, error: error.message.includes('admin_codigos_torneo') ? 'Falta la actualización de la base (v35).' : 'No se pudieron generar los códigos (¿sesión vencida?)' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'error' };
  return { ok: true, valor: new Map((data.codigos as { partido_id: string; codigo: string }[]).map((c) => [c.partido_id, c.codigo])) };
}

export type MarcadorEnVivo = { torneoId: string; partidoId: string; estado: string; marcador: Marcador | null; actualizado: string };

export async function marcadoresEnJuego(): Promise<MarcadorEnVivo[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('arbitraje_partidos').select('torneo_id, partido_id, estado, marcador, actualizado').eq('estado', 'en_juego');
  if (error || !data) return [];
  return data.map((r) => ({ torneoId: r.torneo_id, partidoId: r.partido_id, estado: r.estado, marcador: r.marcador as Marcador | null, actualizado: r.actualizado }));
}

export function suscribirMarcadores(alCambiar: () => void): () => void {
  const sb = supabase;
  if (!sb) return () => {};
  const canal = sb.channel('arbitraje-marcadores')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'arbitraje_partidos' }, alCambiar)
    .subscribe();
  return () => { void sb.removeChannel(canal); };
}
