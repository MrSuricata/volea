import { describe, expect, it } from 'vitest';
import { borradosSiCorrijo } from '../engine/llave';
import type { PartidoLlave } from '../engine/tipos';
import { limpiarPuntos, marcadorCambio, puntosDeTexto, textoDeMarcador, textoDePuntos } from './marcador';

describe('limpiarPuntos', () => {
  it('deja solo dígitos y corta en 2', () => {
    expect(limpiarPuntos('11')).toBe('11');
    expect(limpiarPuntos(' 7a')).toBe('7');
    expect(limpiarPuntos('1.5')).toBe('15');
    expect(limpiarPuntos('-3')).toBe('3');
    expect(limpiarPuntos('150')).toBe('15');
    expect(limpiarPuntos('')).toBe('');
  });
});

describe('puntosDeTexto / textoDePuntos', () => {
  it('vacío es null (sin cargar), como el input viejo', () => {
    expect(puntosDeTexto('')).toBeNull();
    expect(puntosDeTexto('  ')).toBeNull();
  });
  it('lee enteros, con cero adelante incluido', () => {
    expect(puntosDeTexto('0')).toBe(0);
    expect(puntosDeTexto('07')).toBe(7);
    expect(puntosDeTexto('11')).toBe(11);
  });
  it('ida y vuelta', () => {
    expect(textoDePuntos(null)).toBe('');
    expect(textoDePuntos(0)).toBe('0');
    expect(textoDeMarcador(11, null)).toEqual({ a: '11', b: '' });
  });
});

describe('marcadorCambio', () => {
  it('no marca cambio si el borrador dice lo mismo que lo guardado', () => {
    expect(marcadorCambio({ a: '11', b: '7' }, 11, 7)).toBe(false);
    expect(marcadorCambio({ a: '11', b: '07' }, 11, 7)).toBe(false);
    expect(marcadorCambio({ a: '', b: '' }, null, null)).toBe(false);
  });
  it('marca cambio si cualquiera de los dos lados difiere', () => {
    expect(marcadorCambio({ a: '11', b: '9' }, 11, 7)).toBe(true);
    expect(marcadorCambio({ a: '11', b: '' }, 11, 7)).toBe(true);
    expect(marcadorCambio({ a: '0', b: '' }, null, null)).toBe(true);
  });
});

// Por qué existe el borrador: corregir 11-7 → 11-9 tecla por tecla pasaba por "11 a nada"
// y el motor lo tomaba como cambio de ganador (y pedía borrar la ronda siguiente). Con
// el borrador se consulta al motor UNA vez, con el resultado final.
describe('corrección en la llave con borrador', () => {
  const seed = (parejaId: string) => ({ tipo: 'seed' as const, parejaId });
  const partidos: PartidoLlave[] = [
    { id: 's1', ronda: 1, posicion: 0, a: seed('p1'), b: seed('p2'), puntosA: 11, puntosB: 7, esTercerPuesto: false },
    { id: 's2', ronda: 1, posicion: 1, a: seed('p3'), b: seed('p4'), puntosA: 11, puntosB: 5, esTercerPuesto: false },
    {
      id: 'f', ronda: 2, posicion: 0, a: { tipo: 'ganadorDe', partidoId: 's1' }, b: { tipo: 'ganadorDe', partidoId: 's2' },
      puntosA: 11, puntosB: 9, esTercerPuesto: false,
    },
  ];

  it('tecla por tecla, el paso intermedio "11 a nada" pedía borrar la final', () => {
    const intermedio = { a: '11', b: '' };
    expect(borradosSiCorrijo(partidos, 's1', puntosDeTexto(intermedio.a), puntosDeTexto(intermedio.b))).toBe(1);
  });

  it('con el borrador se consulta una vez con 11-9: mismo ganador, no borra nada', () => {
    const final = { a: '11', b: '9' };
    expect(marcadorCambio(final, 11, 7)).toBe(true);
    expect(borradosSiCorrijo(partidos, 's1', puntosDeTexto(final.a), puntosDeTexto(final.b))).toBe(0);
  });

  it('si la corrección SÍ da vuelta el ganador, sigue avisando (se confirma antes de guardar)', () => {
    expect(borradosSiCorrijo(partidos, 's1', 7, 11)).toBe(1);
  });
});
