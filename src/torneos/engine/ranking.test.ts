import { describe, expect, it } from 'vitest';
import { CONFIG_PUNTOS_DEFAULT } from './tipos';
import { armarLlave, cargarResultadoLlave } from './llave';
import type { SeedInfo } from './llave';
import { escalonEnLlave, escalonDePareja, puntosDe } from './ranking';
import type { Torneo } from './tipos';

const cfg = CONFIG_PUNTOS_DEFAULT;
const seeds = (ids: string[]): SeedInfo[] => ids.map((parejaId) => ({ parejaId, grupoId: '' }));

describe('puntosDe', () => {
  it('A usa la escalera tal cual; B baja un escalon; PARTICIPO es piso', () => {
    expect(puntosDe('CAMPEON', 'A', cfg)).toBe(100);
    expect(puntosDe('CAMPEON', 'B', cfg)).toBe(86);
    expect(puntosDe('SEMI', 'B', cfg)).toBe(60); // = A CUARTOS
    expect(puntosDe('FINALISTA', 'B', cfg)).toBe(72); // = A SEMI
    expect(puntosDe('PARTICIPO', 'A', cfg)).toBe(40);
    expect(puntosDe('PARTICIPO', 'B', cfg)).toBe(40);
    expect(puntosDe('OCTAVOS', 'B', cfg)).toBe(40); // baja al piso
  });
});

