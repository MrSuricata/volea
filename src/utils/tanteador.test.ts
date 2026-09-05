import { describe, expect, it } from 'vitest';
import type { TanteadorLado, TanteadorPartido } from '../types';
import {
  anotarPunto,
  crearPartido,
  deshacerPunto,
  ganadorSet,
  jugadoresDe,
  marcadorActual,
  setsGanados,
  tablaAmericano,
  tablaParejas,
  terminarManual,
} from './tanteador';

function partido(): TanteadorPartido {
  return crearPartido({ id: 'test', categoria: 'DM', parejaA: 'UNO / DOS', parejaB: 'TRES / CUATRO' });
}

/** Anota una tanda de puntos y devuelve el estado final (ignora avisos). */
function anotar(p: TanteadorPartido, puntos: TanteadorLado[]): TanteadorPartido {
  return puntos.reduce((acc, lado) => anotarPunto(acc, lado).partido, p);
}

/** n puntos seguidos del mismo lado. */
function racha(lado: TanteadorLado, n: number): TanteadorLado[] {
  return Array.from({ length: n }, () => lado);
}

describe('ganadorSet (a 15, tope 21)', () => {
  it('cierra a 15 con diferencia de 2', () => {
    expect(ganadorSet({ a: 15, b: 13 }, 15, 21)).toBe('A');
    expect(ganadorSet({ a: 13, b: 15 }, 15, 21)).toBe('B');
  });
  it('desde 14-14 no cierra a 15: se define por 2', () => {
    expect(ganadorSet({ a: 15, b: 14 }, 15, 21)).toBeNull();
    expect(ganadorSet({ a: 16, b: 14 }, 15, 21)).toBe('A');
    expect(ganadorSet({ a: 18, b: 17 }, 15, 21)).toBeNull();
  });
  it('el tope 21 cierra aunque la diferencia sea 1', () => {
    expect(ganadorSet({ a: 21, b: 20 }, 15, 21)).toBe('A');
  });
});

describe('anotarPunto', () => {
  it('suma al marcador del set en curso', () => {
    const p = anotar(partido(), ['A', 'A', 'B']);
    expect(marcadorActual(p)).toEqual({ a: 2, b: 1 });
    expect(p.estado).toBe('en_juego');
  });

  it('cierra el set, lo guarda y abre el siguiente con aviso fin_set', () => {
    const casi = anotar(partido(), [...racha('A', 14), ...racha('B', 3)]);
    const { partido: p, aviso } = anotarPunto(casi, 'A');
    expect(p.sets).toEqual([{ a: 15, b: 3 }]);
    expect(p.hist).toHaveLength(2);
    expect(marcadorActual(p)).toEqual({ a: 0, b: 0 });
    expect(aviso).toMatchObject({ tipo: 'fin_set', numero: 1, ganador: 'A' });
  });

  it('dos sets ganados terminan el partido', () => {
    const unSet = anotar(partido(), racha('A', 15));
    const casi = anotar(unSet, racha('A', 14));
    const { partido: p, aviso } = anotarPunto(casi, 'A');
    expect(p.estado).toBe('final');
    expect(p.ganador).toBe('A');
    expect(setsGanados(p)).toEqual({ A: 2, B: 0 });
    expect(aviso).toMatchObject({ tipo: 'fin_partido', ganador: 'A' });
    // partido final no acepta más puntos
    expect(anotarPunto(p, 'B').partido).toBe(p);
  });

  it('avisa cambio de lado a los 8 del 3er set, una sola vez', () => {
    const dosSets = anotar(partido(), [...racha('A', 15), ...racha('B', 15)]);
    const casi = anotar(dosSets, [...racha('A', 7), ...racha('B', 5)]);
    const { partido: p, aviso } = anotarPunto(casi, 'A');
    expect(aviso).toEqual({ tipo: 'cambio_lado' });
    expect(p.avisos.cambio3).toBe(true);
    // el 8 del otro lado ya no avisa
    const { aviso: aviso2 } = anotarPunto(anotar(p, racha('B', 2)), 'B');
    expect(aviso2).toBeNull();
  });
});

