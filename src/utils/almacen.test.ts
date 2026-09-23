import { describe, expect, it } from 'vitest';
import { almacenLocal, crearAlmacen, type AlmacenCrudo } from './almacen';

/** Storage en memoria, como el del navegador. */
function enMemoria(): AlmacenCrudo & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => { datos.set(k, v); },
    removeItem: (k) => { datos.delete(k); },
  };
}

const errorSeguridad = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };

describe('crearAlmacen con el almacenamiento sano', () => {
  it('guarda, lee y borra', () => {
    const crudo = enMemoria();
    const a = crearAlmacen(() => crudo);
    expect(a.leer('nada')).toBeNull();
    expect(a.guardar('k', 'v')).toBe(true);
    expect(a.leer('k')).toBe('v');
    expect(a.borrar('k')).toBe(true);
    expect(a.leer('k')).toBeNull();
  });

  it('JSON ida y vuelta', () => {
    const crudo = enMemoria();
    const a = crearAlmacen(() => crudo);
    expect(a.guardarJSON('lista', [{ id: 1 }])).toBe(true);
    expect(a.leerJSON<{ id: number }[]>('lista')).toEqual([{ id: 1 }]);
  });

  it('un JSON corrupto se lee como si no hubiera nada', () => {
    const crudo = enMemoria();
    crudo.datos.set('roto', '{no es json');
    expect(crearAlmacen(() => crudo).leerJSON('roto')).toBeNull();
  });

  it('algo que no se puede serializar no se guarda y no tira', () => {
    const circular: Record<string, unknown> = {};
    circular.yo = circular;
    expect(crearAlmacen(enMemoria).guardarJSON('c', circular)).toBe(false);
  });
});

describe('crearAlmacen con el almacenamiento bloqueado', () => {
  // Safari privado viejo / cookies bloqueadas: TOCAR window.localStorage ya tira.
  const bloqueado = crearAlmacen(errorSeguridad);

  it('leer devuelve null en vez de tirar', () => {
    expect(bloqueado.leer('k')).toBeNull();
    expect(bloqueado.leerJSON('k')).toBeNull();
  });

  it('guardar y borrar devuelven false en vez de tirar', () => {
    expect(bloqueado.guardar('k', 'v')).toBe(false);
    expect(bloqueado.guardarJSON('k', { a: 1 })).toBe(false);
    expect(bloqueado.borrar('k')).toBe(false);
  });

  it('sin Storage (null) se comporta igual', () => {
    const sin = crearAlmacen(() => null);
    expect(sin.leer('k')).toBeNull();
    expect(sin.guardar('k', 'v')).toBe(false);
  });
});

describe('crearAlmacen con la cuota llena', () => {
  it('la escritura falla con false pero la lectura sigue andando', () => {
    const crudo = enMemoria();
    crudo.datos.set('carrito', '[]');
    const lleno = crearAlmacen(() => ({
      ...crudo,
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    }));
    expect(lleno.guardar('carrito', '[1]')).toBe(false);
    expect(lleno.leer('carrito')).toBe('[]');
  });
});

describe('almacenLocal fuera del navegador', () => {
  it('en Node (sin window) no tira', () => {
    expect(almacenLocal.leer('k')).toBeNull();
    expect(almacenLocal.guardar('k', 'v')).toBe(false);
  });
});
