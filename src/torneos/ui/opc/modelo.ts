// Lógica pura de la pantalla de control del One Point Challenge (llave "rolling" a un punto).
// Nada de React acá: la pantalla (ControlOpc) solo dibuja lo que sale de estas funciones.
import type { PartidoLlave, SlotLlave } from '../../engine/tipos';
import { resultadoValido } from '../../engine/tipos';
import { borradosSiCorrijo, cargarResultadoLlave, ganadorPartido, podio, resolverSlot } from '../../engine/llave';

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
};

export type Ronda = {
  ronda: number;
  nombre: string;
  /** Jugadores vivos al arrancar la ronda (los que juegan + el que pasa directo). */
  vivos: number;
  cruces: Cruce[];
  jugados: number;
  /** Quién pasa directo a la ronda siguiente sin jugar esta (número impar). */
  pasaDirecto: { slot: SlotLlave; id: string | null } | null;
};

export type ModeloOpc = {
  rondas: Ronda[];
  /** Todos los cruces en orden de juego (ronda, posición). */
  cruces: Cruce[];
  total: number;
  jugados: number;
  /** Primera ronda con cruces sin resultado (la final si ya está todo). */
  rondaActual: number;
  campeon: string | null;
  subcampeon: string | null;
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

export function armarModelo(partidos: PartidoLlave[]): ModeloOpc {
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
      orden += 1;
      return { partido: p, ronda: r, numero: i + 1, deRonda: deRonda.length, orden, idA, idB, ganador, estado };
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
    rondas.push({ ronda: r, nombre: nombreRonda(vivos, r), vivos, cruces: lista, jugados: lista.filter((c) => c.estado === 'jugado').length, pasaDirecto });
    cruces.push(...lista);
  }
  const jugados = cruces.filter((c) => c.estado === 'jugado').length;
  const rondaActual = rondas.find((r) => r.jugados < r.cruces.length)?.ronda ?? numeros[numeros.length - 1] ?? 1;
  const { campeon, subcampeon } = podio(partidos);
  return { rondas, cruces, total: cruces.length, jugados, rondaActual, campeon, subcampeon };
}

/** Próximo cruce para jugar (listo, sin resultado) después de `desdeId` en el orden de juego; da la vuelta. */
export function proximoListo(modelo: ModeloOpc, desdeId: string | null, excluir: string[] = []): Cruce | null {
  const listos = modelo.cruces.filter((c) => c.estado === 'listo' && !excluir.includes(c.partido.id));
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

/** Cuántos resultados posteriores se borrarían con esta marca (para pedir confirmación). */
export function borradosSiMarco(partidos: PartidoLlave[], partidoId: string, lado: 'a' | 'b' | null): number {
  const m = marcaDe(lado);
  return borradosSiCorrijo(partidos, partidoId, m.puntosA, m.puntosB);
}

/** Aplica el toque (puro: va dentro del updater de `actualizar`). */
export function marcar(partidos: PartidoLlave[], partidoId: string, lado: 'a' | 'b' | null, ahora: string): PartidoLlave[] {
  const m = marcaDe(lado);
  return cargarResultadoLlave(partidos, partidoId, m.puntosA, m.puntosB).partidos.map((p) => {
    if (p.id !== partidoId) return p;
    if (lado === null) {
      const { cargadoEl: _c, ...resto } = p;
      return resto;
    }
    return p.cargadoEl ? p : { ...p, cargadoEl: ahora };
  });
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
