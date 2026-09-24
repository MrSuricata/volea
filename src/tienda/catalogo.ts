import type { Product } from '../types';

// Reglas de qué producto se muestra dónde en la tienda pública. Criterio común: un
// producto sin foto se ve como una placa vacía y en una vidriera parece un error, así
// que nunca va adelante (auditoría de diseño 24/09: la primera tarjeta de /tienda era
// MUSCULOSA VOLEA sin foto).

const visible = (p: Product) => p.active !== false;
const tieneFoto = (p: Product) => !!p.images[0];

/** Los que tienen foto primero; el orden de cada grupo se respeta tal cual. */
export function conFotoPrimero(productos: Product[]): Product[] {
  return [...productos.filter(tieneFoto), ...productos.filter((p) => !tieneFoto(p))];
}

/** Destacados de la home: marcados en el admin, visibles y con foto. */
export function destacados(productos: Product[], cantidad = 4): Product[] {
  return productos.filter((p) => p.isFeatured && visible(p) && tieneFoto(p)).slice(0, cantidad);
}

/** "También te puede interesar": misma categoría, visibles, con foto primero. */
export function relacionados(productos: Product[], actual: Product, cantidad = 4): Product[] {
  return conFotoPrimero(productos.filter((p) => p.id !== actual.id && visible(p) && p.category === actual.category))
    .slice(0, cantidad);
}

/**
 * La foto que representa una categoría en "Explorá por categoría": la de su primer
 * destacado, o si no hay, la del primero según el orden del admin.
 */
export function fotoDeCategoria(productos: Product[], categoria: string): string | undefined {
  const candidatos = productos
    .filter((p) => p.category === categoria && visible(p) && tieneFoto(p))
    .sort((a, b) =>
      Number(b.isFeatured) - Number(a.isFeatured)
      || (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER));
  return candidatos[0]?.images[0];
}
