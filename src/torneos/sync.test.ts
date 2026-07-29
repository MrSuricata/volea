import { describe, expect, it } from 'vitest';
import type { Torneo } from './engine/tipos';
import { mergeTorneos } from './sync';

function t(id: string, nombre: string): Torneo {
  return {
    id, nombre, creadoEl: '2026-07-29T10:00:00.000Z', fase: 'parejas',
    parejas: [], grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: null,
  };
}
const remoto = (torneo: Torneo, updatedAt: string) => ({ torneo, updatedAt });

describe('mergeTorneos', () => {
  it('sin sucios: gana lo remoto y la base se actualiza', () => {
    const r = mergeTorneos({
      locales: [t('t1', 'Viejo local')],
      remotos: [remoto(t('t1', 'Nuevo server'), '2026-07-29T12:00:00.000Z')],
      sucios: new Set(),
      base: { t1: '2026-07-29T11:00:00.000Z' },
    });
    expect(r.torneos[0].nombre).toBe('Nuevo server');
    expect(r.base.t1).toBe('2026-07-29T12:00:00.000Z');
    expect(r.conflictos).toEqual([]);
  });

  it('sucio local con server sin cambios: se queda lo local (pendiente de push)', () => {
    const r = mergeTorneos({
      locales: [t('t1', 'Editado local')],
      remotos: [remoto(t('t1', 'Base server'), '2026-07-29T11:00:00.000Z')],
      sucios: new Set(['t1']),
      base: { t1: '2026-07-29T11:00:00.000Z' },
    });
    expect(r.torneos[0].nombre).toBe('Editado local');
    expect(r.conflictos).toEqual([]);
  });

  it('sucio local Y server avanzo: CONFLICTO, se queda lo local hasta resolver', () => {
    const r = mergeTorneos({
      locales: [t('t1', 'Editado local')],
      remotos: [remoto(t('t1', 'Otro admin'), '2026-07-29T13:00:00.000Z')],
      sucios: new Set(['t1']),
      base: { t1: '2026-07-29T11:00:00.000Z' },
    });
    expect(r.conflictos).toEqual(['t1']);
    expect(r.torneos[0].nombre).toBe('Editado local');
  });

  it('nuevo local (sin base, sucio): se conserva; nuevo remoto: se agrega', () => {
    const r = mergeTorneos({
      locales: [t('nuevoLocal', 'Recien creado aca')],
      remotos: [remoto(t('nuevoRemoto', 'Creado en otra maquina'), '2026-07-29T12:00:00.000Z')],
      sucios: new Set(['nuevoLocal']),
      base: {},
    });
    const ids = r.torneos.map((x) => x.id).sort();
    expect(ids).toEqual(['nuevoLocal', 'nuevoRemoto']);
  });

  it('borrado remoto de un torneo limpio: desaparece; si esta sucio: se conserva', () => {
    const r = mergeTorneos({
      locales: [t('limpio', 'x'), t('sucio', 'y')],
      remotos: [],
      sucios: new Set(['sucio']),
      base: { limpio: '2026-07-29T11:00:00.000Z', sucio: '2026-07-29T11:00:00.000Z' },
    });
    expect(r.torneos.map((x) => x.id)).toEqual(['sucio']);
    expect(r.base.limpio).toBeUndefined();
  });
});
