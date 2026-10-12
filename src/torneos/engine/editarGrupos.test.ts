import { describe, expect, it } from 'vitest';
import type { Torneo } from './tipos';
import { generarPartidosGrupos } from './grupos';
import { agregarDupla, agregarVuelta, grupoConVuelta, jugadosDe, moverDupla, quitarDupla, quitarVuelta, renombrarDupla } from './editarGrupos';

function torneo(): Torneo {
  const grupos = [{ id: 'A', nombre: 'A', parejaIds: ['a', 'b', 'c'] }, { id: 'B', nombre: 'B', parejaIds: ['d', 'e', 'f', 'g'] }];
  const t: Torneo = {
    id: 't', nombre: 'T', creadoEl: '', fase: 'faseGrupos',
    parejas: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id, nombre: id.toUpperCase(), jugadorIds: [`j${id}`] })),
    grupos, partidosGrupo: generarPartidosGrupos(grupos), configLlave: null, partidosLlave: null,
  };
  // a le ganó a b (resultado cargado)
  const ab = t.partidosGrupo.find((p) => p.grupoId === 'A' && [p.aId, p.bId].sort().join() === 'a,b')!;
  ab.puntosA = 15; ab.puntosB = 10;
  return t;
}
const delGrupo = (t: Torneo, g: string) => t.partidosGrupo.filter((p) => p.grupoId === g);
const pares = (t: Torneo, g: string) => delGrupo(t, g).map((p) => [p.aId, p.bId].sort().join('')).sort();

describe('editar grupos con resultados', () => {
  it('agregar una dupla: suma solo sus cruces y conserva el resultado cargado', () => {
    const t = agregarDupla(torneo(), 'A', 'NUEVA y DUPLA');
    const nueva = t.parejas.find((p) => p.nombre === 'NUEVA y DUPLA')!;
    expect(t.grupos[0].parejaIds).toContain(nueva.id);
    expect(delGrupo(t, 'A')).toHaveLength(6);
    expect(delGrupo(t, 'A').filter((p) => p.aId === nueva.id || p.bId === nueva.id)).toHaveLength(3);
    expect(delGrupo(t, 'A').some((p) => p.puntosA === 15)).toBe(true);
    // las rondas nuevas van después de las existentes
    const maxViejo = Math.max(...torneo().partidosGrupo.filter((p) => p.grupoId === 'A').map((p) => p.ronda));
    expect(Math.min(...delGrupo(t, 'A').filter((p) => p.aId === nueva.id || p.bId === nueva.id).map((p) => p.ronda))).toBeGreaterThan(maxViejo);
    expect(pares(t, 'B')).toEqual(pares(torneo(), 'B'));
  });

  it('quitar una dupla borra sus partidos y deja el resto', () => {
    const t0 = torneo();
    expect(jugadosDe(t0, 'b')).toBe(1);
    const t = quitarDupla(t0, 'b');
    expect(t.parejas.some((p) => p.id === 'b')).toBe(false);
    expect(pares(t, 'A')).toEqual(['ac']);
  });

  it('mover una dupla de grupo: sale del viejo y juega con todos los del nuevo', () => {
    const t = moverDupla(torneo(), 'c', 'B');
    expect(pares(t, 'A')).toEqual(['ab']);
    expect(delGrupo(t, 'A')[0].puntosA).toBe(15);
    expect(delGrupo(t, 'B')).toHaveLength(10);
    expect(t.grupos[1].parejaIds).toEqual(['d', 'e', 'f', 'g', 'c']);
  });

  it('agregar y quitar la vuelta', () => {
    const t = agregarVuelta(torneo(), 'A');
    expect(grupoConVuelta(t, 'A')).toBe(true);
    expect(delGrupo(t, 'A')).toHaveLength(6);
    // con vuelta, agregar una dupla le arma ida y vuelta
    const t2 = agregarDupla(t, 'A', 'X');
    expect(delGrupo(t2, 'A')).toHaveLength(12);
    expect(delGrupo(quitarVuelta(t, 'A'), 'A')).toHaveLength(3);
  });

  it('renombrar una dupla (otro jugador) la desvincula del padrón para volver a vincularla', () => {
    const t = renombrarDupla(torneo(), 'a', 'OTRO y A');
    const a = t.parejas.find((p) => p.id === 'a')!;
    expect(a.nombre).toBe('OTRO y A');
    expect(a.jugadorIds).toBeUndefined();
    expect(renombrarDupla(torneo(), 'a', 'Z', ['x', 'y']).parejas[0].jugadorIds).toEqual(['x', 'y']);
  });
});
