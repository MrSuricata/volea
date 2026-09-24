// Plata en el panel: UN solo formateador y UN solo lector de lo que se tipea.
//
// Por qué existe el lector: los inputs `type="number"` leen "1.200" como 1,2 (el punto es
// decimal para el navegador) y en Uruguay el punto es el separador de miles. Resultado
// visto en la auditoría del 24/09: tipear "1.200" en la Caja registraba una venta de $1.
// Acá "1.200" es mil doscientos, "1,5" es uno y medio, y "$ 1.200,50" también se entiende.

/** "$ 1.200" · "−$ 350" (el signo va adelante del $, como se lee). Sin decimales si son 0. */
export function formatoPlata(monto: number, { decimales = false }: { decimales?: boolean } = {}): string {
  if (!Number.isFinite(monto)) return '$ —';
  const abs = Math.abs(monto);
  const txt = abs.toLocaleString('es-UY', {
    minimumFractionDigits: decimales ? 2 : 0,
    maximumFractionDigits: decimales || !Number.isInteger(abs) ? 2 : 0,
  });
  return `${monto < 0 ? '−' : ''}$ ${txt}`;
}

/**
 * Lee un monto tipeado a mano. Devuelve null si no es un número (vacío, letras).
 * Reglas (es-UY): el punto separa miles y la coma decimales. Si hay un solo punto
 * seguido de exactamente 1 o 2 dígitos ("12.5", "3.75") se toma como decimal: nadie
 * escribe miles así, y es lo que pasa cuando el teclado del celular solo ofrece punto.
 */
export function leerPlata(texto: string): number | null {
  const limpio = texto.replace(/[\s$U]/gi, '').replace(/[−–]/g, '-');
  if (limpio === '' || limpio === '-') return null;
  if (!/^-?[\d.,]+$/.test(limpio)) return null;
  let normal: string;
  if (limpio.includes(',')) {
    // Con coma: la coma es el decimal y los puntos son miles.
    normal = limpio.replace(/\./g, '').replace(',', '.');
    if (normal.includes(',')) return null; // dos comas
  } else {
    const partes = limpio.split('.');
    if (partes.length === 2 && partes[1].length > 0 && partes[1].length <= 2) normal = limpio;
    else normal = limpio.replace(/\./g, '');
  }
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}
