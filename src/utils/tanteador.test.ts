import { describe, expect, it } from 'vitest';
import type { TanteadorLado, TanteadorPartido } from '../types';
import {
  anotarPunto,
  corregirMarcadorActual,
  crearPartido,
  deshacerPunto,
  ganadorSet,
  jugadoresDe,
  marcadorActual,
  propuestasLlave,
  reiniciarPartido,
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

describe('reiniciarPartido y corregirMarcadorActual', () => {
  it('reiniciar vuelve todo a cero', () => {
    const jugado = anotar(partido(), [...racha('A', 15), ...racha('B', 7)]);
    const limpio = reiniciarPartido(jugado);
    expect(limpio.sets).toEqual([]);
    expect(limpio.hist).toEqual([[]]);
    expect(limpio.estado).toBe('en_juego');
    expect(limpio.ganador).toBeNull();
  });

  it('corregir reescribe el set en curso sin tocar los cerrados', () => {
    const jugado = anotar(partido(), [...racha('A', 15), 'A', 'B', 'B']);
    const r = corregirMarcadorActual(jugado, 5, 2);
    if (!r.ok) throw new Error(r.error);
    expect(marcadorActual(r.partido)).toEqual({ a: 5, b: 2 });
    expect(r.partido.sets).toEqual([{ a: 15, b: 0 }]);
  });

  it('rechaza un marcador que cerraria el set y valores invalidos', () => {
    const p = anotar(partido(), ['A', 'B']);
    expect(corregirMarcadorActual(p, 15, 3).ok).toBe(false);
    expect(corregirMarcadorActual(p, -1, 0).ok).toBe(false);
    expect(corregirMarcadorActual(p, 22, 0).ok).toBe(false);
    expect(corregirMarcadorActual(p, 14, 13).ok).toBe(true);
  });
});

describe('fase llave y propuestasLlave', () => {
  function finalizado(pa: string, pb: string, ganador: 'A' | 'B', extra?: Partial<TanteadorPartido>): TanteadorPartido {
    return {
      ...crearPartido({ id: Math.random().toString(36), categoria: 'DM', modo: 'fijas', parejaA: pa, parejaB: pb }),
      sets: ganador === 'A' ? [{ a: 15, b: 5 }, { a: 15, b: 5 }] : [{ a: 5, b: 15 }, { a: 5, b: 15 }],
      estado: 'final', ganador, ...extra,
    };
  }

  // Grupo: D1 le gana a todos, D2 gana 2, D3 gana 1, D4 gana 0
  const grupo = [
    finalizado('D1', 'D2', 'A'), finalizado('D1', 'D3', 'A'), finalizado('D1', 'D4', 'A'),
    finalizado('D2', 'D3', 'A'), finalizado('D2', 'D4', 'A'), finalizado('D3', 'D4', 'A'),
  ];

  it('los partidos de llave no suman en la tabla de grupos', () => {
    const llaveFinal = finalizado('D1', 'D2', 'B', { fase: 'llave', titulo: 'FINAL' });
    const tabla = tablaParejas([...grupo, llaveFinal], 'DM');
    expect(tabla[0]).toMatchObject({ nombre: 'D1', pg: 3, pj: 3 }); // la final no le agrega pj
  });

  it('sin llave propone semis 1v4 / 2v3 y final directa 1v2', () => {
    const props = propuestasLlave(grupo, 'DM', 'fijas');
    const semis = props.find((x) => x.id === 'semis');
    expect(semis?.partidos.map((p) => `${p.parejaA}-${p.parejaB}`)).toEqual(['D1-D4', 'D2-D3']);
    const fd = props.find((x) => x.id === 'final-directa');
    expect(fd?.partidos[0]).toMatchObject({ parejaA: 'D1', parejaB: 'D2', titulo: 'FINAL' });
  });

  it('con semis jugadas propone la final entre ganadores; con final creada, nada', () => {
    const s1 = finalizado('D1', 'D4', 'A', { fase: 'llave', titulo: 'SEMIFINAL 1' });
    const s2 = finalizado('D2', 'D3', 'B', { fase: 'llave', titulo: 'SEMIFINAL 2' });
    const props = propuestasLlave([...grupo, s1, s2], 'DM', 'fijas');
    expect(props).toHaveLength(1);
    expect(props[0].partidos[0]).toMatchObject({ titulo: 'FINAL', parejaA: 'D1', parejaB: 'D3' });
    // semis sin terminar: no propone nada
    const s2vivo = { ...s2, estado: 'en_juego' as const, ganador: null };
    expect(propuestasLlave([...grupo, s1, s2vivo], 'DM', 'fijas')).toHaveLength(0);
    // final ya creada: nada
    const f = finalizado('D1', 'D3', 'A', { fase: 'llave', titulo: 'FINAL' });
    expect(propuestasLlave([...grupo, s1, s2, f], 'DM', 'fijas')).toHaveLength(0);
  });

  it('rotativas propone final americana 1+4 vs 2+3', () => {
    const df = (ja: string[], jb: string[], g: 'A' | 'B') => ({
      ...crearPartido({ id: Math.random().toString(36), categoria: 'DF' as const, modo: 'rotativas' as const, parejaA: ja.join(' / '), parejaB: jb.join(' / '), jugadoresA: ja, jugadoresB: jb }),
      sets: g === 'A' ? [{ a: 15, b: 5 }, { a: 15, b: 5 }] : [{ a: 5, b: 15 }, { a: 5, b: 15 }],
      estado: 'final' as const, ganador: g,
    });
    // J1 gana sus dos, J4 pierde todo
    const partidos = [
      df(['J1', 'J2'], ['J3', 'J4'], 'A'),
      df(['J1', 'J3'], ['J2', 'J4'], 'A'),
      df(['J1', 'J4'], ['J2', 'J3'], 'B'),
    ];
    const props = propuestasLlave(partidos, 'DF', 'rotativas');
    expect(props).toHaveLength(1);
    const f = props[0].partidos[0];
    expect(f.titulo).toBe('FINAL');
    expect(f.jugadoresA).toContain('J1');
    expect(f.jugadoresA).toHaveLength(2);
    expect([...f.jugadoresA, ...f.jugadoresB].sort()).toEqual(['J1', 'J2', 'J3', 'J4']);
  });
});
