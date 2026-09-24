import { describe, expect, it } from 'vitest';
import { plural, resultadoIncierto } from './ventas';

describe('resultadoIncierto', () => {
  it('el techo de 15s y los cortes de red dejan la duda', () => {
    expect(resultadoIncierto('timeout: la escritura no llegó a Supabase en 15s')).toBe(true);
    expect(resultadoIncierto('TypeError: Failed to fetch')).toBe(true);
    expect(resultadoIncierto('Load failed')).toBe(true);
    expect(resultadoIncierto('NetworkError when attempting to fetch resource.')).toBe(true);
    expect(resultadoIncierto('AbortError: signal is aborted without reason')).toBe(true);
  });

  it('un rechazo claro NO: se corrige y se reintenta', () => {
    expect(resultadoIncierto('sin stock: quedan 2')).toBe(false);
    expect(resultadoIncierto('Sin conexión con Supabase')).toBe(false);
    expect(resultadoIncierto('permission denied for function admin_registrar_venta')).toBe(false);
    expect(resultadoIncierto(undefined)).toBe(false);
    expect(resultadoIncierto('')).toBe(false);
  });
});

describe('plural', () => {
  it('singular solo con 1', () => {
    expect(plural(1, 'venta', 'ventas')).toBe('1 venta');
    expect(plural(0, 'venta', 'ventas')).toBe('0 ventas');
    expect(plural(3, 'gasto', 'gastos')).toBe('3 gastos');
  });
});
