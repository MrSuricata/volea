import { describe, expect, it } from 'vitest';
import type { Torneo } from '../engine/tipos';
import { armarLlave, cargarResultadoLlave } from '../engine/llave';
import { podioDeTorneo } from './resultado';

function torneoBase(over: Partial<Torneo> = {}): Torneo {
  return {
    id: 't1', nombre: 'Test', creadoEl: '2026-07-25T10:00:00.000Z', fase: 'terminado',
    parejas: [], grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: null,
    ...over,
  };
}

describe('podioDeTorneo', () => {
  it('usa la llave (con tercer puesto) cuando hay partidos de llave', () => {
    let ps = armarLlave(
      [
        { parejaId: 'p1', grupoId: '' },
        { parejaId: 'p2', grupoId: '' },
        { parejaId: 'p3', grupoId: '' },
        { parejaId: 'p4', grupoId: '' },
      ],
      true,
    );
    const r1 = ps.filter((p) => p.ronda === 1);
    ps = cargarResultadoLlave(ps, r1[0].id, 11, 7).partidos; // p1 gana a p4
    ps = cargarResultadoLlave(ps, r1[1].id, 11, 7).partidos; // p2 gana a p3
    const final = ps.find((p) => p.ronda === 2 && !p.esTercerPuesto)!;
    const tercero = ps.find((p) => p.esTercerPuesto)!;
    ps = cargarResultadoLlave(ps, final.id, 11, 5).partidos; // p1 campeón
    ps = cargarResultadoLlave(ps, tercero.id, 11, 9).partidos; // p4 tercero

    const t = torneoBase({ partidosLlave: ps });
    expect(podioDeTorneo(t)).toEqual({ campeon: 'p1', subcampeon: 'p2', tercero: 'p4' });
  });

  it('llave sin terminar: podio parcial (campeón null hasta que se juegue la final)', () => {
    const ps = armarLlave(
      [
        { parejaId: 'p1', grupoId: '' },
        { parejaId: 'p2', grupoId: '' },
      ],
      false,
    );
    const t = torneoBase({ fase: 'llave', partidosLlave: ps });
    expect(podioDeTorneo(t)).toEqual({ campeon: null, subcampeon: null, tercero: null });
  });

  it('grupo único terminado sin llave: usa la tabla (1º campeón, 2º subcampeón, 3º tercero)', () => {
    const t = torneoBase({
      grupos: [{ id: 'g1', nombre: 'A', parejaIds: ['a', 'b', 'c'] }],
      partidosGrupo: [
        { id: 'm1', grupoId: 'g1', ronda: 1, aId: 'a', bId: 'b', puntosA: 11, puntosB: 5 },
        { id: 'm2', grupoId: 'g1', ronda: 2, aId: 'a', bId: 'c', puntosA: 11, puntosB: 7 },
        { id: 'm3', grupoId: 'g1', ronda: 3, aId: 'b', bId: 'c', puntosA: 11, puntosB: 9 },
      ],
    });
    expect(podioDeTorneo(t)).toEqual({ campeon: 'a', subcampeon: 'b', tercero: 'c' });
  });

  it('grupo único NO terminado: sin podio (evita mostrar un campeón prematuro)', () => {
    const t = torneoBase({
      fase: 'faseGrupos',
      grupos: [{ id: 'g1', nombre: 'A', parejaIds: ['a', 'b', 'c'] }],
      partidosGrupo: [
        { id: 'm1', grupoId: 'g1', ronda: 1, aId: 'a', bId: 'b', puntosA: 11, puntosB: 5 },
      ],
    });
    expect(podioDeTorneo(t)).toEqual({ campeon: null, subcampeon: null, tercero: null });
  });

  it('sin llave ni grupo único: sin podio', () => {
    expect(podioDeTorneo(torneoBase())).toEqual({ campeon: null, subcampeon: null, tercero: null });
  });
});
