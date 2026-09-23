import type { Product } from '../types';
import { getTotalStock } from '../lib/formato';

// Qué productos muestra la vitrina de las páginas de torneos. Solo lo que se puede
// comprar ya: visible en la tienda, con foto (una placa vacía en una vitrina no vende)
// y con stock. Primero los destacados, después el orden que se le dio en el admin.
export function elegirVitrina(productos: Product[], cantidad = 4): Product[] {
  return productos
    .filter((p) => p.active !== false && !!p.images[0] && getTotalStock(p) > 0)
    .sort((a, b) =>
      Number(b.isFeatured) - Number(a.isFeatured)
      || (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
      || b.createdAt.localeCompare(a.createdAt))
    .slice(0, cantidad);
}
