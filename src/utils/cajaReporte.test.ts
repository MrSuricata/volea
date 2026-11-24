import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../types';
import {
  diaMvd, diasEntre, enRango, estadisticasCaja, itemVendido, mesAnterior, rangoAnterior, rangoDePeriodo, textoRango, variacion,
} from './cajaReporte';

let n = 0;
const mov = (kind: 'venta' | 'gasto', amount: number, createdAt: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `m${++n}`, kind, productId: null, variantKey: null, label: kind === 'venta' ? 'Empanada' : 'Hielo', qty: 1, amount,
  reportedBy: 'Gastón', reverted: false, createdAt, paymentMethod: kind === 'venta' ? 'efectivo' : null, debtorName: null,
  jugadorId: null, settledAt: null, settledMethod: null, socioSettledAt: null, paidBy: null, ...extra,
});

describe('días de Montevideo', () => {
  it('una venta de las 23:30 de Montevideo es de ese día, no del siguiente', () => {
    expect(diaMvd('2026-11-24T02:30:00.000Z')).toBe('2026-11-23');
    expect(diaMvd('2026-11-24T03:00:00.000Z')).toBe('2026-11-24');
    expect(diaMvd('cualquiera')).toBe('');
  });
});

describe('rangoDePeriodo', () => {
  const hoy = '2026-11-24';
  it('los períodos fijos', () => {
    expect(rangoDePeriodo('hoy', hoy)).toEqual({ desde: hoy, hasta: hoy });
    expect(rangoDePeriodo('7d', hoy)).toEqual({ desde: '2026-11-18', hasta: hoy });
    expect(rangoDePeriodo('30d', hoy)).toEqual({ desde: '2026-10-26', hasta: hoy });
    expect(rangoDePeriodo('mes', hoy)).toEqual({ desde: '2026-11-01', hasta: hoy });
    expect(rangoDePeriodo('todo', hoy)).toEqual({ desde: null, hasta: null });
  });
  it('fechas a mano: al revés se dan vuelta y un extremo vacío queda abierto', () => {
    expect(rangoDePeriodo('rango', hoy, '2026-10-20', '2026-11-23')).toEqual({ desde: '2026-10-20', hasta: '2026-11-23' });
    expect(rangoDePeriodo('rango', hoy, '2026-11-23', '2026-10-20')).toEqual({ desde: '2026-10-20', hasta: '2026-11-23' });
    expect(rangoDePeriodo('rango', hoy, '', '2026-11-23')).toEqual({ desde: null, hasta: '2026-11-23' });
    expect(rangoDePeriodo('rango', hoy, 'x', null)).toEqual({ desde: null, hasta: null });
  });
  it('mes anterior, también cruzando el año', () => {
    expect(mesAnterior(hoy)).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(mesAnterior('2027-01-05')).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' });
  });
  it('el tramo anterior tiene el mismo largo', () => {
    expect(diasEntre('2026-10-20', '2026-11-23')).toBe(35);
    expect(rangoAnterior({ desde: '2026-10-20', hasta: '2026-11-23' })).toEqual({ desde: '2026-09-15', hasta: '2026-10-19' });
    expect(rangoAnterior({ desde: null, hasta: '2026-11-23' })).toBeNull();
  });
  it('se lee como se dice', () => {
    expect(textoRango({ desde: '2026-10-20', hasta: '2026-11-23' })).toBe('20/10 al 23/11/2026');
    expect(textoRango({ desde: '2025-12-20', hasta: '2026-01-05' })).toBe('20/12/2025 al 5/1/2026');
    expect(textoRango({ desde: '2026-11-23', hasta: '2026-11-23' })).toBe('el 23/11/2026');
    expect(textoRango({ desde: null, hasta: null })).toBe('todo el historial');
  });
});

