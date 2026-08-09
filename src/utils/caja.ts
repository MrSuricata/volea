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

// ── Ventas rápidas de ítems sueltos ──
// Lista curada de lo que VOLEA vende suelto de verdad, sacada del historial real
// de bot_ledger (2026-08-09: powerade/empanadas/alfajor los más vendidos) con el
// último precio conocido de cada uno. El precio es solo el default del botón:
// en el modal queda editable. Para agregar o cambiar precios, editar acá.
export interface VentaRapida { emoji: string; nombre: string; precio: number; }
export const VENTAS_RAPIDAS: VentaRapida[] = [
  { emoji: '🥟', nombre: 'Empanada', precio: 100 },
  { emoji: '🥤', nombre: 'Powerade', precio: 80 },
  { emoji: '🧁', nombre: 'Alfajor', precio: 120 },
  { emoji: '🥤', nombre: 'Coca', precio: 90 },
  { emoji: '☕', nombre: 'Café', precio: 80 },
  { emoji: '☕', nombre: 'Capuchino', precio: 120 },
  { emoji: '💧', nombre: 'Agua', precio: 80 },
  { emoji: '🍺', nombre: 'Cerveza', precio: 240 },
  { emoji: '🍪', nombre: 'Cookie', precio: 100 },
  { emoji: '🍫', nombre: 'Barrita', precio: 100 },
  { emoji: '🥧', nombre: 'Pastafrola', precio: 80 },
  { emoji: '🍕', nombre: 'Pizza', precio: 100 },
];

// Toques repetidos del mismo botón suman cantidad: arma el nombre y el monto
// del ítem suelto ("3× Empanada", 300). Puro para poder testearlo.
export function ventaRapidaAcumulada(v: VentaRapida, veces: number): { nombre: string; monto: number } {
  const n = Math.max(1, Math.floor(veces));
  return { nombre: n === 1 ? v.nombre : `${n}× ${v.nombre}`, monto: v.precio * n };
}
