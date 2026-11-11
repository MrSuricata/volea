// Del torneo del gestor al partido que marca el árbitro: quién juega (resolviendo los cruces de la
// llave), con qué formato y en qué orden van en la hoja de códigos.
import type { FormatoArbitraje, Torneo } from '../engine/tipos';
import { resolverSlot } from '../engine/llave';
import { FORMATO_DEFECTO } from './motor';

export type LadoPartido = { parejaId: string; nombre: string; jugadores: string[] };
export type PartidoArbitrado = { fase: 'grupo' | 'llave'; titulo: string; a: LadoPartido | null; b: LadoPartido | null; jugado: boolean };

// "Ana Pérez y Luis Gómez", "Ana / Luis", "Ana - Luis", "João e Maria", "Ana & Luis". Un guion sin
// espacios ("Ana-María") es parte del nombre.
export const jugadoresDe = (nombre: string) =>
  nombre.split(/\s+(?:y|e|and)\s+|\s*[/&+]\s*|\s+[-–—]\s+/i).map((s) => s.trim()).filter(Boolean);

/** Nombre del jugador i de la pareja; si la pareja no se pudo separar, "Jugador 1/2" (nunca vacío). */
export function nombreJugador(jugadores: string[], i: 0 | 1): string {
  return jugadores.length >= 2 ? jugadores[i] : `Jugador ${i + 1}`;
}

/** Resultado del partido en el cuadro (para comprobar si un "Terminar" sin respuesta llegó igual). */
export function resultadoEnCuadro(t: Torneo, partidoId: string): { puntosA: number; puntosB: number; games?: { a: number; b: number }[] } | null {
  const p = t.partidosGrupo.find((x) => x.id === partidoId) ?? (t.partidosLlave ?? []).find((x) => x.id === partidoId);
  if (!p || p.puntosA === null || p.puntosB === null) return null;
  return p.games ? { puntosA: p.puntosA, puntosB: p.puntosB, games: p.games } : { puntosA: p.puntosA, puntosB: p.puntosB };
}

function lado(t: Torneo, parejaId: string | null): LadoPartido | null {
  if (!parejaId) return null;
  const p = t.parejas.find((x) => x.id === parejaId);
  return p ? { parejaId, nombre: p.nombre, jugadores: jugadoresDe(p.nombre) } : null;
}

const RONDAS: Record<number, string> = { 1: 'Final', 2: 'Semifinal', 4: 'Cuartos', 8: 'Octavos' };

export function ladosDelPartido(t: Torneo, partidoId: string): PartidoArbitrado | null {
  const g = t.partidosGrupo.find((p) => p.id === partidoId);
  if (g) {
    const grupo = t.grupos.find((x) => x.id === g.grupoId);
    return { fase: 'grupo', titulo: `Grupo ${grupo?.nombre ?? ''} · Ronda ${g.ronda}${g.etiqueta ? ` · ${g.etiqueta}` : ''}`, a: lado(t, g.aId), b: lado(t, g.bId), jugado: g.puntosA !== null };
  }
  const llave = t.partidosLlave ?? [];
  const l = llave.find((p) => p.id === partidoId);
  if (!l) return null;
  const enRonda = llave.filter((p) => p.ronda === l.ronda && !p.esTercerPuesto).length;
  const titulo = l.esTercerPuesto ? 'Tercer puesto' : RONDAS[enRonda] ?? `Ronda ${l.ronda}`;
  return {
    fase: 'llave', titulo,
    a: lado(t, resolverSlot(l.a, llave)), b: lado(t, resolverSlot(l.b, llave)),
    jugado: l.puntosA !== null,
  };
}

export function formatoDe(t: Torneo, fase: 'grupo' | 'llave'): FormatoArbitraje {
  const f = fase === 'grupo' ? t.arbitraje?.grupos : t.arbitraje?.llave ?? t.arbitraje?.grupos;
  return f ?? FORMATO_DEFECTO;
}

export function esDobles(t: Torneo): boolean {
  return t.parejas.some((p) => (p.jugadorIds?.length ?? 0) >= 2 || jugadoresDe(p.nombre).length >= 2);
}

/** Partidos que pueden tener árbitro, en orden de juego (grupos por ronda, llave por ronda). Sin byes. */
export function partidosArbitrables(t: Torneo): { partidoId: string; fase: 'grupo' | 'llave' }[] {
  const grupos = [...t.partidosGrupo].sort((x, y) => x.ronda - y.ronda).map((p) => ({ partidoId: p.id, fase: 'grupo' as const }));
  const llave = [...(t.partidosLlave ?? [])]
    .filter((p) => p.a !== null && p.b !== null)
    .sort((x, y) => x.ronda - y.ronda || x.posicion - y.posicion)
    .map((p) => ({ partidoId: p.id, fase: 'llave' as const }));
  return [...grupos, ...llave];
}
