import { describe, expect, it } from 'vitest';
import type { Grupo, PartidoGrupo } from './tipos';
import {
  calcularClasificados,
  candidatosMejoresExtra,
  compararMetricas,
  opcionesClasificacion,
  siguientePotenciaDe2,
} from './clasificacion';

function grupo(id: string, nombre: string, parejaIds: string[]): Grupo {
  return { id, nombre, parejaIds };
}

let n = 0;
function partido(grupoId: string, aId: string, bId: string, puntosA: number, puntosB: number): PartidoGrupo {
  n += 1;
  return { id: `m${n}`, grupoId, ronda: 1, aId, bId, puntosA, puntosB };
}

describe('siguientePotenciaDe2', () => {
  it('redondea hacia arriba a potencia de 2', () => {
    expect(siguientePotenciaDe2(2)).toBe(2);
    expect(siguientePotenciaDe2(3)).toBe(4);
    expect(siguientePotenciaDe2(5)).toBe(8);
    expect(siguientePotenciaDe2(8)).toBe(8);
    expect(siguientePotenciaDe2(9)).toBe(16);
  });
});

describe('opcionesClasificacion', () => {
  const tresGruposDe4 = [
    grupo('g1', 'A', ['a1', 'a2', 'a3', 'a4']),
    grupo('g2', 'B', ['b1', 'b2', 'b3', 'b4']),
    grupo('g3', 'C', ['c1', 'c2', 'c3', 'c4']),
  ];

  it('3 grupos de 4: recomienda 2 por grupo + 2 mejores terceros (llave de 8 justa)', () => {
    const opciones = opcionesClasificacion(tresGruposDe4);
    const primera = opciones[0];
    expect(primera).toMatchObject({ porGrupo: 2, mejoresExtra: 2, total: 8, tamanoLlave: 8, byes: 0 });
    expect(primera.descripcion).toContain('llave de 8 justa');
    expect(primera.descripcion).toContain('mejores terceros');
  });

  it('4 grupos de 4: recomienda 2 por grupo sin extras', () => {
    const cuatro = [...tresGruposDe4, grupo('g4', 'D', ['d1', 'd2', 'd3', 'd4'])];
    expect(opcionesClasificacion(cuatro)[0]).toMatchObject({ porGrupo: 2, mejoresExtra: 0, total: 8, byes: 0 });
  });

  it('2 grupos de 4: recomienda 2 por grupo (semis directas)', () => {
    const dos = tresGruposDe4.slice(0, 2);
    expect(opcionesClasificacion(dos)[0]).toMatchObject({ porGrupo: 2, mejoresExtra: 0, total: 4, tamanoLlave: 4, byes: 0 });
  });

  it('5 grupos de 4: recomienda 1º de cada grupo + los 3 mejores segundos (llave de 8 justa)', () => {
    const cinco = [
      ...tresGruposDe4,
      grupo('g4', 'D', ['d1', 'd2', 'd3', 'd4']),
      grupo('g5', 'E', ['e1', 'e2', 'e3', 'e4']),
    ];
    // "3 por grupo + el mejor cuarto" también daría llave de 16 justa, pero clasificaría al 80%
    // del torneo; la regla del ~60% elige la llave de 8
    expect(opcionesClasificacion(cinco)[0]).toMatchObject({ porGrupo: 1, mejoresExtra: 3, total: 8, tamanoLlave: 8, byes: 0 });
  });

  it('1 grupo de 4: la recomendada es final directa entre los 2 primeros', () => {
    const unico = [grupo('g1', 'A', ['a1', 'a2', 'a3', 'a4'])];
    const opciones = opcionesClasificacion(unico);
    expect(opciones[0]).toMatchObject({ porGrupo: 2, mejoresExtra: 0, total: 2, tamanoLlave: 2, byes: 0 });
    expect(opciones[0].descripcion).toContain('final directa');
    // con 1 solo grupo no hay "mejores extra" de ningún puesto
    expect(opciones.every((o) => o.mejoresExtra === 0)).toBe(true);
  });

  it('mejoresExtra nunca llega a la cantidad de grupos y porGrupo respeta el grupo más chico', () => {
    const conChico = [grupo('g1', 'A', ['a1', 'a2', 'a3', 'a4']), grupo('g2', 'B', ['b1', 'b2', 'b3'])];
    const opciones = opcionesClasificacion(conChico);
    expect(opciones.every((o) => o.mejoresExtra < 2)).toBe(true);
    expect(opciones.every((o) => o.porGrupo <= 3)).toBe(true);
    expect(opciones.every((o) => o.total >= 2)).toBe(true);
  });
});

