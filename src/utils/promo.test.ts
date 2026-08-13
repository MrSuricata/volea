import { describe, expect, it } from 'vitest';
import type { CartItem, Promo } from '../types';
import { hoyMontevideo, precioConPromo, promoPorVenir, promoVigente, totalesConPromo, ventanaPromo } from './promo';

const promo = (parcial: Partial<Promo> = {}): Promo => ({
  id: 'promo-racket-roll-2026',
  label: '10% OFF en toda la web',
  percent: 10,
  startsOn: '2026-08-17',
  endsOn: '2026-08-20',
  deliveryNote: 'Entrega GRATIS en Carmelo el 22, 23 y 24 de agosto.',
  active: true,
  ...parcial,
});

const item = (price: number, quantity: number): CartItem =>
  ({ product: { id: 'p', name: 'X', price, images: [], stockBySize: {} }, quantity, selectedSize: 'M' }) as unknown as CartItem;

describe('precioConPromo', () => {
  // ⚠ Estos valores están FIJADOS: el server (api/_lib/mp.ts) tiene el mismo test.
  // Si uno de los dos cambia, el carrito muestra un total y MP cobra otro.
  it('redondea a peso entero por unidad, igual que el server', () => {
    expect(precioConPromo(1000, 10)).toBe(900);
    expect(precioConPromo(1290, 10)).toBe(1161);
    expect(precioConPromo(995, 10)).toBe(896);   // 895.5 → 896
    expect(precioConPromo(85, 10)).toBe(77);     // 76.5 → 77 (Math.round, no floor)
    expect(precioConPromo(333, 15)).toBe(283);   // 283.05 → 283
  });
});

describe('promoVigente / promoPorVenir', () => {
  it('vigente solo dentro de la ventana, inclusive en ambas puntas', () => {
    const ps = [promo()];
    expect(promoVigente(ps, '2026-08-16')).toBeNull();
    expect(promoVigente(ps, '2026-08-17')?.id).toBe('promo-racket-roll-2026');
    expect(promoVigente(ps, '2026-08-20')?.id).toBe('promo-racket-roll-2026');
    expect(promoVigente(ps, '2026-08-21')).toBeNull();
  });

  it('inactiva o con percent inválido no aplica nunca', () => {
    expect(promoVigente([promo({ active: false })], '2026-08-18')).toBeNull();
    expect(promoVigente([promo({ percent: 0 })], '2026-08-18')).toBeNull();
    expect(promoVigente([promo({ percent: 100 })], '2026-08-18')).toBeNull();
  });

  it('porVenir anuncia la más próxima solo mientras no haya una vigente', () => {
    const ps = [promo()];
    expect(promoPorVenir(ps, '2026-08-13')?.id).toBe('promo-racket-roll-2026');
    expect(promoPorVenir(ps, '2026-08-17')).toBeNull(); // ya está vigente: manda la vigente
    expect(promoPorVenir(ps, '2026-08-21')).toBeNull(); // ya pasó
  });
});

describe('totalesConPromo', () => {
  it('sin promo: total = subtotal, descuento 0', () => {
    const t = totalesConPromo([item(1000, 2)], null);
    expect(t).toEqual({ subtotal: 2000, descuento: 0, total: 2000 });
  });

  it('con promo: redondeo POR UNIDAD (como cobra MP), no sobre el total', () => {
    // 995 → 896 por unidad; ×3 = 2688. Redondear sobre el total daría 2687 (2986.5×0.9).
    const t = totalesConPromo([item(995, 3)], promo());
    expect(t.subtotal).toBe(2985);
    expect(t.total).toBe(2688);
    expect(t.descuento).toBe(297);
  });

  it('varios items suman sus descuentos', () => {
    const t = totalesConPromo([item(1000, 1), item(1290, 2)], promo());
    expect(t.total).toBe(900 + 1161 * 2);
    expect(t.subtotal - t.descuento).toBe(t.total);
  });
});

describe('ventanaPromo', () => {
  it('mismo mes: "del 17 al 20 de agosto"', () => {
    expect(ventanaPromo(promo())).toBe('del 17 al 20 de agosto');
  });
  it('cruza de mes: nombra los dos', () => {
    expect(ventanaPromo(promo({ startsOn: '2026-08-30', endsOn: '2026-09-02' }))).toBe('del 30 de agosto al 2 de setiembre');
  });
  it('un solo día', () => {
    expect(ventanaPromo(promo({ startsOn: '2026-08-17', endsOn: '2026-08-17' }))).toBe('el 17 de agosto');
  });
});

describe('hoyMontevideo', () => {
  it('devuelve el día local aunque UTC ya haya cambiado de fecha', () => {
    // 01:30 UTC del 18 = 22:30 del 17 en Montevideo.
    expect(hoyMontevideo(new Date('2026-08-18T01:30:00Z'))).toBe('2026-08-17');
  });
});
