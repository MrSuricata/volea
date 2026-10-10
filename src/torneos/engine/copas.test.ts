import { describe, expect, it } from 'vitest';
import type { PartidoGrupo, Torneo } from './tipos';
import { armarCopas, armarLlaveSeis, rondasDeLlave, tablaGeneral } from './copas';
import { resolverSlot } from './llave';

// Grupo A de 4 (a1..a4), grupo B de 3 (b1..b3). Resultados: en A gana la de menor número
// siempre; en B igual. a1 le gana 11-0 a a4 (la última): ese partido no debe contar para
// comparar primeras con b1, que no tiene una 4ª contra quien inflarse.
function torneo(): Torneo {
  const pg = (id: string, g: string, aId: string, bId: string, pa: number, pb: number): PartidoGrupo => ({ id, grupoId: g, ronda: 1, aId, bId, puntosA: pa, puntosB: pb });
  return {
    id: 'fem', nombre: 'DOBLE FEMENINO ANIVERSARIO', creadoEl: '2026-10-10T00:00:00.000Z', fase: 'faseGrupos', categoria: 'A', evento: 'Aniv',
    copas: { oro: 4 },
    parejas: ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3'].map((id) => ({ id, nombre: id.toUpperCase() })),
    grupos: [{ id: 'A', nombre: 'A', parejaIds: ['a1', 'a2', 'a3', 'a4'] }, { id: 'B', nombre: 'B', parejaIds: ['b1', 'b2', 'b3'] }],
    partidosGrupo: [
      pg('1', 'A', 'a1', 'a2', 11, 9), pg('2', 'A', 'a1', 'a3', 11, 8), pg('3', 'A', 'a1', 'a4', 11, 0),
      pg('4', 'A', 'a2', 'a3', 11, 7), pg('5', 'A', 'a2', 'a4', 11, 5), pg('6', 'A', 'a3', 'a4', 11, 9),
      pg('7', 'B', 'b1', 'b2', 11, 6), pg('8', 'B', 'b1', 'b3', 11, 4), pg('9', 'B', 'b2', 'b3', 11, 10),
    ],
    configLlave: null, partidosLlave: null,
  };
}

describe('tablaGeneral', () => {
  it('ordena por posición y, entre primeras, sin contar el partido contra la 4ª del grupo de 4', () => {
    const g = tablaGeneral(torneo());
    expect(g.map((f) => f.parejaId)).toEqual(['b1', 'a1', 'a2', 'b2', 'a3', 'b3', 'a4']);
    // a1 ajustada: 2 partidos (sin el 11-0 a a4): dif +5 · b1: 2 partidos, dif +12 ⇒ b1 primera
    expect(g[0].ajustado).toEqual({ pj: 2, pg: 2, dif: 12, pf: 22 });
    expect(g[1].ajustado).toEqual({ pj: 2, pg: 2, dif: 5, pf: 22 });
    expect(g[1].pj).toBe(3);
  });
  it('de terceras para abajo compara por promedio', () => {
    const g = tablaGeneral(torneo());
    const terceras = g.filter((f) => f.posicion === 3).map((f) => f.parejaId);
    // a3: 1 ganado de 3 (0.33) · b3: 0 de 2 ⇒ a3 antes
    expect(terceras).toEqual(['a3', 'b3']);
  });
});

describe('rondasDeLlave', () => {
  it('byes a los mejores', () => {
    expect(rondasDeLlave(6)).toEqual([2, 2, 1]);
    expect(rondasDeLlave(5)).toEqual([1, 2, 1]);
    expect(rondasDeLlave(8)).toEqual([4, 2, 1]);
    expect(rondasDeLlave(3)).toEqual([1, 1]);
    expect(rondasDeLlave(2)).toEqual([1]);
  });
});

describe('armarCopas', () => {
  it('oro con las mejores y plata con el resto, cada una como torneo de llave sola', () => {
    const { oro, plata } = armarCopas(torneo(), { ahora: '2026-10-10T18:00:00.000Z', ids: { oro: 'oro', plata: 'plata' } });
    expect(oro.nombre).toBe('DOBLE FEMENINO ANIVERSARIO · COPA DE ORO');
    expect(oro.parejas.map((p) => p.id)).toEqual(['b1', 'a1', 'a2', 'b2']);
    expect(plata.parejas.map((p) => p.id)).toEqual(['a3', 'b3', 'a4']);
    expect(oro.fase).toBe('llave');
    expect(oro.grupos).toEqual([]);
    expect(oro.copaDe).toBe('fem');
    expect(oro.evento).toBe('Aniv');
    expect(plata.cuentaParaRanking).toBe(false);
    // oro: 4 ⇒ semis + final; b1-b2 y a1-a2 serían del mismo grupo, así que la llave los cruza
    const semis = oro.partidosLlave!.filter((p) => p.ronda === 1);
    expect(semis.map((p) => [resolverSlot(p.a, oro.partidosLlave!), resolverSlot(p.b, oro.partidosLlave!)])).toEqual([['b1', 'a2'], ['a1', 'b2']]); // semis 1v4 y 2v3, con el cruce anti mismo-grupo de armarLlave
    // plata: 3 ⇒ la 1ª (a3) espera con bye
    const r1 = plata.partidosLlave!.filter((p) => p.ronda === 1);
    expect(r1.some((p) => p.b === null && resolverSlot(p.a, plata.partidosLlave!) === 'a3')).toBe(true);
  });
  it('no arma con grupos incompletos', () => {
    const t = torneo();
    t.partidosGrupo[0].puntosA = null;
    expect(() => armarCopas(t)).toThrow(/sin resultado/);
  });
});

