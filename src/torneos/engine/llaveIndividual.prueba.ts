import { armarLlaveRolling } from './llaveIndividual';
import { cargarResultadoLlave, resolverSlot } from './llave';
import type { PartidoLlave } from './tipos';

// Solo para tests: arma un OPC de n jugadores y lo juega entero con ganadores al azar (semilla fija).
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

export function jugarTodo(n: number, semilla: number): PartidoLlave[] {
  let s = semilla;
  const azar = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  let ps = armarLlaveRolling(ids(n));
  for (;;) {
    const listo = ps
      .slice()
      .sort((x, y) => x.ronda - y.ronda || x.posicion - y.posicion)
      .find((p) => p.puntosA === null && resolverSlot(p.a, ps) !== null && resolverSlot(p.b, ps) !== null);
    if (!listo) break;
    ps = azar() < 0.5 ? cargarResultadoLlave(ps, listo.id, 1, 0).partidos : cargarResultadoLlave(ps, listo.id, 0, 1).partidos;
  }
  return ps;
}

