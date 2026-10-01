import { describe, expect, it } from 'vitest';
import {
  armarSeccionesCategoria, buscanPareja, costoInscripcion, estadisticasTorneo, faltaInscribirse, generoDe, resumenArmado,
  inscripcionAbierta, textoTarifa, MIN_UNIDADES_VIABLE,
} from './inscripciones';
import type { Inscripcion } from '../types';

const base = {
  celular: '', email: '', duprId: '', notas: '', estado: 'pendiente' as const,
  createdAt: '2026-08-15T12:00:00Z', eventId: 'evt', pareja: '',
  pagoCosto: null, pagoMonto: null, pagoMetodo: null, pagoDeuda: null, pagoAt: null,
};

describe('estadisticasTorneo', () => {
  it('cuenta jugadores, géneros, la más jugada y estima partidos (2×unidades−1 por categoría jugable)', () => {
    const filas = [
      insc('1', 'Ana', 'Doble Femenino A, Doble Mixto A', { 'Doble Femenino A': 'Bea' }),
      insc('2', 'Bea', 'Doble Femenino A', { 'Doble Femenino A': 'Ana' }),
      insc('3', 'Juan', 'Doble Masculino A, Doble Mixto A'),
      insc('4', 'X Sin Genero', 'Doble Mixto A'),
    ];
    const armado = resumenArmado(armarSeccionesCategoria(filas, ['Doble Femenino A', 'Doble Mixto A', 'Doble Masculino A']), filas);
    const s = estadisticasTorneo(filas, armado);
    expect(s.jugadores).toBe(4);
    expect(s.mujeres).toBe(2);
    expect(s.hombres).toBe(1);
    expect(s.sinGenero).toBe(1);
    expect(s.masJugada).toEqual({ categoria: 'Doble Mixto A', personas: 3 });
    // Fem A: 1 dupla (unidades 1, no juega) · Mixto A: 3 sueltos sin pareja (0 unidades) ·
    // Masc A: 1 suelto (0) → ninguna llega a 2 unidades ⇒ 0 partidos estimados.
    expect(s.partidosAprox).toBe(0);
  });

  it('las bajas no cuentan y los partidos suman por categoría jugable', () => {
    const filas = [
      insc('1', 'A', 'Singles Masculino A'), insc('2', 'B', 'Singles Masculino A'),
      insc('3', 'C', 'Singles Masculino A'), insc('4', 'D', 'Singles Masculino A'),
      { ...insc('9', 'Baja', 'Singles Masculino A'), estado: 'baja' as const },
    ];
    const armado = resumenArmado(armarSeccionesCategoria(filas, ['Singles Masculino A']), filas);
    const s = estadisticasTorneo(filas, armado);
    expect(s.jugadores).toBe(4);
    expect(s.partidosAprox).toBe(7); // 2×4−1
  });
});

describe('costoInscripcion', () => {
  const tarifa = { base: 1200, incluye: 3, extra: 200 };
  it('hasta lo incluido paga la base', () => {
    expect(costoInscripcion(1, tarifa)).toBe(1200);
    expect(costoInscripcion(3, tarifa)).toBe(1200);
  });
  it('cada categoría adicional suma el extra', () => {
    expect(costoInscripcion(4, tarifa)).toBe(1400);
    expect(costoInscripcion(6, tarifa)).toBe(1800);
  });
  it('aniversario de Pickleball City: $900 las 2 primeras y $300 cada adicional', () => {
    const t = { base: 900, incluye: 2, extra: 300, max: 4 };
    expect([1, 2, 3, 4].map(n => costoInscripcion(n, t))).toEqual([900, 900, 1200, 1500]);
  });
});

describe('inscripcionAbierta', () => {
  const evt = { inscripcionesAbiertas: true, inscripcionesCierre: '2026-10-08', date: '2026-10-09', endDate: '2026-10-10' };
  it('hasta el día de cierre, inclusive, se puede', () => {
    expect(inscripcionAbierta(evt, '2026-10-01')).toBe(true);
    expect(inscripcionAbierta(evt, '2026-10-08')).toBe(true);
  });
  it('desde el día siguiente al cierre ya no', () => {
    expect(inscripcionAbierta(evt, '2026-10-09')).toBe(false);
  });
  it('sin fecha de cierre corre hasta el último día del evento', () => {
    const sinCierre = { ...evt, inscripcionesCierre: '' };
    expect(inscripcionAbierta(sinCierre, '2026-10-10')).toBe(true);
    expect(inscripcionAbierta(sinCierre, '2026-10-11')).toBe(false);
  });
  it('con el interruptor del admin apagado, nunca', () => {
    expect(inscripcionAbierta({ ...evt, inscripcionesAbiertas: false }, '2026-10-01')).toBe(false);
  });
});

describe('textoTarifa', () => {
  const plata = (n: number) => `$${n}`;
  it('dice lo que incluye la base, el adicional y el tope', () => {
    expect(textoTarifa({ base: 900, incluye: 2, extra: 300, max: 4 }, plata))
      .toBe('$900 las primeras 2 categorías · $300 cada categoría adicional · máximo 4 categorías por participante');
  });
  it('una sola categoría incluida va en singular, y sin tope no lo nombra', () => {
    expect(textoTarifa({ base: 1200, incluye: 1, extra: 200 }, plata))
      .toBe('$1200 la primera categoría · $200 cada categoría adicional');
  });
  it('sin adicional es un precio fijo', () => {
    expect(textoTarifa({ base: 600, incluye: 1, extra: 0 }, plata)).toBe('$600 la inscripción');
  });
  it('el monto no se parte entre renglones: el espacio de "$ 900" sale duro', () => {
    const texto = textoTarifa({ base: 900, incluye: 2, extra: 300 }, n => `$ ${n}`);
    expect(texto).toContain('$\u00A0900 las primeras');
    expect(texto).toContain('$\u00A0300 cada');
  });
});
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
