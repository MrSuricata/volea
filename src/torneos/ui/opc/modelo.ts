// Lógica pura de la pantalla de control del One Point Challenge (llave "rolling" a un punto).
// Nada de React acá: la pantalla (ControlOpc) solo dibuja lo que sale de estas funciones.
import type { PartidoLlave, SlotLlave } from '../../engine/tipos';
import { resultadoValido } from '../../engine/tipos';
import { cargarResultadoLlave, ganadorPartido, podio, resolverSlot } from '../../engine/llave';
import { realesBorrados, resolverAusentes } from './ausentes';

export type EstadoCruce = 'esperando' | 'listo' | 'jugado';

export type Cruce = {
  partido: PartidoLlave;
  ronda: number;
  /** 1-based dentro de la ronda. */
  numero: number;
  /** Cantidad de cruces de la ronda. */
  deRonda: number;
  /** 1-based en el orden de juego de toda la llave. */
  orden: number;
  idA: string | null;
  idB: string | null;
  ganador: string | null;
  estado: EstadoCruce;
  /** Resuelto por W.O. (alguien no se presentó): cuenta como resuelto, pero no se jugó. */
  wo: boolean;
  /**
   * Si el jugador de cada lado figura, EN ESTE CRUCE, como que no se presentó: está marcado
   * ausente y el cruce no se jugó de verdad. En un W.O. el que pasa solo figura ausente si nunca
   * jugó un cruce (pasó contra otro ausente); si jugó y faltó después, ese W.O. lo ganó presente.
   */
  ausenteA: boolean;
  ausenteB: boolean;
};

export type Ronda = {
  ronda: number;
  nombre: string;
  /** Jugadores vivos al arrancar la ronda (los que juegan + el que pasa directo). */
  vivos: number;
  cruces: Cruce[];
  /** Cruces resueltos (jugados + por W.O.). */
  jugados: number;
  /** De esos, cuántos por W.O. */
  porWo: number;
  /** Quién pasa directo a la ronda siguiente sin jugar esta (número impar). */
  pasaDirecto: { slot: SlotLlave; id: string | null } | null;
};

export type ModeloOpc = {
  rondas: Ronda[];
  /** Todos los cruces en orden de juego (ronda, posición). */
  cruces: Cruce[];
  total: number;
  /** Cruces resueltos (jugados + por W.O.): lo que ya no falta. */
  jugados: number;
  porWo: number;
  /** Primera ronda con cruces sin resultado (la final si ya está todo). */
  rondaActual: number;
  campeon: string | null;
  subcampeon: string | null;
  /** La final se resolvió por W.O. (el subcampeón no se presentó). */
  finalPorWo: boolean;
  /** Los que no se presentaron (parejaIds). */
  ausentes: string[];
};

const ordenar = (a: PartidoLlave, b: PartidoLlave) => a.ronda - b.ronda || a.posicion - b.posicion;

// Nombre de la ronda según cuántos quedan vivos: lo mismo que mira el ranking para pagar
// (ver escalonEnLlave: perder con ≤2 vivos = finalista, ≤4 = semi…). En el rolling las rondas
// no son potencias de 2, así que no se llaman "cuartos/octavos": solo Final y Semifinal, que
// sí se entienden siempre, y "Ronda N" para el resto.
export function nombreRonda(vivos: number, ronda: number): string {
  if (vivos <= 2) return 'Final';
  if (vivos <= 4) return 'Semifinal';
  return `Ronda ${ronda}`;
}

export function armarModelo(partidos: PartidoLlave[], ausentes: readonly string[] = []): ModeloOpc {
  const aus = new Set(ausentes);
  // Los que jugaron al menos un cruce de verdad (con resultado y sin W.O.).
  const jugaron = new Set<string>();
  for (const p of partidos) {
    if (p.wo || !resultadoValido(p.puntosA, p.puntosB)) continue;
    for (const s of [p.a, p.b]) { const id = resolverSlot(s, partidos); if (id) jugaron.add(id); }
  }
  const reales = partidos.filter((p) => !p.esTercerPuesto).sort(ordenar);
  const rondaDe = new Map(reales.map((p) => [p.id, p.ronda]));
  const numeros = [...new Set(reales.map((p) => p.ronda))].sort((a, b) => a - b);
  const cruces: Cruce[] = [];
  const rondas: Ronda[] = [];
  let orden = 0;
  for (const r of numeros) {
    const deRonda = reales.filter((p) => p.ronda === r);
    const lista: Cruce[] = deRonda.map((p, i) => {
      const idA = resolverSlot(p.a, partidos);
      const idB = resolverSlot(p.b, partidos);
      const ganador = ganadorPartido(p, partidos);
      const jugado = resultadoValido(p.puntosA, p.puntosB) && ganador !== null;
      const estado: EstadoCruce = jugado ? 'jugado' : idA !== null && idB !== null ? 'listo' : 'esperando';
      const wo = jugado && !!p.wo;
      const figura = (id: string | null) => id !== null && aus.has(id) && (!jugado || (wo && (id !== ganador || !jugaron.has(id))));
      orden += 1;
      return {
        partido: p, ronda: r, numero: i + 1, deRonda: deRonda.length, orden, idA, idB, ganador, estado,
        wo, ausenteA: figura(idA), ausenteB: figura(idB),
      };
    });
    // Pasa directo: el lugar de la ronda siguiente que no sale de un cruce de ESTA ronda.
    const siguiente = reales.filter((p) => p.ronda === r + 1);
    let pasaDirecto: Ronda['pasaDirecto'] = null;
    for (const p of siguiente) {
      for (const s of [p.a, p.b]) {
        if (!s) continue;
        const desdeEsta = s.tipo !== 'seed' && rondaDe.get(s.partidoId) === r;
        if (!desdeEsta) pasaDirecto = { slot: s, id: resolverSlot(s, partidos) };
      }
    }
    const vivos = deRonda.length * 2 + (pasaDirecto ? 1 : 0);
    rondas.push({
      ronda: r, nombre: nombreRonda(vivos, r), vivos, cruces: lista,
      jugados: lista.filter((c) => c.estado === 'jugado').length, porWo: lista.filter((c) => c.wo).length, pasaDirecto,
    });
    cruces.push(...lista);
  }
  const jugados = cruces.filter((c) => c.estado === 'jugado').length;
  const rondaActual = rondas.find((r) => r.jugados < r.cruces.length)?.ronda ?? numeros[numeros.length - 1] ?? 1;
  const { campeon, subcampeon } = podio(partidos);
  const final = cruces[cruces.length - 1];
  return {
    rondas, cruces, total: cruces.length, jugados, porWo: cruces.filter((c) => c.wo).length, rondaActual, campeon, subcampeon,
    finalPorWo: campeon !== null && !!final?.wo, ausentes: [...aus],
  };
}

