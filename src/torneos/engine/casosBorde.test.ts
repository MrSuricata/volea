// Casos borde del motor que no tenían test: W.O. en tabla y llave, partidos con games en la
// llave, la Plata de 5 y la normalización de rondas al corregir la llave a mano.
import { describe, expect, it } from 'vitest';
import type { PartidoGrupo, PartidoLlave, SlotLlave } from './tipos';
import { conWo } from './tipos';
import { calcularTabla } from './tabla';
import { armarLlave, campeonDe, cargarResultadoLlave, ganadorPartido, podio, resolverSlot } from './llave';
import { llavePlataCinco } from './copas';
import { normalizarRondas } from './editarLlave';
import { escalonEnLlave } from './ranking';

const pg = (id: string, aId: string, bId: string, pa: number | null, pb: number | null, extra: Partial<PartidoGrupo> = {}): PartidoGrupo =>
  ({ id, grupoId: 'g', ronda: 1, aId, bId, puntosA: pa, puntosB: pb, ...extra });
const seeds = (ids: string[]) => ids.map((parejaId) => ({ parejaId, grupoId: parejaId }));

describe('W.O.', () => {
  it('en la tabla vale como partido ganado con el resultado cargado', () => {
    const tabla = calcularTabla(['a', 'b', 'c'], [
      pg('1', 'a', 'b', 11, 0, { wo: true }),
      pg('2', 'b', 'c', 11, 4),
      pg('3', 'c', 'a', 11, 9),
    ]);
    expect(tabla.find((f) => f.parejaId === 'a')).toMatchObject({ pj: 2, pg: 1, pf: 20, pc: 11 });
    expect(tabla.find((f) => f.parejaId === 'b')).toMatchObject({ pj: 2, pg: 1, pp: 1 });
    // W.O. sin resultado no cuenta
    expect(calcularTabla(['a', 'b'], [pg('1', 'a', 'b', null, null, { wo: true })])[0].pj).toBe(0);
  });

  it('en la llave el ganador por W.O. avanza; borrar el puntaje borra la marca', () => {
    let l = armarLlave(seeds(['p1', 'p2', 'p3', 'p4']), false);
    const [s1, s2] = l.filter((p) => p.ronda === 1);
    l = cargarResultadoLlave(l, s1.id, 0, 11).partidos.map((p) => (p.id === s1.id ? conWo(p, true) : p));
    expect(ganadorPartido(l.find((p) => p.id === s1.id)!, l)).toBe('p4');
    l = cargarResultadoLlave(l, s2.id, 11, 3).partidos;
    const fin = l.find((p) => p.ronda === 2)!;
    expect([resolverSlot(fin.a, l), resolverSlot(fin.b, l)]).toEqual(['p4', 'p2']);
    l = cargarResultadoLlave(l, s1.id, null, null).partidos;
    expect(l.find((p) => p.id === s1.id)!.wo).toBeUndefined();
    expect(resolverSlot(l.find((p) => p.ronda === 2)!.a, l)).toBeNull();
  });

  it('corregir un W.O. que cambia el ganador borra lo que dependía, con su marca', () => {
    let l = armarLlave(seeds(['p1', 'p2', 'p3', 'p4']), false);
    const [s1, s2] = l.filter((p) => p.ronda === 1);
    const fin = l.find((p) => p.ronda === 2)!;
    l = cargarResultadoLlave(l, s1.id, 11, 0).partidos;
    l = cargarResultadoLlave(l, s2.id, 11, 0).partidos;
    l = cargarResultadoLlave(l, fin.id, 0, 11).partidos.map((p) => (p.id === fin.id ? conWo(p, true) : p));
    const r = cargarResultadoLlave(l, s1.id, 3, 11);
    expect(r.borrados).toBe(1);
    const finDespues = r.partidos.find((p) => p.id === fin.id)!;
    expect(finDespues.puntosA).toBeNull();
    expect(finDespues.wo).toBeUndefined();
  });
});