describe('escalonEnLlave', () => {
  it('llave de 4: campeon / finalista / los dos semifinalistas', () => {
    let ps = armarLlave(seeds(['p1', 'p2', 'p3', 'p4']), false);
    const r1 = ps.filter((p) => p.ronda === 1);
    ps = cargarResultadoLlave(ps, r1[0].id, 11, 7).partidos; // gana p1 (vs p4)
    ps = cargarResultadoLlave(ps, r1[1].id, 11, 7).partidos; // gana p2 (vs p3)
    const final = ps.find((p) => p.ronda === 2)!;
    ps = cargarResultadoLlave(ps, final.id, 11, 5).partidos; // campeon p1
    expect(escalonEnLlave(ps, 'p1')).toBe('CAMPEON');
    expect(escalonEnLlave(ps, 'p2')).toBe('FINALISTA');
    expect(escalonEnLlave(ps, 'p3')).toBe('SEMI');
    expect(escalonEnLlave(ps, 'p4')).toBe('SEMI');
  });

  it('llave de 8: el que cae en primera ronda es CUARTOS', () => {
    let ps = armarLlave(seeds(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']), false);
    const r1 = ps.filter((p) => p.ronda === 1);
    const res = cargarResultadoLlave(ps, r1[0].id, 11, 3);
    ps = res.partidos;
    const perdedor = escalonEnLlave(ps, 'p8'); // en la llave de 8, p1 vs p8 en primera ronda
    expect(perdedor).toBe('CUARTOS');
  });

  it('llave de 4 CON tercer puesto: los semifinalistas son SEMI aunque jueguen el 3er puesto', () => {
    let ps = armarLlave(seeds(['p1', 'p2', 'p3', 'p4']), true);
    const r1 = ps.filter((p) => p.ronda === 1);
    ps = cargarResultadoLlave(ps, r1[0].id, 11, 7).partidos; // p1 vence a p4 (semi)
    ps = cargarResultadoLlave(ps, r1[1].id, 11, 7).partidos; // p2 vence a p3 (semi)
    const final = ps.find((p) => p.ronda === 2 && !p.esTercerPuesto)!;
    const tercer = ps.find((p) => p.esTercerPuesto)!;
    ps = cargarResultadoLlave(ps, final.id, 11, 5).partidos;  // campeon p1
    ps = cargarResultadoLlave(ps, tercer.id, 11, 9).partidos; // 3er puesto: p4 vence a p3
    expect(escalonEnLlave(ps, 'p1')).toBe('CAMPEON');
    expect(escalonEnLlave(ps, 'p2')).toBe('FINALISTA');
    expect(escalonEnLlave(ps, 'p3')).toBe('SEMI'); // pierde semi Y 3er puesto -> sigue SEMI
    expect(escalonEnLlave(ps, 'p4')).toBe('SEMI');
  });
});

describe('escalonDePareja', () => {
  it('usa la llave cuando hay', () => {
    let ps = armarLlave(seeds(['p1', 'p2', 'p3', 'p4']), false);
    const r1 = ps.filter((p) => p.ronda === 1);
    ps = cargarResultadoLlave(ps, r1[0].id, 11, 7).partidos;
    ps = cargarResultadoLlave(ps, r1[1].id, 11, 7).partidos;
    ps = cargarResultadoLlave(ps, ps.find((p) => p.ronda === 2)!.id, 11, 5).partidos;
    const t = torneoBase({ partidosLlave: ps });
    expect(escalonDePareja(t, 'p1')).toBe('CAMPEON');
    expect(escalonDePareja(t, 'p3')).toBe('SEMI');
    expect(escalonDePareja(t, 'zzz')).toBe('PARTICIPO'); // no jugo la llave (no clasifico)
  });

  it('grupo unico terminado sin llave: 1º CAMPEON, 2º FINALISTA, resto PARTICIPO', () => {
    const t = torneoBase({
      grupos: [{ id: 'g1', nombre: 'A', parejaIds: ['a', 'b', 'c'] }],
      partidosGrupo: [
        { id: 'm1', grupoId: 'g1', ronda: 1, aId: 'a', bId: 'b', puntosA: 11, puntosB: 5 },
        { id: 'm2', grupoId: 'g1', ronda: 2, aId: 'a', bId: 'c', puntosA: 11, puntosB: 7 },
        { id: 'm3', grupoId: 'g1', ronda: 3, aId: 'b', bId: 'c', puntosA: 11, puntosB: 9 },
      ],
    });
    expect(escalonDePareja(t, 'a')).toBe('CAMPEON'); // 2-0
    expect(escalonDePareja(t, 'b')).toBe('FINALISTA'); // 1-1, gano a c
    expect(escalonDePareja(t, 'c')).toBe('PARTICIPO');
  });
});

function torneoBase(over: Partial<Torneo>): Torneo {
  return {
    id: 't', nombre: 'T', creadoEl: '2026-07-26T12:00:00.000Z', fase: 'terminado',
    parejas: [], grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: null, ...over,
  };
}

import { calcularRanking, torneoAporta } from './ranking';
import type { Jugador } from './tipos';

describe('torneoAporta', () => {
  it('solo aporta si terminado + categoria + no excluido', () => {
    expect(torneoAporta(torneoBase({ categoria: 'A' }))).toBe(true);
    expect(torneoAporta(torneoBase({ categoria: 'A', fase: 'llave' }))).toBe(false);
    expect(torneoAporta(torneoBase({}))).toBe(false); // sin categoria
    expect(torneoAporta(torneoBase({ categoria: 'A', cuentaParaRanking: false }))).toBe(false);
  });
});

describe('calcularRanking', () => {
  it('dobles: los dos integrantes suman; A y B; el individual PARTICIPO no paga', () => {
    let ps = armarLlave(seeds(['pa', 'pb']), false); // final directa
    ps = cargarResultadoLlave(ps, ps[0].id, 11, 6).partidos; // gana pa
    const torneoA = torneoBase({
      id: 'tA', nombre: 'Apertura A', categoria: 'A', partidosLlave: ps,
      parejas: [
        { id: 'pa', nombre: 'Ana y Bea', jugadorIds: ['jA', 'jB'] },
        { id: 'pb', nombre: 'Cata y Dani', jugadorIds: ['jC', 'jD'] },
      ],
    });
    const torneoB = torneoBase({
      id: 'tB', nombre: 'OPC B', categoria: 'B', formato: 'individual',
      grupos: [], partidosLlave: [],
      parejas: [{ id: 'x', nombre: 'Ana', jugadorIds: ['jA'] }],
    });
    const jugadores: Jugador[] = [
      { id: 'jA', nombre: 'Ana' }, { id: 'jB', nombre: 'Bea' },
      { id: 'jC', nombre: 'Cata' }, { id: 'jD', nombre: 'Dani' },
    ];
    const ranking = calcularRanking([torneoA, torneoB], jugadores, cfg);
    const fila = (id: string) => ranking.find((f) => f.jugadorId === id)!;
    expect(fila('jA').puntos).toBe(100); // campeon A (100) + participo individual (0: en individuales participar no paga)
    expect(fila('jB').puntos).toBe(100);
    expect(fila('jC').puntos).toBe(86); // finalista A
    expect(fila('jA').torneosJugados).toBe(2);
    expect(fila('jA').nombre).toBe('Ana');
    expect(ranking[0].jugadorId).toBe('jA'); // ordena por puntos desc
    expect(fila('jA').aportes).toHaveLength(2);
  });

  it('filtro por periodo (creadoEl) deja fuera lo viejo', () => {
    let ps = armarLlave(seeds(['pa', 'pb']), false);
    ps = cargarResultadoLlave(ps, ps[0].id, 11, 6).partidos;
    const viejo = torneoBase({
      id: 't1', categoria: 'A', creadoEl: '2025-05-01T00:00:00.000Z', partidosLlave: ps,
      parejas: [{ id: 'pa', nombre: 'Ana', jugadorIds: ['jA'] }, { id: 'pb', nombre: 'Bea', jugadorIds: ['jB'] }],
    });
    const js: Jugador[] = [{ id: 'jA', nombre: 'Ana' }, { id: 'jB', nombre: 'Bea' }];
    expect(calcularRanking([viejo], js, cfg)).toHaveLength(2); // sin filtro, suma
    expect(calcularRanking([viejo], js, cfg, { desde: '2026-01-01T00:00:00.000Z' })).toHaveLength(0);
  });
});

describe('evento (max A/B por evento) e individuales sin puntos por participar', () => {
  // final directa entre dos parejas de UN jugador cada una; gana la primera
  function torneoFinalDirecta(over: Partial<Torneo> & { id: string }, jGanador: string, jPerdedor: string): Torneo {
    let ps = armarLlave(seeds(['pw', 'pl']), false);
    ps = cargarResultadoLlave(ps, ps[0].id, 11, 6).partidos; // gana pw
    return torneoBase({
      partidosLlave: ps,
      parejas: [
        { id: 'pw', nombre: jGanador, jugadorIds: [jGanador] },
        { id: 'pl', nombre: jPerdedor, jugadorIds: [jPerdedor] },
      ],
      ...over,
    });
  }
  const js = (...ids: string[]): Jugador[] => ids.map((id) => ({ id, nombre: id }));

  it('individual: PARTICIPO vale 0; desde las instancias de llave para arriba paga normal', () => {
    let ps = armarLlave(seeds(['x1', 'x2', 'x3', 'x4']), false);
    const r1 = ps.filter((p) => p.ronda === 1);
    ps = cargarResultadoLlave(ps, r1[0].id, 1, 0).partidos;
    ps = cargarResultadoLlave(ps, r1[1].id, 1, 0).partidos;
    ps = cargarResultadoLlave(ps, ps.find((p) => p.ronda === 2)!.id, 1, 0).partidos;
    const opc = torneoBase({
      id: 'opc', categoria: 'A', formato: 'individual', partidosLlave: ps,
      parejas: [
        { id: 'x1', nombre: 'j1', jugadorIds: ['j1'] },
        { id: 'x2', nombre: 'j2', jugadorIds: ['j2'] },
        { id: 'x3', nombre: 'j3', jugadorIds: ['j3'] },
        { id: 'x4', nombre: 'j4', jugadorIds: ['j4'] },
        { id: 'x5', nombre: 'j5', jugadorIds: ['j5'] }, // quedo afuera de la llave: participo
      ],
    });
    const ranking = calcularRanking([opc], js('j1', 'j2', 'j3', 'j4', 'j5'), cfg);
    const fila = (id: string) => ranking.find((f) => f.jugadorId === id)!;
    expect(fila('j1').puntos).toBe(100); // campeon
    expect(fila('j2').puntos).toBe(86); // finalista
    expect(fila('j3').puntos).toBe(72); // semi
    expect(fila('j5').puntos).toBe(0); // participo: en individuales no paga
    expect(fila('j5').torneosJugados).toBe(1); // pero jugo
  });

  it('parejas: PARTICIPO sigue valiendo el piso de la escalera (40)', () => {
    const t = torneoFinalDirecta({ id: 't1', categoria: 'A' }, 'jA', 'jB');
    t.parejas.push({ id: 'px', nombre: 'jX', jugadorIds: ['jX'] }); // no clasifico a la llave
    const ranking = calcularRanking([t], js('jA', 'jB', 'jX'), cfg);
    expect(ranking.find((f) => f.jugadorId === 'jX')!.puntos).toBe(40);
  });

  it('dos torneos de parejas con el MISMO evento: al jugador le cuenta solo el mejor', () => {
    const tB = torneoFinalDirecta({ id: 'tB', categoria: 'B', evento: '26/7' }, 'jA', 'jB'); // jA campeon B = 86
    const tA = torneoFinalDirecta({ id: 'tA', categoria: 'A', evento: '26/7' }, 'jC', 'jA'); // jA finalista A = 86, jC campeon = 100
    // tA primero a proposito: en el empate 86-86 debe quedar el CAMPEON, no el primero de la lista
    const ranking = calcularRanking([tA, tB], js('jA', 'jB', 'jC'), cfg);
    const fila = (id: string) => ranking.find((f) => f.jugadorId === id)!;
    expect(fila('jA').puntos).toBe(86); // max(86, 86), NO 172
    expect(fila('jA').torneosJugados).toBe(2); // jugo los dos igual
    expect(fila('jA').aportes).toHaveLength(2); // el detalle muestra ambos
    expect(fila('jA').aportes.filter((a) => a.descartadoPorEvento).length).toBe(1); // uno marcado como no-cuenta
    expect(fila('jA').aportes.find((a) => !a.descartadoPorEvento)!.escalon).toBe('CAMPEON'); // empate: queda el mejor escalon
    expect(fila('jB').puntos).toBe(72); // finalista B, un solo torneo: nada que descartar
    expect(fila('jC').puntos).toBe(100);
  });

  it('el evento agrupa sin importar mayusculas ni espacios; y un evento no-string no rompe', () => {
    const tB = torneoFinalDirecta({ id: 'tB', categoria: 'B', evento: 'Sabado ' }, 'jA', 'jB'); // jA campeon B = 86
    const tA = torneoFinalDirecta({ id: 'tA', categoria: 'A', evento: 'sabado' }, 'jC', 'jA'); // jA finalista A = 86
    const ranking = calcularRanking([tB, tA], js('jA', 'jB', 'jC'), cfg);
    expect(ranking.find((f) => f.jugadorId === 'jA')!.puntos).toBe(86); // 'Sabado ' y 'sabado' son el mismo evento
    // evento no-string (import editado a mano): se ignora, no tira la pantalla abajo
    const roto = torneoFinalDirecta({ id: 'tR', categoria: 'A', evento: 7 as unknown as string }, 'jA', 'jB');
    expect(calcularRanking([roto], js('jA', 'jB'), cfg).find((f) => f.jugadorId === 'jA')!.puntos).toBe(100);
  });

  it('sin evento o con eventos distintos: suma todo como siempre', () => {
    const tB = torneoFinalDirecta({ id: 'tB', categoria: 'B', evento: '26/7' }, 'jA', 'jB');
    const tA = torneoFinalDirecta({ id: 'tA', categoria: 'A', evento: '2/8' }, 'jC', 'jA');
    const fila = (r: ReturnType<typeof calcularRanking>, id: string) => r.find((f) => f.jugadorId === id)!;
    expect(fila(calcularRanking([tB, tA], js('jA', 'jB', 'jC'), cfg), 'jA').puntos).toBe(172); // eventos distintos
    const sinEvento1 = torneoFinalDirecta({ id: 's1', categoria: 'B' }, 'jA', 'jB');
    const sinEvento2 = torneoFinalDirecta({ id: 's2', categoria: 'A' }, 'jC', 'jA');
    expect(fila(calcularRanking([sinEvento1, sinEvento2], js('jA', 'jB', 'jC'), cfg), 'jA').puntos).toBe(172); // sin evento
  });

  it('individual con el mismo evento: queda fuera del maximo y suma aparte', () => {
    const tB = torneoFinalDirecta({ id: 'tB', categoria: 'B', evento: '26/7' }, 'jA', 'jB'); // jA campeon B = 86
    let ps = armarLlave(seeds(['y1', 'y2']), false);
    ps = cargarResultadoLlave(ps, ps[0].id, 1, 0).partidos;
    const opc = torneoBase({
      id: 'opc', categoria: 'A', formato: 'individual', evento: '26/7', partidosLlave: ps,
      parejas: [
        { id: 'y1', nombre: 'jA', jugadorIds: ['jA'] },
        { id: 'y2', nombre: 'jB', jugadorIds: ['jB'] },
      ],
    });
    const ranking = calcularRanking([tB, opc], js('jA', 'jB'), cfg);
    const fila = (id: string) => ranking.find((f) => f.jugadorId === id)!;
    expect(fila('jA').puntos).toBe(186); // 86 (parejas B) + 100 (campeon OPC cat A) — el OPC no entra al max
    expect(fila('jA').aportes.some((a) => a.descartadoPorEvento)).toBe(false);
  });
});

import { reasignarJugador, unirJugadores } from './ranking';

describe('unirJugadores', () => {
  it('absorbe alias y saca al absorbido', () => {
    const js: Jugador[] = [
      { id: 'j1', nombre: 'Juan Perez', alias: ['juancho'] },
      { id: 'j2', nombre: 'Juan P.', alias: ['jp'] },
    ];
    const r = unirJugadores(js, 'j1', 'j2');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('j1');
    expect(r[0].alias).toEqual(expect.arrayContaining(['juancho', 'Juan P.', 'jp']));
  });

  it('no hace nada si el absorbido no existe o es el mismo', () => {
    const js: Jugador[] = [{ id: 'j1', nombre: 'A' }];
    expect(unirJugadores(js, 'j1', 'j1')).toEqual(js);
    expect(unirJugadores(js, 'j1', 'zzz')).toEqual(js);
  });
});

describe('reasignarJugador', () => {
  it('reescribe jugadorIds de deId a aId en las parejas; preserva la referencia de torneos no afectados', () => {
    const torneos = [
      torneoBase({
        parejas: [{ id: 'p', nombre: 'X y Y', jugadorIds: ['j2', 'j9'] }, { id: 'q', nombre: 'Z', jugadorIds: ['j5'] }],
      }),
      torneoBase({ id: 'sinCambios', parejas: [{ id: 'r', nombre: 'W', jugadorIds: ['j7'] }] }),
    ];
    const r = reasignarJugador(torneos, 'j2', 'j1');
    expect(r[0].parejas[0].jugadorIds).toEqual(['j1', 'j9']);
    expect(r[0].parejas[1].jugadorIds).toEqual(['j5']);
    expect(r[1]).toBe(torneos[1]); // no afectado: misma referencia (clave para no marcarlo "sucio" en el sync)
  });
});

