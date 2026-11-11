import { describe, expect, it } from 'vitest';
import { esMarcadorValido, estadoDe, formatoDelPartido, resultadoFinal, resumen, type Jugada } from './motor';
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

describe('formato elegido al empezar', () => {
  it('sin elección vale el de la categoría; con elección, el elegido', () => {
    expect(formatoDelPartido(SO11, [ini('A'), r('A')])).toEqual(SO11);
    expect(formatoDelPartido(SO11, [{ t: 'inicio', saca: 'A', derechaA: 0, derechaB: 0, formato: RA11x3 }])).toEqual(RA11x3);
    expect(formatoDelPartido(SO11, [])).toEqual(SO11);
  });
  it('un formato roto se ignora', () => {
    const malo = { tipo: 'rally', a: 9, mejorDe: 1 } as unknown as FormatoArbitraje;
    expect(formatoDelPartido(SO11, [{ t: 'inicio', saca: 'A', derechaA: 0, derechaB: 0, formato: malo }])).toEqual(SO11);
  });
  it('rally a 15 elegido sobre una categoría de side out: termina a 15', () => {
    const jug: Jugada[] = [{ t: 'inicio', saca: 'A', derechaA: 0, derechaB: 0, formato: RA15 }, ...rallies('B', 15)];
    const f = formatoDelPartido(SO11, jug);
    const e = estadoDe(f, true, jug);
    expect(e.terminado).toBe(true);
    expect(resultadoFinal(f, e)).toEqual({ puntosA: 0, puntosB: 15 });
  });
});

describe('quién saca y de qué lado, jugada por jugada (side out en dobles)', () => {
  // A arranca sacando; en cada pareja el jugador 0 arranca a la derecha.
  // [jugada, saca, servidor, quién tiene la pelota, quién está a la derecha en A y en B, canto]
  const pasos: [Jugada, 'A' | 'B', 1 | 2, 0 | 1, 0 | 1, 0 | 1, string][] = [
    [ini('A'), 'A', 2, 0, 0, 0, '0-0-2'], // 0-0-2: saca el de la derecha de A
    [r('A'), 'A', 2, 0, 1, 0, '1-0-2'], // suma A: el que sacó cruza a la izquierda y sigue sacando
    [r('B'), 'B', 1, 0, 1, 0, '0-1-1'], // pierde el servidor 2: side out, saca el de la derecha de B
    [r('B'), 'B', 1, 0, 1, 1, '1-1-1'], // suma B: B0 cruza a la izquierda y sigue
    [r('A'), 'B', 2, 1, 1, 1, '1-1-2'], // pierde el servidor 1: pasa al compañero (B1)
    [r('B'), 'B', 2, 1, 1, 0, '2-1-2'], // suma B con B1: B1 cruza
    [r('A'), 'A', 1, 1, 1, 0, '1-2-1'], // side out: saca el de la derecha de A, que ahora es A1 (A tiene 1, impar)
    [r('B'), 'A', 2, 0, 1, 0, '1-2-2'], // pierde A1: saca A0
    [r('A'), 'A', 2, 0, 0, 0, '2-2-2'], // suma A con A0
  ];
  it.each(pasos.map((p, i) => [i, ...p] as const))('jugada %i', (i, _j, saca, servidor, sirve, derA, derB, canto) => {
    const e = estadoDe(SO11, true, pasos.slice(0, i + 1).map((p) => p[0]));
    expect({ saca: e.saca, servidor: e.servidor, sirve: e.sirve, derecha: e.derecha, canto: e.canto })
      .toEqual({ saca, servidor, sirve, derecha: { A: derA, B: derB }, canto });
  });

  it('en cada equipo, el que arrancó a la derecha está a la derecha con puntaje par; el primer servidor de cada turno es el de la derecha', () => {
    const jug: Jugada[] = [ini('A')];
    for (let i = 0; i < 60; i++) {
      const antes = estadoDe(SO11, true, jug);
      jug.push(r(i % 3 === 0 ? 'B' : 'A'));
      const e = estadoDe(SO11, true, jug);
      if (e.terminado) break;
      expect(e.derecha.A === 0).toBe(e.puntos.a % 2 === 0);
      expect(e.derecha.B === 0).toBe(e.puntos.b % 2 === 0);
      if (e.saca !== antes.saca) expect({ servidor: e.servidor, sirve: e.sirve }).toEqual({ servidor: 1, sirve: e.derecha[e.saca] });
    }
  });
});

