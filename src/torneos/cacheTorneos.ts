// Modulo hoja: A PROPOSITO sin imports de React, Supabase, ni del hook de sync (useSyncTorneos
// importa TODO eso, mas mergeTorneos, etc.). App.tsx necesita limpiar la cache de torneos al
// hacer logout, pero App.tsx es parte del bundle publico (no esta detras del lazy() de
// AdminTorneosTab) - si importara aunque sea una sola cosa de useSyncTorneos.ts, Rollup arrastra
// el modulo entero (y sus imports) de vuelta al chunk de entrada, rompiendo el split lazy. Este
// archivo es la unica superficie que App.tsx puede tocar de forma estatica sin ese efecto.

export const CLAVE_CACHE = 'volea-torneos:cache';

type CachePendiente = {
  sucios?: unknown[];
  borrados?: unknown[];
  jugadoresSucios?: boolean;
  configSucia?: boolean;
};

/**
 * Borra la cache de torneos de localStorage SOLO si no hay nada pendiente de subir (nada
 * "sucio", nada borrado sin confirmar, jugadores/config sin sincronizar). Pensada para logout:
 * el gestor le promete al admin "tus cambios quedan guardados en este navegador y se reintenta
 * solo": borrar la cache sin mirar rompe esa promesa para quien cargo resultados con mala señal,
 * el push (y su reintento periodico / flush al desmontar) nunca llego a confirmar con el server,
 * y cierra sesion de todos modos - ese trabajo se perderia para siempre.
 *
 * Devuelve si borró (true) o la dejó intacta por tener trabajo sin sincronizar (false).
 */
export function limpiarCacheTorneosSiSincronizada(): boolean {
  let crudo: string | null;
  try {
    crudo = localStorage.getItem(CLAVE_CACHE);
  } catch (e) {
    console.error('[torneos cache] no se pudo leer localStorage', e);
    return true; // inaccesible: no hay nada que podamos hacer ni nada que perder
  }
  if (crudo === null) return true; // no hay cache: nada que borrar

  let parsed: unknown;
  try {
    parsed = JSON.parse(crudo);
  } catch {
    // JSON corrupto: no es recuperable de todos modos (no hay forma de leer sucios/borrados
    // de algo que no parsea) - borrar es lo correcto, no bloqueamos el logout para siempre
    // por una cache que ya estaba rota.
    try { localStorage.removeItem(CLAVE_CACHE); } catch { /* nada mas que hacer */ }
    return true;
  }

  if (parsed === null || typeof parsed !== 'object') {
    try { localStorage.removeItem(CLAVE_CACHE); } catch { /* nada mas que hacer */ }
    return true;
  }

  const c = parsed as CachePendiente;
  const sucios = Array.isArray(c.sucios) ? c.sucios : [];
  const borrados = Array.isArray(c.borrados) ? c.borrados : [];
  const hayPendiente = sucios.length > 0 || borrados.length > 0 || c.jugadoresSucios === true || c.configSucia === true;
  if (hayPendiente) return false; // NO borrar: hay trabajo sin sincronizar

  try {
    localStorage.removeItem(CLAVE_CACHE);
  } catch (e) {
    console.error('[torneos cache] no se pudo borrar localStorage', e);
    // no habia nada pendiente (la rama de arriba ya filtro eso), asi que no perdimos nada -
    // simplemente no se libero el espacio.
  }
  return true;
}
