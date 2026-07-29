import { describe, expect, it } from 'vitest';
import { crearRng, mezclar } from './rng';

describe('rng', () => {
  it('misma seed produce la misma secuencia', () => {
    const r1 = crearRng(42);
    const r2 = crearRng(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });

  it('seeds distintas producen secuencias distintas', () => {
    expect(crearRng(1)()).not.toEqual(crearRng(2)());
  });

  it('mezclar es determinista con la misma seed y no muta el original', () => {
    const orig = ['a', 'b', 'c', 'd', 'e'];
    const copia = [...orig];
    const m1 = mezclar(orig, crearRng(7));
    const m2 = mezclar(orig, crearRng(7));
    expect(m1).toEqual(m2);
    expect(orig).toEqual(copia);
    expect([...m1].sort()).toEqual([...orig].sort());
  });
});
