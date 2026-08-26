import { describe, expect, it } from 'vitest';
import { armarFilasPagos, armarFilasPlanilla, nivelSheet } from './inscripcionesExcel';
import type { Inscripcion, TarifaEvento } from '../types';

const base = {
  celular: '', email: '', duprId: '', notas: '', estado: 'pendiente' as const,
  createdAt: '2026-08-15T12:00:00Z', eventId: 'evt', pareja: '',
  pagoCosto: null, pagoMonto: null, pagoMetodo: null, pagoDeuda: null, pagoAt: null,
};
const insc = (id: string, nombre: string, categorias: string, parejas: Record<string, string> = {}): Inscripcion =>
  ({ ...base, id, nombre, categorias, parejas });

describe('nivelSheet (mapeo inverso al de la planilla)', () => {
  it('dobles y singles con género', () => {
    expect(nivelSheet('Doble Masculino A')).toBe('MASC A');
    expect(nivelSheet('Doble Femenino +50')).toBe('FEM +50');
    expect(nivelSheet('Doble Mixto C')).toBe('MIXTO C');
    expect(nivelSheet('Singles Femenino B')).toBe('SINGLE FEM B');
    expect(nivelSheet('Singles Masculino +50')).toBe('SINGLE MASC +50');
  });
  it('categoría desconocida queda tal cual', () => {
    expect(nivelSheet('Rara X')).toBe('Rara X');
  });
});

describe('armarFilasPlanilla', () => {
  it('numera duplas globales, marca CONFIRMAR y mapea estados', () => {
    const filas = [
      insc('1', 'A', 'Doble Masculino A', { 'Doble Masculino A': 'B' }),
      { ...insc('2', 'B', 'Doble Masculino A', { 'Doble Masculino A': 'A' }), estado: 'confirmada' as const },
      insc('3', 'C', 'Doble Masculino A, Singles Masculino B', { 'Doble Masculino A': 'Externo X' }),
      insc('4', 'D', 'Doble Femenino C'),
    ];
    const r = armarFilasPlanilla(filas, ['Doble Masculino A', 'Doble Femenino C', 'Singles Masculino B']);
    expect(r.dobles[0]).toEqual(['1', 'A', '', 'MASC A', 'Pendiente']);
    expect(r.dobles[1]).toEqual(['', 'B', '', 'MASC A', 'Pagado']);
    expect(r.dobles[2]).toEqual(['2', 'C', '', 'MASC A', 'Pendiente']);
    expect(r.dobles[3]).toEqual(['', 'Externo X', '', 'MASC A', '']);
    expect(r.dobles[4]).toEqual(['3', 'D', '', 'FEM C', 'Pendiente']);
    expect(r.dobles[5]).toEqual(['', 'CONFIRMAR', '', 'FEM C', '']);
    expect(r.singles[0]).toEqual(['1', 'C', '', 'SINGLE MASC B', 'Pendiente']);
  });

  it('lleva el celular de cada inscripto y excluye bajas', () => {
    const filas = [
      { ...insc('1', 'A', 'Singles Masculino A'), celular: '099111222' },
      { ...insc('2', 'Baja', 'Singles Masculino A'), estado: 'baja' as const },
    ];
    const r = armarFilasPlanilla(filas, ['Singles Masculino A']);
    expect(r.singles).toEqual([['1', 'A', '099111222', 'SINGLE MASC A', 'Pendiente']]);
  });
});

describe('armarFilasPagos', () => {
  const tarifa: TarifaEvento = { base: 700, incluye: 1, extra: 500 };

  it('una fila por persona (alfabético, sin bajas) con debería/pagó/debe y TOTAL', () => {
    const filas = [
      { ...insc('1', 'ZULMA', 'Doble Femenino C'), pagoCosto: 700, pagoMonto: 700, pagoDeuda: 0, pagoMetodo: 'efectivo' as const, pagoAt: '2026-08-23T14:00:00Z' },
      { ...insc('2', 'ANA', 'Doble Femenino C, Singles Femenino A'), pagoCosto: 1200, pagoMonto: 800, pagoDeuda: 400, pagoMetodo: 'transferencia' as const, pagoAt: '2026-08-23T15:00:00Z' },
      insc('3', 'CARLA', 'Doble Femenino C'),
      { ...insc('4', 'BAJA', 'Doble Femenino C'), estado: 'baja' as const },
      { ...insc('5', 'FREE', 'Doble Femenino C'), pagoMonto: 0, pagoDeuda: 0, pagoMetodo: 'freepass' as const, pagoAt: '2026-08-23T10:00:00Z' },
    ];
    const r = armarFilasPagos(filas, tarifa);
    expect(r.map(f => f[0])).toEqual(['ANA', 'CARLA', 'FREE', 'ZULMA', 'TOTAL']);
    expect(r[0]).toEqual(['ANA', 2, 'FEM C, SINGLE FEM A', 1200, 'Parcial', 800, 400, 'Transferencia', '23/08']);
    // Sin pago registrado: debe todo lo que le corresponde por tarifa.
    expect(r[1]).toEqual(['CARLA', 1, 'FEM C', 700, 'SIN REGISTRAR', 0, 700, '', '']);
    expect(r[2]).toEqual(['FREE', 1, 'FEM C', 0, 'Free pass', 0, 0, 'Free pass', '23/08']);
    expect(r[3]).toEqual(['ZULMA', 1, 'FEM C', 700, 'Pagado', 700, 0, 'Efectivo', '23/08']);
    expect(r[4]).toEqual(['TOTAL', '', '', 2600, '', 1500, 1100, '', '']);
  });

  it('sin tarifa y sin pago registrado, el debería queda en 0', () => {
    const r = armarFilasPagos([insc('1', 'A', 'Doble Femenino C')], null);
    expect(r[0]).toEqual(['A', 1, 'FEM C', 0, 'SIN REGISTRAR', 0, 0, '', '']);
  });
});
