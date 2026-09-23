// Guardado de productos sin pisar ventas.
//
// El editor de producto arma el stock completo con lo que tenía al abrirse. Si
// mientras tanto la caja, el bot o una compra movieron el stock, re-subirlo
// devolvía las unidades vendidas. Por eso el guardado distingue tres casos.

export type GuardadoStock =
  | { modo: 'nuevo' }                                   // producto nuevo: el stock va tal cual
  | { modo: 'sin-cambios' }                             // no tocaste el stock: no se manda
  | { modo: 'editado'; base: Record<string, number> };  // lo tocaste: base = stock al abrir

/** Mismo stock, contando una clave ausente como 0 (el editor agrega talles × colores en cero). */
export function mismoStock(a: Record<string, number> = {}, b: Record<string, number> = {}): boolean {
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of claves) {
    if ((Number(a[k]) || 0) !== (Number(b[k]) || 0)) return false;
  }
  return true;
}

export function modoGuardadoStock(
  original: Record<string, number> | null | undefined,
  editado: Record<string, number>,
): GuardadoStock {
  if (original == null) return { modo: 'nuevo' };
  return mismoStock(original, editado) ? { modo: 'sin-cambios' } : { modo: 'editado', base: original };
}
