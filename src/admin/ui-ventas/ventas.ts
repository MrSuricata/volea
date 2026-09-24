// Reglas chicas de las pantallas de plata (Caja, Compras, Socios) que conviene
// tener fuera del JSX para poder testearlas.

/**
 * ¿El error de una escritura deja la duda de si entró?
 *
 * Una venta que vuelve con "sin stock" o un rechazo de la base NO entró: se puede
 * corregir y reintentar. Pero si la conexión se cortó o venció el techo de 15s
 * (conTechoEscritura), la RPC pudo haber llegado y confirmado igual: reintentar a
 * ciegas duplica la venta y descuenta el stock dos veces. "Sin conexión con
 * Supabase" no cuenta: sale antes de mandar nada.
 */
export function resultadoIncierto(error: string | null | undefined): boolean {
  if (!error) return false;
  return /timeout|failed to fetch|fetch failed|networkerror|network request failed|load failed|abort/i.test(error);
}

/** "1 venta" / "3 ventas": los plurales del panel son todos regulares. */
export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}
