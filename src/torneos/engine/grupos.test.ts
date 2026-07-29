import { describe, expect, it } from 'vitest';
import { crearRng } from './rng';
import {
  generarPartidosGrupos,
  opcionesCantidadGrupos,
  repartirEnGrupos,
  sugerirCantidadGrupos,
} from './grupos';

describe('opcionesCantidadGrupos', () => {
  it('solo permite configuraciones sin grupos de menos de 3', () => {
    expect(opcionesCantidadGrupos(4)).toEqual([1]);
    expect(opcionesCantidadGrupos(6)).toEqual([2]); // 1 grupo no vale (6 > 5); 3 grupos serían de 2
    expect(opcionesCantidadGrupos(8)).toEqual([2]);
    expect(opcionesCantidadGrupos(12)).toEqual([2, 3, 4]);
    expect(opcionesCantidadGrupos(10)).toEqual([2, 3]);
  });

  it('con 3 a 5 parejas la única opción es 1 grupo', () => {
    expect(opcionesCantidadGrupos(3)).toEqual([1]);
    expect(opcionesCantidadGrupos(5)).toEqual([1]);
  });
});

describe('sugerirCantidadGrupos', () => {
  it('apunta a grupos de ~4', () => {
    expect(sugerirCantidadGrupos(8)).toBe(2);
    expect(sugerirCantidadGrupos(12)).toBe(3);
    expect(sugerirCantidadGrupos(16)).toBe(4);
    expect(sugerirCantidadGrupos(10)).toBe(3); // 4+3+3 mejor que 5+5
    expect(sugerirCantidadGrupos(4)).toBe(1);
  });
});

describe('repartirEnGrupos', () => {
  it('reparte parejo (dif máx 1), cubre a todos y es determinista por seed', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];
    const r1 = repartirEnGrupos(ids, 3, crearRng(5));
    const r2 = repartirEnGrupos(ids, 3, crearRng(5));
    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(3);
    const tamanos = r1.map((g) => g.length).sort();
    expect(tamanos).toEqual([3, 3, 4]);
    expect(r1.flat().sort()).toEqual([...ids].sort());
  });

  it('cantidad 1 devuelve un solo grupo con todos; cantidad inválida tira error', () => {
    const r = repartirEnGrupos(['a', 'b', 'c'], 1, crearRng(42));
    expect(r).toHaveLength(1);
    expect([...r[0]].sort()).toEqual(['a', 'b', 'c']);
    expect(() => repartirEnGrupos(['a'], 0, crearRng(1))).toThrow();
  });
});

describe('generarPartidosGrupos', () => {
  it('genera el fixture de cada grupo con ids y grupoId correctos', () => {
    const grupos = [
      { id: 'g1', nombre: 'A', parejaIds: ['a', 'b', 'c', 'd'] },
      { id: 'g2', nombre: 'B', parejaIds: ['e', 'f', 'g'] },
    ];
    const partidos = generarPartidosGrupos(grupos);
    expect(partidos.filter((p) => p.grupoId === 'g1')).toHaveLength(6);
    expect(partidos.filter((p) => p.grupoId === 'g2')).toHaveLength(3);
    expect(new Set(partidos.map((p) => p.id)).size).toBe(9);
    expect(partidos.every((p) => p.puntosA === null && p.puntosB === null)).toBe(true);
  });
});
