import { describe, expect, it } from 'vitest';
import { partesReparto, resumenCaja, saldoCaja, type CajaVoleaMov } from './cajaVolea';

const mov = (c: Partial<CajaVoleaMov>): CajaVoleaMov => ({
  id: 'm', createdAt: '2026-10-15T10:00:00Z', fecha: '2026-10-15', tipo: 'venta', monto: 0,
  descripcion: '', socio: null, contado: null, reportedBy: 'x', ...c,
});

describe('caja VOLEA', () => {
  it('el saldo suma entradas y salidas, y el conteo ajusta la diferencia', () => {
    const movs = [
      mov({ createdAt: '2026-10-01T00:00:00Z', tipo: 'conteo', monto: 10000, contado: 10000 }),
      mov({ createdAt: '2026-10-02T00:00:00Z', tipo: 'venta', monto: 3000 }),
      mov({ createdAt: '2026-10-03T00:00:00Z', tipo: 'gasto', monto: -1500 }),
      mov({ createdAt: '2026-10-04T00:00:00Z', tipo: 'retiro', monto: -9500, socio: 'gaston' }),
    ];
    expect(saldoCaja(movs)).toBe(2000);
    const r = resumenCaja(movs);
    expect(r.ultimoConteo?.contado).toBe(10000);
    expect(r.entradas).toBe(3000);
    expect(r.salidas).toBe(11000);
  });

  it('un conteo nuevo deja el saldo en lo contado', () => {
    const movs = [mov({ monto: 2000 }), mov({ createdAt: '2026-10-16T00:00:00Z', tipo: 'conteo', monto: -150, contado: 1850 })];
    expect(saldoCaja(movs)).toBe(1850);
  });

  it('el reparto suma exacto el monto', () => {
    expect(partesReparto(1001)).toEqual({ brian: 500.5, paula: 250.25, gaston: 250.25 });
    const p = partesReparto(333.33);
    expect(Math.round((p.brian + p.paula + p.gaston) * 100) / 100).toBe(333.33);
  });
});
