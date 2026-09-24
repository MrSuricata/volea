import { describe, expect, it } from 'vitest';
import { formatoPlata, leerPlata } from './plata';

describe('leerPlata (lo que se tipea en el panel)', () => {
  it('el punto es separador de miles: "1.200" son mil doscientos, no 1,2', () => {
    expect(leerPlata('1.200')).toBe(1200);
    expect(leerPlata('12.500')).toBe(12500);
    expect(leerPlata('1.234.567')).toBe(1234567);
  });

  it('la coma es decimal, con o sin miles', () => {
    expect(leerPlata('1,5')).toBe(1.5);
    expect(leerPlata('1.200,50')).toBe(1200.5);
  });

  it('un punto con 1 o 2 dígitos se toma como decimal (teclado del celular)', () => {
    expect(leerPlata('12.5')).toBe(12.5);
    expect(leerPlata('3.75')).toBe(3.75);
  });

  it('acepta $, espacios y signo', () => {
    expect(leerPlata('$ 1.200')).toBe(1200);
    expect(leerPlata('$U 890')).toBe(890);
    expect(leerPlata('-350')).toBe(-350);
    expect(leerPlata('−350')).toBe(-350);
  });

  it('vacío o basura = null (no 0)', () => {
    expect(leerPlata('')).toBeNull();
    expect(leerPlata('   ')).toBeNull();
    expect(leerPlata('abc')).toBeNull();
    expect(leerPlata('1,2,3')).toBeNull();
  });
});

describe('formatoPlata', () => {
  it('miles con punto y signo adelante del $', () => {
    expect(formatoPlata(1200)).toBe('$ 1.200');
    expect(formatoPlata(-350)).toBe('−$ 350');
    expect(formatoPlata(0)).toBe('$ 0');
  });

  it('decimales solo si los hay o si se piden', () => {
    expect(formatoPlata(1200.5)).toBe('$ 1.200,5');
    expect(formatoPlata(10, { decimales: true })).toBe('$ 10,00');
  });

  it('un monto roto no se muestra como número', () => {
    expect(formatoPlata(Number.NaN)).toBe('$ —');
  });
});
