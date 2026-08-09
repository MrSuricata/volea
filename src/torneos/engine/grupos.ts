import { generarFixture } from './fixture';
import type { OpcionesFixture } from './fixture';
import type { Grupo, PartidoGrupo } from './tipos';
import { nuevoId } from './tipos';
import { mezclar } from './rng';

// Cantidades de grupos válidas: ningún grupo con menos de 3;
// 1 solo grupo únicamente cuando hay 3-5 parejas (torneo chico sin llave o con final directa)
export function opcionesCantidadGrupos(cantParejas: number): number[] {
  const opciones: number[] = [];
  if (cantParejas >= 3 && cantParejas <= 5) opciones.push(1);
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
