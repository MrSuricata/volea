import { describe, expect, it } from 'vitest';
import { armarSeccionesCategoria, categoriasDe, parejaDe } from './inscripciones';
import type { Inscripcion } from '../types';

const base = {
  celular: '', email: '', duprId: '', notas: '', estado: 'pendiente' as const,
  createdAt: '2026-08-14T12:00:00Z', eventId: 'evt', pareja: '',
};
const insc = (id: string, nombre: string, categorias: string, parejas: Record<string, string> = {}): Inscripcion =>
  ({ ...base, id, nombre, categorias, parejas });

describe('categoriasDe', () => {
  it('splitea por coma y limpia espacios y vacíos', () => {
    expect(categoriasDe(insc('1', 'Ana', ' Doble Mixto A ,Singles A,, '))).toEqual(['Doble Mixto A', 'Singles A']);
  });
});

describe('parejaDe', () => {
  it('lee del mapa por categoría', () => {
    expect(parejaDe(insc('1', 'Ana', 'Doble Mixto A', { 'Doble Mixto A': 'Beto' }), 'Doble Mixto A')).toBe('Beto');
  });
  it('cae al texto legacy solo en categorías de dobles', () => {
    expect(parejaDe({ ...insc('2', 'Ana', 'Doble Mixto A'), pareja: 'Beto' }, 'Doble Mixto A')).toBe('Beto');
    expect(parejaDe({ ...insc('3', 'Ana', 'Singles A'), pareja: 'Beto' }, 'Singles A')).toBe('');
  });
  it('sin nada devuelve vacío', () => {
    expect(parejaDe(insc('4', 'Ana', 'Doble Mixto A'), 'Doble Mixto A')).toBe('');
  });
});

describe('armarSeccionesCategoria', () => {
  it('secciones = categorías del evento ∪ las presentes en datos, orden del evento primero', () => {
    const secs = armarSeccionesCategoria([insc('1', 'Ana', 'Rara X')], ['Doble Mixto A', 'Singles A']);
    expect(secs.map(s => s.categoria)).toEqual(['Doble Mixto A', 'Singles A', 'Rara X']);
  });

  it('arma duplas por mención mutua normalizada (tildes y mayúsculas no importan)', () => {
    const secs = armarSeccionesCategoria([
      insc('1', 'Gastón Moirano', 'Doble Masculino A', { 'Doble Masculino A': 'Brian Ridvanovich' }),
      insc('2', 'Brian Ridvanovich', 'Doble Masculino A', { 'Doble Masculino A': 'GASTON MOIRANO' }),
      insc('3', 'Suelto Pérez', 'Doble Masculino A', { 'Doble Masculino A': 'Nadie Conocido' }),
    ], ['Doble Masculino A']);
    expect(secs[0].duplas).toEqual([['1', '2']]);
    expect(secs[0].sueltos).toEqual(['3']);
    expect(secs[0].total).toBe(3);
  });

  it('la mención en una sola dirección no arma dupla', () => {
    const secs = armarSeccionesCategoria([
      insc('1', 'Ana', 'Doble Femenino B', { 'Doble Femenino B': 'Bea' }),
      insc('2', 'Bea', 'Doble Femenino B', { 'Doble Femenino B': 'Carla' }),
    ], ['Doble Femenino B']);
    expect(secs[0].duplas).toEqual([]);
    expect(secs[0].sueltos).toEqual(['1', '2']);
  });

  it('excluye bajas y nadie queda en dos duplas', () => {
    const baja = { ...insc('9', 'Baja Uno', 'Doble Mixto A'), estado: 'baja' as const };
    const secs = armarSeccionesCategoria([baja], ['Doble Mixto A']);
    expect(secs[0].total).toBe(0);
    const tri = armarSeccionesCategoria([
      insc('1', 'Ana', 'Doble Mixto A', { 'Doble Mixto A': 'Bea' }),
      insc('2', 'Bea', 'Doble Mixto A', { 'Doble Mixto A': 'Ana' }),
      insc('3', 'Ana', 'Doble Mixto A', { 'Doble Mixto A': 'Bea' }),
    ], ['Doble Mixto A']);
    const usados = tri[0].duplas.flat();
    expect(new Set(usados).size).toBe(usados.length);
  });

  it('una persona en dos categorías aparece en las dos secciones', () => {
    const secs = armarSeccionesCategoria([
      insc('1', 'Ana', 'Doble Mixto A, Singles A', { 'Doble Mixto A': 'Beto' }),
    ], ['Doble Mixto A', 'Singles A']);
    expect(secs[0].total).toBe(1);
    expect(secs[1].total).toBe(1);
  });
});
