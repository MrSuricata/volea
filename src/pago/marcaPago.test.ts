import { describe, expect, it } from 'vitest';
import { CLAVE_MARCA_PAGO, consumirMarcaDePago, guardarMarcaDePago } from './marcaPago';

// Storage en memoria; `roto` simula el storage bloqueado (tira en todo).
function almacen(roto = false) {
  const datos = new Map<string, string>();
  const chequear = () => { if (roto) throw new DOMException('bloqueado', 'SecurityError'); };
  return {
    datos,
    getItem: (k: string) => { chequear(); return datos.get(k) ?? null; },
    setItem: (k: string, v: string) => { chequear(); datos.set(k, v); },
    removeItem: (k: string) => { chequear(); datos.delete(k); },
  };
}

describe('marca de pago de MP', () => {
  it('MP vuelve en OTRA pestaña (sessionStorage vacío): vacía el carrito si el pedido es el mismo', () => {
    const local = almacen();
    guardarMarcaDePago('VO-ABC', { sesion: almacen(), local }); // pestaña del checkout
    const otraPestaña = { sesion: almacen(), local };           // mismo localStorage, otra sesión
    expect(consumirMarcaDePago('VO-ABC', otraPestaña)).toBe(true);
    expect(local.datos.has(CLAVE_MARCA_PAGO)).toBe(false); // se consume una vez
    expect(consumirMarcaDePago('VO-ABC', otraPestaña)).toBe(false);
  });

  it('un link compartido de otro pedido no vacía el carrito', () => {
    const local = almacen();
    local.setItem(CLAVE_MARCA_PAGO, 'VO-MIO');
    expect(consumirMarcaDePago('VO-AJENO', { sesion: almacen(), local })).toBe(false);
    expect(local.datos.get(CLAVE_MARCA_PAGO)).toBe('VO-MIO'); // la marca propia sigue
  });

  it('sin ninguna marca no vacía nada', () => {
    expect(consumirMarcaDePago('VO-ABC', { sesion: almacen(), local: almacen() })).toBe(false);
  });

  it('sigue funcionando la marca de pestaña que escribe hoy el checkout (sessionStorage = "1")', () => {
    const sesion = almacen();
    sesion.setItem(CLAVE_MARCA_PAGO, '1');
    expect(consumirMarcaDePago('VO-ABC', { sesion, local: almacen() })).toBe(true);
    expect(sesion.datos.has(CLAVE_MARCA_PAGO)).toBe(false);
  });

  it('con el storage bloqueado no revienta: simplemente no vacía', () => {
    expect(() => guardarMarcaDePago('VO-ABC', { sesion: almacen(true), local: almacen(true) })).not.toThrow();
    expect(consumirMarcaDePago('VO-ABC', { sesion: almacen(true), local: almacen(true) })).toBe(false);
    expect(consumirMarcaDePago('VO-ABC', { sesion: null, local: null })).toBe(false);
  });

  it('sin id de pedido en la vuelta, la marca compartida no cuenta', () => {
    const local = almacen();
    local.setItem(CLAVE_MARCA_PAGO, 'VO-ABC');
    expect(consumirMarcaDePago('', { sesion: almacen(), local })).toBe(false);
  });
});
