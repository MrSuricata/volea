// Cupones de un solo uso (tabla cupones, v38). La base valida y gasta el código; acá solo la
// cuenta de cuánto se descuenta, con LA MISMA regla que admin_pago_inscripcion (redondeo a peso).

import type { CartItem, Promo, TarifaEvento } from '../types';
import { costoInscripcion } from './inscripciones';
import { totalesConPromo, type TotalesCarrito } from './promo';

export type CuponTipo = 'inscripcion' | 'tienda';

export interface CuponValido {
  codigo: string;
  tipo: CuponTipo;
  percent: number;
  etiqueta: string;
}

export interface Cupon extends CuponValido {
  vence: string | null;
  usadoAt: string | null;
  usadoPor: string | null;
  usadoRef: string | null;
}

/** "abc 123456" → "ABC-123456" (la base hace lo mismo; acá es para mostrarlo prolijo). */
export function normalizarCodigo(s: string): string {
  const v = s.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{9}$/.test(v) ? `${v.slice(0, 3)}-${v.slice(3)}` : v;
}

/** Monto con el % de cupón aplicado, redondeado a peso (igual que la base). */
export function conDescuento(monto: number, percent: number | null | undefined): number {
  if (!percent || percent <= 0) return monto;
  return Math.round((monto * (100 - Math.min(percent, 100))) / 100);
}

/** Costo de una inscripción con su cupón (si tiene). */
export function costoConCupon(nCategorias: number, tarifa: TarifaEvento, cuponPercent: number | null | undefined): number {
  return conDescuento(costoInscripcion(nCategorias, tarifa), cuponPercent);
}

/**
 * Totales del carrito con cupón. No es acumulable: si además hay una promo general vigente,
 * vale el descuento más alto de los dos (redondeo por unidad, como la promo).
 */
export function totalesConCupon(
  cart: CartItem[],
  promo: Promo | null,
  cupon: CuponValido | null,
): TotalesCarrito & { usa: 'cupon' | 'promo' | null } {
  if (!cupon || (promo && promo.percent >= cupon.percent)) {
    return { ...totalesConPromo(cart, promo), usa: promo ? 'promo' : null };
  }
  const comoPromo: Promo = {
    id: cupon.codigo, label: `Cupón ${cupon.codigo}`, percent: cupon.percent,
    startsOn: '', endsOn: '', active: true, deliveryNote: '',
  };
  return { ...totalesConPromo(cart, comoPromo), usa: 'cupon' };
}
