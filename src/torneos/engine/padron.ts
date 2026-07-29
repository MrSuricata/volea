import type { Jugador } from './tipos';
import { nuevoId } from './tipos';

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

// ----- Busqueda y mantenimiento del padron -----

const UMBRAL_DUDOSO = 2; // distancia de edicion maxima para considerar "puede ser la misma persona"

export type Busqueda =
  | { tipo: 'exacto'; jugador: Jugador }
  | { tipo: 'dudoso'; candidatos: Jugador[] }
  | { tipo: 'nuevo' };

function nombresNormalizados(j: Jugador): string[] {
  return [j.nombre, ...(j.alias ?? [])].map(normalizar);
}

export function buscarJugador(jugadores: Jugador[], nombre: string): Busqueda {
  const norm = normalizar(nombre);
  const exacto = jugadores.find((j) => nombresNormalizados(j).includes(norm));
  if (exacto) return { tipo: 'exacto', jugador: exacto };

  const candidatos = jugadores
    .map((j) => ({ j, d: Math.min(...nombresNormalizados(j).map((n) => distancia(norm, n))) }))
    .filter(({ j, d }) => d <= UMBRAL_DUDOSO || nombresNormalizados(j).some((n) => (n.length >= 4 && (n.includes(norm) || norm.includes(n)))))
    .sort((a, b) => a.d - b.d)
    .map(({ j }) => j);

  return candidatos.length ? { tipo: 'dudoso', candidatos } : { tipo: 'nuevo' };
}

export function agregarJugador(jugadores: Jugador[], nombre: string): { jugadores: Jugador[]; jugador: Jugador } {
  const jugador: Jugador = { id: nuevoId(), nombre: nombre.trim() };
  return { jugadores: [...jugadores, jugador], jugador };
}

export function agregarAlias(jugadores: Jugador[], jugadorId: string, alias: string): Jugador[] {
  const limpio = alias.trim();
  return jugadores.map((j) => {
    if (j.id !== jugadorId) return j;
    const yaEsta = nombresNormalizados(j).includes(normalizar(limpio));
    if (yaEsta) return j;
    return { ...j, alias: [...(j.alias ?? []), limpio] };
  });
}
