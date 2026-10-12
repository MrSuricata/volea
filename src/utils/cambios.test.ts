import { describe, expect, it } from 'vitest';
import { diferenciaSugerida, metodosPara, metodoValido, resumenPlata, saldosAFavor, variantesDe, type Cambio } from './cambios';

const cambio = (c: Partial<Cambio>): Cambio => ({
  id: 'c', createdAt: '2026-10-12', cliente: 'TATI', orderId: null,
  devuelveNombre: 'A', devuelveVariant: 'M', devuelvePrecio: 670,
  llevaNombre: 'B', llevaVariant: 'L', llevaPrecio: 670,
  monto: 0, metodo: 'sin_cargo', nota: null, reportedBy: 'x', saldoUsadoEl: null, ...c,
});

describe('cambios', () => {
  it('la diferencia es la nueva menos la devuelta', () => {
    expect(diferenciaSugerida(670, 900)).toBe(230);
    expect(diferenciaSugerida(900, 670)).toBe(-230);
    expect(diferenciaSugerida(670, 670)).toBe(0);
  });

  it('las opciones dependen de quién le debe a quién', () => {
    expect(metodosPara(230).map((m) => m.valor)).toEqual(['efectivo', 'transferencia', 'mp', 'debe']);
    expect(metodosPara(-230).map((m) => m.valor)).toEqual(['a_favor', 'efectivo', 'transferencia']);
    expect(metodosPara(0).map((m) => m.valor)).toEqual(['sin_cargo']);
  });

  it('al cambiar el monto a mano, el método se ajusta si deja de valer', () => {
    expect(metodoValido(230, 'transferencia')).toBe('transferencia');
    expect(metodoValido(0, 'transferencia')).toBe('sin_cargo');
    expect(metodoValido(-100, 'debe')).toBe('a_favor');
    expect(metodoValido(100, null)).toBe('efectivo');
  });

  it('resume cómo quedó la plata', () => {
    expect(resumenPlata({ monto: 0, metodo: 'sin_cargo', saldoUsadoEl: null })).toBe('Sin cargo');
    expect(resumenPlata({ monto: 230, metodo: 'debe', saldoUsadoEl: null })).toBe('Debe $ 230');
    expect(resumenPlata({ monto: -230, metodo: 'a_favor', saldoUsadoEl: null })).toBe('$ 230 a favor');
    expect(resumenPlata({ monto: -230, metodo: 'efectivo', saldoUsadoEl: null })).toBe('Se le devolvió $ 230 (efectivo)');
  });

  it('suma los saldos a favor sin usar por cliente', () => {
    const r = saldosAFavor([
      cambio({ id: '1', metodo: 'a_favor', monto: -200 }),
      cambio({ id: '2', metodo: 'a_favor', monto: -100 }),
      cambio({ id: '3', metodo: 'a_favor', monto: -50, saldoUsadoEl: '2026-10-12' }),
      cambio({ id: '4', cliente: 'ANA', metodo: 'efectivo', monto: -80 }),
    ]);
    expect(r).toEqual([expect.objectContaining({ cliente: 'TATI', total: 300 })]);
  });

  it('lista todas las variantes, también las agotadas', () => {
    expect(variantesDe({ 'M|Azul': 2, 'L|Azul': 0 })).toEqual([{ key: 'M|Azul', stock: 2 }, { key: 'L|Azul', stock: 0 }]);
  });
});