describe('llave con partidos a games (mejor de 3)', () => {
  it('el ganador sale de los games ganados aunque haya hecho menos puntos', () => {
    let l = armarLlave(seeds(['p1', 'p2']), false);
    const fin = l[0];
    l = cargarResultadoLlave(l, fin.id, 2, 1).partidos.map((p) => (p.id === fin.id ? { ...p, games: [{ a: 11, b: 9 }, { a: 2, b: 11 }, { a: 11, b: 9 }] } : p));
    expect(campeonDe(l)).toBe('p1');
    expect(escalonEnLlave(l, 'p2')).toBe('FINALISTA');
  });
});

describe('llavePlataCinco', () => {
  it('7º espera en semis contra el ganador de 10º-11º; la otra semi es 8º-9º', () => {
    const l = llavePlataCinco(['s7', 's8', 's9', 's10', 's11']);
    const q = l.find((p) => p.ronda === 1)!;
    expect([resolverSlot(q.a, l), resolverSlot(q.b, l)]).toEqual(['s10', 's11']);
    const semis = l.filter((p) => p.ronda === 2).sort((a, b) => a.posicion - b.posicion);
    expect([resolverSlot(semis[0].a, l), resolverSlot(semis[0].b, l)]).toEqual(['s8', 's9']);
    expect(semis[1].a).toEqual({ tipo: 'seed', parejaId: 's7' });
    expect(semis[1].b).toEqual({ tipo: 'ganadorDe', partidoId: q.id });
    let j = cargarResultadoLlave(l, q.id, 11, 5).partidos;
    j = cargarResultadoLlave(j, semis[0].id, 11, 7).partidos;
    j = cargarResultadoLlave(j, semis[1].id, 4, 11).partidos;
    j = cargarResultadoLlave(j, l.find((p) => p.ronda === 3)!.id, 11, 9).partidos;
    expect(podio(j)).toMatchObject({ campeon: 's8', subcampeon: 's10' });
    expect(escalonEnLlave(j, 's11')).toBe('CUARTOS');
    expect(escalonEnLlave(j, 's7')).toBe('SEMI');
  });
});

describe('normalizarRondas', () => {
  const seed = (parejaId: string): SlotLlave => ({ tipo: 'seed', parejaId });
  const gan = (partidoId: string): SlotLlave => ({ tipo: 'ganadorDe', partidoId });
  const p = (id: string, ronda: number, posicion: number, a: SlotLlave | null, b: SlotLlave | null, tercero = false): PartidoLlave =>
    ({ id, ronda, posicion, a, b, puntosA: null, puntosB: null, esTercerPuesto: tercero });

  it('sube un partido a la ronda después del último que espera y compacta huecos y posiciones', () => {
    const l = normalizarRondas([
      p('q1', 1, 0, seed('a'), seed('b')),
      p('q2', 1, 3, seed('c'), seed('d')),
      p('s', 1, 5, gan('q1'), gan('q2')), // mal puesto en ronda 1
      p('f', 7, 2, gan('s'), seed('e')),
      p('t', 2, 1, null, null, true),
    ]);
    const de = (id: string) => l.find((x) => x.id === id)!;
    expect([de('q1').ronda, de('q2').ronda, de('s').ronda, de('f').ronda]).toEqual([1, 1, 2, 3]);
    expect([de('q1').posicion, de('q2').posicion]).toEqual([0, 1]);
    expect([de('s').posicion, de('f').posicion]).toEqual([0, 0]);
    expect(de('t').ronda).toBe(3); // el 3er puesto acompaña a la final
  });

  it('una llave ya normal queda igual', () => {
    const l = armarLlave(seeds(['a', 'b', 'c', 'd', 'e']), true);
    const n = normalizarRondas(l);
    for (const x of l) expect(n.find((y) => y.id === x.id)).toMatchObject({ ronda: x.ronda, posicion: x.posicion });
  });
});
