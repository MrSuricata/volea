import { describe, expect, it } from 'vitest';
import { armarLlaveRolling } from './llaveIndividual';
import { borradosSiCorrijo, campeonDe, cargarResultadoLlave, ganadorPartido, resolverSlot } from './llave';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('armarLlaveRolling', () => {
  it('4 jugadores: 3 partidos, R1 empareja consecutivos, la final toma los ganadores', () => {
    const ps = armarLlaveRolling(['p1', 'p2', 'p3', 'p4']);
    expect(ps).toHaveLength(3);
    const r1 = ps.filter((p) => p.ronda === 1);
    expect(r1).toHaveLength(2);
    expect(resolverSlot(r1[0].a, ps)).toBe('p1');
    expect(resolverSlot(r1[0].b, ps)).toBe('p2');
    expect(resolverSlot(r1[1].a, ps)).toBe('p3');
    expect(resolverSlot(r1[1].b, ps)).toBe('p4');
    const final = ps.find((p) => p.ronda === 2)!;
    expect(final.a).toEqual({ tipo: 'ganadorDe', partidoId: r1[0].id });
    expect(final.b).toEqual({ tipo: 'ganadorDe', partidoId: r1[1].id });
  });

  it('5 jugadores: el 5º zafa la ronda 1 y juega (como seed) la ronda 2', () => {
    const ps = armarLlaveRolling(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(ps).toHaveLength(4); // n-1
    expect(ps.filter((p) => p.ronda === 1)).toHaveLength(2); // (p1,p2)(p3,p4); p5 zafa
    const r2 = ps.filter((p) => p.ronda === 2);
    expect(r2).toHaveLength(1);
    // el skipper va al FRENTE del pool: p5 juega la ronda 2 (aparece como seed)
    const p5EnR2 = [r2[0].a, r2[0].b].some((s) => s !== null && s.tipo === 'seed' && s.parejaId === 'p5');
    expect(p5EnR2).toBe(true);
    expect(ps.filter((p) => p.ronda === 3)).toHaveLength(1); // final
  });

  it('potencia de 2 (8) no genera zafadas', () => {
    const ps = armarLlaveRolling(ids(8));
    expect(ps).toHaveLength(7);
    expect(ps.filter((p) => p.ronda === 1)).toHaveLength(4);
    expect(ps.filter((p) => p.ronda === 2)).toHaveLength(2);
    expect(ps.filter((p) => p.ronda === 3)).toHaveLength(1);
  });

  it('34 jugadores: 6 rondas con 17/8/4/2/1/1 partidos', () => {
    const ps = armarLlaveRolling(ids(34));
    expect(ps).toHaveLength(33);
    const conteo = [1, 2, 3, 4, 5, 6].map((r) => ps.filter((p) => p.ronda === r).length);
    expect(conteo).toEqual([17, 8, 4, 2, 1, 1]);
  });

  it('nadie aparece dos veces en la misma ronda', () => {
    const ps = armarLlaveRolling(ids(6));
    for (const r of new Set(ps.map((p) => p.ronda))) {
      const slots = ps.filter((p) => p.ronda === r).flatMap((p) => [p.a, p.b]);
      const resueltosR1 = slots.filter((s) => s !== null && s.tipo === 'seed').map((s) => (s as { parejaId: string }).parejaId);
      expect(new Set(resueltosR1).size).toBe(resueltosR1.length);
    }
  });

  it('menos de 2 jugadores no genera partidos', () => {
    expect(armarLlaveRolling([])).toEqual([]);
    expect(armarLlaveRolling(['solo'])).toEqual([]);
  });

  it('se juega hasta el campeón y una corrección en cascada limpia lo de adelante', () => {
    let ps = armarLlaveRolling(['p1', 'p2', 'p3', 'p4']);
    const r1 = ps.filter((p) => p.ronda === 1);
    ps = cargarResultadoLlave(ps, r1[0].id, 1, 0).partidos; // gana p1
    ps = cargarResultadoLlave(ps, r1[1].id, 0, 1).partidos; // gana p4
    const final = ps.find((p) => p.ronda === 2)!;
    ps = cargarResultadoLlave(ps, final.id, 1, 0).partidos; // campeón p1
    expect(campeonDe(ps)).toBe('p1');
    expect(borradosSiCorrijo(ps, r1[0].id, 0, 1)).toBe(1); // invertir R1m0 borra la final
    const res = cargarResultadoLlave(ps, r1[0].id, 0, 1); // ahora gana p2
    expect(campeonDe(res.partidos)).toBeNull();
    const r1m0 = res.partidos.find((p) => p.ronda === 1 && p.id === r1[0].id)!;
    expect(ganadorPartido(r1m0, res.partidos)).toBe('p2');
  });
});
