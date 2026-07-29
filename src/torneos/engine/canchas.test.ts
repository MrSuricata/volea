import { describe, expect, it } from 'vitest';
import { ordenDeJuego } from './canchas';

const p = (id: string, grupoId: string) => ({ id, grupoId });

describe('ordenDeJuego', () => {
  it('intercala grupos y reparte en tandas de N canchas', () => {
    // ronda con 2 partidos del grupo A y 2 del B, 2 canchas:
    // tanda 1 = A1 (cancha 1) + B1 (cancha 2); tanda 2 = A2 + B2
    const turnos = ordenDeJuego([p('a1', 'gA'), p('a2', 'gA'), p('b1', 'gB'), p('b2', 'gB')], 2);
    expect(turnos).toEqual([
      { partidoId: 'a1', tanda: 1, cancha: 1 },
      { partidoId: 'b1', tanda: 1, cancha: 2 },
      { partidoId: 'a2', tanda: 2, cancha: 1 },
      { partidoId: 'b2', tanda: 2, cancha: 2 },
    ]);
  });

  it('con 1 cancha es una cola simple intercalada', () => {
    const turnos = ordenDeJuego([p('a1', 'gA'), p('a2', 'gA'), p('b1', 'gB')], 1);
    expect(turnos.map((t) => t.partidoId)).toEqual(['a1', 'b1', 'a2']);
    expect(turnos.map((t) => t.tanda)).toEqual([1, 2, 3]);
    expect(turnos.every((t) => t.cancha === 1)).toBe(true);
  });

  it('más canchas que partidos: todo en la tanda 1', () => {
    const turnos = ordenDeJuego([p('a1', 'gA'), p('b1', 'gB')], 4);
    expect(turnos.map((t) => t.tanda)).toEqual([1, 1]);
    expect(turnos.map((t) => t.cancha)).toEqual([1, 2]);
  });

  it('grupos de distinto tamaño no pierden partidos', () => {
    const turnos = ordenDeJuego([p('a1', 'gA'), p('a2', 'gA'), p('a3', 'gA'), p('b1', 'gB')], 2);
    expect(turnos.map((t) => t.partidoId)).toEqual(['a1', 'b1', 'a2', 'a3']);
    expect(turnos.map((t) => t.tanda)).toEqual([1, 1, 2, 2]);
  });

  it('sin partidos devuelve vacío; canchas inválidas tiran error', () => {
    expect(ordenDeJuego([], 2)).toEqual([]);
    expect(() => ordenDeJuego([p('a1', 'gA')], 0)).toThrow();
  });
});
