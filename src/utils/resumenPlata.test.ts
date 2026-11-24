import { describe, expect, it } from 'vitest';
import type { GastoPendiente, LedgerEntry, SocioMove } from '../types';
import { ACUERDO_DEFECTO } from './liquidacionTorneo';
import { resumenPlata } from './resumenPlata';

let n = 0;
const mov = (kind: 'venta' | 'gasto', amount: number, createdAt: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `m${++n}`, kind, productId: null, variantKey: null, label: 'x', qty: 1, amount, reportedBy: 'Gastón', reverted: false, createdAt,
  paymentMethod: kind === 'venta' ? 'efectivo' : null, debtorName: null, jugadorId: null, settledAt: null, settledMethod: null,
  socioSettledAt: null, paidBy: null, ...extra,
});
const pendiente = (amount: number, venceEl: string | null, pagadoAt: string | null = null): GastoPendiente => ({
  id: `p${++n}`, label: `Gasto ${amount}`, amount, venceEl, proveedor: null, notas: null, createdBy: 'x', createdAt: '2026-11-01T00:00:00Z', pagadoAt, pagadoPor: null, ledgerId: null,
});
const socio = (imp: [number, number, number], extra: Partial<SocioMove> = {}): SocioMove => ({
  id: `s${++n}`, area: 'marca', tipo: 'gasto', periodo: null, fecha: '2026-11-01', descripcion: 'x', monto: 100, pagador: 'brian', de: null, para: null,
  moneda: 'UYU', impBrian: imp[0], impPaula: imp[1], impGaston: imp[2], source: 'web', cuotaGrupo: null, createdAt: '2026-11-01T00:00:00Z', ...extra,
});

describe('resumenPlata', () => {
  const hoy = '2026-11-24';
  const r = resumenPlata(
    [
      mov('venta', 1000, '2026-11-10T15:00:00Z'),
      mov('venta', 500, '2026-11-12T15:00:00Z', { socioSettledAt: '2026-11-13T00:00:00Z' }),
      mov('gasto', 300, '2026-11-12T15:00:00Z', { paidBy: 'gaston' }),
      mov('gasto', 200, '2026-10-30T15:00:00Z', { paidBy: 'gaston' }),
      mov('venta', 400, '2026-10-05T15:00:00Z', { paymentMethod: 'debe', debtorName: 'Pepe' }),
      mov('venta', 100, '2026-11-02T15:00:00Z', { paymentMethod: 'debe', debtorName: 'Pepe' }),
      mov('venta', 250, '2026-11-03T15:00:00Z', { paymentMethod: 'debe', debtorName: 'Ana' }),
      mov('venta', 90, '2026-11-03T15:00:00Z', { paymentMethod: 'debe', debtorName: 'Ana', settledAt: '2026-11-04T00:00:00Z' }),
      mov('venta', 9999, '2026-11-03T15:00:00Z', { reverted: true }),
    ],
    [pendiente(800, '2026-11-20'), pendiente(1200, '2026-12-01'), pendiente(300, null), pendiente(5000, '2026-11-01', '2026-11-02T00:00:00Z')],
    [socio([-50, 25, 25]), socio([100, -50, -50]), socio([999, 0, 0], { moneda: 'ARS' }), socio([400, 0, 0], { fecha: '2027-03-01', cuotaGrupo: 'c1' })],
    [{
      id: 'l1',
      liq: { nombre: 'Palos', acuerdo: { ...ACUERDO_DEFECTO }, inscripciones: [{ id: 'a', nombre: 'A', total: 700, pagado: 700 }, { id: 'b', nombre: 'B', total: 700, pagado: 0 }], gastos: [] },
    }],
    hoy,
    new Date('2026-11-24T12:00:00Z'),
  );

  it('el mes en la Caja: sin anulados y solo noviembre', () => {
    expect(r.mes).toEqual({ ventas: 1940, gastos: 300, balance: 1640, movimientos: 6 });
  });
  it('fiados de siempre, agrupados por persona', () => {
    expect(r.porCobrar).toEqual({ total: 750, personas: 2, items: 3, desde: '2026-10-05', mayores: [{ nombre: 'Pepe', total: 500 }, { nombre: 'Ana', total: 250 }] });
  });
  it('lo que falta pagar: vencidos y el próximo vencimiento', () => {
    expect(r.porPagar).toEqual({ total: 2300, n: 3, vencidos: 1, proximo: { label: 'Gasto 800', venceEl: '2026-11-20', amount: 800 } });
  });
  it('lo que todavía no pasó a las cuentas entre socios', () => {
    expect(r.sinLiquidar).toEqual({ ventas: 1840, gastos: 500, n: 7, desde: '2026-10-05', gastosPor: [{ quien: 'gaston', monto: 500 }] });
  });
  it('saldos entre socios: solo pesos y sin las cuotas que todavía no vencen', () => {
    expect(r.socios).toEqual([{ nombre: 'brian', saldo: 50 }, { nombre: 'paula', saldo: -25 }, { nombre: 'gaston', saldo: -25 }]);
  });
  it('una fila por campeonato', () => {
    expect(r.torneos).toEqual([{ id: 'l1', nombre: 'Palos', saldoClub: 440, porCobrar: 700, netoVolea: 960, club: 'Pickleball City' }]);
  });
});
