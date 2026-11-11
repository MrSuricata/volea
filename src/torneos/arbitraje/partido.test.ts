import { describe, expect, it } from 'vitest';
import type { Torneo } from '../engine/tipos';
import { esDobles, formatoDe, jugadoresDe, ladosDelPartido, nombreJugador, partidosArbitrables, resultadoEnCuadro } from './partido';

const torneo = (c: Partial<Torneo> = {}): Torneo => ({
  id: 't', nombre: 'MIXTO A', creadoEl: '2026-10-27', fase: 'llave',
  parejas: [
    { id: 'p1', nombre: 'ANA PEREZ y LUIS GOMEZ' }, { id: 'p2', nombre: 'EVA RUIZ y JUAN SOSA' },
    { id: 'p3', nombre: 'SOL DIAZ y PEDRO PAZ' }, { id: 'p4', nombre: 'LIA MORA y TOMAS RIOS' },
  ],
  grupos: [{ id: 'g1', nombre: 'A', parejaIds: ['p1', 'p2'] }],
  partidosGrupo: [{ id: 'm1', grupoId: 'g1', ronda: 1, aId: 'p1', bId: 'p2', puntosA: null, puntosB: null }],
  configLlave: null,
  partidosLlave: [
    { id: 's1', ronda: 1, posicion: 0, a: { tipo: 'seed', parejaId: 'p1' }, b: { tipo: 'seed', parejaId: 'p3' }, puntosA: 15, puntosB: 9, esTercerPuesto: false },
    { id: 's2', ronda: 1, posicion: 1, a: { tipo: 'seed', parejaId: 'p2' }, b: { tipo: 'seed', parejaId: 'p4' }, puntosA: null, puntosB: null, esTercerPuesto: false },
    { id: 'f', ronda: 2, posicion: 0, a: { tipo: 'ganadorDe', partidoId: 's1' }, b: { tipo: 'ganadorDe', partidoId: 's2' }, puntosA: null, puntosB: null, esTercerPuesto: false },
  ],
  ...c,
});

describe('partido arbitrado', () => {
  it('arma los lados con jugadores separados', () => {
    const l = ladosDelPartido(torneo(), 'm1');
    expect(l?.fase).toBe('grupo');
    expect(l?.a?.jugadores).toEqual(['ANA PEREZ', 'LUIS GOMEZ']);
    expect(l?.b?.nombre).toBe('EVA RUIZ y JUAN SOSA');
  });

  it('en la llave resuelve el ganador anterior y deja null lo que todavía no se sabe', () => {
    const l = ladosDelPartido(torneo(), 'f');
    expect(l?.fase).toBe('llave');
    expect(l?.a?.nombre).toBe('ANA PEREZ y LUIS GOMEZ');
    expect(l?.b).toBeNull();
  });

  it('formato por fase con defecto rally a 15', () => {
    const t = torneo({ arbitraje: { llave: { tipo: 'sideout', a: 11, mejorDe: 3 } } });
    expect(formatoDe(t, 'grupo')).toEqual({ tipo: 'rally', a: 15, mejorDe: 1 });
    expect(formatoDe(t, 'llave')).toEqual({ tipo: 'sideout', a: 11, mejorDe: 3 });
  });

  it('detecta singles', () => {
    expect(esDobles(torneo())).toBe(true);
    expect(esDobles(torneo({ parejas: [{ id: 'x', nombre: 'ANA PEREZ' }] }))).toBe(false);
  });

  it('lista los partidos para la hoja: sin byes y en orden de juego', () => {
    const ids = partidosArbitrables(torneo()).map((p) => p.partidoId);
    expect(ids).toEqual(['m1', 's1', 's2', 'f']);
  });
});

describe('separar la pareja en jugadores', () => {
  it('reconoce los separadores de uso común', () => {
    expect(jugadoresDe('Ana Pérez y Luis Gómez')).toEqual(['Ana Pérez', 'Luis Gómez']);
    expect(jugadoresDe('Ana / Luis')).toEqual(['Ana', 'Luis']);
    expect(jugadoresDe('Ana Pérez - Luis Gómez')).toEqual(['Ana Pérez', 'Luis Gómez']);
    expect(jugadoresDe('João e Maria')).toEqual(['João', 'Maria']);
    expect(jugadoresDe('Ana & Luis')).toEqual(['Ana', 'Luis']);
  });
  it('un guion sin espacios es parte del nombre', () => {
    expect(jugadoresDe('Ana-María Ruiz')).toEqual(['Ana-María Ruiz']);
  });
  it('si no se puede separar, nunca queda un nombre vacío', () => {
    expect(nombreJugador(jugadoresDe('LOS TIGRES'), 0)).toBe('Jugador 1');
    expect(nombreJugador(jugadoresDe('LOS TIGRES'), 1)).toBe('Jugador 2');
    expect(nombreJugador([], 1)).toBe('Jugador 2');
    expect(nombreJugador(['Ana', 'Luis'], 1)).toBe('Luis');
  });
});

describe('resultado en el cuadro', () => {
  it('lo encuentra en grupos y en la llave; null si no hay', () => {
    expect(resultadoEnCuadro(torneo(), 's1')).toEqual({ puntosA: 15, puntosB: 9 });
    expect(resultadoEnCuadro(torneo(), 'm1')).toBeNull();
    expect(resultadoEnCuadro(torneo(), 'no-existe')).toBeNull();
  });
});
