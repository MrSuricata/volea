import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLAVE_CACHE, limpiarCacheTorneosSiSincronizada } from './cacheTorneos';

// Stub minimo de localStorage (Map en memoria): este archivo corre en entorno 'node' (ver
// vite.config.ts), sin window/localStorage real. limpiarCacheTorneosSiSincronizada es la
// unica superficie que App.tsx toca en el logout (ver comentario en cacheTorneos.ts) -
// estos tests la pin-ean ANTES de mover el tipo Cache a este archivo (mismo comportamiento,
// tipo mas preciso), asi el refactor no puede cambiar en silencio que se borra y que no.
class LocalStorageStub {
  private mapa = new Map<string, string>();
  getItem(clave: string): string | null {
    return this.mapa.has(clave) ? this.mapa.get(clave)! : null;
  }
  setItem(clave: string, valor: string): void {
    this.mapa.set(clave, valor);
  }
  removeItem(clave: string): void {
    this.mapa.delete(clave);
  }
  clear(): void {
    this.mapa.clear();
  }
}

let stub: LocalStorageStub;

beforeEach(() => {
  stub = new LocalStorageStub();
  // @ts-expect-error stub minimo a proposito: no implementa el Storage completo (length, key())
  globalThis.localStorage = stub;
});

afterEach(() => {
  // @ts-expect-error ver beforeEach
  delete globalThis.localStorage;
});

function guardar(cache: Record<string, unknown>) {
  stub.setItem(CLAVE_CACHE, JSON.stringify(cache));
}

// Cache "sincronizada": todas las banderas de trabajo pendiente en su valor limpio.
const cacheLimpia = () => ({
  estado: { torneos: [], jugadores: [] },
  base: {},
  sucios: [] as string[],
  borrados: [] as string[],
  jugadoresBase: [] as string[],
  jugadoresSucios: false,
  configSucia: false,
  conflictos: [] as string[],
});

describe('limpiarCacheTorneosSiSincronizada', () => {
  // Nota: la guarda NO mira `conflictos`, y es a proposito: un conflicto sin resolver esta
  // SIEMPRE tambien en `sucios` (mergeTorneos solo marca conflicto sobre ids sucios,
  // reconciliarPostPush mantiene sucios a los conflictuados, y resolverConflicto('local')
  // re-agrega a sucios) — la preservacion de conflictos viaja en el chequeo de `sucios`.
  // Si alguien "simplifica" esa relacion en el hook, tiene que venir a ampliar la guarda.

  // (a)
  it('sucio via `sucios`: preserva la cache intacta y devuelve false', () => {
    guardar({ ...cacheLimpia(), sucios: ['t1'] });
    const antes = stub.getItem(CLAVE_CACHE);
    expect(limpiarCacheTorneosSiSincronizada()).toBe(false);
    expect(stub.getItem(CLAVE_CACHE)).toBe(antes);
  });

  // (b)
  it('sucio via `borrados`: preserva la cache intacta y devuelve false', () => {
    guardar({ ...cacheLimpia(), borrados: ['t1'] });
    const antes = stub.getItem(CLAVE_CACHE);
    expect(limpiarCacheTorneosSiSincronizada()).toBe(false);
    expect(stub.getItem(CLAVE_CACHE)).toBe(antes);
  });

  // (c)
  it('sucio via `jugadoresSucios: true`: preserva la cache intacta y devuelve false', () => {
    guardar({ ...cacheLimpia(), jugadoresSucios: true });
    const antes = stub.getItem(CLAVE_CACHE);
    expect(limpiarCacheTorneosSiSincronizada()).toBe(false);
    expect(stub.getItem(CLAVE_CACHE)).toBe(antes);
  });

  // (d)
  it('sucio via `configSucia: true`: preserva la cache intacta y devuelve false', () => {
    guardar({ ...cacheLimpia(), configSucia: true });
    const antes = stub.getItem(CLAVE_CACHE);
    expect(limpiarCacheTorneosSiSincronizada()).toBe(false);
    expect(stub.getItem(CLAVE_CACHE)).toBe(antes);
  });

  // (e)
  it('completamente limpia: la borra y devuelve true', () => {
    guardar(cacheLimpia());
    expect(limpiarCacheTorneosSiSincronizada()).toBe(true);
    expect(stub.getItem(CLAVE_CACHE)).toBeNull();
  });

  // (f)
  it('sin clave guardada: devuelve true (nada que borrar)', () => {
    expect(stub.getItem(CLAVE_CACHE)).toBeNull();
    expect(limpiarCacheTorneosSiSincronizada()).toBe(true);
    expect(stub.getItem(CLAVE_CACHE)).toBeNull();
  });

  // (g)
  it('JSON corrupto: no es recuperable, lo borra y devuelve true', () => {
    stub.setItem(CLAVE_CACHE, '{esto no es json valido');
    expect(limpiarCacheTorneosSiSincronizada()).toBe(true);
    expect(stub.getItem(CLAVE_CACHE)).toBeNull();
  });

  // (h)
  it('forma legacy sin `borrados` (y por lo demas limpia): falta => [], la borra y devuelve true', () => {
    guardar({
      estado: { torneos: [], jugadores: [] },
      base: {},
      sucios: [],
      // sin 'borrados': simula una cache guardada por una version anterior del hook
      jugadoresBase: [],
      jugadoresSucios: false,
      configSucia: false,
      conflictos: [],
    });
    expect(limpiarCacheTorneosSiSincronizada()).toBe(true);
    expect(stub.getItem(CLAVE_CACHE)).toBeNull();
  });

  // (i)
  it('forma legacy sin `borrados` pero sucia via `sucios`: preserva y devuelve false', () => {
    guardar({
      estado: { torneos: [], jugadores: [] },
      base: {},
      sucios: ['t1'],
      // sin 'borrados': la dimension ausente no blanquea a las presentes
      jugadoresBase: [],
      jugadoresSucios: false,
      configSucia: false,
      conflictos: [],
    });
    const antes = stub.getItem(CLAVE_CACHE);
    expect(limpiarCacheTorneosSiSincronizada()).toBe(false);
    expect(stub.getItem(CLAVE_CACHE)).toBe(antes);
  });
});