describe('enRango', () => {
  const r = { desde: '2026-10-20', hasta: '2026-11-23' };
  it('los dos extremos entran, mirando el día de Montevideo', () => {
    expect(enRango('2026-10-20T03:00:00.000Z', r)).toBe(true); // 00:00 del 20
    expect(enRango('2026-10-20T02:59:00.000Z', r)).toBe(false); // 23:59 del 19
    expect(enRango('2026-11-24T02:59:00.000Z', r)).toBe(true); // 23:59 del 23
    expect(enRango('2026-11-24T03:00:00.000Z', r)).toBe(false);
  });
});

describe('estadisticasCaja', () => {
  const rango = { desde: '2026-11-16', hasta: '2026-11-22' }; // lunes a domingo
  const movs = [
    mov('venta', 1000, '2026-11-16T15:00:00.000Z', { paymentMethod: 'mp', productId: 'remera', label: 'Remera VOLEA', qty: 2 }),
    mov('venta', 500, '2026-11-16T16:00:00.000Z', { paymentMethod: 'mp', productId: 'remera', label: 'Remera VOLEA', socioSettledAt: '2026-11-17T00:00:00Z' }),
    mov('venta', 100, '2026-11-21T15:00:00.000Z'),
    mov('venta', 100, '2026-11-21T15:05:00.000Z', { label: 'empanada', reportedBy: 'Brian' }),
    mov('venta', 240, '2026-11-21T18:00:00.000Z', { label: 'Cerveza', paymentMethod: 'debe', debtorName: 'Pepe' }),
    mov('venta', 80, '2026-11-22T18:00:00.000Z', { label: 'Agua', paymentMethod: 'debe', debtorName: 'Ana', settledAt: '2026-11-23T00:00:00Z', settledMethod: 'efectivo' }),
    mov('gasto', 300, '2026-11-20T12:00:00.000Z', { paidBy: 'gaston' }),
    mov('gasto', 200, '2026-11-21T12:00:00.000Z', { label: 'HIELO', paidBy: 'caja' }),
    mov('gasto', 900, '2026-11-21T12:00:00.000Z', { label: 'Medallas' }),
    mov('venta', 5000, '2026-11-21T12:00:00.000Z', { reverted: true }),
    mov('venta', 7777, '2026-11-23T12:00:00.000Z'), // fuera del rango
  ];
  const s = estadisticasCaja(movs, rango);

  it('totales, sin anulados ni lo de afuera', () => {
    expect([s.ventas, s.gastos, s.balance]).toEqual([2020, 1400, 620]);
    expect([s.nVentas, s.nGastos]).toEqual([6, 3]);
    expect(s.anulados).toEqual({ n: 1, monto: 5000 });
    expect(s.ticketPromedio).toBe(336.67);
    expect([s.dias, s.diasConVentas]).toEqual([7, 3]);
    expect(s.mejorDia).toEqual({ dia: '2026-11-16', ventas: 1500 });
  });
  it('un tramo por día, también los días sin nada', () => {
    expect(s.granularidad).toBe('dia');
    expect(s.serie.map((t) => [t.etiqueta, t.ventas, t.gastos])).toEqual([
      ['16/11', 1500, 0], ['17/11', 0, 0], ['18/11', 0, 0], ['19/11', 0, 0], ['20/11', 0, 300], ['21/11', 440, 1100], ['22/11', 80, 0],
    ]);
    expect(s.porDiaSemana.map((d) => d.ventas)).toEqual([1500, 0, 0, 0, 0, 440, 80]);
  });
  it('por método, por producto y catálogo contra sueltos', () => {
    expect(s.porMetodo).toEqual([
      { metodo: 'mp', monto: 1500, n: 2 }, { metodo: 'efectivo', monto: 200, n: 2 },
      { metodo: 'debe-cobrado', monto: 80, n: 1 }, { metodo: 'debe-pendiente', monto: 240, n: 1 },
    ]);
    expect(s.catalogo).toEqual({ monto: 1500, n: 2 });
    expect(s.sueltos).toEqual({ monto: 520, n: 4 });
    expect(s.productos.slice(0, 3)).toEqual([
      { nombre: 'Remera VOLEA', catalogo: true, unidades: 3, monto: 1500, n: 2 },
      { nombre: 'Cerveza', catalogo: false, unidades: 1, monto: 240, n: 1 },
      { nombre: 'Empanada', catalogo: false, unidades: 2, monto: 200, n: 2 }, // "Empanada" y "empanada" son lo mismo
    ]);
  });
  it('gastos por concepto y por quién puso la plata', () => {
    expect(s.gastosPorConcepto).toEqual([{ nombre: 'Medallas', monto: 900, n: 1 }, { nombre: 'Hielo', monto: 500, n: 2 }]);
    expect(s.gastosPorPagador).toEqual([{ quien: null, monto: 900, n: 1 }, { quien: 'gaston', monto: 300, n: 1 }, { quien: 'caja', monto: 200, n: 1 }]);
    expect(s.porPersona).toEqual([{ nombre: 'Gastón', ventas: 1920, gastos: 1400, n: 8 }, { nombre: 'Brian', ventas: 100, gastos: 0, n: 1 }]);
    expect(s.sinLiquidar).toEqual({ ventas: 1520, gastos: 1400, n: 8 });
  });
  it('rangos largos se agrupan por semana y por mes; sin tope, de la primera a la última fecha', () => {
    const largo = estadisticasCaja(movs, { desde: '2026-09-01', hasta: '2026-11-23' });
    expect(largo.granularidad).toBe('semana');
    expect(largo.serie[0].clave).toBe('2026-08-31'); // el lunes de esa semana
    expect(largo.serie.reduce((t, x) => t + x.ventas, 0)).toBe(largo.ventas);
    expect(estadisticasCaja(movs, { desde: '2026-01-01', hasta: '2026-11-23' }).serie.map((t) => t.etiqueta).slice(-2)).toEqual(['oct 26', 'nov 26']);
    const todo = estadisticasCaja(movs, { desde: null, hasta: null });
    expect([todo.desde, todo.hasta, todo.dias]).toEqual(['2026-11-16', '2026-11-23', 8]);
  });
  it('sin movimientos no rompe', () => {
    const v = estadisticasCaja([], { desde: null, hasta: null });
    expect([v.ventas, v.dias, v.serie.length, v.mejorDia]).toEqual([0, 0, 0, null]);
  });
});

