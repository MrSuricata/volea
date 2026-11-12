import { describe, expect, it } from 'vitest';
import type { CartItem, Promo } from '../types';
import { conDescuento, costoConCupon, normalizarCodigo, totalesConCupon, type CuponValido } from './cupones';

const item = (price: number, quantity: number): CartItem =>
  ({ product: { id: 'p', name: 'X', price, images: [], stockBySize: {} }, quantity, selectedSize: 'M' }) as unknown as CartItem;
const cupon = (percent: number): CuponValido => ({ codigo: 'ABC-123456', tipo: 'tienda', percent, etiqueta: '20% en la tienda' });
const promo = (percent: number): Promo => ({ id: 'p', label: 'Promo', percent, startsOn: '2026-01-01', endsOn: '2026-12-31', deliveryNote: '', active: true });

describe('normalizarCodigo', () => {
  it('acepta minúsculas, espacios y sin guion', () => {
    expect(normalizarCodigo(' abc 123456 ')).toBe('ABC-123456');
    expect(normalizarCodigo('xyz-a1b2c3')).toBe('XYZ-A1B2C3');
    expect(normalizarCodigo('QWE987654')).toBe('QWE-987654');
  });
  it('lo que no tiene forma de código queda en mayúsculas', () => {
    expect(normalizarCodigo('hola')).toBe('HOLA');
  });
});

describe('conDescuento / costoConCupon', () => {
  it('redondea a peso como la base', () => {
    expect(conDescuento(900, 50)).toBe(450);
    expect(conDescuento(700, 100)).toBe(0);
    expect(conDescuento(1290, 20)).toBe(1032);
    expect(conDescuento(85, 50)).toBe(43); // 42.5 → 43
    expect(conDescuento(900, null)).toBe(900);
  });
  it('aplica sobre el costo total de la inscripción', () => {
    const tarifa = { base: 900, extra: 300, incluye: 2 };
    expect(costoConCupon(3, tarifa, 50)).toBe(600);
    expect(costoConCupon(1, tarifa, 100)).toBe(0);
    expect(costoConCupon(1, tarifa, null)).toBe(900);
  });
});

describe('totalesConCupon', () => {
  it('descuenta el cupón por unidad', () => {
    const t = totalesConCupon([item(1290, 2)], null, cupon(20));
    expect(t).toMatchObject({ subtotal: 2580, total: 2064, descuento: 516, usa: 'cupon' });
  });
  it('no se acumula con la promo: vale el descuento más alto', () => {
    expect(totalesConCupon([item(1000, 1)], promo(10), cupon(20))).toMatchObject({ total: 800, usa: 'cupon' });
    expect(totalesConCupon([item(1000, 1)], promo(25), cupon(20))).toMatchObject({ total: 750, usa: 'promo' });
  });
  it('sin cupón ni promo no descuenta', () => {
    expect(totalesConCupon([item(1000, 1)], null, null)).toMatchObject({ total: 1000, descuento: 0, usa: null });
  });
});