describe('deshacerPunto', () => {
  it('borra el último punto', () => {
    const p = deshacerPunto(anotar(partido(), ['A', 'B', 'B']));
    expect(marcadorActual(p)).toEqual({ a: 1, b: 1 });
  });

  it('con el set en curso vacío reabre el set anterior', () => {
    const conSet = anotar(partido(), racha('A', 15)); // set cerrado, set 2 vacío
    const p = deshacerPunto(conSet);
    expect(p.sets).toEqual([]);
    expect(p.hist).toHaveLength(1);
    expect(marcadorActual(p)).toEqual({ a: 14, b: 0 });
  });

  it('reabre un partido final', () => {
    const final = anotar(partido(), [...racha('A', 15), ...racha('A', 15)]);
    expect(final.estado).toBe('final');
    const p = deshacerPunto(final);
    expect(p.estado).toBe('en_juego');
    expect(p.ganador).toBeNull();
    expect(p.sets).toEqual([{ a: 15, b: 0 }]);
    expect(marcadorActual(p)).toEqual({ a: 14, b: 0 });
  });

  it('sin puntos no hace nada', () => {
    const p = partido();
    expect(deshacerPunto(p)).toBe(p);
  });
});

describe('terminarManual', () => {
  it('guarda el set parcial y saca ganador por sets a favor', () => {
    const enJuego = anotar(partido(), [...racha('A', 15), ...racha('B', 4), ...racha('A', 7)]);
    const p = terminarManual(enJuego);
    expect(p.estado).toBe('final');
    expect(p.sets).toEqual([{ a: 15, b: 0 }, { a: 7, b: 4 }]);
    expect(p.ganador).toBe('A');
  });

  it('empate de sets queda sin ganador, y deshacer solo reabre (no borra sets reales)', () => {
    const enJuego = anotar(partido(), [...racha('A', 15), ...racha('B', 15)]);
    const p = terminarManual(enJuego); // set en curso vacío: no agrega parcial
    expect(p.ganador).toBeNull();
    expect(p.sets).toHaveLength(2);
    const reabierto = deshacerPunto(p);
    expect(reabierto.estado).toBe('en_juego');
    expect(reabierto.sets).toHaveLength(2);
    expect(marcadorActual(reabierto)).toEqual({ a: 0, b: 0 });
  });

  it('deshacer tras terminar a mano con set parcial des-guarda el parcial sin borrar puntos', () => {
    const enJuego = anotar(partido(), [...racha('A', 15), ...racha('B', 4), ...racha('A', 7)]);
    const reabierto = deshacerPunto(terminarManual(enJuego));
    expect(reabierto.estado).toBe('en_juego');
    expect(reabierto.sets).toEqual([{ a: 15, b: 0 }]);
    expect(marcadorActual(reabierto)).toEqual({ a: 7, b: 4 });
  });
});

