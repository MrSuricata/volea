import { describe, expect, it } from 'vitest';
import type { Torneo } from '../engine/tipos';
import { nombreDe } from './util';

function torneoCon(nombres: string[]): Torneo {
  return {
    id: 't', nombre: 'T', creadoEl: '2026-07-21T12:00:00.000Z', fase: 'parejas',
    parejas: nombres.map((nombre, i) => ({ id: `p${i + 1}`, nombre })),
    grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: null,
  };
}

describe('nombreDe', () => {
  it('nombre único se muestra tal cual', () => {
    expect(nombreDe(torneoCon(['Los Primos', 'Ana y Bea']), 'p1')).toBe('Los Primos');
  });

  it('duplicados llevan sufijo (2), (3) según el orden de carga', () => {
    const t = torneoCon(['Los Primos', 'Los Primos', 'Los Primos']);
    expect(nombreDe(t, 'p1')).toBe('Los Primos');
    expect(nombreDe(t, 'p2')).toBe('Los Primos (2)');
    expect(nombreDe(t, 'p3')).toBe('Los Primos (3)');
  });

  it('id desconocido devuelve ¿?', () => {
    expect(nombreDe(torneoCon(['A']), 'nope')).toBe('¿?');
  });
});
