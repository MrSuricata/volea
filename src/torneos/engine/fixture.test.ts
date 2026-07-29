import { describe, expect, it } from 'vitest';
import { generarFixture } from './fixture';

function pares(partidos: { aId: string; bId: string }[]): string[] {
  return partidos.map((p) => [p.aId, p.bId].sort().join('-'));
}

describe('generarFixture', () => {
  it('4 parejas: 3 rondas de 2 partidos, todos contra todos una vez', () => {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    const partidos = generarFixture(ids);
    expect(partidos).toHaveLength(6);
    expect(new Set(pares(partidos)).size).toBe(6); // sin repetidos
    const rondas = new Set(partidos.map((p) => p.ronda));
    expect(rondas).toEqual(new Set([1, 2, 3]));
    for (const r of rondas) {
      const deRonda = partidos.filter((p) => p.ronda === r);
      expect(deRonda).toHaveLength(2);
      const jugadores = deRonda.flatMap((p) => [p.aId, p.bId]);
      expect(new Set(jugadores).size).toBe(4); // nadie juega 2 veces en la ronda
    }
  });

  it('5 parejas (impar): 5 rondas, cada pareja libre exactamente una vez', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const partidos = generarFixture(ids);
    expect(partidos).toHaveLength(10); // C(5,2)
    expect(new Set(pares(partidos)).size).toBe(10);
    const rondas = [...new Set(partidos.map((p) => p.ronda))].sort((a, b) => a - b);
    expect(rondas).toEqual([1, 2, 3, 4, 5]);
    for (const r of rondas) {
      const deRonda = partidos.filter((p) => p.ronda === r);
      expect(deRonda).toHaveLength(2); // 4 juegan, 1 libre
      const jugadores = deRonda.flatMap((p) => [p.aId, p.bId]);
      expect(new Set(jugadores).size).toBe(4);
    }
    // cada pareja juega en exactamente 4 rondas => libre 1 vez
    for (const id of ids) {
      const rondasJugadas = partidos.filter((p) => p.aId === id || p.bId === id);
      expect(rondasJugadas).toHaveLength(4);
    }
  });

  it('3 parejas: 3 rondas de 1 partido', () => {
    const partidos = generarFixture(['a', 'b', 'c']);
    expect(partidos).toHaveLength(3);
    expect(new Set(pares(partidos)).size).toBe(3);
  });

  it('6 parejas: 5 rondas de 3 partidos, sin repetidos', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const partidos = generarFixture(ids);
    expect(partidos).toHaveLength(15); // C(6,2)
    expect(new Set(pares(partidos)).size).toBe(15);
    for (let r = 1; r <= 5; r++) {
      const deRonda = partidos.filter((p) => p.ronda === r);
      expect(deRonda).toHaveLength(3);
      expect(new Set(deRonda.flatMap((p) => [p.aId, p.bId])).size).toBe(6);
    }
  });

  it('2 parejas: 1 ronda de 1 partido', () => {
    expect(generarFixture(['a', 'b'])).toEqual([{ ronda: 1, aId: 'a', bId: 'b' }]);
  });
});
