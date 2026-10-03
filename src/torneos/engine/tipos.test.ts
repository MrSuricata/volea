import { describe, expect, it } from 'vitest';
import { conWo } from './tipos';
import type { PartidoGrupo } from './tipos';

describe('conWo', () => {
  const partido: PartidoGrupo = { id: 'x', grupoId: 'g', ronda: 2, aId: 'a', bId: 'b', puntosA: 0, puntosB: 11 };

  it('marca el W.O. sin tocar el resultado', () => {
    expect(conWo(partido, true)).toEqual({ ...partido, wo: true });
  });

  it('al desmarcar quita la clave en vez de dejarla en false', () => {
    const limpio = conWo(conWo(partido, true), false);
    expect(limpio).toEqual(partido);
    expect('wo' in limpio).toBe(false);
  });

  it('desmarcar un partido que no era W.O. lo deja igual', () => {
    expect(conWo(partido, false)).toEqual(partido);
  });
});
