import { describe, expect, it } from 'vitest';
import type { Torneo } from '../engine/tipos';
import { agruparParaGestor, avanceDe } from './listaGestor';

function torneo(id: string, nombre: string, extra: Partial<Torneo> = {}): Torneo {
  return {
    id, nombre, creadoEl: '2026-10-08T12:00:00.000Z', fase: 'faseGrupos',
    parejas: [], grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: null, ...extra,
  };
}
const pg = (id: string, puntosA: number | null, puntosB: number | null) => ({ id, grupoId: 'g', ronda: 1, aId: 'a', bId: 'b', puntosA, puntosB });

describe('avanceDe', () => {
  it('cuenta grupos y llave sin los byes', () => {
    const t = torneo('t', 'T', {
      partidosGrupo: [pg('1', 11, 5), pg('2', null, null)],
      partidosLlave: [
        { id: 'l1', ronda: 1, posicion: 0, a: { tipo: 'seed', parejaId: 'x' }, b: null, puntosA: null, puntosB: null, esTercerPuesto: false },
        { id: 'l2', ronda: 2, posicion: 0, a: { tipo: 'seed', parejaId: 'x' }, b: { tipo: 'seed', parejaId: 'y' }, puntosA: 11, puntosB: 9, esTercerPuesto: false },
      ],
    });
    expect(avanceDe(t)).toEqual({ jugados: 2, total: 3 });
  });
});

describe('agruparParaGestor', () => {
  const lista = [
    torneo('v1', 'TORNEO VIEJO', { evento: 'Racket Roll · 22-23 ago', fase: 'terminado', creadoEl: '2026-08-20T00:00:00.000Z' }),
    torneo('a2', 'SINGLES FEMENINO ANIVERSARIO', { evento: 'Aniversario' }),
    torneo('a1', 'DOBLE MIXTO A ANIVERSARIO', { evento: 'Aniversario' }),
    torneo('s1', 'PRUEBA SUELTA'),
    torneo('k1', 'KINGS CUP', { evento: 'Kings', creadoEl: '2026-09-30T00:00:00.000Z' }),
  ];

  it('eventos en juego primero (más nuevo arriba), después los terminados; sin evento al final de su bloque', () => {
    const g = agruparParaGestor(lista);
    expect(g.map((x) => x.titulo)).toEqual(['Aniversario', 'Kings', 'Sin evento', 'Racket Roll · 22-23 ago']);
    expect(g[0].enJuego).toBe(true);
    expect(g[3].enJuego).toBe(false);
  });

  it('dentro del evento ordena por nombre', () => {
    expect(agruparParaGestor(lista)[0].torneos.map((t) => t.id)).toEqual(['a1', 'a2']);
  });

  it('la búsqueda filtra por nombre o evento, sin tildes ni mayúsculas', () => {
    expect(agruparParaGestor(lista, 'femenino').flatMap((g) => g.torneos.map((t) => t.id))).toEqual(['a2']);
    expect(agruparParaGestor(lista, 'RACKET').flatMap((g) => g.torneos.map((t) => t.id))).toEqual(['v1']);
    expect(agruparParaGestor(lista, 'nada')).toEqual([]);
  });
});
