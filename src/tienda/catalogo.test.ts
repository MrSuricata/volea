import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { conFotoPrimero, destacados, fotoDeCategoria, relacionados } from './catalogo';

const producto = (id: string, extra: Partial<Product> = {}): Product => ({
  id, name: id, sku: '', description: '', price: 100, category: 'remeras',
  images: [`https://x/${id}.jpg`], sizes: ['M'], colors: [], stockBySize: { M: 1 },
  isFeatured: false, isOffer: false, createdAt: '2026-01-01T00:00:00Z', ...extra,
});

describe('catálogo público', () => {
  it('conFotoPrimero manda al final los que no tienen foto sin desordenar el resto', () => {
    const lista = [producto('a'), producto('sin', { images: [] }), producto('b')];
    expect(conFotoPrimero(lista).map((p) => p.id)).toEqual(['a', 'b', 'sin']);
  });

  it('destacados deja afuera ocultos y sin foto', () => {
    const lista = [
      producto('ok', { isFeatured: true }),
      producto('sin-foto', { isFeatured: true, images: [] }),
      producto('oculto', { isFeatured: true, active: false }),
      producto('comun'),
    ];
    expect(destacados(lista).map((p) => p.id)).toEqual(['ok']);
  });

  it('relacionados: misma categoría, sin el actual ni ocultos, con foto primero', () => {
    const actual = producto('actual');
    const lista = [
      actual,
      producto('sin', { images: [] }),
      producto('oculto', { active: false }),
      producto('otra-cat', { category: 'polos' }),
      producto('con'),
    ];
    expect(relacionados(lista, actual).map((p) => p.id)).toEqual(['con', 'sin']);
  });

  it('fotoDeCategoria prefiere el destacado y después el orden del admin', () => {
    const lista = [
      producto('b', { sortOrder: 2 }),
      producto('a', { sortOrder: 1 }),
      producto('d', { sortOrder: 9, isFeatured: true }),
      producto('polo', { category: 'polos' }),
    ];
    expect(fotoDeCategoria(lista, 'remeras')).toBe('https://x/d.jpg');
    expect(fotoDeCategoria(lista.filter((p) => p.id !== 'd'), 'remeras')).toBe('https://x/a.jpg');
    expect(fotoDeCategoria(lista, 'vestidos')).toBeUndefined();
  });
});
