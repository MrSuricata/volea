import { describe, expect, it } from 'vitest';
import { distancia, normalizar, buscarJugador, agregarJugador, agregarAlias } from './padron';
import type { Jugador } from './tipos';

describe('normalizar', () => {
  it('baja a minusculas, saca tildes y colapsa espacios', () => {
    expect(normalizar('  Juan   PÉREZ ')).toBe('juan perez');
    expect(normalizar('José Ñandú')).toBe('jose nandu');
  });
});

describe('distancia', () => {
  it('cuenta ediciones (Levenshtein)', () => {
    expect(distancia('juan', 'juan')).toBe(0);
    expect(distancia('juan', 'jvan')).toBe(1);
    expect(distancia('juan perez', 'juan peres')).toBe(1);
    expect(distancia('ana', 'anabel')).toBe(3);
  });
});

function padron(...nombres: string[]): Jugador[] {
  return nombres.map((nombre, i) => ({ id: `j${i + 1}`, nombre }));
}

describe('buscarJugador', () => {
  it('match exacto por nombre (ignora may/tildes/espacios)', () => {
    const r = buscarJugador(padron('Juan Pérez', 'Ana'), '  juan perez ');
    expect(r.tipo).toBe('exacto');
    if (r.tipo === 'exacto') expect(r.jugador.id).toBe('j1');
  });

  it('match exacto por alias', () => {
    const js: Jugador[] = [{ id: 'j1', nombre: 'Juan Pérez', alias: ['juancho'] }];
    const r = buscarJugador(js, 'Juancho');
    expect(r.tipo).toBe('exacto');
  });

  it('typo => dudoso con candidatos ordenados por cercania', () => {
    const r = buscarJugador(padron('Juan Pérez', 'Pedro'), 'Jvan Perez');
    expect(r.tipo).toBe('dudoso');
    if (r.tipo === 'dudoso') expect(r.candidatos[0].id).toBe('j1');
  });

  it('nombre sin parecido => nuevo', () => {
    const r = buscarJugador(padron('Juan', 'Ana'), 'Rodrigo Silva');
    expect(r.tipo).toBe('nuevo');
  });
});

describe('agregarJugador / agregarAlias', () => {
  it('agrega un jugador nuevo y lo devuelve', () => {
    const { jugadores, jugador } = agregarJugador(padron('Ana'), '  Beto  ');
    expect(jugadores).toHaveLength(2);
    expect(jugador.nombre).toBe('Beto');
    expect(jugadores[1].id).toBe(jugador.id);
  });

  it('agrega alias sin duplicar', () => {
    const js = padron('Juan');
    const r1 = agregarAlias(js, 'j1', 'Juancho');
    const r2 = agregarAlias(r1, 'j1', 'juancho'); // mismo normalizado
    expect(r2[0].alias).toEqual(['Juancho']);
  });
});
