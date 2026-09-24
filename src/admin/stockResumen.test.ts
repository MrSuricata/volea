import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import {
  UMBRAL_STOCK_BAJO, coincideBusqueda, estadoVariante, ordenarPorUrgencia, pasaFiltro, porColor,
  resumirStock, totalesStock,
} from './stockResumen';

const producto = (p: Partial<Product>): Product => ({
  id: 'p', name: 'Remera', sku: 'VOL-001', description: '', price: 1290, category: 'remeras', images: [],
  sizes: ['S', 'M', 'L'], colors: [{ name: 'Negro', hex: '#000' }, { name: 'Blanco', hex: '#fff' }],
  stockBySize: {}, isFeatured: false, isOffer: false, createdAt: '2026-01-01', ...p,
});

describe('estadoVariante', () => {
  it('0 o menos es sin stock; hasta el umbral es bajo', () => {
    expect(UMBRAL_STOCK_BAJO).toBe(3);
    expect(estadoVariante(-1)).toBe('sin');
    expect(estadoVariante(0)).toBe('sin');
    expect(estadoVariante(1)).toBe('bajo');
    expect(estadoVariante(UMBRAL_STOCK_BAJO)).toBe('bajo');
    expect(estadoVariante(UMBRAL_STOCK_BAJO + 1)).toBe('ok');
  });
});

describe('resumirStock', () => {
  const r = resumirStock(producto({ stockBySize: { 'L|Blanco': 5, 'M|Negro': 2, 'S|Negro': 0, 'L|Negro': -1, 'M|Blanco': 9 } }));

  it('separa talle y color y ordena como el producto (color, después talle)', () => {
    expect(r.variantes.map((v) => v.clave)).toEqual(['S|Negro', 'M|Negro', 'L|Negro', 'M|Blanco', 'L|Blanco']);
  });

  it('cuenta sin stock, bajo y unidades (lo negativo no resta)', () => {
    expect(r.sinStock.map((v) => v.clave)).toEqual(['S|Negro', 'L|Negro']);
    expect(r.bajo.map((v) => v.clave)).toEqual(['M|Negro']);
    expect(r.unidades).toBe(16);
  });

  it('sin "|" el color es Único', () => {
    const u = resumirStock(producto({ sizes: ['U'], colors: [], stockBySize: { U: 4 } }));
    expect(u.variantes[0]).toMatchObject({ talle: 'U', color: 'Único', cantidad: 4, estado: 'ok' });
  });

  it('agrupa por color', () => {
    expect(porColor(r.variantes).map((g) => [g.color, g.variantes.length])).toEqual([['Negro', 3], ['Blanco', 2]]);
  });
});

describe('búsqueda y filtros', () => {
  it('busca por nombre o SKU, sin tildes ni mayúsculas', () => {
    const p = producto({ name: 'Polo Técnico', sku: 'VOL-POLO-07' });
    expect(coincideBusqueda(p, 'tecnico')).toBe(true);
    expect(coincideBusqueda(p, 'polo-07')).toBe(true);
    expect(coincideBusqueda(p, '  ')).toBe(true);
    expect(coincideBusqueda(p, 'gorro')).toBe(false);
    expect(coincideBusqueda({ ...p, sku: undefined as unknown as string }, 'polo')).toBe(true);
  });

  it('filtra y ordena lo más urgente arriba', () => {
    const sano = resumirStock(producto({ id: 'a', name: 'A sano', stockBySize: { 'S|Negro': 10 } }));
    const bajo = resumirStock(producto({ id: 'b', name: 'B bajo', stockBySize: { 'S|Negro': 2 } }));
    const sin = resumirStock(producto({ id: 'c', name: 'C sin', stockBySize: { 'S|Negro': 0 } }));
    expect(pasaFiltro(sano, 'todos')).toBe(true);
    expect([sano, bajo, sin].filter((r) => pasaFiltro(r, 'sin')).map((r) => r.producto.id)).toEqual(['c']);
    expect([sano, bajo, sin].filter((r) => pasaFiltro(r, 'bajo')).map((r) => r.producto.id)).toEqual(['b']);
    expect(ordenarPorUrgencia([sano, bajo, sin]).map((r) => r.producto.id)).toEqual(['c', 'b', 'a']);
    expect(totalesStock([sano, bajo, sin])).toEqual({ unidades: 12, variantes: 3, bajo: 1, sin: 1 });
  });
});
