// Orden de los talles para MOSTRARLOS en la ficha. El catálogo los guarda en el orden en
// que se fueron cargando ("S, L, M, XL, 2XL, 3XL, XS"): en la ficha se leían salteados.
// Solo presentación: no toca qué talle se elige por defecto ni el stock.

// XXL = 2XL y XXXL = 3XL: misma posición.
const RANGO: Record<string, number> = { XXS: 0, XS: 1, S: 2, M: 3, L: 4, XL: 5, '2XL': 6, XXL: 6, '3XL': 7, XXXL: 7, '4XL': 8 };

function rango(talle: string): number {
  const base = talle.split('/')[0].trim().toUpperCase();
  if (base in RANGO) return RANGO[base];
  const n = Number(base.replace(',', '.'));
  // Numéricos (calzado, "U" de talle único, etc.) después de las letras, por número.
  return Number.isFinite(n) ? 100 + n : 1000;
}

/** Copia ordenada XS → 3XL; a igual talle, el orden original ("S / Masculino" antes que
 *  "S / Femenino" si así venían). Lo desconocido queda al final, en su orden. */
export function ordenarTalles(talles: string[]): string[] {
  return talles
    .map((t, i) => ({ t, i, r: rango(t) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}