describe('calcularClasificados', () => {
  it('ordena seeds por franja de puesto y porcentajes; el mejor segundo entra como extra', () => {
    const grupos = [
      grupo('g1', 'A', ['a1', 'a2', 'a3']),
      grupo('g2', 'B', ['b1', 'b2', 'b3']),
    ];
    const partidos = [
      // Grupo A: a1 gana todo con margen chico; a2 segundo con dif +2 sobre 38 puntos
      partido('g1', 'a1', 'a2', 11, 9),
      partido('g1', 'a1', 'a3', 11, 5),
      partido('g1', 'a2', 'a3', 11, 7),
      // Grupo B: b1 gana todo con paliza; b2 segundo con dif +1 sobre 25 puntos
      partido('g2', 'b1', 'b2', 11, 2),
      partido('g2', 'b1', 'b3', 11, 3),
      partido('g2', 'b2', 'b3', 11, 1),
    ];
    const clasificados = calcularClasificados(grupos, partidos, { porGrupo: 1, mejoresExtra: 1 });
    // franja de 1ºs: b1 (difRatio 17/27) antes que a1 (8/36); extra: a2 (2/38) > b2 (1/25)
    expect(clasificados.map((c) => c.parejaId)).toEqual(['b1', 'a1', 'a2']);
    expect(clasificados.map((c) => c.puesto)).toEqual([1, 1, 2]);
    expect(clasificados[2].grupoNombre).toBe('A');
  });

  it('una pareja sin partidos jugados no le gana el cupo de mejor tercero a una que jugó', () => {
    const grupos = [
      grupo('g1', 'A', ['a1', 'a2', 'a3']),
      grupo('g2', 'B', ['b1', 'b2', 'b3']),
    ];
    // Grupo A completo; grupo B sin resultados (se armó la llave con partidos pendientes)
    const partidos = [
      partido('g1', 'a1', 'a2', 11, 9),
      partido('g1', 'a1', 'a3', 11, 9),
      partido('g1', 'a2', 'a3', 11, 9),
    ];
    const clasificados = calcularClasificados(grupos, partidos, { porGrupo: 2, mejoresExtra: 1 });
    // el cupo extra es para a3 (jugó y perdió ajustado), no para b3 (pj=0)
    expect(clasificados.map((c) => c.parejaId)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3']);
  });

  it('invariante de franjas: un 2º con peores métricas sigue delante del mejor 3º', () => {
    const grupos = [
      grupo('g1', 'A', ['a1', 'a2', 'a3']),
      grupo('g2', 'B', ['b1', 'b2', 'b3']),
    ];
    const partidos = [
      // A: a2 segundo con difRatio -1/41; a3 tercero con difRatio -2/42 (buenísimo para ser 3º)
      partido('g1', 'a1', 'a2', 11, 9),
      partido('g1', 'a1', 'a3', 11, 10),
      partido('g1', 'a2', 'a3', 11, 10),
      // B: b2 segundo horrible (difRatio -9/31), b3 tercero -8/36
      partido('g2', 'b1', 'b2', 11, 0),
      partido('g2', 'b1', 'b3', 11, 5),
      partido('g2', 'b2', 'b3', 11, 9),
    ];
    const clasificados = calcularClasificados(grupos, partidos, { porGrupo: 2, mejoresExtra: 1 });
    // b2 (franja de 2ºs) queda delante de a3 (extra) aunque a3 tenga mejores métricas
    expect(clasificados.map((c) => c.parejaId)).toEqual(['b1', 'a1', 'a2', 'b2', 'a3']);
  });

  it('candidatos a mejores terceros: empate TOTAL entre grupos iguales lo decide el orden de grupo (A antes que B) y es detectable', () => {
    // grupos espejo: los dos terceros terminan 1-2 con pf 27 / pc 30 exactos
    const grupos = [
      grupo('g1', 'A', ['a1', 'a2', 'a3', 'a4']),
      grupo('g2', 'B', ['b1', 'b2', 'b3', 'b4']),
    ];
    const partidos = [
      partido('g1', 'a1', 'a2', 11, 5), partido('g1', 'a1', 'a3', 11, 7), partido('g1', 'a1', 'a4', 11, 3),
      partido('g1', 'a2', 'a3', 11, 9), partido('g1', 'a2', 'a4', 11, 6), partido('g1', 'a3', 'a4', 11, 8),
      partido('g2', 'b1', 'b2', 11, 5), partido('g2', 'b1', 'b3', 11, 7), partido('g2', 'b1', 'b4', 11, 3),
      partido('g2', 'b2', 'b3', 11, 9), partido('g2', 'b2', 'b4', 11, 6), partido('g2', 'b3', 'b4', 11, 8),
    ];
    const candidatos = candidatosMejoresExtra(grupos, partidos, { porGrupo: 2, mejoresExtra: 1 });
    expect(candidatos.map((c) => c.parejaId)).toEqual(['a3', 'b3']); // empate total → orden de grupo
    expect(candidatos.map((c) => c.entra)).toEqual([true, false]);
    expect(candidatos[0]).toMatchObject({ pg: 1, pp: 2, pf: 27, pc: 30, dif: -3, puesto: 3, grupoNombre: 'A' });
    // empate total detectable para que la UI lo avise
    expect(compararMetricas(candidatos[0].metricas, candidatos[1].metricas)).toBe(0);
  });

  it('extras manuales: elegir a mano el otro tercero empatado lo hace pasar a él (resolver en la cancha)', () => {
    const grupos = [
      grupo('g1', 'A', ['a1', 'a2', 'a3', 'a4']),
      grupo('g2', 'B', ['b1', 'b2', 'b3', 'b4']),
    ];
    const partidos = [
      partido('g1', 'a1', 'a2', 11, 5), partido('g1', 'a1', 'a3', 11, 7), partido('g1', 'a1', 'a4', 11, 3),
      partido('g1', 'a2', 'a3', 11, 9), partido('g1', 'a2', 'a4', 11, 6), partido('g1', 'a3', 'a4', 11, 8),
      partido('g2', 'b1', 'b2', 11, 5), partido('g2', 'b1', 'b3', 11, 7), partido('g2', 'b1', 'b4', 11, 3),
      partido('g2', 'b2', 'b3', 11, 9), partido('g2', 'b2', 'b4', 11, 6), partido('g2', 'b3', 'b4', 11, 8),
    ];
    // auto: empate total → entra a3 por orden de grupo
    const auto = calcularClasificados(grupos, partidos, { porGrupo: 2, mejoresExtra: 1 });
    expect(auto[auto.length - 1].parejaId).toBe('a3');
    // manual: elijo b3 → entra b3
    const manual = calcularClasificados(grupos, partidos, { porGrupo: 2, mejoresExtra: 1, extrasManuales: ['b3'] });
    expect(manual[manual.length - 1].parejaId).toBe('b3');
    // y los candidatos reflejan la elección manual en el flag entra
    const cand = candidatosMejoresExtra(grupos, partidos, { porGrupo: 2, mejoresExtra: 1, extrasManuales: ['b3'] });
    expect(cand.find((c) => c.parejaId === 'b3')!.entra).toBe(true);
    expect(cand.find((c) => c.parejaId === 'a3')!.entra).toBe(false);
    // los directos (1º y 2º de cada grupo) no cambian por el override
    expect(manual.filter((c) => c.puesto <= 2).map((c) => c.parejaId).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('candidatos a mejores terceros: gana el de mejor diferencia relativa y calcularClasificados coincide', () => {
    const grupos = [
      grupo('g1', 'A', ['a1', 'a2', 'a3', 'a4']),
      grupo('g2', 'B', ['b1', 'b2', 'b3', 'b4']),
    ];
    const partidos = [
      partido('g1', 'a1', 'a2', 11, 5), partido('g1', 'a1', 'a3', 11, 7), partido('g1', 'a1', 'a4', 11, 3),
      partido('g1', 'a2', 'a3', 11, 9), partido('g1', 'a2', 'a4', 11, 6), partido('g1', 'a3', 'a4', 11, 8),
      // B igual salvo que b3 pierde más ajustado con b1 (9-11): dif -1 contra -3 de a3
      partido('g2', 'b1', 'b2', 11, 5), partido('g2', 'b1', 'b3', 11, 9), partido('g2', 'b1', 'b4', 11, 3),
      partido('g2', 'b2', 'b3', 11, 9), partido('g2', 'b2', 'b4', 11, 6), partido('g2', 'b3', 'b4', 11, 8),
    ];
    const candidatos = candidatosMejoresExtra(grupos, partidos, { porGrupo: 2, mejoresExtra: 1 });
    expect(candidatos.map((c) => c.parejaId)).toEqual(['b3', 'a3']);
    expect(candidatos.map((c) => c.entra)).toEqual([true, false]);
    expect(compararMetricas(candidatos[0].metricas, candidatos[1].metricas)).toBeLessThan(0);
    // el que entra según candidatos es el mismo que agrega calcularClasificados como extra
    const clasificados = calcularClasificados(grupos, partidos, { porGrupo: 2, mejoresExtra: 1 });
    expect(clasificados[clasificados.length - 1].parejaId).toBe('b3');
  });

  it('invariante de franjas real: el 1º de un grupo (winPct 0.5) va delante del 2º de otro (winPct 0.67)', () => {
    const grupos = [
      grupo('g1', 'A', ['a1', 'a2', 'a3']),
      grupo('g2', 'B', ['b1', 'b2', 'b3', 'b4']),
    ];
    const partidos = [
      // A: círculo perfecto, todos 1-1 (winPct 0.5); a1 1º por dif (+5), a3 2º (-1)
      partido('g1', 'a1', 'a2', 11, 5),
      partido('g1', 'a2', 'a3', 11, 9),
      partido('g1', 'a3', 'a1', 11, 10),
      // B: b1 3-0, b2 2-1 (winPct 0.67), b3 1-2, b4 0-3
      partido('g2', 'b1', 'b2', 11, 7),
      partido('g2', 'b1', 'b3', 11, 4),
      partido('g2', 'b1', 'b4', 11, 3),
      partido('g2', 'b2', 'b3', 11, 6),
      partido('g2', 'b2', 'b4', 11, 8),
      partido('g2', 'b3', 'b4', 11, 9),
    ];
    const clasificados = calcularClasificados(grupos, partidos, { porGrupo: 2, mejoresExtra: 0 });
    // las franjas mandan: a1 (1º, winPct 0.5) queda delante de b2 (2º, winPct 0.67);
    // un sort global por métricas pondría a b2 antes que a1 — este test mata ese mutante
    expect(clasificados.map((c) => c.parejaId)).toEqual(['b1', 'a1', 'b2', 'a3']);
    expect(clasificados.map((c) => c.puesto)).toEqual([1, 1, 2, 2]);
  });
});
