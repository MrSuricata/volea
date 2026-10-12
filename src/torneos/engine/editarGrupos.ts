// Cambios en la fase de grupos con el torneo en marcha: agregar, sacar o mover una dupla,
// cambiarle el nombre (otro jugador) y agregar la vuelta a un grupo. Regla de oro: los
// partidos que ya tienen resultado y siguen teniendo sentido NO se tocan; solo se agregan los
// cruces que faltan y se borran los que involucran a quien ya no está en el grupo.
import type { Pareja, PartidoGrupo, Torneo } from './tipos';
import { nuevoId, resultadoDe } from './tipos';
import { generarFixture } from './fixture';

const clavePar = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** El grupo se juega a ida y vuelta si algún cruce está dos veces. */
export function grupoConVuelta(t: Torneo, grupoId: string): boolean {
  const vistos = new Set<string>();
  for (const p of t.partidosGrupo) {
    if (p.grupoId !== grupoId) continue;
    const k = clavePar(p.aId, p.bId);
    if (vistos.has(k)) return true;
    vistos.add(k);
  }
  return false;
}

/** Partidos de un grupo que borraría un cambio, con resultado (para avisar antes). */
export function jugadosDe(t: Torneo, parejaId: string): number {
  return t.partidosGrupo.filter((p) => (p.aId === parejaId || p.bId === parejaId) && resultadoDe(p) !== null).length;
}

/**
 * Deja el grupo con exactamente estas duplas: conserva los partidos entre ellas (jugados o no),
 * borra los que involucran a alguien que ya no está y agrega los cruces que faltan al final
 * (rondas nuevas, en el orden del método del círculo). Respeta ida y vuelta.
 */
export function rearmarGrupo(t: Torneo, grupoId: string, parejaIds: string[], opts: { vuelta?: boolean } = {}): Torneo {
  const vuelta = opts.vuelta ?? grupoConVuelta(t, grupoId);
  const miembros = new Set(parejaIds);
  const otros = t.partidosGrupo.filter((p) => p.grupoId !== grupoId);
  const quedan = t.partidosGrupo.filter((p) => p.grupoId === grupoId && miembros.has(p.aId) && miembros.has(p.bId));
  const cuenta = new Map<string, number>();
  for (const p of quedan) cuenta.set(clavePar(p.aId, p.bId), (cuenta.get(clavePar(p.aId, p.bId)) ?? 0) + 1);
  const piernas = vuelta ? 2 : 1;
  const base = Math.max(0, ...quedan.map((p) => p.ronda));
  const nuevos: PartidoGrupo[] = [];
  for (const f of generarFixture(parejaIds, { idaYVuelta: vuelta })) {
    const k = clavePar(f.aId, f.bId);
    const ya = cuenta.get(k) ?? 0;
    if (ya >= piernas) continue;
    cuenta.set(k, ya + 1);
    nuevos.push({ id: nuevoId(), grupoId, ronda: f.ronda, aId: f.aId, bId: f.bId, puntosA: null, puntosB: null });
  }
  // Las rondas nuevas van después de las que ya existen, compactadas (1, 2, 3…).
  const rondasNuevas = [...new Set(nuevos.map((p) => p.ronda))].sort((a, b) => a - b);
  const renum = new Map(rondasNuevas.map((r, i) => [r, base + i + 1]));
  for (const p of nuevos) p.ronda = renum.get(p.ronda)!;
  return {
    ...t,
    grupos: t.grupos.map((g) => (g.id === grupoId ? { ...g, parejaIds: [...parejaIds] } : g)),
    partidosGrupo: [...otros, ...quedan, ...nuevos],
  };
}

/** Agrega la vuelta (mismos cruces, lados invertidos) a un grupo que se jugaba a una vuelta. */
export function agregarVuelta(t: Torneo, grupoId: string): Torneo {
  if (grupoConVuelta(t, grupoId)) return t;
  const ida = t.partidosGrupo.filter((p) => p.grupoId === grupoId).sort((a, b) => a.ronda - b.ronda);
  const max = Math.max(0, ...ida.map((p) => p.ronda));
  const min = Math.min(...ida.map((p) => p.ronda));
  const vuelta: PartidoGrupo[] = ida.map((p) => ({
    id: nuevoId(), grupoId, ronda: max + (p.ronda - min) + 1, aId: p.bId, bId: p.aId, puntosA: null, puntosB: null,
  }));
  return { ...t, partidosGrupo: [...t.partidosGrupo, ...vuelta] };
}

/** Saca la vuelta: borra los partidos repetidos SIN resultado (los jugados quedan). */
export function quitarVuelta(t: Torneo, grupoId: string): Torneo {
  const vistos = new Set<string>();
  const ordenados = [...t.partidosGrupo].sort((a, b) => a.ronda - b.ronda);
  const borrar = new Set<string>();
  for (const p of ordenados) {
    if (p.grupoId !== grupoId) continue;
    const k = clavePar(p.aId, p.bId);
    if (vistos.has(k) && resultadoDe(p) === null) borrar.add(p.id);
    vistos.add(k);
  }
  return { ...t, partidosGrupo: t.partidosGrupo.filter((p) => !borrar.has(p.id)) };
}

/** Agrega una dupla nueva a un grupo (y al torneo). */
export function agregarDupla(t: Torneo, grupoId: string, nombre: string, jugadorIds?: string[]): Torneo {
  const pareja: Pareja = { id: nuevoId(), nombre: nombre.trim(), ...(jugadorIds?.length ? { jugadorIds } : {}) };
  const grupo = t.grupos.find((g) => g.id === grupoId);
  if (!grupo) throw new Error('No existe ese grupo');
  return rearmarGrupo({ ...t, parejas: [...t.parejas, pareja] }, grupoId, [...grupo.parejaIds, pareja.id]);
}

/** Saca una dupla del torneo: se borran sus partidos (también los jugados). */
export function quitarDupla(t: Torneo, parejaId: string): Torneo {
  const grupo = t.grupos.find((g) => g.parejaIds.includes(parejaId));
  const sinPareja = { ...t, parejas: t.parejas.filter((p) => p.id !== parejaId) };
  if (!grupo) return sinPareja;
  return rearmarGrupo(sinPareja, grupo.id, grupo.parejaIds.filter((id) => id !== parejaId));
}

/** Pasa una dupla a otro grupo: sale con sus partidos del grupo viejo y juega con todos los del nuevo. */
export function moverDupla(t: Torneo, parejaId: string, aGrupoId: string): Torneo {
  const desde = t.grupos.find((g) => g.parejaIds.includes(parejaId));
  const hasta = t.grupos.find((g) => g.id === aGrupoId);
  if (!hasta) throw new Error('No existe ese grupo');
  if (desde?.id === aGrupoId) return t;
  let r = t;
  if (desde) r = rearmarGrupo(r, desde.id, desde.parejaIds.filter((id) => id !== parejaId));
  return rearmarGrupo(r, aGrupoId, [...hasta.parejaIds, parejaId]);
}

/** Cambia el nombre de una dupla (otro jugador). Sin jugadorIds se vuelve a vincular al padrón. */
export function renombrarDupla(t: Torneo, parejaId: string, nombre: string, jugadorIds?: string[]): Torneo {
  return {
    ...t,
    parejas: t.parejas.map((p) => {
      if (p.id !== parejaId) return p;
      const { jugadorIds: _viejos, ...resto } = p;
      return { ...resto, nombre: nombre.trim(), ...(jugadorIds?.length ? { jugadorIds } : {}) };
    }),
  };
}
