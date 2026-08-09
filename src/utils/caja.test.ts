import { describe, expect, it } from 'vitest';
import { formatVariant, stockTotal, variantesConStock } from './caja';

describe('formatVariant', () => {
  it('separa talle y color con " · "', () => {
    expect(formatVariant('M / Femenino|Fucsia')).toBe('M / Femenino · Fucsia');
  });

  it('clave sin color → solo el talle', () => {
    expect(formatVariant('Único')).toBe('Único');
    expect(formatVariant('Único|')).toBe('Único');
  });

  it('null → string vacío', () => {
    expect(formatVariant(null)).toBe('');
  });
});

describe('variantesConStock', () => {
  it('deja solo las variantes con stock > 0, en el orden del producto', () => {
    expect(variantesConStock({ 'S|Negro': 0, 'M|Negro': 3, 'L|Negro': 1 })).toEqual([
      { key: 'M|Negro', label: 'M · Negro', stock: 3 },
      { key: 'L|Negro', label: 'L · Negro', stock: 1 },
    ]);
  });

  it('valores raros (negativos, no numéricos) cuentan como sin stock', () => {
    const sucio = { 'S|Rojo': -2, 'M|Rojo': NaN, 'L|Rojo': 'tres', 'XL|Rojo': 2 };
    expect(variantesConStock(sucio as unknown as Record<string, number>)).toEqual([
      { key: 'XL|Rojo', label: 'XL · Rojo', stock: 2 },
    ]);
  });

  it('sin stockBySize o vacío → lista vacía', () => {
    expect(variantesConStock(undefined)).toEqual([]);
    expect(variantesConStock({})).toEqual([]);
  });
});

describe('stockTotal', () => {
  it('suma solo las variantes con stock', () => {
    expect(stockTotal({ 'S|Negro': 0, 'M|Negro': 3, 'L|Negro': 1 })).toBe(4);
  });

  it('sin datos → 0', () => {
    expect(stockTotal(undefined)).toBe(0);
    expect(stockTotal({})).toBe(0);
  });
});
