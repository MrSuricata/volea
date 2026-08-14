// Lógica pura de la pestaña Inscripciones del admin: parejas por categoría
// (con fallback al campo legacy) y armado de secciones "spliteadas" por
// categoría con duplas por mención mutua, como la planilla de Brian.

import type { Inscripcion } from '../types';
import { normalizar } from './nombres';

export function categoriasDe(i: Inscripcion): string[] {
  return i.categorias.split(',').map(c => c.trim()).filter(Boolean);
}

/** Pareja declarada para una categoría: mapa nuevo, con fallback al campo legacy. */
export function parejaDe(i: Inscripcion, categoria: string): string {
  const m = i.parejas?.[categoria];
  if (m && m.trim()) return m.trim();
  // Las inscripciones viejas tienen un único texto de pareja: vale para
  // cualquier categoría de dobles, nunca para singles.
  if (categoria.toLowerCase().includes('doble') && i.pareja.trim()) return i.pareja.trim();
  return '';
}

export interface SeccionCategoria {
  categoria: string;
  /** Pares de ids de inscripciones emparejadas por mención mutua. */
  duplas: [string, string][];
  /** Ids sin dupla armada (con o sin pareja declarada). */
  sueltos: string[];
  total: number;
}

/**
 * Secciones por categoría para la vista "spliteada": una por categoría del
 * evento (en su orden) más cualquier categoría presente en los datos que el
 * evento ya no liste (resiliente a renombres). Bajas excluidas. En cada
 * sección, dos inscriptos cuyas parejas declaradas se apuntan mutuamente
 * (normalizado, sin tildes) se muestran como dupla armada.
 */
export function armarSeccionesCategoria(
  inscripciones: Inscripcion[],
  categoriasEvento: string[],
): SeccionCategoria[] {
  const activos = inscripciones.filter(x => x.estado !== 'baja');
  const orden: string[] = [...categoriasEvento.map(c => c.trim()).filter(Boolean)];
  for (const i of activos) {
    for (const c of categoriasDe(i)) if (!orden.includes(c)) orden.push(c);
  }
  return orden.map(categoria => {
    const del = activos.filter(x => categoriasDe(x).includes(categoria));
    const usados = new Set<string>();
    const duplas: [string, string][] = [];
    for (const a of del) {
      if (usados.has(a.id)) continue;
      const objetivo = normalizar(parejaDe(a, categoria));
      if (!objetivo) continue;
      const b = del.find(x => x.id !== a.id && !usados.has(x.id)
        && normalizar(x.nombre) === objetivo
        && normalizar(parejaDe(x, categoria)) === normalizar(a.nombre));
      if (b) { usados.add(a.id); usados.add(b.id); duplas.push([a.id, b.id]); }
    }
    const sueltos = del.filter(x => !usados.has(x.id)).map(x => x.id);
    return { categoria, duplas, sueltos, total: del.length };
  });
}
