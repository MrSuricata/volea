import { describe, expect, it } from 'vitest';
import { historialDeJugador, nombresSinVincular } from './jugadores';
import type { LedgerEntry } from '../types';

const fila = (p: Partial<LedgerEntry>): LedgerEntry => ({
  id: p.id || 'x', kind: 'venta', productId: null, variantKey: null,
  label: p.label || 'Cookie', qty: 1, amount: p.amount ?? 100, reportedBy: 'Web',
  reverted: p.reverted ?? false, createdAt: p.createdAt || '2026-08-10T12:00:00Z',
  paymentMethod: p.paymentMethod ?? 'efectivo', debtorName: p.debtorName ?? null,
  jugadorId: p.jugadorId ?? null, settledAt: p.settledAt ?? null, settledMethod: null,
  socioSettledAt: null, paidBy: null,
  ...p,
});

const jugador = { id: 'j1', nombre: 'LUIS CONDE', alias: ['Luis conde'], duprId: null };

describe('historialDeJugador', () => {
  it('une lo vinculado por id con lo viejo por nombre (sin tildes) y ordena por fecha desc', () => {
    const ledger = [
      fila({ id: 'a', jugadorId: 'j1', label: 'Cookie', createdAt: '2026-08-01T10:00:00Z' }),
      fila({ id: 'b', debtorName: 'luis conde', paymentMethod: 'debe', label: 'Cerveza', amount: 240, createdAt: '2026-08-05T10:00:00Z' }),
      fila({ id: 'c', debtorName: 'Otro', paymentMethod: 'debe', label: 'Agua' }),
      fila({ id: 'd', jugadorId: 'j2', label: 'Pizza' }),
    ];
    const h = historialDeJugador(jugador, ledger);
    expect(h.movimientos.map(m => m.id)).toEqual(['b', 'a']);
    expect(h.totalComprado).toBe(340);
  });

  it('la deuda abierta suma solo fiados sin cobrar y no cuenta anuladas', () => {
    const ledger = [
      fila({ id: 'a', jugadorId: 'j1', paymentMethod: 'debe', amount: 300 }),
      fila({ id: 'b', jugadorId: 'j1', paymentMethod: 'debe', amount: 200, settledAt: '2026-08-12T10:00:00Z' }),
      fila({ id: 'c', jugadorId: 'j1', paymentMethod: 'debe', amount: 999, reverted: true }),
      fila({ id: 'd', jugadorId: 'j1', paymentMethod: 'efectivo', amount: 100 }),
    ];
    const h = historialDeJugador(jugador, ledger);
    expect(h.deudaAbierta).toBe(300);
    expect(h.totalComprado).toBe(600); // 300 + 200 + 100, sin la anulada
    expect(h.movimientos).toHaveLength(3);
  });

  it('matchea también por alias del padrón', () => {
    const h = historialDeJugador(jugador, [fila({ id: 'a', debtorName: 'Luis conde', paymentMethod: 'debe' })]);
    expect(h.movimientos).toHaveLength(1);
  });
});

describe('nombresSinVincular', () => {
  const ledger = [
    fila({ id: 'a', debtorName: 'Luis conde', paymentMethod: 'debe', amount: 200 }),
    fila({ id: 'b', debtorName: 'luis b', paymentMethod: 'debe', amount: 100, settledAt: '2026-08-11T10:00:00Z' }),
    fila({ id: 'c', debtorName: 'TROYA', paymentMethod: 'debe', amount: 900, jugadorId: 'j9' }),
    fila({ id: 'd', debtorName: null, paymentMethod: 'efectivo' }),
    fila({ id: 'e', debtorName: 'Luis conde', paymentMethod: 'debe', amount: 300 }),
  ];

  it('agrupa por nombre exacto los que no tienen jugador, con saldo y cantidad', () => {
    const sin = nombresSinVincular(ledger, []);
    expect(sin.map(s => s.nombre)).toEqual(['Luis conde', 'luis b']);
    expect(sin[0]).toMatchObject({ movimientos: 2, saldo: 500 });
    expect(sin[1]).toMatchObject({ movimientos: 1, saldo: 0 });
  });

  it('los marcados como "no es jugador" quedan fuera', () => {
    expect(nombresSinVincular(ledger, ['luis b']).map(s => s.nombre)).toEqual(['Luis conde']);
  });
});