describe('deshacer cruzando games', () => {
  it('deshacer el punto que cerró el game vuelve al game anterior con sus tiempos', () => {
    const g1: Jugada[] = [ini('A'), ...rallies('A', 5), { t: 'tiempo', equipo: 'B' }, ...rallies('A', 6)];
    const cerrado = estadoDe(RA11x3, true, g1);
    expect(cerrado).toMatchObject({ game: 2, gamesA: 1, saca: 'B', puntos: { a: 0, b: 0 }, tiempos: { A: 0, B: 0 } });
    const deshecho = estadoDe(RA11x3, true, g1.slice(0, -1));
    expect(deshecho).toMatchObject({ game: 1, gamesA: 0, games: [], saca: 'A', puntos: { a: 10, b: 0 }, tiempos: { A: 0, B: 1 }, finDeGame: false });
  });

  it('deshacer el primer punto del game 2 deja el game 2 en 0-0 con el saque del otro equipo', () => {
    const g1 = [ini('A'), ...rallies('A', 11)];
    const e = estadoDe(RA11x3, true, [...g1, r('B'), r('B')].slice(0, -2));
    expect(e).toMatchObject({ game: 2, saca: 'B', puntos: { a: 0, b: 0 }, finDeGame: true });
  });

  it('deshacer el punto que cerró el partido lo reabre', () => {
    const jug = [ini('A'), ...rallies('A', 11), ...rallies('A', 11)];
    expect(estadoDe(RA11x3, true, jug).terminado).toBe(true);
    const e = estadoDe(RA11x3, true, jug.slice(0, -1));
    expect(e).toMatchObject({ terminado: false, ganador: null, game: 2, gamesA: 1, puntos: { a: 10, b: 0 } });
  });
});

describe('game 3 a 21', () => {
  const RA21x3: FormatoArbitraje = { tipo: 'rally', a: 21, mejorDe: 3 };
  const hasta3 = [ini('A'), ...rallies('A', 21), ...rallies('B', 21)];
  it('cambio de lado a 11 en el tercero (una sola vez) y 3 tiempos', () => {
    expect(estadoDe(RA21x3, true, [...hasta3, ...rallies('A', 10)]).cambiarLado).toBe(false);
    const a11 = [...hasta3, ...rallies('A', 11)];
    const e = estadoDe(RA21x3, true, a11);
    expect(e).toMatchObject({ game: 3, cambiarLado: true, puntos: { a: 11, b: 0 }, maxTiempos: 3 });
    expect(estadoDe(RA21x3, true, [...a11, r('B')]).cambiarLado).toBe(false);
    expect(estadoDe(RA21x3, true, [...a11, ...rallies('B', 11)]).cambiarLado).toBe(false);
  });
  it('en los games 1 y 2 no hay cambio a mitad', () => {
    expect(estadoDe(RA21x3, true, [ini('A'), ...rallies('A', 11)]).cambiarLado).toBe(false);
  });
  it('el tercero lo saca el que no sacó primero el segundo', () => {
    expect(estadoDe(RA21x3, true, hasta3).saca).toBe('A');
  });
});

describe('marcador válido para dibujar', () => {
  it('acepta el resumen del motor y rechaza lo roto', () => {
    expect(esMarcadorValido(resumen(estadoDe(RA15, true, [ini('A'), r('A')])))).toBe(true);
    expect(esMarcadorValido({ puntos: { a: 1, b: 0 }, saca: 'A' })).toBe(false); // sin games
    expect(esMarcadorValido(null)).toBe(false);
    expect(esMarcadorValido({ puntos: { a: 1, b: 0 }, games: [null], gamesA: 0, gamesB: 0, game: 1, saca: 'A' })).toBe(false);
    expect(esMarcadorValido({ puntos: { a: '1', b: 0 }, games: [], gamesA: 0, gamesB: 0, game: 1, saca: 'A' })).toBe(false);
  });
});
