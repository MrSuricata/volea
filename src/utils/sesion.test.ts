import { describe, expect, it } from 'vitest';
import { tokenVencido } from './sesion';

// expires_at de supabase-js viene en SEGUNDOS de epoch; ahora en ms.
const AHORA_MS = 1_700_000_000_000; // instante fijo cualquiera
const AHORA_SEG = AHORA_MS / 1000;

describe('tokenVencido', () => {
  it('vencido: si ahora ya pasó el límite, da true', () => {
    expect(tokenVencido(AHORA_SEG - 600, AHORA_MS)).toBe(true); // venció hace 10 min
  });

  it('vigente: si el vencimiento queda lejos en el futuro, da false', () => {
    expect(tokenVencido(AHORA_SEG + 3600, AHORA_MS)).toBe(false); // vence en 1 hora
  });

  it('borde: dentro del margen de 30s ya lo tratamos como vencido', () => {
    expect(tokenVencido(AHORA_SEG + 10, AHORA_MS)).toBe(true); // vence en 10s: no alcanza
  });

  it('sin dato (undefined/null) no afirmamos nada: da false', () => {
    expect(tokenVencido(undefined, AHORA_MS)).toBe(false);
    expect(tokenVencido(null, AHORA_MS)).toBe(false);
  });
});
