import { describe, expect, it } from 'vitest';
import type { Grupo, Torneo } from './tipos';
import { generarPartidosGrupos } from './grupos';
import { resolverSlot } from './llave';
import { armarLlaveFormato, conFormato, formatoDe, formatoEfectivo, formatosPosibles, proyeccionFormato } from './formatoLlave';

// Gana siempre la de id menor (alfabético) 15 a 10.
function torneo(grupos: Grupo[]): Torneo {
  const partidosGrupo = generarPartidosGrupos(grupos).map((p) => (p.aId < p.bId ? { ...p, puntosA: 15, puntosB: 10 } : { ...p, puntosA: 10, puntosB: 15 }));
  return {
    id: 't', nombre: 'T', creadoEl: '', fase: 'faseGrupos',
    parejas: grupos.flatMap((g) => g.parejaIds).map((id) => ({ id, nombre: id })),
    grupos, partidosGrupo, configLlave: null, partidosLlave: null,
  };
}
const ronda1 = (l: NonNullable<ReturnType<typeof armarLlaveFormato>>) =>
  l.filter((p) => p.ronda === 1).map((p) => [resolverSlot(p.a, l), resolverSlot(p.b, l)]);

describe('formato de llave', () => {
  it('banderas viejas y nuevas se leen y escriben juntas', () => {
    const t = torneo([{ id: 'A', nombre: 'A', parejaIds: ['a', 'b', 'c', 'd'] }]);
    expect(formatoDe(t)).toBe('auto');
    expect(formatoDe(conFormato(t, 'tabla'))).toBe('tabla');
    expect(conFormato(t, 'tabla').sinLlave).toBe(true);
    const copas = conFormato(conFormato(t, 'seis'), 'copas', 3);
    expect(copas.llave6).toBeUndefined();
    expect(copas.copas).toEqual({ oro: 3 });
    expect(formatoDe(conFormato(copas, 'semis'))).toBe('semis');
    expect(conFormato(copas, 'semis').copas).toBeUndefined();
  });

  it('opciones según la cantidad de grupos', () => {
    const uno = torneo([{ id: 'A', nombre: 'A', parejaIds: ['a', 'b', 'c', 'd'] }]);
    expect(formatosPosibles(uno).map((o) => o.valor)).toEqual(['final', 'semis', 'tabla', 'auto']);
    const tres = torneo(['A', 'B', 'C'].map((g) => ({ id: g, nombre: g, parejaIds: [`${g}1`, `${g}2`, `${g}3`] })));
    expect(formatosPosibles(tres).map((o) => o.valor)).toEqual(['seis', 'copas', 'auto']);
    expect(formatoEfectivo(tres)).toBe('auto');
  });

  it('grupo único: final directa o semis 1-4 y 2-3', () => {
    const t = torneo([{ id: 'A', nombre: 'A', parejaIds: ['a', 'b', 'c', 'd'] }]);
    expect(ronda1(armarLlaveFormato(t)!)).toEqual([['a', 'b']]);
    const s = armarLlaveFormato(conFormato(t, 'semis'))!;
    expect(ronda1(s)).toEqual([['a', 'd'], ['b', 'c']]);
    expect(s).toHaveLength(3);
    expect(armarLlaveFormato(conFormato(t, 'tabla'))).toBeNull();
  });

  it('2 grupos: semis cruzadas; 4 grupos: cuartos cruzados', () => {
    const dos = torneo([{ id: 'A', nombre: 'A', parejaIds: ['a1', 'a2', 'a3'] }, { id: 'B', nombre: 'B', parejaIds: ['b1', 'b2', 'b3'] }]);
    expect(ronda1(armarLlaveFormato(dos)!)).toEqual([['a1', 'b2'], ['b1', 'a2']]);
    const cuatro = torneo(['A', 'B', 'C', 'D'].map((g) => ({ id: g, nombre: g, parejaIds: [`${g}1`, `${g}2`, `${g}3`] })));
    expect(ronda1(armarLlaveFormato(cuatro)!)).toEqual([['A1', 'B2'], ['C1', 'D2'], ['B1', 'A2'], ['D1', 'C2']]);
    expect(proyeccionFormato(cuatro)![0]).toHaveLength(4);
  });

  it('no arma con grupos sin terminar', () => {
    const t = torneo([{ id: 'A', nombre: 'A', parejaIds: ['a', 'b', 'c'] }]);
    t.partidosGrupo[0].puntosA = null;
    expect(() => armarLlaveFormato(t)).toThrow(/sin resultado/);
  });
});
