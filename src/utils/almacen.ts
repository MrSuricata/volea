// localStorage / sessionStorage que nunca tiran.
//
// POR QUÉ: con el almacenamiento bloqueado (Safari privado viejo, cookies bloqueadas,
// la web adentro de un iframe de Instagram/Facebook) el solo hecho de TOCAR
// `window.localStorage` tira SecurityError. Un getItem suelto en un useState de
// arranque tumbaba el sitio entero en pantalla blanca, y un removeItem en el `.then`
// de un import() lazy hacía fallar TODAS las páginas lazy. Además, con la cuota llena
// (QuotaExceededError) una escritura local que tiraba cortaba la escritura a la nube
// que venía después en la misma función.
//
// Regla: lo local es comodidad (carrito, marcas de "ya lo vi", espejos). Si no se
// puede leer, se sigue como si no hubiera nada; si no se puede escribir, se sigue
// igual y el que llama se entera por el boolean si le importa.

/** Lo mínimo de Storage que usamos (así los tests pasan un doble sin DOM). */
export interface AlmacenCrudo {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

export interface Almacen {
  /** El texto guardado, o null si no hay o si el almacenamiento no se puede usar. */
  leer(clave: string): string | null;
  /** true si quedó guardado; false si está bloqueado o lleno. Nunca tira. */
  guardar(clave: string, valor: string): boolean;
  /** true si se borró (o no estaba). Nunca tira. */
  borrar(clave: string): boolean;
  /** JSON parseado, o null si no hay, está corrupto o no se puede leer. */
  leerJSON<T>(clave: string): T | null;
  /** Serializa y guarda; false si no se pudo (bloqueado, lleno o no serializable). */
  guardarJSON(clave: string, valor: unknown): boolean;
}

/**
 * `obtener` es una FUNCIÓN y no el Storage en sí: el acceso a `window.localStorage`
 * es lo que tira con las cookies bloqueadas, así que tiene que quedar adentro del try.
 */
export function crearAlmacen(obtener: () => AlmacenCrudo | null | undefined): Almacen {
  const usar = <R>(fn: (s: AlmacenCrudo) => R, siFalla: R): R => {
    try {
      const s = obtener();
      return s ? fn(s) : siFalla;
    } catch {
      return siFalla;
    }
  };
  const leer = (clave: string) => usar(s => s.getItem(clave), null);
  const guardar = (clave: string, valor: string) => usar(s => { s.setItem(clave, valor); return true; }, false);
  return {
    leer,
    guardar,
    borrar: (clave) => usar(s => { s.removeItem(clave); return true; }, false),
    leerJSON: <T>(clave: string): T | null => {
      const crudo = leer(clave);
      if (crudo === null) return null;
      try {
        return JSON.parse(crudo) as T;
      } catch {
        return null;
      }
    },
    guardarJSON: (clave, valor) => {
      let texto: string;
      try {
        texto = JSON.stringify(valor);
      } catch {
        return false;
      }
      return guardar(clave, texto);
    },
  };
}

// typeof window: el mismo módulo corre en los tests (Node, sin window).
export const almacenLocal = crearAlmacen(() => (typeof window === 'undefined' ? null : window.localStorage));
export const almacenSesion = crearAlmacen(() => (typeof window === 'undefined' ? null : window.sessionStorage));
