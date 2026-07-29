import type { Torneo } from '../engine/tipos';

// Nombre para mostrar; si hay parejas con el mismo nombre, la 2ª en adelante lleva sufijo "(2)", "(3)"... (spec §6)
export function nombreDe(torneo: Torneo, parejaId: string): string {
  const idx = torneo.parejas.findIndex((p) => p.id === parejaId);
  if (idx === -1) return '¿?';
  const pareja = torneo.parejas[idx];
  const repetidasAntes = torneo.parejas.slice(0, idx).filter((p) => p.nombre === pareja.nombre).length;
  return repetidasAntes > 0 ? `${pareja.nombre} (${repetidasAntes + 1})` : pareja.nombre;
}
