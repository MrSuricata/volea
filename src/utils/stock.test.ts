import { describe, expect, it } from 'vitest';
import { mismoStock, modoGuardadoStock } from './stock';

describe('mismoStock', () => {
  it('una clave ausente equivale a cero', () => {
    expect(mismoStock({ 'M|Negro': 2 }, { 'M|Negro': 2, 'L|Negro': 0 })).toBe(true);
  });

  it('distingue cantidades distintas', () => {
    expect(mismoStock({ 'M|Negro': 2 }, { 'M|Negro': 1 })).toBe(false);
  });

  it('renombrar un color cambia las claves y cuenta como cambio', () => {
    expect(mismoStock({ 'L|FUCISIA': 2 }, { 'L|Fucsia': 2 })).toBe(false);
  });
});

describe('modoGuardadoStock', () => {
  it('producto nuevo manda el stock', () => {
    expect(modoGuardadoStock(undefined, { 'M|Negro': 3 })).toEqual({ modo: 'nuevo' });
  });

  it('si no tocaste el stock no se manda', () => {
    expect(modoGuardadoStock({ 'M|Negro': 3 }, { 'M|Negro': 3, 'S|Negro': 0 })).toEqual({ modo: 'sin-cambios' });
  });

  it('si lo tocaste guarda la base para comparar contra la nube', () => {
    expect(modoGuardadoStock({ 'M|Negro': 3 }, { 'M|Negro': 5 })).toEqual({ modo: 'editado', base: { 'M|Negro': 3 } });
  });
});
