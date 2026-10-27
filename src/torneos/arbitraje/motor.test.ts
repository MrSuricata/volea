import { describe, expect, it } from 'vitest';
import { estadoDe, resultadoFinal, resumen, type Jugada } from './motor';
import type { FormatoArbitraje } from '../engine/tipos';

const SO11: FormatoArbitraje = { tipo: 'sideout', a: 11, mejorDe: 1 };
const RA15: FormatoArbitraje = { tipo: 'rally', a: 15, mejorDe: 1 };
const RA11x3: FormatoArbitraje = { tipo: 'rally', a: 11, mejorDe: 3 };
const ini = (saca: 'A' | 'B' = 'A'): Jugada => ({ t: 'inicio', saca, derechaA: 0, derechaB: 0 });
const r = (gana: 'A' | 'B'): Jugada => ({ t: 'rally', gana });
const rallies = (gana: 'A' | 'B', n: number) => Array.from({ length: n }, () => r(gana));

describe('side out en dobles', () => {
  it('arranca 0-0-2 y el primer side out es directo', () => {
    let e = estadoDe(SO11, true, [ini('A')]);
    expect(e.canto).toBe('0-0-2');
    e = estadoDe(SO11, true, [ini('A'), r('B')]);
    expect(e.saca).toBe('B');
    expect(e.servidor).toBe(1);
    expect(e.canto).toBe('0-0-1');
  });

  it('solo suma el que saca; el servidor 1 pierde y pasa al 2', () => {
    const e = estadoDe(SO11, true, [ini('A'), r('B'), r('B'), r('A')]);
    expect(e.puntos).toEqual({ a: 0, b: 1 });
    expect(e.saca).toBe('B');
    expect(e.servidor).toBe(2);
    expect(e.canto).toBe('1-0-2');
  });

  it('el que saca cambia de lado al sumar y sigue sacando el mismo', () => {
    const e = estadoDe(SO11, true, [ini('A'), r('A')]);
    expect(e.puntos).toEqual({ a: 1, b: 0 });
    expect(e.derecha.A).toBe(1);
    expect(e.sirve).toBe(0);
  });

  it('game a 11 por 2 y cambio de lado a 6', () => {
    const e6 = estadoDe(SO11, true, [ini('A'), ...rallies('A', 6)]);
    expect(e6.cambiarLado).toBe(true);
    const e7 = estadoDe(SO11, true, [ini('A'), ...rallies('A', 7)]);
    expect(e7.cambiarLado).toBe(false);
    const fin = estadoDe(SO11, true, [ini('A'), ...rallies('A', 11)]);
    expect(fin.terminado).toBe(true);
    expect(fin.ganador).toBe('A');
    expect(resultadoFinal(SO11, fin)).toEqual({ puntosA: 11, puntosB: 0 });
  });
});

describe('side out en singles', () => {
  it('no hay servidor 2: perder el saque es side out', () => {
    const e = estadoDe(SO11, false, [ini('A'), r('B')]);
    expect(e.saca).toBe('B');
    expect(e.canto).toBe('0-0');
  });
});

describe('rally', () => {
  it('cada rally suma y el que gana recibiendo pasa a sacar', () => {
    const e = estadoDe(RA15, true, [ini('A'), r('B')]);
    expect(e.puntos).toEqual({ a: 0, b: 1 });
    expect(e.saca).toBe('B');
    expect(e.canto).toBe('1-0');
  });

  it('se gana por 2: 15-14 sigue, 16-14 termina', () => {
    const base = [ini('A'), ...rallies('A', 14), ...rallies('B', 14)];
    expect(estadoDe(RA15, true, [...base, r('A')]).terminado).toBe(false);
    const fin = estadoDe(RA15, true, [...base, r('A'), r('A')]);
    expect(fin.terminado).toBe(true);
    expect(resultadoFinal(RA15, fin)).toEqual({ puntosA: 16, puntosB: 14 });
  });

  it('cambio de lado a 8 en game a 15', () => {
    expect(estadoDe(RA15, true, [ini('A'), ...rallies('B', 8)]).cambiarLado).toBe(true);
  });
});

describe('mejor de 3', () => {
  it('2-0 termina; el segundo game lo saca el otro equipo', () => {
    const g1 = [ini('A'), ...rallies('A', 11)];
    const tras1 = estadoDe(RA11x3, true, g1);
    expect(tras1.finDeGame).toBe(true);
    expect(tras1.terminado).toBe(false);
    expect(tras1.game).toBe(2);
    expect(tras1.saca).toBe('B');
    expect(tras1.puntos).toEqual({ a: 0, b: 0 });
    const fin = estadoDe(RA11x3, true, [...g1, ...rallies('A', 11)]);
    expect(fin.terminado).toBe(true);
    expect(resultadoFinal(RA11x3, fin)).toEqual({ puntosA: 2, puntosB: 0, games: [{ a: 11, b: 0 }, { a: 11, b: 0 }] });
  });

  it('el cambio de lado de mitad solo va en el tercer game', () => {
    const g1 = [ini('A'), ...rallies('A', 6)];
    expect(estadoDe(RA11x3, true, g1).cambiarLado).toBe(false);
    const hasta3 = [ini('A'), ...rallies('A', 11), ...rallies('B', 11), ...rallies('A', 6)];
    expect(estadoDe(RA11x3, true, hasta3).cambiarLado).toBe(true);
  });
});

describe('tiempos, deshacer y resumen', () => {
  it('cuenta los tiempos hasta el máximo del game', () => {
    const e = estadoDe(SO11, true, [ini('A'), { t: 'tiempo', equipo: 'A' }, { t: 'tiempo', equipo: 'A' }, { t: 'tiempo', equipo: 'A' }]);
    expect(e.tiempos.A).toBe(2);
    expect(e.maxTiempos).toBe(2);
  });

  it('las jugadas después del final no cuentan', () => {
    const e = estadoDe(SO11, true, [ini('A'), ...rallies('A', 11), r('B')]);
    expect(e.puntos).toEqual({ a: 11, b: 0 });
  });

  it('sin inicio no hay partido', () => {
    expect(estadoDe(SO11, true, [r('A')]).iniciado).toBe(false);
  });

  it('el resumen lleva lo que necesita la TV', () => {
    const e = estadoDe(RA15, true, [ini('A'), r('A'), r('B')]);
    expect(resumen(e)).toMatchObject({ puntos: { a: 1, b: 1 }, saca: 'B', game: 1, gamesA: 0, gamesB: 0, terminado: false });
  });
});
