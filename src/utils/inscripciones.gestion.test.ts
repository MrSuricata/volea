import { describe, expect, it } from 'vitest';
import {
  armarSeccionesCategoria, buscanPareja, faltaInscribirse, generoDe, resumenArmado,
  MIN_UNIDADES_VIABLE,
} from './inscripciones';
import type { Inscripcion } from '../types';

const base = {
  celular: '', email: '', duprId: '', notas: '', estado: 'pendiente' as const,
  createdAt: '2026-08-15T12:00:00Z', eventId: 'evt', pareja: '',
};
const insc = (id: string, nombre: string, categorias: string, parejas: Record<string, string> = {}): Inscripcion =>
  ({ ...base, id, nombre, categorias, parejas });

describe('generoDe', () => {
  it('infiere por las categorías que juega', () => {
    expect(generoDe(insc('1', 'Ana', 'Doble Femenino B, Doble Mixto A'))).toBe('F');
    expect(generoDe(insc('2', 'Juan', 'Singles Masculino A'))).toBe('M');
    expect(generoDe(insc('3', 'X', 'Doble Mixto A'))).toBe(null);
    expect(generoDe(insc('4', 'Raro', 'Doble Femenino A, Doble Masculino A'))).toBe(null);
  });
});

describe('resumenArmado (umbral 4)', () => {
  it('dobles: mutuas + declaradas = unidades; singles: personas', () => {
    const filas = [
      insc('1', 'A', 'Doble Masculino B', { 'Doble Masculino B': 'B' }),
      insc('2', 'B', 'Doble Masculino B', { 'Doble Masculino B': 'A' }),
      insc('3', 'C', 'Doble Masculino B', { 'Doble Masculino B': 'Externo' }),
      insc('4', 'D', 'Doble Masculino B'),
      insc('5', 'S', 'Singles Masculino A'),
    ];
    const secs = armarSeccionesCategoria(filas, ['Doble Masculino B', 'Singles Masculino A']);
    const r = resumenArmado(secs, filas);
    const masc = r.find(x => x.categoria === 'Doble Masculino B')!;
    expect(masc).toMatchObject({ duplasArmadas: 1, duplasDeclaradas: 1, buscanPareja: 1, unidades: 2, nivel: 'ambar' });
    const sing = r.find(x => x.categoria === 'Singles Masculino A')!;
    expect(sing).toMatchObject({ unidades: 1, nivel: 'gris' });
  });

  it('verde con >= MIN_UNIDADES_VIABLE', () => {
    const filas = Array.from({ length: 4 }, (_, i) => insc(String(i), `J${i}`, 'Singles Masculino A'));
    const r = resumenArmado(armarSeccionesCategoria(filas, ['Singles Masculino A']), filas);
    expect(MIN_UNIDADES_VIABLE).toBe(4);
    expect(r[0].nivel).toBe('verde');
  });

  it('categoría vacía queda gris con cero unidades', () => {
    const r = resumenArmado(armarSeccionesCategoria([], ['Doble Mixto C']), []);
    expect(r[0]).toMatchObject({ unidades: 0, nivel: 'gris', totalPersonas: 0 });
  });
});

describe('buscanPareja + cruces', () => {
  it('en categorías de género sugiere cualquier par; en mixto respeta género inferido', () => {
    const filas = [
      insc('1', 'Yesica', 'Doble Femenino A, Doble Mixto B'),
      insc('2', 'Paula', 'Doble Femenino A, Doble Mixto B'),
      insc('3', 'Franco', 'Doble Masculino B, Doble Mixto B'),
    ];
    const b = buscanPareja(armarSeccionesCategoria(filas, ['Doble Femenino A', 'Doble Mixto B']), filas);
    const femA = b.find(x => x.categoria === 'Doble Femenino A')!;
    expect(femA.buscan.map(i => i.nombre)).toEqual(['Yesica', 'Paula']);
    expect(femA.cruces).toContainEqual(['1', '2']);
    const mixtoB = b.find(x => x.categoria === 'Doble Mixto B')!;
    expect(mixtoB.cruces).toContainEqual(['1', '3']);
    expect(mixtoB.cruces).toContainEqual(['2', '3']);
    expect(mixtoB.cruces).not.toContainEqual(['1', '2']);
  });

  it('sin sueltos sin pareja no devuelve la categoría', () => {
    const filas = [insc('1', 'A', 'Doble Femenino A', { 'Doble Femenino A': 'B' })];
    expect(buscanPareja(armarSeccionesCategoria(filas, ['Doble Femenino A']), filas)).toEqual([]);
  });
});

describe('faltaInscribirse', () => {
  it('lista parejas declaradas sin inscripción propia, agrupadas sin duplicar', () => {
    const filas = [
      insc('1', 'Ana', 'Doble Femenino A', { 'Doble Femenino A': 'Bea Externa' }),
      insc('2', 'Cami', 'Doble Femenino B', { 'Doble Femenino B': 'BEA EXTERNA' }),
      insc('3', 'Dani', 'Doble Mixto A', { 'Doble Mixto A': 'Ana' }),
    ];
    const f = faltaInscribirse(filas);
    expect(f).toHaveLength(1);
    expect(f[0].nombre).toBe('Bea Externa');
    expect(f[0].declaradaPor.map(d => d.nombre)).toEqual(['Ana', 'Cami']);
  });

  it('las bajas no cuentan ni como declarantes ni como inscriptos', () => {
    const baja = { ...insc('1', 'Ana', 'Doble Femenino A', { 'Doble Femenino A': 'Externa' }), estado: 'baja' as const };
    expect(faltaInscribirse([baja])).toEqual([]);
  });
});
