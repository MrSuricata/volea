import { describe, expect, it } from 'vitest';
import { distancia, faltantesEnPadron, normalizar, sugerirDeudores } from './nombres';

describe('faltantesEnPadron', () => {
  it('detecta los que no están (sin tildes/mayúsculas), dedup interno y saltea vacíos', () => {
    const padron = ['GASTON MOIRANO', 'Ana López'];
    expect(faltantesEnPadron(['gastón moirano', 'ana lopez', 'Nuevo Uno', 'NUEVO UNO', '  '], padron))
      .toEqual(['Nuevo Uno']);
  });
  it('matchea también contra alias (vienen aplanados en la lista del padrón)', () => {
    expect(faltantesEnPadron(['GASTÓN MOIRANO'], ['GASTON MOIRANO', 'GASTÓN MOIRANO'])).toEqual([]);
  });
});

describe('normalizar / distancia (movidos del motor de torneos)', () => {
  it('saca tildes, mayúsculas y espacios repetidos', () => {
    expect(normalizar('  Hernán  BONJOUR ')).toBe('hernan bonjour');
    expect(normalizar('GASTÓN')).toBe('gaston');
    expect(normalizar('Ñandú')).toBe('nandu');
  });
  it('distancia de edición clásica', () => {
    expect(distancia('gaston', 'gaston')).toBe(0);
    expect(distancia('moirano', 'moriano')).toBe(2);
    expect(distancia('ana', 'anna')).toBe(1);
  });
});

describe('sugerirDeudores', () => {
  const abiertos = [
    { nombre: 'Hernán Bonjour', saldo: 300 },
    { nombre: 'Lucía De Feo', saldo: 150 },
  ];
  const otros = ['Gastón Moirano', 'Mario Neves', 'María Gladys González'];

  it('con texto vacío devuelve los deudores abiertos tal cual', () => {
    const s = sugerirDeudores(abiertos, otros, '');
    expect(s.map(x => x.nombre)).toEqual(['Hernán Bonjour', 'Lucía De Feo']);
    expect(s[0].saldo).toBe(300);
  });

  it('matchea sin tildes y por prefijo, abiertos primero', () => {
    const s = sugerirDeudores(abiertos, otros, 'hernan');
    expect(s[0]).toEqual({ nombre: 'Hernán Bonjour', saldo: 300 });
  });

  it('tolera typos de hasta distancia 2 en alguna palabra', () => {
    const s = sugerirDeudores(abiertos, otros, 'moriano');
    expect(s.some(x => x.nombre === 'Gastón Moirano')).toBe(true);
  });

  it('deduplica por nombre normalizado y corta en 6', () => {
    const muchos = Array.from({ length: 10 }, (_, i) => `Jugador Número ${i}`);
    expect(sugerirDeudores([], muchos, 'jugador').length).toBe(6);
    const s = sugerirDeudores(abiertos, ['HERNAN BONJOUR'], 'hern');
    expect(s.filter(x => normalizar(x.nombre) === 'hernan bonjour').length).toBe(1);
  });

  it('sin match devuelve vacío', () => {
    expect(sugerirDeudores(abiertos, otros, 'zzz')).toEqual([]);
  });

  it('palabras cortas no disparan el fuzzy (evita ruido con 2-3 letras)', () => {
    // 'nes' está a distancia 2 de 'neves' pero con <4 letras el fuzzy no corre
    // (y no es substring de ningún candidato).
    expect(sugerirDeudores(abiertos, otros, 'nes')).toEqual([]);
  });
});
