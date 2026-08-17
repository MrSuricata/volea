import { describe, expect, it } from 'vitest';
import { armarFilasPlanilla, nivelSheet } from './inscripcionesExcel';
import type { Inscripcion } from '../types';

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
