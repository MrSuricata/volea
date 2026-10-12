import { describe, expect, it } from 'vitest';
import type { PartidoLlave, SlotLlave } from './tipos';
import { editarSlot, moverEnRonda, origenesPosibles } from './editarLlave';

const seed = (parejaId: string): SlotLlave => ({ tipo: 'seed', parejaId });
const gan = (partidoId: string): SlotLlave => ({ tipo: 'ganadorDe', partidoId });
const p = (id: string, ronda: number, posicion: number, a: SlotLlave | null, b: SlotLlave | null, pa: number | null = null, pb: number | null = null): PartidoLlave =>
  ({ id, ronda, posicion, a, b, puntosA: pa, puntosB: pb, esTercerPuesto: false });

// Copa de Plata del Aniversario como se armó: 7 bye, cuarto 10v11 (jugado), 8 vs 9 (jugado), semis y final.
function plata(): PartidoLlave[] {
  return [
    p('b7', 1, 0, seed('s7'), null),
    p('q', 1, 1, seed('s10'), seed('s11'), 9, 15),
    p('b8', 1, 2, seed('s8'), null),
    p('b9', 1, 3, seed('s9'), null),
    p('sf1', 2, 0, gan('b7'), gan('q')),
    p('sf2', 2, 1, gan('b8'), gan('b9'), 20, 22),
    p('fin', 3, 0, gan('sf1'), gan('sf2')),
  ];
}

describe('corregir la llave a mano', () => {
  it('lo que pasó en la Copa de Plata: la 7ª juega contra la ganadora de 8v9 y la final es contra la del cuarto', () => {
    let l = editarSlot(plata(), 'sf1', 'b', gan('sf2'));
    l = editarSlot(l, 'fin', 'b', gan('q'));
    const sf1 = l.find((x) => x.id === 'sf1')!;
    const fin = l.find((x) => x.id === 'fin')!;
    expect(sf1.ronda).toBeGreaterThan(l.find((x) => x.id === 'sf2')!.ronda);
    expect(fin.ronda).toBeGreaterThan(sf1.ronda);
    // los resultados cargados siguen
    expect(l.find((x) => x.id === 'q')!.puntosB).toBe(15);
    expect(l.find((x) => x.id === 'sf2')!.puntosB).toBe(22);
  });

  it('no deja tocar un partido con resultado ni armar un círculo', () => {
    expect(() => editarSlot(plata(), 'sf2', 'a', seed('x'))).toThrow(/resultado/);
    expect(() => editarSlot(plata(), 'sf1', 'a', gan('fin'))).toThrow(/círculo/);
    expect(origenesPosibles(plata(), 'sf1').map((x) => x.id)).not.toContain('fin');
  });

  it('reemplazar un clasificado y reordenar el dibujo', () => {
    const l = editarSlot(plata(), 'sf1', 'a', seed('s8'));
    expect(l.find((x) => x.id === 'sf1')!.a).toEqual(seed('s8'));
    const m = moverEnRonda(plata(), 'q', -1);
    expect(m.find((x) => x.id === 'q')!.posicion).toBe(0);
    expect(m.find((x) => x.id === 'b7')!.posicion).toBe(1);
    expect(moverEnRonda(plata(), 'b7', -1)).toEqual(plata());
  });
});