describe('armarLlaveSeis', () => {
  // A de 4 (a1 gana todo, 11-0 a la última), B y C de 3. Primeros: a1, b1, c1.
  function tres(): Torneo {
    const pg = (id: string, g: string, aId: string, bId: string, pa: number, pb: number): PartidoGrupo => ({ id, grupoId: g, ronda: 1, aId, bId, puntosA: pa, puntosB: pb });
    return {
      id: 'ma', nombre: 'MASC A', creadoEl: '', fase: 'faseGrupos', llave6: true,
      parejas: ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'].map((id) => ({ id, nombre: id })),
      grupos: [{ id: 'A', nombre: 'A', parejaIds: ['a1', 'a2', 'a3', 'a4'] }, { id: 'B', nombre: 'B', parejaIds: ['b1', 'b2', 'b3'] }, { id: 'C', nombre: 'C', parejaIds: ['c1', 'c2', 'c3'] }],
      partidosGrupo: [
        pg('1', 'A', 'a1', 'a2', 15, 13), pg('2', 'A', 'a1', 'a3', 15, 14), pg('3', 'A', 'a1', 'a4', 15, 0),
        pg('4', 'A', 'a2', 'a3', 15, 10), pg('5', 'A', 'a2', 'a4', 15, 10), pg('6', 'A', 'a3', 'a4', 15, 10),
        pg('7', 'B', 'b1', 'b2', 15, 5), pg('8', 'B', 'b1', 'b3', 15, 5), pg('9', 'B', 'b2', 'b3', 15, 12),
        pg('10', 'C', 'c1', 'c2', 15, 10), pg('11', 'C', 'c1', 'c3', 15, 10), pg('12', 'C', 'c2', 'c3', 15, 14),
      ],
      configLlave: null, partidosLlave: null,
    };
  }
  it('2 mejores primeros a semis, 3er primero vs peor segundo, los otros segundos entre sí', () => {
    const l = armarLlaveSeis(tres());
    const r = (p: (typeof l)[number]) => [resolverSlot(p.a, l), p.b?.tipo === 'seed' ? p.b.parejaId : 'gan'];
    // primeros ajustados: b1 +20, c1 +10, a1 +3 (sin el 15-0 a a4) ⇒ b1, c1 a semis; a1 juega 4tos
    // segundos ajustados: a2 (sin el partido vs a4) +1 (13-15, 15-10 → -2+5=+3)… c2 +1, b2 -7
    expect(l.filter((p) => p.ronda === 1).map(r)).toEqual([['a2', 'c2'], ['a1', 'b2']]);
    expect(l.filter((p) => p.ronda === 1).map((p) => p.posicion)).toEqual([0, 1]);
    expect(l.filter((p) => p.ronda === 2).map((p) => resolverSlot(p.a, l))).toEqual(['b1', 'c1']);
    expect(l.filter((p) => p.ronda === 3)).toHaveLength(1);
  });
});

describe('copas del Aniversario (3 grupos, Oro 6, Plata 5)', () => {
  // A y B de 4, C de 3; gana siempre la de número menor; a1 le gana 15-0 a a4.
  function fem(): Torneo {
    let k = 0;
    const pg = (g: string, aId: string, bId: string, pa: number, pb: number): PartidoGrupo => ({ id: `p${k++}`, grupoId: g, ronda: 1, aId, bId, puntosA: pa, puntosB: pb });
    const grupo = (g: string, ids: string[], margen: number) => ids.flatMap((x, i) => ids.slice(i + 1).map((y) => pg(g, x, y, 15, x === 'a1' && y === 'a4' ? 0 : 15 - margen)));
    return {
      id: 'fem', nombre: 'FEM', creadoEl: '', fase: 'faseGrupos', copas: { oro: 6 },
      parejas: ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4', 'c1', 'c2', 'c3'].map((id) => ({ id, nombre: id })),
      grupos: [{ id: 'A', nombre: 'A', parejaIds: ['a1', 'a2', 'a3', 'a4'] }, { id: 'B', nombre: 'B', parejaIds: ['b1', 'b2', 'b3', 'b4'] }, { id: 'C', nombre: 'C', parejaIds: ['c1', 'c2', 'c3'] }],
      partidosGrupo: [...grupo('A', ['a1', 'a2', 'a3', 'a4'], 3), ...grupo('B', ['b1', 'b2', 'b3', 'b4'], 5), ...grupo('C', ['c1', 'c2', 'c3'], 1)],
      configLlave: null, partidosLlave: null,
    };
  }
  it('Oro: llave de 6; Plata: 7º mejor tercero de grupos de 4, 8º vs 9º semi, 10º vs 11º cuartos', () => {
    const { oro, plata } = armarCopas(fem(), { ids: { oro: 'o', plata: 'p' } });
    expect(oro.partidosLlave).toHaveLength(5);
    const lp = plata.partidosLlave!;
    const pos = (p: (typeof lp)[number]) => [resolverSlot(p.a, lp), p.b?.tipo === 'seed' ? p.b.parejaId : 'gan'];
    // terceros: b3 (grupo de 4, PG 1 de 3, dif mejor que a3) es 7º; a3 y c3 8º/9º; a4, b4 10º/11º
    expect(lp.find((p) => p.ronda === 1)!.a).toEqual({ tipo: 'seed', parejaId: plata.parejas[3].id });
    expect(lp.filter((p) => p.ronda === 2).map(pos)[1][0]).toBe(plata.parejas[0].id);
    expect(['a3', 'b3']).toContain(plata.parejas[0].id);
    expect(plata.parejas.slice(3).map((p) => p.id).sort()).toEqual(['a4', 'b4']);
  });
});
