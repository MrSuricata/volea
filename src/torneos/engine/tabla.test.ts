import { describe, expect, it } from 'vitest';
import type { PartidoGrupo } from './tipos';
import { calcularTabla } from './tabla';

let n = 0;
function partido(aId: string, bId: string, puntosA: number | null, puntosB: number | null): PartidoGrupo {
  n += 1;
  return { id: `m${n}`, grupoId: 'g1', ronda: 1, aId, bId, puntosA, puntosB };
}

describe('calcularTabla', () => {
  it('ordena por victorias y calcula PJ/PG/PP/PF/PC/dif', () => {
    const tabla = calcularTabla(
      ['a', 'b', 'c'],
      [partido('a', 'b', 11, 5), partido('a', 'c', 11, 7), partido('b', 'c', 11, 9)],
    );
    expect(tabla.map((f) => f.parejaId)).toEqual(['a', 'b', 'c']);
    const a = tabla[0];
    expect(a).toMatchObject({ pj: 2, pg: 2, pp: 0, pf: 22, pc: 12, dif: 10, posicion: 1 });
  });

  it('empate doble: h2h decide por sobre la dif total', () => {
    // pg: a=2 (venció c,d), b=2 (venció a,d), c=1 (venció b), d=1 (venció c)
    // dif: a=+17, b=+9 => la dif favorece a a, pero el h2h lo ganó b => b primero
    // c=-17, d=-9, y h2h d venció a c => d tercero
    const partidos = [
      partido('a', 'b', 9, 11), // b gana el duelo directo
      partido('a', 'c', 11, 1),
      partido('c', 'b', 11, 9),
      partido('a', 'd', 11, 2),
      partido('b', 'd', 11, 2),
      partido('c', 'd', 2, 11),
    ];
    const tabla = calcularTabla(['a', 'b', 'c', 'd'], partidos);
    expect(tabla.map((f) => f.parejaId)).toEqual(['b', 'a', 'd', 'c']);
    expect(tabla.map((f) => f.posicion)).toEqual([1, 2, 3, 4]);
    expect(tabla.every((f) => !f.desempatePorSorteo)).toBe(true);
  });

  it('empate triple: salta h2h y usa dif total; empate persistente marca desempatePorSorteo', () => {
    // triángulo perfecto: a>b, b>c, c>a, todos 11-9 => dif idéntica, pf idéntico
    const tabla = calcularTabla(
      ['a', 'b', 'c'],
      [partido('a', 'b', 11, 9), partido('b', 'c', 11, 9), partido('c', 'a', 11, 9)],
    );
    expect(tabla.map((f) => f.pg)).toEqual([1, 1, 1]);
    // dif: cada uno +2-2=0, pf 20 c/u => empate total => orden de entrada y flag
    expect(tabla.map((f) => f.parejaId)).toEqual(['a', 'b', 'c']);
    expect(tabla.every((f) => f.desempatePorSorteo)).toBe(true);
  });

  it('empate triple con dif distinta se separa por dif y no marca sorteo', () => {
    const tabla = calcularTabla(
      ['a', 'b', 'c'],
      [partido('a', 'b', 11, 2), partido('b', 'c', 11, 9), partido('c', 'a', 11, 9)],
    );
    // dif: a = +9-2 = +7 ; b = -9+2 = -7 ; c = 0
    expect(tabla.map((f) => f.parejaId)).toEqual(['a', 'c', 'b']);
    expect(tabla.map((f) => f.posicion)).toEqual([1, 2, 3]);
    expect(tabla.every((f) => !f.desempatePorSorteo)).toBe(true);
  });

  it('empate triple con dif total idéntica: dif entre empatados separa y el sub-empate vuelve al h2h', () => {
    const partidos = [
      partido('x', 'y', 11, 9), partido('y', 'z', 11, 5), partido('z', 'x', 11, 7),
      partido('x', 'w', 11, 3), partido('z', 'w', 11, 3), partido('y', 'w', 11, 9),
    ];
    // pg: x=y=z=2, w=0; dif total: los tres +6 (no separa)
    // dif entre empatados {x,y,z}: y=+4, x=-2, z=-2 => y primero
    // sub-empate {x,z}: la cascada arranca de nuevo => h2h => z le ganó 11-7 a x => z arriba
    const tabla = calcularTabla(['x', 'y', 'z', 'w'], partidos);
    expect(tabla.map((f) => f.parejaId)).toEqual(['y', 'z', 'x', 'w']);
    expect(tabla.every((f) => !f.desempatePorSorteo)).toBe(true);
  });

  it('empatados que nunca se enfrentaron y con dif idéntica: decide pf total', () => {
    // a y b: 1 victoria, dif +6 c/u, sin duelo directo (h2h y dif-entre no aplican) => pf: b 15 > a 11
    // c y d: 0 victorias, dif -6 c/u, idem => pf: d 9 > c 5
    const partidos = [partido('a', 'c', 11, 5), partido('b', 'd', 15, 9)];
    const tabla = calcularTabla(['a', 'b', 'c', 'd'], partidos);
    expect(tabla.map((f) => f.parejaId)).toEqual(['b', 'a', 'd', 'c']);
    expect(tabla.every((f) => !f.desempatePorSorteo)).toBe(true);
  });

  it('partidos sin resultado, empatados o con NaN no cuentan; tabla virgen no marca sorteo', () => {
    const tabla = calcularTabla(['a', 'b'], [partido('a', 'b', null, null)]);
    expect(tabla[0]).toMatchObject({ pj: 0, pg: 0, pf: 0, pc: 0, dif: 0 });
    expect(tabla.every((f) => !f.desempatePorSorteo)).toBe(true);
    const conEmpate = calcularTabla(['a', 'b'], [partido('a', 'b', 11, 11)]);
    expect(conEmpate[0]).toMatchObject({ pj: 0, pg: 0 });
    const conNan = calcularTabla(['a', 'b'], [partido('a', 'b', NaN, 5)]);
    expect(conNan[0]).toMatchObject({ pj: 0, pg: 0 });
  });
});
