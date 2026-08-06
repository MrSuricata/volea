import { describe, expect, it } from 'vitest';
import { fechaHumana } from './fechas';

// Montevideo es UTC-3 todo el año (sin horario de verano desde 2015).
// "Ahora": jueves 2026-08-06 15:00 en Montevideo.
const AHORA = Date.parse('2026-08-06T18:00:00Z');

describe('fechaHumana', () => {
  it('mismo día calendario en Montevideo → "hoy HH:MM"', () => {
    // 17:32Z = 14:32 Montevideo, mismo 6/8
    expect(fechaHumana('2026-08-06T17:32:00Z', AHORA)).toBe('hoy 14:32');
  });

  it('día calendario anterior → "ayer HH:MM" (con hora con cero adelante)', () => {
    // 12:15Z = 09:15 Montevideo del 5/8
    expect(fechaHumana('2026-08-05T12:15:00Z', AHORA)).toBe('ayer 09:15');
  });

  it('día de la semana pasada → "día d/m · HH:MM" con día corto es-UY', () => {
    // 2026-07-29 fue miércoles; 17:32Z = 14:32 Montevideo
    expect(fechaHumana('2026-07-29T17:32:00Z', AHORA)).toBe('mié 29/7 · 14:32');
  });

  it('compara días calendario de Montevideo, no la fecha UTC', () => {
    // 01:00Z del 7/8 = 22:00 Montevideo del 6/8 → sigue siendo "hoy"
    expect(fechaHumana('2026-08-07T01:00:00Z', AHORA)).toBe('hoy 22:00');
  });

  it('borde de medianoche: 23:59 vs 00:01 son días distintos', () => {
    // "Ahora": 00:05 Montevideo del 6/8 (03:05Z)
    const madrugada = Date.parse('2026-08-06T03:05:00Z');
    // 02:59Z = 23:59 Montevideo del 5/8 → ayer
    expect(fechaHumana('2026-08-06T02:59:00Z', madrugada)).toBe('ayer 23:59');
    // 03:01Z = 00:01 Montevideo del 6/8 → hoy (y en formato 24h, no "24:01")
    expect(fechaHumana('2026-08-06T03:01:00Z', madrugada)).toBe('hoy 00:01');
  });

  it('fecha inválida → devuelve el string tal cual (igual que formatDateTime)', () => {
    expect(fechaHumana('no-es-fecha', AHORA)).toBe('no-es-fecha');
  });
});
