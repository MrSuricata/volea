// Cuentas del tablero de Stock, sin React (se testean solas y el panel las reusa).
// El stock vive en product.stockBySize con clave "talle|color" (sin "|" = color único).

import type { Product } from '../types';

/** Hasta cuántas unidades una variante está "baja". Único lugar donde se define. */
export const UMBRAL_STOCK_BAJO = 3;

export type EstadoVariante = 'sin' | 'bajo' | 'ok';

export const estadoVariante = (cantidad: number): EstadoVariante =>
  cantidad <= 0 ? 'sin' : cantidad <= UMBRAL_STOCK_BAJO ? 'bajo' : 'ok';

export type VarianteStock = { clave: string; talle: string; color: string; cantidad: number; estado: EstadoVariante };

export type ResumenStock = {
  producto: Product;
  variantes: VarianteStock[];
  sinStock: VarianteStock[];
  bajo: VarianteStock[];
  /** Unidades vendibles (una variante en negativo no resta). */
  unidades: number;
};

export const COLOR_UNICO = 'Único';

export function resumirStock(producto: Product): ResumenStock {
  const orden = (lista: string[], v: string) => { const i = lista.indexOf(v); return i < 0 ? lista.length : i; };
  const talles = producto.sizes ?? [];
  const colores = (producto.colors ?? []).map((c) => c.name);
  const variantes = Object.entries(producto.stockBySize ?? {})
    .map(([clave, qty]) => {
      const [talle, color] = clave.split('|');
      const cantidad = Number(qty) || 0;
      return { clave, talle, color: color || COLOR_UNICO, cantidad, estado: estadoVariante(cantidad) };
    })
    // Mismo orden que en la ficha: colores y talles como están cargados en el producto.
    .sort((a, b) => orden(colores, a.color) - orden(colores, b.color) || orden(talles, a.talle) - orden(talles, b.talle));
  return {
    producto,
    variantes,
    sinStock: variantes.filter((v) => v.estado === 'sin'),
    bajo: variantes.filter((v) => v.estado === 'bajo'),
    unidades: variantes.reduce((s, v) => s + Math.max(0, v.cantidad), 0),
  };
}

/** Variantes agrupadas por color (para ver el detalle como una grilla color × talles). */
export function porColor(variantes: VarianteStock[]): { color: string; variantes: VarianteStock[] }[] {
  const grupos = new Map<string, VarianteStock[]>();
  for (const v of variantes) grupos.set(v.color, [...(grupos.get(v.color) ?? []), v]);
  return [...grupos].map(([color, vs]) => ({ color, variantes: vs }));
}

export type FiltroStock = 'todos' | 'sin' | 'bajo';

const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Busca por nombre o SKU, sin importar mayúsculas ni tildes. */
export function coincideBusqueda(producto: Product, busqueda: string): boolean {
  const q = normal(busqueda);
  if (!q) return true;
  return normal(producto.name ?? '').includes(q) || normal(producto.sku ?? '').includes(q);
}

export function pasaFiltro(r: ResumenStock, filtro: FiltroStock): boolean {
  if (filtro === 'sin') return r.sinStock.length > 0;
  if (filtro === 'bajo') return r.bajo.length > 0;
  return true;
}

/** Lo más urgente arriba: sin stock pesa más que stock bajo; empate por nombre. */
export function ordenarPorUrgencia(lista: ResumenStock[]): ResumenStock[] {
  const puntos = (r: ResumenStock) => r.sinStock.length * 10 + r.bajo.length;
  return [...lista].sort((a, b) => puntos(b) - puntos(a) || a.producto.name.localeCompare(b.producto.name, 'es'));
}

export type TotalesStock = { unidades: number; variantes: number; bajo: number; sin: number };

export function totalesStock(lista: ResumenStock[]): TotalesStock {
  return lista.reduce(
    (t, r) => ({
      unidades: t.unidades + r.unidades,
      variantes: t.variantes + r.variantes.length,
      bajo: t.bajo + r.bajo.length,
      sin: t.sin + r.sinStock.length,
    }),
    { unidades: 0, variantes: 0, bajo: 0, sin: 0 },
  );
}
