// Comparación de nombres de personas, compartida por el padrón de torneos, la
// Caja (sugerencias de deudor) y las inscripciones. `normalizar` y `distancia`
// nacieron en src/torneos/engine/padron.ts, que ahora las re-exporta de acá.

// Baja a minusculas, saca diacriticos (incluida la tilde de la ñ) y colapsa espacios. Solo para comparar.
export function normalizar(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Levenshtein clasico (una fila), suficiente para nombres cortos.
export function distancia(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const fila = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = fila[0];
    fila[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = fila[j];
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, prev + costo);
      prev = temp;
    }
  }
  return fila[n];
}

export interface SugerenciaDeudor {
  nombre: string;
  /** Saldo abierto si ya debe; null si es solo un nombre conocido (histórico/padrón). */
  saldo: number | null;
}

/**
 * Sugerencias para el campo "¿Quién debe?" de la Caja. `abiertos` = deudores
 * con deuda abierta (van primero, con su saldo); `otros` = nombres históricos
 * del ledger + padrón de jugadores. Texto vacío = los abiertos tal cual.
 * Match: substring en cualquier dirección (normalizado), o alguna palabra del
 * nombre a distancia ≤ 2 cuando ambas puntas tienen ≥ 4 letras (así un typo
 * corto no enciende cualquier cosa). Tope 6, sin repetidos por normalizado.
 */
export function sugerirDeudores(
  abiertos: { nombre: string; saldo: number }[],
  otros: string[],
  texto: string,
): SugerenciaDeudor[] {
  const q = normalizar(texto);
  const vistos = new Set<string>();
  const out: SugerenciaDeudor[] = [];
  const agregar = (nombre: string, saldo: number | null) => {
    const clave = normalizar(nombre);
    if (!clave || vistos.has(clave) || out.length >= 6) return;
    vistos.add(clave);
    out.push({ nombre, saldo });
  };
  if (q === '') {
    for (const d of abiertos) agregar(d.nombre, d.saldo);
    return out;
  }
  const matchea = (nombre: string) => {
    const n = normalizar(nombre);
    if (n.includes(q) || q.includes(n)) return true;
    return n.split(' ').some(p => Math.min(p.length, q.length) >= 4 && distancia(p, q) <= 2);
  };
  for (const d of abiertos) if (matchea(d.nombre)) agregar(d.nombre, d.saldo);
  for (const n of otros) if (matchea(n)) agregar(n, null);
  return out;
}
