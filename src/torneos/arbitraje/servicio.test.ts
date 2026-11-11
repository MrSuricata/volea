import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/supabaseClient', () => ({ supabase: null }));
const { cuadroDe } = await import('./servicio');

describe('quién juega según la base (torneo oculto)', () => {
  it('arma los lados con los jugadores separados', () => {
    expect(cuadroDe({ fase: 'llave', titulo: 'Final', a: { parejaId: 'p1', nombre: 'Ana y Luis' }, b: null })).toEqual({
      fase: 'llave', titulo: 'Final', jugado: false, a: { parejaId: 'p1', nombre: 'Ana y Luis', jugadores: ['Ana', 'Luis'] }, b: null,
    });
  });
  it('lo que no tiene la forma esperada (base v36 o basura) no cuenta', () => {
    expect(cuadroDe(undefined)).toBeNull();
    expect(cuadroDe({ fase: 'otra' })).toBeNull();
    expect(cuadroDe({ fase: 'grupo', a: { nombre: 3 } })?.a).toBeNull();
  });
});
