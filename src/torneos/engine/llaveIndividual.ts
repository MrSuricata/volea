import type { PartidoLlave, SlotLlave } from './tipos';
import { nuevoId } from './tipos';

// Eliminación directa "rolling": cada ronda empareja consecutivos (1v2, 3v4…); si la cantidad
// es impar el último zafa y se agrega AL FRENTE del pool de la ronda siguiente (juega esa ronda,
// nadie zafa dos rondas seguidas). Todos los jugadores se conocen de entrada, así que la llave
// entera se pre-construye con referencias ganadorDe.
export function armarLlaveRolling(jugadorIds: string[]): PartidoLlave[] {
  const partidos: PartidoLlave[] = [];
  let pool: SlotLlave[] = jugadorIds.map((id) => ({ tipo: 'seed', parejaId: id }));
  let ronda = 1;
  while (pool.length > 1) {
    const deEstaRonda: PartidoLlave[] = [];
    let i = 0;
    for (; i + 1 < pool.length; i += 2) {
      deEstaRonda.push({
        id: nuevoId(),
        ronda,
        posicion: deEstaRonda.length,
        a: pool[i],
        b: pool[i + 1],
        puntosA: null,
        puntosB: null,
        esTercerPuesto: false,
      });
    }
    const zafa: SlotLlave | null = i < pool.length ? pool[i] : null;
    partidos.push(...deEstaRonda);
    const ganadores: SlotLlave[] = deEstaRonda.map((m) => ({ tipo: 'ganadorDe', partidoId: m.id }));
    pool = zafa ? [zafa, ...ganadores] : ganadores;
    ronda += 1;
  }
  return partidos;
}
