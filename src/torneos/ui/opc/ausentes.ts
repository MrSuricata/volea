// "No se presentó" en el One Point Challenge: lógica pura (sin React), para usar adentro del
// updater de `actualizar` y desde los tests.
//
// Regla:
//  · `torneo.ausentes` (parejaIds) es la lista de jugadores que no se presentaron. Sin el campo,
//    el torneo se comporta exactamente como antes.
//  · Mientras un jugador está ausente, todo cruce LISTO (los dos lugares resueltos) en el que esté
//    y sin resultado se resuelve solo a favor del rival, 1-0 con `wo: true` (sin `cargadoEl`: no
//    es un resultado cargado, y así dos equipos que resuelven lo mismo guardan lo mismo). Si los
//    dos son ausentes pasa el de arriba (lado a), también por W.O.: sigue ausente, así que pierde
//    el cruce siguiente apenas quede listo. Se propaga ronda a ronda hasta que no cambia nada.
//  · Un cruce que ya tiene resultado no se toca nunca (lo jugado de verdad antes de marcar queda).
//  · Desmarcar (llegó tarde): se borran los W.O. que perdió ESE jugador (con la cascada de
//    siempre: lo que dependía de ellos se borra) y se vuelve a resolver con los que siguen
//    ausentes. Si eso borra cruces jugados de verdad, la pantalla lo avisa antes (realesBorrados).
import type { PartidoLlave, Torneo } from '../../engine/tipos';
import { resultadoValido } from '../../engine/tipos';
import { cargarResultadoLlave, ganadorPartido, resolverSlot } from '../../engine/llave';

const ordenar = (a: PartidoLlave, b: PartidoLlave) => a.ronda - b.ronda || a.posicion - b.posicion;

/** Los ausentes del torneo que siguen siendo jugadores del torneo (sin repetidos). */
export function ausentesDe(t: Pick<Torneo, 'ausentes' | 'parejas'>): string[] {
  if (!Array.isArray(t.ausentes)) return [];
  const ids = new Set(t.parejas.map((p) => p.id));
  return [...new Set(t.ausentes.filter((x) => typeof x === 'string' && ids.has(x)))];
}

/**
 * Resuelve por W.O. los cruces listos donde hay un ausente. Idempotente: si no hay nada que
 * resolver devuelve EL MISMO arreglo (misma referencia), así el sync no ve un cambio.
 */
export function resolverAusentes(partidos: PartidoLlave[], ausentes: readonly string[]): PartidoLlave[] {
  if (ausentes.length === 0) return partidos;
  const aus = new Set(ausentes);
  let ps = partidos;
  for (let vuelta = 0; vuelta <= partidos.length; vuelta++) {
    let cambio = false;
    for (const p of [...ps].sort(ordenar)) {
      if (p.a === null || p.b === null) continue;
      if (p.puntosA !== null || p.puntosB !== null) continue; // ya tiene algo cargado: no se toca
      const a = resolverSlot(p.a, ps);
      const b = resolverSlot(p.b, ps);
      if (a === null || b === null) continue;
      if (!aus.has(a) && !aus.has(b)) continue;
      const pasaA = !aus.has(a) || aus.has(b); // los dos ausentes: pasa el de arriba
      const nuevo: PartidoLlave = { ...p, puntosA: pasaA ? 1 : 0, puntosB: pasaA ? 0 : 1, wo: true };
      ps = ps.map((x) => (x.id === p.id ? nuevo : x));
      cambio = true;
    }
    if (!cambio) break;
  }
  return ps;
}

/** Quién perdió un cruce resuelto (o null). */
function perdedor(p: PartidoLlave, ps: PartidoLlave[]): string | null {
  const g = ganadorPartido(p, ps);
  if (g === null || !resultadoValido(p.puntosA, p.puntosB)) return null;
  const a = resolverSlot(p.a, ps);
  const b = resolverSlot(p.b, ps);
  return g === a ? b : a;
}

/** Borra los W.O. que perdió `id` (con la cascada de la llave), del primero al último. */
function deshacerWoDe(partidos: PartidoLlave[], id: string): PartidoLlave[] {
  let ps = partidos;
  for (let vuelta = 0; vuelta < partidos.length; vuelta++) {
    const p = [...ps].sort(ordenar).find((x) => x.wo && perdedor(x, ps) === id);
    if (!p) break;
    ps = cargarResultadoLlave(ps, p.id, null, null).partidos;
  }
  return ps;
}

/** Marca (o desmarca) a un jugador como ausente y deja la llave resuelta. Puro. */
export function conAusente(t: Torneo, id: string, ausente: boolean): Torneo {
  const actuales = ausentesDe(t);
  const ya = actuales.includes(id);
  if (ausente === ya) return aplicarAusentes(t);
  const ausentes = ausente ? [...actuales, id] : actuales.filter((x) => x !== id);
  const { ausentes: _viejo, ...resto } = t;
  const base: Torneo = ausentes.length > 0 ? { ...resto, ausentes } : resto;
  if (!base.partidosLlave) return base;
  const partidos = ausente ? base.partidosLlave : deshacerWoDe(base.partidosLlave, id);
  return { ...base, partidosLlave: resolverAusentes(partidos, ausentes) };
}

/** Deja la llave al día con los ausentes (misma referencia si no hay nada que hacer). */
export function aplicarAusentes(t: Torneo): Torneo {
  if (!t.partidosLlave) return t;
  const ps = resolverAusentes(t.partidosLlave, ausentesDe(t));
  return ps === t.partidosLlave ? t : { ...t, partidosLlave: ps };
}

/**
 * Cruces jugados de verdad (con resultado y sin W.O.) que pierden su resultado al pasar de
 * `antes` a `despues`. Es lo que se avisa antes de una corrección o de desmarcar un ausente.
 */
export function realesBorrados(antes: PartidoLlave[], despues: PartidoLlave[]): PartidoLlave[] {
  const porId = new Map(despues.map((p) => [p.id, p]));
  return antes.filter((p) => {
    if (p.wo || !resultadoValido(p.puntosA, p.puntosB)) return false;
    const d = porId.get(p.id);
    return !d || d.puntosA !== p.puntosA || d.puntosB !== p.puntosB;
  });
}

/** Qué cruces jugados de verdad se borrarían si `id` deja de estar ausente. */
export function borradosSiDesmarco(t: Torneo, id: string): PartidoLlave[] {
  if (!t.partidosLlave) return [];
  const despues = conAusente(t, id, false).partidosLlave ?? [];
  return realesBorrados(t.partidosLlave, despues);
}