describe('itemVendido', () => {
  const de = (label: string, extra: Partial<LedgerEntry> = {}) => itemVendido(mov('venta', 100, '2026-11-16T15:00:00.000Z', { label, ...extra }));
  it('junta inscripciones y pedidos, y lee las unidades de "2× Llavero"', () => {
    expect(de('Inscripción: PABLO BARRERA')).toEqual({ clave: 's:inscripciones', nombre: 'Inscripciones', unidades: 1 });
    expect(de('Inscripción: LUIS BAUTISTA (pago parcial)').clave).toBe('s:inscripciones');
    expect(de('Pedido VO-MULK7P1S: VOLEA by Pickleball').nombre).toBe('Pedidos de la web');
    expect(de('2× Llavero')).toEqual({ clave: de('llavero').clave, nombre: 'Llavero', unidades: 2 });
    expect(de('3× Electrolitos + 3× Gomitas').unidades).toBe(1); // un combo no se desarma
    expect(de('Remera', { productId: 'r1', qty: 3 })).toEqual({ clave: 'p:r1', nombre: 'Remera', unidades: 3 });
  });
});

describe('variacion', () => {
  it('en porcentaje, y nada si antes no hubo', () => {
    expect(variacion(150, 100)).toBe(50);
    expect(variacion(50, 100)).toBe(-50);
    expect(variacion(50, 0)).toBeNull();
  });
});
