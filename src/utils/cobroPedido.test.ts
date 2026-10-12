import { describe, expect, it } from 'vitest';
import type { Order } from '../types';
import { estadoCobro, faltaCobrar, type CobroPedido } from './cobroPedido';

const pedido = (cambios: Partial<Order> = {}): Order => ({
  id: 'VO-1',
  items: [],
  customer: { name: 'Tati', phone: '', email: '', address: '', city: '', department: '', notes: '' },
  total: 670,
  status: 'delivered',
  createdAt: '2026-10-02',
  ...cambios,
});

const cobro = (cambios: Partial<CobroPedido> = {}): CobroPedido => ({
  ledgerId: 'l1', orderId: 'VO-1', metodo: 'efectivo', saldadoEl: null, saldadoCon: null, ...cambios,
});

describe('estadoCobro', () => {
  it('sin venta en caja ni pago online: sin cobrar', () => {
    expect(estadoCobro(pedido(), undefined)).toEqual({ tipo: 'sin-cobrar' });
  });

  it('venta en efectivo: cobrado', () => {
    expect(estadoCobro(pedido(), cobro())).toMatchObject({ tipo: 'cobrado', metodo: 'efectivo' });
  });

  it('anotado como deuda: debe, hasta que se cobra', () => {
    expect(estadoCobro(pedido(), cobro({ metodo: 'debe' })).tipo).toBe('debe');
    expect(estadoCobro(pedido(), cobro({ metodo: 'debe', saldadoEl: '2026-10-12', saldadoCon: 'transferencia' })))
      .toMatchObject({ tipo: 'cobrado', metodo: 'transferencia' });
  });

  it('Mercado Pago acreditado cuenta como pagado; con revisión pendiente, no', () => {
    expect(estadoCobro(pedido({ paymentStatus: 'aprobado' }), undefined).tipo).toBe('pagado-mp');
    expect(estadoCobro(pedido({ paymentStatus: 'aprobado', requiereRevision: 'monto distinto' }), undefined).tipo).toBe('sin-cobrar');
    expect(estadoCobro(pedido({ paymentStatus: 'pendiente' }), undefined).tipo).toBe('sin-cobrar');
  });
});

describe('faltaCobrar', () => {
  it('confirmado en adelante sin cobrar o debiendo', () => {
    expect(faltaCobrar(pedido(), undefined)).toBe(true);
    expect(faltaCobrar(pedido({ status: 'confirmed' }), cobro({ metodo: 'debe' }))).toBe(true);
    expect(faltaCobrar(pedido(), cobro())).toBe(false);
  });

  it('un pendiente todavía no se persigue', () => {
    expect(faltaCobrar(pedido({ status: 'pending' }), undefined)).toBe(false);
  });
});