/**
 * Próximo cruce para jugar (listo, sin resultado) después de `desdeId` en el orden de juego; da la
 * vuelta. Nunca uno con un ausente (se resuelve solo por W.O.; si todavía no se resolvió, tampoco
 * se lo propone).
 */
export function proximoListo(modelo: ModeloOpc, desdeId: string | null, excluir: string[] = []): Cruce | null {
  const listos = modelo.cruces.filter((c) => c.estado === 'listo' && !c.ausenteA && !c.ausenteB && !excluir.includes(c.partido.id));
  if (listos.length === 0) return null;
  const i = desdeId ? modelo.cruces.findIndex((c) => c.partido.id === desdeId) : -1;
  return listos.find((c) => c.orden - 1 > i) ?? listos[0];
}

/** El cruce que se muestra al abrir: el guardado si existe, si no el primero para jugar (o la final). */
export function cruceInicial(modelo: ModeloOpc, guardado: string | null | undefined): Cruce | null {
  const g = guardado ? modelo.cruces.find((c) => c.partido.id === guardado) : undefined;
  if (g) return g;
  return proximoListo(modelo, null) ?? modelo.cruces[modelo.cruces.length - 1] ?? null;
}

/** Cómo se describe un lugar que todavía no tiene jugador ("Ganador del cruce 2 · Ronda 1"). */
export function describirLugar(modelo: ModeloOpc, slot: SlotLlave | null): string {
  if (!slot) return 'Pasa directo';
  if (slot.tipo === 'seed') return 'A definir';
  const c = modelo.cruces.find((x) => x.partido.id === slot.partidoId);
  if (!c) return 'A definir';
  const r = modelo.rondas.find((x) => x.ronda === c.ronda);
  return `${slot.tipo === 'ganadorDe' ? 'Ganador' : 'Perdedor'} del cruce ${c.numero} · ${r?.nombre ?? `Ronda ${c.ronda}`}`;
}

export type Marca = { puntosA: number | null; puntosB: number | null };

/** El resultado de un toque: el ganador se guarda 1-0 (o 0-1). null = borrar el resultado. */
export function marcaDe(lado: 'a' | 'b' | null): Marca {
  if (lado === null) return { puntosA: null, puntosB: null };
  return lado === 'a' ? { puntosA: 1, puntosB: 0 } : { puntosA: 0, puntosB: 1 };
}

/**
 * Cuántos resultados JUGADOS posteriores se borrarían con esta marca (para pedir confirmación).
 * Los W.O. automáticos que dependían de él no cuentan: se vuelven a resolver solos.
 */
export function borradosSiMarco(partidos: PartidoLlave[], partidoId: string, lado: 'a' | 'b' | null, ausentes: readonly string[] = []): number {
  const despues = marcar(partidos, partidoId, lado, '', ausentes);
  return realesBorrados(partidos, despues).filter((p) => p.id !== partidoId).length;
}

/**
 * Aplica el toque (puro: va dentro del updater de `actualizar`). Con `ausentes`, después del
 * toque se resuelven por W.O. los cruces que quedaron listos con un ausente (nunca queda uno
 * esperando un toque).
 */
export function marcar(partidos: PartidoLlave[], partidoId: string, lado: 'a' | 'b' | null, ahora: string, ausentes: readonly string[] = []): PartidoLlave[] {
  const m = marcaDe(lado);
  const marcados = cargarResultadoLlave(partidos, partidoId, m.puntosA, m.puntosB).partidos.map((p) => {
    if (p.id !== partidoId) return p;
    if (lado === null) {
      const { cargadoEl: _c, ...resto } = p;
      return resto;
    }
    return p.cargadoEl ? p : { ...p, cargadoEl: ahora };
  });
  return resolverAusentes(marcados, ausentes);
}

/**
 * Limpia una lista pegada de jugadores: una línea por jugador, sin la numeración ni las viñetas
 * que traen las listas de WhatsApp ("1. Ana", "2) Beto", "- Carla", "• Diego").
 */
export function limpiarListaJugadores(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*(?:\d{1,3}\s*[.)\-–:]|[-–•*·])\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
