// Formularios del panel: saber si hay cambios sin guardar (el Dialogo pregunta antes de
// cerrar si tocaste afuera sin querer). Vacío, null y undefined cuentan como lo mismo:
// abrir "Último día" y borrarlo no es un cambio.

const vacio = (v: unknown) => v === undefined || v === null || v === '';

function igual(a: unknown, b: unknown): boolean {
  if (vacio(a) && vacio(b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** true si algún campo de `actual` difiere de `inicial` (comparación de primer nivel). */
export function hayCambios<T extends object>(inicial: T, actual: T): boolean {
  const a = inicial as Record<string, unknown>;
  const b = actual as Record<string, unknown>;
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of claves) if (!igual(a[k], b[k])) return true;
  return false;
}

/**
 * Usuario de Instagram "sin @" como lo guarda el club, aunque peguen "@club" o el link
 * del perfil ("https://www.instagram.com/club/?hl=es").
 */
export function usuarioInstagram(texto: string): string {
  const t = texto.trim();
  const link = t.match(/instagram\.com\/([^/?#\s]+)/i);
  return (link ? link[1] : t).replace(/^@+/, '');
}
