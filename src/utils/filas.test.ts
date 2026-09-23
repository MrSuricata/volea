import { describe, expect, it } from 'vitest';
import { motivoBorradoFallido, quitarPorId, reemplazarOAgregar } from './filas';

describe('reemplazarOAgregar', () => {
  const lista = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];

  it('reemplaza en su lugar la fila con el mismo id', () => {
    expect(reemplazarOAgregar(lista, { id: 'a', v: 9 })).toEqual([{ id: 'a', v: 9 }, { id: 'b', v: 2 }]);
  });

  it('una fila nueva va al final', () => {
    expect(reemplazarOAgregar(lista, { id: 'c', v: 3 })).toEqual([...lista, { id: 'c', v: 3 }]);
  });

  it('no muta la lista original', () => {
    reemplazarOAgregar(lista, { id: 'a', v: 9 });
    expect(lista[0].v).toBe(1);
  });
});

describe('quitarPorId', () => {
  it('saca solo esa fila', () => {
    expect(quitarPorId([{ id: 'a' }, { id: 'b' }], 'a')).toEqual([{ id: 'b' }]);
  });

  it('si no estaba devuelve la misma lista', () => {
    const lista = [{ id: 'a' }];
    expect(quitarPorId(lista, 'x')).toBe(lista);
  });
});

describe('motivoBorradoFallido', () => {
  it('sin error es ok', () => {
    expect(motivoBorradoFallido(null)).toBe('ok');
  });

  it('la FK en RESTRICT (23503) dice que hay filas colgando', () => {
    expect(motivoBorradoFallido({ code: '23503' })).toBe('con-referencias');
  });

  it('cualquier otro fallo (RLS, timeout, red) es error', () => {
    expect(motivoBorradoFallido({ code: '42501' })).toBe('error');
    expect(motivoBorradoFallido(new Error('timeout'))).toBe('error');
  });
});
