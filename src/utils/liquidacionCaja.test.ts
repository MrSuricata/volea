import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../types';
import { agruparPorCobrador, socioPorNombre, ventaALiquidar } from './liquidacionCaja';

const venta = (c: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'v', kind: 'venta', productId: null, variantKey: null, label: 'x', qty: 1, amount: 100, reportedBy: 'VOLEA Team',
  reverted: false, createdAt: '2026-10-15', paymentMethod: 'efectivo', debtorName: null, jugadorId: null,
  settledAt: null, settledMethod: null, socioSettledAt: null, paidBy: null, ...c,
});

describe('liquidación de ventas por cobrador', () => {
  it('reconoce a los socios por el nombre y no adivina las cuentas compartidas', () => {
    expect(socioPorNombre('Brian Ridvanovich')).toBe('brian');
    expect(socioPorNombre('Pauli')).toBe('paula');
    expect(socioPorNombre('Gasty')).toBe('gaston');
    expect(socioPorNombre('VOLEA Team')).toBeNull();
    expect(socioPorNombre('Web')).toBeNull();
    expect(socioPorNombre('Usuario')).toBeNull();
  });

  it('una venta cobrada en el momento va a quien la registró', () => {
    expect(ventaALiquidar(venta({ reportedBy: 'Gasty' }))).toMatchObject({ grupo: 'Efectivo', cobrador: 'gaston', origen: 'registro' });
    expect(ventaALiquidar(venta({}))).toMatchObject({ cobrador: null, origen: 'falta' });
  });

  it('un fiado cobrado va a quien cobró, no a quien vendió', () => {
    const f = venta({ paymentMethod: 'debe', settledAt: '2026-10-15', settledMethod: 'efectivo', reportedBy: 'Gasty' });
    expect(ventaALiquidar(f)).toMatchObject({ grupo: 'Fiados cobrados (Efectivo)', cobrador: null, origen: 'falta' });
    expect(ventaALiquidar({ ...f, paidBy: 'brian' })).toMatchObject({ cobrador: 'brian', origen: 'cobro' });
  });

  it('arma un movimiento por grupo y socio, sin los que falta elegir', () => {
    const vs = [
      { ...ventaALiquidar(venta({ id: 'a', reportedBy: 'Gasty', amount: 100 })) },
      { ...ventaALiquidar(venta({ id: 'b', reportedBy: 'Gasty', amount: 50 })) },
      { ...ventaALiquidar(venta({ id: 'c', reportedBy: 'Brian', amount: 2980 })) },
      { ...ventaALiquidar(venta({ id: 'd', amount: 10 })) },
    ];
    expect(agruparPorCobrador(vs)).toEqual([
      { grupo: 'Efectivo', cobrador: 'gaston', ids: ['a', 'b'], total: 150 },
      { grupo: 'Efectivo', cobrador: 'brian', ids: ['c'], total: 2980 },
    ]);
  });
});
