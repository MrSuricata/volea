import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { elegirVitrina } from './vitrina';

const producto = (id: string, extra: Partial<Product> = {}): Product => ({
  id, name: id, sku: '', description: '', price: 100, category: 'remeras',
  images: [`https://x/${id}.jpg`], sizes: ['M'], colors: [], stockBySize: { M: 3 },
  isFeatured: false, isOffer: false, createdAt: '2026-01-01T00:00:00Z', ...extra,
});

describe('elegirVitrina', () => {
  it('deja afuera ocultos, sin foto y sin stock', () => {
    const lista = [
      producto('oculto', { active: false }),
      producto('sin-foto', { images: [] }),
      producto('agotado', { stockBySize: { M: 0, L: 0 } }),
      producto('ok'),
    ];
    expect(elegirVitrina(lista).map((p) => p.id)).toEqual(['ok']);
  });

  it('pone primero los destacados y después respeta el orden del admin', () => {
    const lista = [
      producto('c', { sortOrder: 3 }),
      producto('a', { sortOrder: 1 }),
      producto('destacado', { isFeatured: true, sortOrder: 9 }),
      producto('b', { sortOrder: 2 }),
    ];
    expect(elegirVitrina(lista, 3).map((p) => p.id)).toEqual(['destacado', 'a', 'b']);
  });

  it('sin orden cargado, los más nuevos primero', () => {
    const lista = [
      producto('viejo', { createdAt: '2026-01-01T00:00:00Z' }),
      producto('nuevo', { createdAt: '2026-09-01T00:00:00Z' }),
    ];
    expect(elegirVitrina(lista).map((p) => p.id)).toEqual(['nuevo', 'viejo']);
  });
});