describe('tablaAmericano', () => {
  function final(
    jugadoresA: string[], jugadoresB: string[],
    sets: { a: number; b: number }[], ganador: 'A' | 'B',
  ): TanteadorPartido {
    return {
      ...crearPartido({ id: Math.random().toString(36), categoria: 'DM', parejaA: jugadoresA.join(' / '), parejaB: jugadoresB.join(' / '), jugadoresA, jugadoresB }),
      sets, estado: 'final', ganador,
    };
  }

  it('acumula por jugador: PG, PF, PC y DIF, orden PG > DIF > PF', () => {
    const partidos = [
      // Ronda 1: JUAN+PEDRO 15-10 / 15-8 a LUIS+MARIO
      final(['JUAN', 'PEDRO'], ['LUIS', 'MARIO'], [{ a: 15, b: 10 }, { a: 15, b: 8 }], 'A'),
      // Ronda 2 (rotan): JUAN+LUIS 15-13 / 12-15 / 15-11 a PEDRO+MARIO
      final(['JUAN', 'LUIS'], ['PEDRO', 'MARIO'], [{ a: 15, b: 13 }, { a: 12, b: 15 }, { a: 15, b: 11 }], 'A'),
    ];
    const tabla = tablaAmericano(partidos, 'DM');
    expect(tabla.map((f) => f.nombre)).toEqual(['JUAN', 'PEDRO', 'LUIS', 'MARIO']);
    const juan = tabla[0];
    expect(juan).toMatchObject({ pj: 2, pg: 2, pf: 72, pc: 57, dif: 15 });
    const pedro = tabla[1]; // 1 ganado; dif = (30-18) + (39-42) = +9
    expect(pedro).toMatchObject({ pj: 2, pg: 1, dif: 9 });
    const luis = tabla[2]; // 1 ganado; dif = (18-30) + (42-39) = -9
    expect(luis).toMatchObject({ pj: 2, pg: 1, dif: -9 });
    expect(tabla[3]).toMatchObject({ nombre: 'MARIO', pg: 0 });
  });

  it('solo cuenta finalizados de la categoria pedida', () => {
    const dm = final(['A1', 'A2'], ['B1', 'B2'], [{ a: 15, b: 0 }, { a: 15, b: 0 }], 'A');
    const df = { ...final(['F1', 'F2'], ['F3', 'F4'], [{ a: 15, b: 3 }, { a: 15, b: 3 }], 'A'), categoria: 'DF' as const };
    const vivo = { ...final(['A1', 'A2'], ['B1', 'B2'], [{ a: 15, b: 0 }], 'A'), estado: 'en_juego' as const, ganador: null };
    const tabla = tablaAmericano([dm, df, vivo], 'DM');
    expect(tabla).toHaveLength(4);
    expect(tabla[0].pj).toBe(1);
    expect(tablaAmericano([dm, df, vivo], 'DF')[0].nombre).toBe('F1');
  });

  it('partidos viejos sin jugadores se parten por el texto de la pareja', () => {
    const viejo = { ...final([], [], [{ a: 15, b: 10 }, { a: 15, b: 10 }], 'A'), parejaA: 'OLSZTYN / CARDOZO', parejaB: 'RIVERO - HERNANDEZ' };
    expect(jugadoresDe(viejo, 'A')).toEqual(['OLSZTYN', 'CARDOZO']);
    expect(jugadoresDe(viejo, 'B')).toEqual(['RIVERO', 'HERNANDEZ']);
    const tabla = tablaAmericano([viejo], 'DM');
    expect(tabla.map((f) => f.nombre)).toContain('HERNANDEZ');
    expect(tabla).toHaveLength(4);
  });
});

describe('tablaParejas', () => {
  it('suma por dupla con el mismo orden PG > DIF > PF', () => {
    const base = crearPartido({ id: 'x', categoria: 'DM', modo: 'fijas', parejaA: 'D1', parejaB: 'D2' });
    const p1 = { ...base, id: 'p1', sets: [{ a: 15, b: 10 }, { a: 15, b: 8 }], estado: 'final' as const, ganador: 'A' as const };
    const p2 = { ...base, id: 'p2', parejaA: 'D1', parejaB: 'D3', sets: [{ a: 10, b: 15 }, { a: 15, b: 13 }, { a: 11, b: 15 }], estado: 'final' as const, ganador: 'B' as const };
    const tabla = tablaParejas([p1, p2], 'DM');
    // D3 y D1 tienen 1 ganado cada una; desempata la diferencia (+7 vs +5)
    expect(tabla[0]).toMatchObject({ nombre: 'D3', pj: 1, pg: 1, dif: 7 });
    expect(tabla[1]).toMatchObject({ nombre: 'D1', pj: 2, pg: 1, dif: 5 });
    expect(tabla[2]).toMatchObject({ nombre: 'D2', pj: 1, pg: 0, dif: -12 });
  });
});
