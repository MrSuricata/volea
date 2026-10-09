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
// promo: "2 por $30" → { cantidad: 2, precio: 30 } (los que sobran van a precio suelto).
export interface PromoCantidad { cantidad: number; precio: number }
export interface VentaRapida { emoji: string; nombre: string; precio: number; promo?: PromoCantidad }
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
  { emoji: '⚡', nombre: 'Electrolitos', precio: 70 },
  { emoji: '🍭', nombre: 'Pico dulce', precio: 20, promo: { cantidad: 2, precio: 30 } },
  { emoji: '🍬', nombre: 'Gomitas Finni', precio: 20, promo: { cantidad: 2, precio: 30 } },
  { emoji: '🌿', nombre: 'Mentitas', precio: 30 },
];

export interface ItemCarrito { nombre: string; precio: number; veces: number; promo?: PromoCantidad }

/** Total de un ítem aplicando la promo por cantidad: 3 picos a "$20 / 2 por $30" = $50. */
export function montoItem(i: ItemCarrito): number {
  const p = i.promo;
  if (!p || p.cantidad < 2) return i.precio * i.veces;
  return Math.floor(i.veces / p.cantidad) * p.precio + (i.veces % p.cantidad) * i.precio;
}

// Carrito de sueltos: varios ítems distintos suman en UNA venta (pedido de
// Brian 15/8 — antes tocar otro botón pisaba el anterior). Arma el detalle
// ("Empanada + 2× Coca + Cookie") y el total. Puro para poder testearlo.
export function resumenCarrito(items: ItemCarrito[]): { nombre: string; monto: number } {
  const partes = items.map(i => (i.veces === 1 ? i.nombre : `${i.veces}× ${i.nombre}`));
  const monto = items.reduce((s, i) => s + montoItem(i), 0);
  return { nombre: partes.join(' + '), monto };
}
