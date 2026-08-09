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

describe('generarFixture ida y vuelta', () => {
  // Agrupa los partidos por par (sin importar el lado) para comparar ida vs vuelta.
  function porPar(partidos: { ronda: number; aId: string; bId: string }[]) {
    const mapa = new Map<string, { ronda: number; aId: string; bId: string }[]>();
    for (const p of partidos) {
      const clave = [p.aId, p.bId].sort().join('-');
      if (!mapa.has(clave)) mapa.set(clave, []);
      mapa.get(clave)!.push(p);
    }
    return mapa;
  }

  it('sin opciones el fixture es EXACTAMENTE el de siempre (pin de regresión)', () => {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    const esperado = [
      { ronda: 1, aId: 'p1', bId: 'p4' },
      { ronda: 1, aId: 'p2', bId: 'p3' },
      { ronda: 2, aId: 'p1', bId: 'p3' },
      { ronda: 2, aId: 'p4', bId: 'p2' },
      { ronda: 3, aId: 'p1', bId: 'p2' },
      { ronda: 3, aId: 'p3', bId: 'p4' },
    ];
    expect(generarFixture(ids)).toEqual(esperado);
    expect(generarFixture(ids, {})).toEqual(esperado);
    expect(generarFixture(ids, { idaYVuelta: false })).toEqual(esperado);
  });

  it('4 parejas: 6 rondas, 12 partidos, cada par juega 2 veces con los lados invertidos', () => {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    const partidos = generarFixture(ids, { idaYVuelta: true });
    expect(partidos).toHaveLength(12);
    const rondas = [...new Set(partidos.map((p) => p.ronda))].sort((a, b) => a - b);
    expect(rondas).toEqual([1, 2, 3, 4, 5, 6]);
    for (const r of rondas) {
      const deRonda = partidos.filter((p) => p.ronda === r);
      expect(deRonda).toHaveLength(2);
      expect(new Set(deRonda.flatMap((p) => [p.aId, p.bId])).size).toBe(4); // nadie juega 2 veces en la ronda
    }
    const pares = porPar(partidos);
    expect(pares.size).toBe(6);
    for (const [, [ida, vuelta]] of pares) {
      expect(vuelta.ronda).toBe(ida.ronda + 3); // misma ronda, corrida una rueda
      expect(vuelta.aId).toBe(ida.bId); // lados invertidos
      expect(vuelta.bId).toBe(ida.aId);
    }
    // la vuelta conserva el orden de emparejamiento de la ida
    const ida = generarFixture(ids);
    expect(partidos.slice(0, 6)).toEqual(ida);
    expect(partidos.slice(6)).toEqual(ida.map((p) => ({ ronda: p.ronda + 3, aId: p.bId, bId: p.aId })));
  });

  it('2 parejas: partido de ida y partido de vuelta', () => {
    expect(generarFixture(['a', 'b'], { idaYVuelta: true })).toEqual([
      { ronda: 1, aId: 'a', bId: 'b' },
      { ronda: 2, aId: 'b', bId: 'a' },
    ]);
  });

  it('3 parejas (impar, con libre): 6 rondas, cada par juega 2 veces, cada pareja libre 2 veces', () => {
    const ids = ['a', 'b', 'c'];
    const partidos = generarFixture(ids, { idaYVuelta: true });
    expect(partidos).toHaveLength(6);
    const rondas = [...new Set(partidos.map((p) => p.ronda))].sort((a, b) => a - b);
    expect(rondas).toEqual([1, 2, 3, 4, 5, 6]); // 3 por rueda
    const pares = porPar(partidos);
    expect(pares.size).toBe(3);
    for (const [, [ida, vuelta]] of pares) {
      expect(vuelta.ronda).toBe(ida.ronda + 3);
      expect(vuelta.aId).toBe(ida.bId);
      expect(vuelta.bId).toBe(ida.aId);
    }
    for (const id of ids) {
      expect(partidos.filter((p) => p.aId === id || p.bId === id)).toHaveLength(4); // juega 4 de 6 rondas
    }
  });
});
