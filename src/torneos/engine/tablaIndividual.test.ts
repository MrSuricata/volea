import { describe, expect, it } from 'vitest';
import type { Pareja, PartidoGrupo } from './tipos';
import { calcularTablaIndividual, nombresDePareja } from './tabla';

const parejas: Pareja[] = [
  { id: 'p12', nombre: 'ANA y BEA', jugadorIds: ['j1', 'j2'] },
  { id: 'p34', nombre: 'CARO y DANI', jugadorIds: ['j3', 'j4'] },
  { id: 'p13', nombre: 'ANA y CARO', jugadorIds: ['j1', 'j3'] },
  { id: 'p24', nombre: 'BEA y DANI', jugadorIds: ['j2', 'j4'] },
];
const partido = (id: string, aId: string, bId: string, puntosA: number | null, puntosB: number | null): PartidoGrupo =>
  ({ id, grupoId: 'g', ronda: 1, aId, bId, puntosA, puntosB });

describe('nombresDePareja', () => {
  it('reparte "A y B" según jugadorIds', () => {
    expect([...nombresDePareja(parejas[0])]).toEqual([['j1', 'ANA'], ['j2', 'BEA']]);
  });
  it('si el nombre no se puede partir usa el nombre entero', () => {
    expect([...nombresDePareja({ id: 'x', nombre: 'LOS PRIMOS', jugadorIds: ['a', 'b'] })]).toEqual([['a', 'LOS PRIMOS'], ['b', 'LOS PRIMOS']]);
  });
});

describe('calcularTablaIndividual', () => {
  it('suma a cada jugador lo de todas sus duplas y ordena por PG, dif, PF', () => {
    const tabla = calcularTablaIndividual(parejas, [
      partido('m1', 'p12', 'p34', 11, 5),
      partido('m2', 'p13', 'p24', 11, 9),
      partido('m3', 'p12', 'p34', null, null),
    ]);
    expect(tabla.map((f) => [f.posicion, f.nombre, f.pj, f.pg, f.dif])).toEqual([
      [1, 'ANA', 2, 2, 8],
      [2, 'BEA', 2, 1, 4],
      [3, 'CARO', 2, 1, -4],
      [4, 'DANI', 2, 0, -8],
    ]);
  });
  it('sin partidos lista a todos en cero', () => {
    expect(calcularTablaIndividual(parejas, []).map((f) => f.pj)).toEqual([0, 0, 0, 0]);
  });
});
