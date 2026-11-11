// Acceso a la base del tanteador de árbitros. El árbitro no tiene sesión: todo pasa por RPC con el código.
// Funciona contra la base v36 (respuestas sin estado/motivo/resultado) y contra la v37.
import { supabase } from '../../services/supabaseClient';
import type { FormatoArbitraje, Torneo } from '../engine/tipos';
import type { Jugada, Marcador } from './motor';
import { esDobles, formatoDe, jugadoresDe, partidosArbitrables, type PartidoArbitrado } from './partido';
import { interpretar, mensajeAmigable, type Resultado, type Respuesta } from './sincro';

export type PartidoDelArbitro = {
  torneoId: string; partidoId: string; formato: FormatoArbitraje; dobles: boolean;
  jugadas: Jugada[]; version: number; estado: 'pendiente' | 'en_juego' | 'terminado';
  // v37 (en la v36 no vienen):
  motivo?: 'terminado' | 'cargado_en_mesa'; resultado?: Resultado | null; rivales?: boolean | null;
  cuadro?: PartidoArbitrado | null; // quién juega, según la base (sirve aunque el torneo esté oculto)
};
type Res<T> = { ok: true; valor: T } | { ok: false; error: string; red?: boolean };

const sinConexion = { ok: false as const, error: 'Sin conexión con el servidor', red: true };

// Con mala señal un pedido puede quedar colgado: a los 12 s se da por perdido (si igual llegó, la
// reconciliación lo reconoce como propio).
const ESPERA_MS = 12000;
async function conEspera<T>(p: PromiseLike<T>): Promise<T | 'timeout'> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<'timeout'>((r) => { reloj = setTimeout(() => r('timeout'), ESPERA_MS); });
  try { return await Promise.race([Promise.resolve(p), limite]); } finally { clearTimeout(reloj); }
}

export async function entrar(codigo: string): Promise<Res<PartidoDelArbitro>> {
  if (!supabase) return sinConexion;
  const r = await conEspera(supabase.rpc('arbitro_entrar', { p_codigo: codigo }));
  if (r === 'timeout' || r.error) return { ok: false, error: 'Sin señal: no se pudo conectar con el servidor.', red: true };
  const data = r.data;
  if (!data?.ok) return { ok: false, error: mensajeAmigable(data?.error) || 'Código incorrecto' };
  return { ok: true, valor: {
    torneoId: data.torneo_id, partidoId: data.partido_id, formato: data.formato, dobles: data.dobles !== false,
    jugadas: (data.jugadas ?? []) as Jugada[], version: data.version ?? 0, estado: data.estado ?? 'pendiente',
    motivo: data.motivo === 'cargado_en_mesa' ? 'cargado_en_mesa' : data.motivo === 'terminado' ? 'terminado' : undefined,
    resultado: (data.resultado ?? null) as Resultado | null, rivales: typeof data.rivales === 'boolean' ? data.rivales : null,
    cuadro: cuadroDe(data.cuadro),
  } };
}

type LadoCrudo = { parejaId?: unknown; nombre?: unknown } | null | undefined;
const ladoDe = (l: LadoCrudo) => (l && typeof l.nombre === 'string' && typeof l.parejaId === 'string'
  ? { parejaId: l.parejaId, nombre: l.nombre, jugadores: jugadoresDe(l.nombre) } : null);

/** El `cuadro` que devuelve arbitro_entrar en la v37 (en la v36 no viene). */
export function cuadroDe(x: unknown): PartidoArbitrado | null {
  if (!x || typeof x !== 'object') return null;
  const c = x as { fase?: unknown; titulo?: unknown; a?: LadoCrudo; b?: LadoCrudo };
  if (c.fase !== 'grupo' && c.fase !== 'llave') return null;
  return { fase: c.fase, titulo: typeof c.titulo === 'string' ? c.titulo : '', a: ladoDe(c.a), b: ladoDe(c.b), jugado: false };
}

export async function marcar(codigo: string, version: number, jugadas: Jugada[], marcador: Marcador): Promise<Respuesta> {
  if (!supabase) return { tipo: 'red' };
  const r = await conEspera(supabase.rpc('arbitro_marcar', { p_codigo: codigo, p_version: version, p_jugadas: jugadas, p_marcador: marcador }));
  return r === 'timeout' ? { tipo: 'red' } : interpretar(r.data, r.error);
}

export async function terminar(codigo: string, version: number, jugadas: Jugada[], marcador: Marcador, resultado: Resultado): Promise<Respuesta> {
  if (!supabase) return { tipo: 'red' };
  const r = await conEspera(supabase.rpc('arbitro_terminar', { p_codigo: codigo, p_version: version, p_jugadas: jugadas, p_marcador: marcador, p_resultado: resultado }));
  return r === 'timeout' ? { tipo: 'red' } : interpretar(r.data, r.error);
}

/** Torneo leído como público (para los nombres). 'red' = sin señal; null = no está o no es público. */
export async function leerTorneo(torneoId: string): Promise<Torneo | null | 'red'> {
  if (!supabase) return 'red';
  const r = await conEspera(supabase.from('rk_torneos').select('data').eq('id', torneoId).maybeSingle());
  if (r === 'timeout' || r.error) return 'red';
  return (r.data?.data as Torneo | undefined) ?? null;
}

/** Gestor: crea/actualiza los códigos del torneo y los devuelve por partido. */
export async function codigosDelTorneo(t: Torneo): Promise<Res<{ codigos: Map<string, string>; cuatroCifras: number }>> {
  if (!supabase) return sinConexion;
  const partidos = partidosArbitrables(t).map((p) => ({ partido_id: p.partidoId, formato: formatoDe(t, p.fase) }));
  const { data, error } = await supabase.rpc('admin_codigos_torneo', { p_torneo_id: t.id, p_dobles: esDobles(t), p_partidos: partidos });
  if (error) return { ok: false, error: error.message.includes('admin_codigos_torneo') ? 'Falta la actualización de la base (v35).' : 'No se pudieron generar los códigos (¿sesión vencida?)' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'error' };
  return { ok: true, valor: {
    codigos: new Map((data.codigos as { partido_id: string; codigo: string }[]).map((c) => [c.partido_id, c.codigo])),
    cuatroCifras: typeof data.cuatro_cifras === 'number' ? data.cuatro_cifras : 0,
  } };
}

/** Gestor (v37): cambia los códigos de 4 cifras de partidos que no empezaron por unos de 6. */
export async function renovarCodigos(torneoId: string): Promise<Res<number>> {
  if (!supabase) return sinConexion;
  const { data, error } = await supabase.rpc('admin_codigos_renovar', { p_torneo_id: torneoId });
  if (error) return { ok: false, error: 'No se pudieron renovar (¿falta la actualización v37 de la base?)' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'error' };
  return { ok: true, valor: data.renovados as number };
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
