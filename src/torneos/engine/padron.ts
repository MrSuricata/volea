import type { Jugador } from './tipos';
import { nuevoId } from './tipos';
// normalizar/distancia viven en utils/nombres (compartidas con Caja e
// inscripciones); se re-exportan para no tocar los import sites del motor.
import { distancia, normalizar } from '../../utils/nombres';

export { distancia, normalizar };

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
