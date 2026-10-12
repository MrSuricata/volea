import { generarFixture } from './fixture';
import type { OpcionesFixture } from './fixture';
import type { Grupo, PartidoGrupo } from './tipos';
import { nuevoId } from './tipos';
import { mezclar } from './rng';

// Cantidades de grupos válidas: al repartir en varios grupos, ninguno con menos de 3;
// 1 solo grupo únicamente con 2-5 parejas (torneo chico sin llave o con final directa).
// Con 2 parejas el grupo es un único partido: una categoría chica que igual se juega.
export function opcionesCantidadGrupos(cantParejas: number): number[] {
  const opciones: number[] = [];
  if (cantParejas >= 2 && cantParejas <= 5) opciones.push(1);
  for (let g = 2; g <= Math.floor(cantParejas / 3); g++) opciones.push(g);
  return opciones;
}

// Ideal: grupos de ~4 (spec §3 Paso 2)
export function sugerirCantidadGrupos(cantParejas: number): number {
  const opciones = opcionesCantidadGrupos(cantParejas);
  if (opciones.length === 0) return 0;
  let mejor = opciones[0];
  let mejorPuntaje = Infinity;
  for (const g of opciones) {
    const puntaje = Math.abs(cantParejas / g - 4);
    if (puntaje < mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = g;
    }
  }
  return mejor;
}

// Mezcla y reparte tipo "mano de cartas": índice i va al grupo i % cantidad. El rng debe ser nuevo en cada sorteo (la UI pasa una seed aleatoria por click).
export function repartirEnGrupos(parejaIds: string[], cantidad: number, rng: () => number): string[][] {
  if (cantidad < 1) throw new Error(`cantidad de grupos inválida: ${cantidad}`);
  const mezclados = mezclar(parejaIds, rng);
  const grupos: string[][] = Array.from({ length: cantidad }, () => []);
  mezclados.forEach((id, i) => grupos[i % cantidad].push(id));
  return grupos;
}

/**
 * Cabezas de serie: las `cantidad` parejas con mejor promedio de rating (DUPR) de sus jugadores.
 * Las que no tienen ningún jugador con rating no entran. Devuelve de la más fuerte a la más débil.
 */
export function elegirCabezas(parejas: { id: string; jugadorIds?: string[] }[], rating: Map<string, number>, cantidad: number): string[] {
  const conRating = parejas
    .map((p) => {
      const rs = (p.jugadorIds ?? []).map((j) => rating.get(j)).filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
      return { id: p.id, prom: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null };
    })
    .filter((x): x is { id: string; prom: number } => x.prom !== null)
    .sort((a, b) => b.prom - a.prom);
  return conRating.slice(0, cantidad).map((x) => x.id);
}

/** Como repartirEnGrupos, pero con una cabeza de serie por grupo (la 1ª al grupo A, la 2ª al B…). */
export function repartirConCabezas(parejaIds: string[], cantidad: number, cabezas: string[], rng: () => number): string[][] {
  if (cantidad < 1) throw new Error(`cantidad de grupos inválida: ${cantidad}`);
  const grupos: string[][] = Array.from({ length: cantidad }, () => []);
  const usadas = cabezas.slice(0, cantidad);
  usadas.forEach((id, i) => grupos[i].push(id));
  const resto = mezclar(parejaIds.filter((id) => !usadas.includes(id)), rng);
  for (const id of resto) {
    // al grupo con menos parejas (desempata el de letra más baja)
    let k = 0;
    for (let i = 1; i < cantidad; i++) if (grupos[i].length < grupos[k].length) k = i;
    grupos[k].push(id);
  }
  return grupos;
}

export function generarPartidosGrupos(grupos: Grupo[], opciones?: OpcionesFixture): PartidoGrupo[] {
  const partidos: PartidoGrupo[] = [];
  for (const g of grupos) {
    for (const p of generarFixture(g.parejaIds, opciones)) {
      partidos.push({
        id: nuevoId(), grupoId: g.id, ronda: p.ronda,
        aId: p.aId, bId: p.bId, puntosA: null, puntosB: null,
      });
    }
  }
  return partidos;
}
