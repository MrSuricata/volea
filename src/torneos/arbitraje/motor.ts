// Motor del tanteador de árbitros. Reconstruye todo el estado de un partido desde la lista de
// jugadas (inicio, rallies, tiempos), así "deshacer" es borrar la última jugada y el servidor
// solo tiene que guardar la lista. Reglas USA Pickleball: side out con servidor 1/2 y "0-0-2",
// rally a 15/21, por 2, cambio de lado en el game decisivo a 6/8/11.
import type { FormatoArbitraje } from '../engine/tipos';

export type Lado = 'A' | 'B';

export type Jugada =
  | { t: 'inicio'; saca: Lado; derechaA: 0 | 1; derechaB: 0 | 1 }
  | { t: 'rally'; gana: Lado }
  | { t: 'tiempo'; equipo: Lado };

export type EstadoArbitraje = {
  iniciado: boolean;
  games: { a: number; b: number }[]; // games terminados
  puntos: { a: number; b: number }; // game en curso (o el último si terminó el partido)
  gamesA: number;
  gamesB: number;
  game: number; // 1..3
  saca: Lado;
  servidor: 1 | 2; // solo cuenta en side out de dobles
  sirve: 0 | 1; // jugador del equipo que saca que tiene la pelota (índice en la pareja)
  derecha: { A: 0 | 1; B: 0 | 1 }; // jugador parado a la derecha en cada equipo
  tiempos: { A: number; B: number }; // usados en el game en curso
  maxTiempos: number;
  cambiarLado: boolean; // el último rally llegó a la mitad del game decisivo
  finDeGame: boolean; // el último rally cerró un game (sin cerrar el partido)
  terminado: boolean;
  ganador: Lado | null;
  canto: string; // "4-2-1" (side out dobles) o "4-2"
};

export const FORMATO_DEFECTO: FormatoArbitraje = { tipo: 'rally', a: 15, mejorDe: 1 };

const otro = (l: Lado): Lado => (l === 'A' ? 'B' : 'A');
const cruzar = (i: 0 | 1): 0 | 1 => (i === 0 ? 1 : 0);
const mitadDe = (a: number) => (a === 11 ? 6 : a === 15 ? 8 : 11);
const gana = (x: number, y: number, objetivo: number) => x >= objetivo && x - y >= 2;

export function estadoDe(f: FormatoArbitraje, dobles: boolean, jugadas: Jugada[]): EstadoArbitraje {
  const e: EstadoArbitraje = {
    iniciado: false, games: [], puntos: { a: 0, b: 0 }, gamesA: 0, gamesB: 0, game: 1,
    saca: 'A', servidor: 1, sirve: 0, derecha: { A: 0, B: 0 }, tiempos: { A: 0, B: 0 },
    maxTiempos: f.a === 21 ? 3 : 2, cambiarLado: false, finDeGame: false, terminado: false, ganador: null, canto: '',
  };
  let inicio: Extract<Jugada, { t: 'inicio' }> | null = null;
  let sacoPrimero: Lado = 'A';
  let cambioHecho = false;
  const de = (l: Lado) => (l === 'A' ? e.puntos.a : e.puntos.b);
  const sumar = (l: Lado) => { if (l === 'A') e.puntos.a++; else e.puntos.b++; };

  const empezarGame = (saca: Lado) => {
    e.puntos = { a: 0, b: 0 };
    e.saca = saca;
    sacoPrimero = saca;
    e.tiempos = { A: 0, B: 0 };
    cambioHecho = false;
    e.derecha = { A: inicio!.derechaA, B: inicio!.derechaB };
    e.sirve = dobles ? e.derecha[saca] : 0;
    e.servidor = f.tipo === 'sideout' && dobles ? 2 : 1;
  };

  for (const j of jugadas) {
    if (e.terminado) break;
    e.cambiarLado = false;
    e.finDeGame = false;
    if (j.t === 'inicio') {
      if (e.iniciado) continue;
      inicio = j;
      e.iniciado = true;
      empezarGame(j.saca);
      continue;
    }
    if (!e.iniciado) continue;
    if (j.t === 'tiempo') {
      if (e.tiempos[j.equipo] < e.maxTiempos) e.tiempos[j.equipo]++;
      continue;
    }
    const saca = e.saca;
    if (f.tipo === 'rally') {
      sumar(j.gana);
      if (j.gana === saca) {
        if (dobles) e.derecha[saca] = cruzar(e.derecha[saca]);
      } else {
        e.saca = j.gana;
      }
      // Saca el de la derecha con puntaje par y el de la izquierda con impar.
      if (dobles) e.sirve = de(e.saca) % 2 === 0 ? e.derecha[e.saca] : cruzar(e.derecha[e.saca]);
    } else if (j.gana === saca) {
      sumar(saca);
      if (dobles) e.derecha[saca] = cruzar(e.derecha[saca]);
    } else if (dobles && e.servidor === 1) {
      e.servidor = 2;
      e.sirve = cruzar(e.sirve);
    } else {
      e.saca = otro(saca);
      e.servidor = 1;
      e.sirve = dobles ? e.derecha[e.saca] : 0;
    }

    const { a: pa, b: pb } = e.puntos;
    if (gana(pa, pb, f.a) || gana(pb, pa, f.a)) {
      const ganadorGame: Lado = pa > pb ? 'A' : 'B';
      e.games.push({ a: pa, b: pb });
      if (ganadorGame === 'A') e.gamesA++; else e.gamesB++;
      const necesarios = f.mejorDe === 3 ? 2 : 1;
      if (e.gamesA === necesarios || e.gamesB === necesarios) {
        e.terminado = true;
        e.ganador = ganadorGame;
      } else {
        e.finDeGame = true;
        e.game++;
        empezarGame(otro(sacoPrimero));
      }
    } else {
      const decisivo = f.mejorDe === 1 || e.game === 3;
      if (decisivo && !cambioHecho && Math.max(pa, pb) === mitadDe(f.a)) {
        e.cambiarLado = true;
        cambioHecho = true;
      }
    }
  }

  if (e.iniciado) {
    const ps = de(e.saca);
    const pr = de(otro(e.saca));
    e.canto = f.tipo === 'sideout' && dobles ? `${ps}-${pr}-${e.servidor}` : `${ps}-${pr}`;
  }
  return e;
}

/** Lo que se escribe en el cuadro al terminar (null si el partido no terminó). */
export function resultadoFinal(f: FormatoArbitraje, e: EstadoArbitraje): { puntosA: number; puntosB: number; games?: { a: number; b: number }[] } | null {
  if (!e.terminado) return null;
  if (f.mejorDe === 1) return { puntosA: e.games[0].a, puntosB: e.games[0].b };
  return { puntosA: e.gamesA, puntosB: e.gamesB, games: e.games };
}

export type Marcador = Pick<EstadoArbitraje, 'puntos' | 'games' | 'gamesA' | 'gamesB' | 'game' | 'saca' | 'servidor' | 'canto' | 'terminado' | 'ganador'>;

/** Lo que leen la TV y la web pública (sin rehacer el cálculo). */
export function resumen(e: EstadoArbitraje): Marcador {
  const { puntos, games, gamesA, gamesB, game, saca, servidor, canto, terminado, ganador } = e;
  return { puntos, games, gamesA, gamesB, game, saca, servidor, canto, terminado, ganador };
}
