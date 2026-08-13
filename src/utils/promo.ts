import type { CartItem, Promo } from '../types';

// ⚠ PARIDAD CON EL SERVER: la preferencia de Mercado Pago aplica este mismo
// descuento del lado del servidor (api/_lib/mp.ts, precioConPromo + promoVigenteHoy).
// Si se cambia el redondeo o la regla de fechas acá, hay que cambiarla ALLÁ
// también, o el total que muestra el carrito difiere del que cobra MP.

const TZ = 'America/Montevideo';

/** "YYYY-MM-DD" de hoy en día de Uruguay (la promo corre con fechas locales). */
export function hoyMontevideo(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: TZ });
}

/**
 * Precio unitario con el descuento aplicado, redondeado a peso entero POR UNIDAD.
 * El redondeo es por unidad y no sobre el total a propósito: Mercado Pago cobra
 * unit_price × cantidad, así que redondear distinto acá desfasaría el total.
 */
export function precioConPromo(price: number, percent: number): number {
  return Math.round(price * (100 - percent) / 100);
}

/** La promo activa cuya ventana incluye hoy, o null. */
export function promoVigente(promos: Promo[], hoy: string): Promo | null {
  // Orden por id ANTES de elegir: las queries no traen ORDER BY, y con dos promos
  // solapadas el cliente y el server (api/_lib/mp.ts) podrían elegir distinta.
  return [...promos].sort((a, b) => a.id.localeCompare(b.id)).find(p =>
    p.active && p.percent > 0 && p.percent < 100 &&
    p.startsOn <= hoy && hoy <= p.endsOn,
  ) ?? null;
}

/**
 * La promo activa que todavía no arrancó (para anunciarla antes), o null.
 * Si hay una vigente, manda la vigente.
 */
export function promoPorVenir(promos: Promo[], hoy: string): Promo | null {
  if (promoVigente(promos, hoy)) return null;
  return promos
    .filter(p => p.active && p.percent > 0 && p.percent < 100 && p.startsOn > hoy)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0] ?? null;
}

export type TotalesCarrito = {
  /** Suma a precio de lista. */
  subtotal: number;
  /** Lo que se descuenta (0 sin promo vigente). */
  descuento: number;
  /** Lo que se paga: subtotal − descuento. */
  total: number;
};

/** Totales del carrito con la promo (si hay) aplicada por unidad. */
export function totalesConPromo(cart: CartItem[], promo: Promo | null): TotalesCarrito {
  const subtotal = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  if (!promo) return { subtotal, descuento: 0, total: subtotal };
  const total = cart.reduce((s, i) => s + precioConPromo(i.product.price, promo.percent) * i.quantity, 0);
  return { subtotal, descuento: subtotal - total, total };
}

/** "17 al 20 de agosto" — la ventana de la promo para los carteles. */
export function ventanaPromo(promo: Promo): string {
  const dia = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`); // mediodía UTC: sin esto muestra el día anterior
    return isNaN(d.getTime()) ? null : d;
  };
  const d1 = dia(promo.startsOn);
  const d2 = dia(promo.endsOn);
  if (!d1 || !d2) return '';
  // toLowerCase: el ICU de Node capitaliza los meses en es-UY ("Agosto") y el
  // navegador no — sin normalizar, el texto cambia según dónde corra.
  const nombreMes = (d: Date) => d.toLocaleDateString('es-UY', { month: 'long', timeZone: TZ }).toLowerCase();
  const mes = nombreMes(d2);
  if (promo.startsOn === promo.endsOn) return `el ${d2.getUTCDate()} de ${mes}`;
  const mes1 = nombreMes(d1);
  if (mes1 !== mes) return `del ${d1.getUTCDate()} de ${mes1} al ${d2.getUTCDate()} de ${mes}`;
  return `del ${d1.getUTCDate()} al ${d2.getUTCDate()} de ${mes}`;
}
