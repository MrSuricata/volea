// Helpers puros de la Caja (pestaña admin): formateo de variantes y armado
// de las opciones de venta a partir del stock_by_size de un producto.

/** "M / Femenino|Fucsia" → "M / Femenino · Fucsia" */
export const formatVariant = (key: string | null) => {
  if (!key) return '';
  const [size, color] = key.split('|');
  return [size, color].filter(Boolean).join(' · ');
};

/** Una variante elegible en el modal de venta: clave real + etiqueta + stock. */
export interface VarianteConStock {
  key: string; // clave cruda "talle|color" (la que viaja a la RPC)
  label: string; // "M / Femenino · Fucsia"
  stock: number;
}

/**
 * Variantes de un producto con stock disponible (>0), en el orden en que el
 * producto las define. Valores no numéricos o negativos cuentan como sin stock.
 */
export function variantesConStock(stockBySize: Record<string, number> | undefined): VarianteConStock[] {
  if (!stockBySize) return [];
  const variantes: VarianteConStock[] = [];
  for (const [key, value] of Object.entries(stockBySize)) {
    const stock = Math.floor(Number(value));
    if (!Number.isFinite(stock) || stock <= 0) continue;
    variantes.push({ key, label: formatVariant(key), stock });
  }
  return variantes;
}

/** Stock total de un producto (suma de todas sus variantes con stock). */
export function stockTotal(stockBySize: Record<string, number> | undefined): number {
  return variantesConStock(stockBySize).reduce((sum, v) => sum + v.stock, 0);
}
