# Tanteador de árbitros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un árbitro marque cada partido de un torneo del gestor desde el celular con un código de 4 dígitos, que el marcador se vea en vivo (TV, web pública, En vivo) y que el resultado entre solo al cuadro.

**Architecture:** Motor de tanteo puro en TS (`src/torneos/arbitraje/motor.ts`) que reconstruye el estado desde la lista de jugadas. La base guarda el marcador en `arbitraje_partidos` (lectura pública + Realtime) y los códigos en `arbitraje_codigos` (privada); todo se escribe por funciones `SECURITY DEFINER` que validan el código. `arbitro_terminar` escribe el resultado en `rk_torneos.data` dentro de la base. La web suma la pantalla `/arbitro`, la hoja de códigos y el formato por categoría en el gestor, y el marcador en vivo donde ya se muestran las canchas.

**Tech Stack:** Vite + React 19 + TS + Tailwind, Supabase (Postgres, RLS, Realtime, RPC), vitest (`--no-file-parallelism`), typecheck `npx tsc -b`.

Spec: `docs/superpowers/specs/2026-10-27-tanteador-arbitros-design.md`. Rama: `feat/arbitros` (no se mergea a master hasta que Brian pegue la migración v35 y lo pruebe).

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/torneos/engine/tipos.ts` (mod) | `FormatoArbitraje`, `Torneo.arbitraje`, `games` en los partidos |
| `src/torneos/arbitraje/motor.ts` (+test) | Reglas: rally / side out, servidores, lados, cambio de lado, games, tiempos, canto, resultado |
| `src/torneos/arbitraje/partido.ts` (+test) | Del torneo al partido arbitrado: lados con nombres y jugadores, formato que corresponde, lista para la hoja de códigos |
| `supabase/migraciones_propuestas/v35_arbitraje.sql` | Tablas + funciones `arbitro_*` y `admin_codigos_torneo` |
| `src/torneos/arbitraje/servicio.ts` | Llamadas a la base (RPC, lectura de marcadores, Realtime) |
| `src/torneos/arbitraje/ArbitroPage.tsx` | Pantalla del árbitro `/arbitro` |
| `src/torneos/arbitraje/MarcadorVivo.tsx` | Hook `useMarcadores` + componente del marcador chico |
| `src/torneos/arbitraje/HojaCodigos.tsx` | Diálogo del gestor con los códigos para imprimir / WhatsApp |
| `src/torneos/ui/SelectorArbitraje.tsx` | Formato de arbitraje por categoría (Ajustes del cuadro) |
| `src/App.tsx` (mod) | Ruta `/arbitro` |
| `src/torneos/TorneosApp.tsx` (mod) | Ajustes: selector de formato + botón de códigos |
| `src/torneos/publico/ProgramacionPage.tsx`, `PantallaTv.tsx` (mod) | Marcador en vivo en cada cancha |

---

### Task 1: Tipos

**Files:** Modify `src/torneos/engine/tipos.ts`

- [ ] **Step 1:** Agregar al final de `PartidoGrupo` y de `PartidoLlave` (después de `cargadoEl?`):

```ts
  // Mejor de 3 (tanteador de árbitros): puntosA/puntosB son los games ganados y acá va el detalle.
  games?: { a: number; b: number }[];
```

- [ ] **Step 2:** Antes de `export type Torneo`, agregar:

```ts
// Cómo se cuenta un partido arbitrado (tanteador de árbitros).
export type FormatoArbitraje = { tipo: 'rally' | 'sideout'; a: 11 | 15 | 21; mejorDe: 1 | 3 };
```

y dentro de `Torneo`, después de `formatoLlave?`:

```ts
  // Formato del tanteador de árbitros: uno para la fase de grupos y otro para la llave.
  arbitraje?: { grupos?: FormatoArbitraje; llave?: FormatoArbitraje };
```

- [ ] **Step 3:** `npx tsc -b` → sin errores. Commit `git commit -am "Arbitraje: tipos"`.

---

### Task 2: Motor de tanteo

**Files:** Create `src/torneos/arbitraje/motor.ts`, `src/torneos/arbitraje/motor.test.ts`

- [ ] **Step 1: Tests (fallan porque no existe el módulo)**

```ts
// file: src/torneos/arbitraje/motor.test.ts
import { describe, expect, it } from 'vitest';
import { estadoDe, resultadoFinal, resumen, type Jugada } from './motor';
import type { FormatoArbitraje } from '../engine/tipos';

const SO11: FormatoArbitraje = { tipo: 'sideout', a: 11, mejorDe: 1 };
const RA15: FormatoArbitraje = { tipo: 'rally', a: 15, mejorDe: 1 };
const RA11x3: FormatoArbitraje = { tipo: 'rally', a: 11, mejorDe: 3 };
const ini = (saca: 'A' | 'B' = 'A'): Jugada => ({ t: 'inicio', saca, derechaA: 0, derechaB: 0 });
const r = (gana: 'A' | 'B'): Jugada => ({ t: 'rally', gana });
const rallies = (gana: 'A' | 'B', n: number) => Array.from({ length: n }, () => r(gana));

describe('side out en dobles', () => {
  it('arranca 0-0-2 y el primer side out es directo', () => {
    let e = estadoDe(SO11, true, [ini('A')]);
    expect(e.canto).toBe('0-0-2');
    e = estadoDe(SO11, true, [ini('A'), r('B')]);
    expect(e.saca).toBe('B');
    expect(e.servidor).toBe(1);
    expect(e.canto).toBe('0-0-1');
  });

  it('solo suma el que saca; el servidor 1 pierde y pasa al 2', () => {
    const e = estadoDe(SO11, true, [ini('A'), r('B'), r('B'), r('A')]);
    expect(e.puntos).toEqual({ a: 0, b: 1 });
    expect(e.saca).toBe('B');
    expect(e.servidor).toBe(2);
    expect(e.canto).toBe('1-0-2');
  });

  it('el que saca cambia de lado al sumar y sigue sacando el mismo', () => {
    const e = estadoDe(SO11, true, [ini('A'), r('A')]);
    expect(e.puntos).toEqual({ a: 1, b: 0 });
    expect(e.derecha.A).toBe(1);
    expect(e.sirve).toBe(0);
  });

  it('game a 11 por 2 y cambio de lado a 6', () => {
    const e6 = estadoDe(SO11, true, [ini('A'), ...rallies('A', 6)]);
    expect(e6.cambiarLado).toBe(true);
    const e7 = estadoDe(SO11, true, [ini('A'), ...rallies('A', 7)]);
    expect(e7.cambiarLado).toBe(false);
    const fin = estadoDe(SO11, true, [ini('A'), ...rallies('A', 11)]);
    expect(fin.terminado).toBe(true);
    expect(fin.ganador).toBe('A');
    expect(resultadoFinal(SO11, fin)).toEqual({ puntosA: 11, puntosB: 0 });
  });
});

describe('side out en singles', () => {
  it('no hay servidor 2: perder el saque es side out', () => {
    const e = estadoDe(SO11, false, [ini('A'), r('B')]);
    expect(e.saca).toBe('B');
    expect(e.canto).toBe('0-0');
  });
});

describe('rally', () => {
  it('cada rally suma y el que gana recibiendo pasa a sacar', () => {
    const e = estadoDe(RA15, true, [ini('A'), r('B')]);
    expect(e.puntos).toEqual({ a: 0, b: 1 });
    expect(e.saca).toBe('B');
    expect(e.canto).toBe('1-0');
  });

  it('se gana por 2: 15-14 sigue, 16-14 termina', () => {
    const base = [ini('A'), ...rallies('A', 14), ...rallies('B', 14)];
    expect(estadoDe(RA15, true, [...base, r('A')]).terminado).toBe(false);
    const fin = estadoDe(RA15, true, [...base, r('A'), r('A')]);
    expect(fin.terminado).toBe(true);
    expect(resultadoFinal(RA15, fin)).toEqual({ puntosA: 16, puntosB: 14 });
  });

  it('cambio de lado a 8 en game a 15', () => {
    expect(estadoDe(RA15, true, [ini('A'), ...rallies('B', 8)]).cambiarLado).toBe(true);
  });
});

describe('mejor de 3', () => {
  it('2-0 termina; el segundo game lo saca el otro equipo', () => {
    const g1 = [ini('A'), ...rallies('A', 11)];
    const tras1 = estadoDe(RA11x3, true, g1);
    expect(tras1.finDeGame).toBe(true);
    expect(tras1.terminado).toBe(false);
    expect(tras1.game).toBe(2);
    expect(tras1.saca).toBe('B');
    expect(tras1.puntos).toEqual({ a: 0, b: 0 });
    const fin = estadoDe(RA11x3, true, [...g1, ...rallies('A', 11)]);
    expect(fin.terminado).toBe(true);
    expect(resultadoFinal(RA11x3, fin)).toEqual({ puntosA: 2, puntosB: 0, games: [{ a: 11, b: 0 }, { a: 11, b: 0 }] });
  });

  it('el cambio de lado de mitad solo va en el tercer game', () => {
    const g1 = [ini('A'), ...rallies('A', 6)];
    expect(estadoDe(RA11x3, true, g1).cambiarLado).toBe(false);
    const hasta3 = [ini('A'), ...rallies('A', 11), ...rallies('B', 11), ...rallies('A', 6)];
    expect(estadoDe(RA11x3, true, hasta3).cambiarLado).toBe(true);
  });
});

describe('tiempos, deshacer y resumen', () => {
  it('cuenta los tiempos hasta el máximo del game', () => {
    const e = estadoDe(SO11, true, [ini('A'), { t: 'tiempo', equipo: 'A' }, { t: 'tiempo', equipo: 'A' }, { t: 'tiempo', equipo: 'A' }]);
    expect(e.tiempos.A).toBe(2);
    expect(e.maxTiempos).toBe(2);
  });

  it('las jugadas después del final no cuentan', () => {
    const e = estadoDe(SO11, true, [ini('A'), ...rallies('A', 11), r('B')]);
    expect(e.puntos).toEqual({ a: 11, b: 0 });
  });

  it('sin inicio no hay partido', () => {
    expect(estadoDe(SO11, true, [r('A')]).iniciado).toBe(false);
  });

  it('el resumen lleva lo que necesita la TV', () => {
    const e = estadoDe(RA15, true, [ini('A'), r('A'), r('B')]);
    expect(resumen(e)).toMatchObject({ puntos: { a: 1, b: 1 }, saca: 'B', game: 1, gamesA: 0, gamesB: 0, terminado: false });
  });
});
```

- [ ] **Step 2:** `npx vitest run --no-file-parallelism src/torneos/arbitraje/motor.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementación**

```ts
// file: src/torneos/arbitraje/motor.ts
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
```

- [ ] **Step 4:** Correr los tests → PASS. `npx tsc -b` → OK.
- [ ] **Step 5:** Commit `git add src/torneos/arbitraje && git commit -m "Arbitraje: motor de tanteo"`.

---

### Task 3: Del torneo al partido arbitrado

**Files:** Create `src/torneos/arbitraje/partido.ts`, `src/torneos/arbitraje/partido.test.ts`

- [ ] **Step 1: Tests**

```ts
// file: src/torneos/arbitraje/partido.test.ts
import { describe, expect, it } from 'vitest';
import type { Torneo } from '../engine/tipos';
import { esDobles, formatoDe, ladosDelPartido, partidosArbitrables } from './partido';

const torneo = (c: Partial<Torneo> = {}): Torneo => ({
  id: 't', nombre: 'MIXTO A', creadoEl: '2026-10-27', fase: 'llave',
  parejas: [
    { id: 'p1', nombre: 'ANA PEREZ y LUIS GOMEZ' }, { id: 'p2', nombre: 'EVA RUIZ y JUAN SOSA' },
    { id: 'p3', nombre: 'SOL DIAZ y PEDRO PAZ' }, { id: 'p4', nombre: 'LIA MORA y TOMAS RIOS' },
  ],
  grupos: [{ id: 'g1', nombre: 'A', parejaIds: ['p1', 'p2'] }],
  partidosGrupo: [{ id: 'm1', grupoId: 'g1', ronda: 1, aId: 'p1', bId: 'p2', puntosA: null, puntosB: null }],
  configLlave: null,
  partidosLlave: [
    { id: 's1', ronda: 1, posicion: 0, a: { tipo: 'seed', parejaId: 'p1' }, b: { tipo: 'seed', parejaId: 'p3' }, puntosA: 15, puntosB: 9, esTercerPuesto: false },
    { id: 's2', ronda: 1, posicion: 1, a: { tipo: 'seed', parejaId: 'p2' }, b: { tipo: 'seed', parejaId: 'p4' }, puntosA: null, puntosB: null, esTercerPuesto: false },
    { id: 'f', ronda: 2, posicion: 0, a: { tipo: 'ganadorDe', partidoId: 's1' }, b: { tipo: 'ganadorDe', partidoId: 's2' }, puntosA: null, puntosB: null, esTercerPuesto: false },
  ],
  ...c,
});

describe('partido arbitrado', () => {
  it('arma los lados con jugadores separados', () => {
    const l = ladosDelPartido(torneo(), 'm1');
    expect(l?.fase).toBe('grupo');
    expect(l?.a?.jugadores).toEqual(['ANA PEREZ', 'LUIS GOMEZ']);
    expect(l?.b?.nombre).toBe('EVA RUIZ y JUAN SOSA');
  });

  it('en la llave resuelve el ganador anterior y deja null lo que todavía no se sabe', () => {
    const l = ladosDelPartido(torneo(), 'f');
    expect(l?.fase).toBe('llave');
    expect(l?.a?.nombre).toBe('ANA PEREZ y LUIS GOMEZ');
    expect(l?.b).toBeNull();
  });

  it('formato por fase con defecto rally a 15', () => {
    const t = torneo({ arbitraje: { llave: { tipo: 'sideout', a: 11, mejorDe: 3 } } });
    expect(formatoDe(t, 'grupo')).toEqual({ tipo: 'rally', a: 15, mejorDe: 1 });
    expect(formatoDe(t, 'llave')).toEqual({ tipo: 'sideout', a: 11, mejorDe: 3 });
  });

  it('detecta singles', () => {
    expect(esDobles(torneo())).toBe(true);
    expect(esDobles(torneo({ parejas: [{ id: 'x', nombre: 'ANA PEREZ' }] }))).toBe(false);
  });

  it('lista los partidos para la hoja: sin byes y en orden de juego', () => {
    const ids = partidosArbitrables(torneo()).map((p) => p.partidoId);
    expect(ids).toEqual(['m1', 's1', 's2', 'f']);
  });
});
```

- [ ] **Step 2:** Correr → FAIL.

- [ ] **Step 3: Implementación**

```ts
// file: src/torneos/arbitraje/partido.ts
// Del torneo del gestor al partido que marca el árbitro: quién juega (resolviendo los cruces de la
// llave), con qué formato y en qué orden van en la hoja de códigos.
import type { FormatoArbitraje, Torneo } from '../engine/tipos';
import { resolverSlot } from '../engine/llave';
import { FORMATO_DEFECTO } from './motor';

export type LadoPartido = { parejaId: string; nombre: string; jugadores: string[] };
export type PartidoArbitrado = { fase: 'grupo' | 'llave'; titulo: string; a: LadoPartido | null; b: LadoPartido | null; jugado: boolean };

const jugadoresDe = (nombre: string) => nombre.split(/\s+y\s+|\s*\/\s*/i).map((s) => s.trim()).filter(Boolean);

function lado(t: Torneo, parejaId: string | null): LadoPartido | null {
  if (!parejaId) return null;
  const p = t.parejas.find((x) => x.id === parejaId);
  return p ? { parejaId, nombre: p.nombre, jugadores: jugadoresDe(p.nombre) } : null;
}

const RONDAS: Record<number, string> = { 1: 'Final', 2: 'Semifinal', 4: 'Cuartos', 8: 'Octavos' };

export function ladosDelPartido(t: Torneo, partidoId: string): PartidoArbitrado | null {
  const g = t.partidosGrupo.find((p) => p.id === partidoId);
  if (g) {
    const grupo = t.grupos.find((x) => x.id === g.grupoId);
    return { fase: 'grupo', titulo: `Grupo ${grupo?.nombre ?? ''} · Ronda ${g.ronda}`, a: lado(t, g.aId), b: lado(t, g.bId), jugado: g.puntosA !== null };
  }
  const llave = t.partidosLlave ?? [];
  const l = llave.find((p) => p.id === partidoId);
  if (!l) return null;
  const maxRonda = Math.max(...llave.map((p) => p.ronda));
  const enRonda = llave.filter((p) => p.ronda === l.ronda && !p.esTercerPuesto).length;
  const titulo = l.esTercerPuesto ? 'Tercer puesto' : (RONDAS[enRonda] ?? `Ronda ${l.ronda}`) + (l.ronda === maxRonda ? '' : '');
  return {
    fase: 'llave', titulo,
    a: lado(t, resolverSlot(l.a, llave)), b: lado(t, resolverSlot(l.b, llave)),
    jugado: l.puntosA !== null,
  };
}

export function formatoDe(t: Torneo, fase: 'grupo' | 'llave'): FormatoArbitraje {
  const f = fase === 'grupo' ? t.arbitraje?.grupos : t.arbitraje?.llave ?? t.arbitraje?.grupos;
  return f ?? FORMATO_DEFECTO;
}

export function esDobles(t: Torneo): boolean {
  return t.parejas.some((p) => (p.jugadorIds?.length ?? 0) >= 2 || jugadoresDe(p.nombre).length >= 2);
}

/** Partidos que pueden tener árbitro, en orden de juego (grupos por ronda, llave por ronda). Sin byes. */
export function partidosArbitrables(t: Torneo): { partidoId: string; fase: 'grupo' | 'llave' }[] {
  const grupos = [...t.partidosGrupo].sort((x, y) => x.ronda - y.ronda).map((p) => ({ partidoId: p.id, fase: 'grupo' as const }));
  const llave = [...(t.partidosLlave ?? [])]
    .filter((p) => p.a !== null && p.b !== null)
    .sort((x, y) => x.ronda - y.ronda || x.posicion - y.posicion)
    .map((p) => ({ partidoId: p.id, fase: 'llave' as const }));
  return [...grupos, ...llave];
}
```

- [ ] **Step 4:** Tests PASS, `npx tsc -b` OK. Commit `"Arbitraje: partido desde el torneo"`.

---

### Task 4: Migración v35

**Files:** Create `supabase/migraciones_propuestas/v35_arbitraje.sql`

- [ ] **Step 1:** Escribir el SQL completo:

```sql
-- file: supabase/migraciones_propuestas/v35_arbitraje.sql
-- v35: tanteador de árbitros. arbitraje_partidos = marcador en vivo (lectura pública + Realtime);
-- arbitraje_codigos = el código de 4 dígitos de cada partido (privada: nunca viaja por Realtime);
-- arbitraje_intentos = códigos fallidos para frenar a quien prueba números. Todo se escribe por RPC.

CREATE TABLE IF NOT EXISTS arbitraje_partidos (
  torneo_id text NOT NULL,
  partido_id text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_juego', 'terminado')),
  formato jsonb NOT NULL,
  dobles boolean NOT NULL DEFAULT true,
  jugadas jsonb NOT NULL DEFAULT '[]'::jsonb,
  marcador jsonb,
  version int NOT NULL DEFAULT 0,
  actualizado timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (torneo_id, partido_id)
);
ALTER TABLE arbitraje_partidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS arbitraje_lectura ON arbitraje_partidos;
CREATE POLICY arbitraje_lectura ON arbitraje_partidos FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON arbitraje_partidos FROM anon, authenticated;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE arbitraje_partidos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS arbitraje_codigos (
  codigo text PRIMARY KEY CHECK (codigo ~ '^[0-9]{4}$'),
  torneo_id text NOT NULL,
  partido_id text NOT NULL,
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (torneo_id, partido_id)
);
ALTER TABLE arbitraje_codigos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arbitraje_codigos FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS arbitraje_intentos (
  origen text NOT NULL,
  cuando timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arbitraje_intentos_origen ON arbitraje_intentos (origen, cuando);
ALTER TABLE arbitraje_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arbitraje_intentos FROM anon, authenticated;

-- Quién llama (IP según el proxy de Supabase); sin cabecera, un valor fijo.
CREATE OR REPLACE FUNCTION public._arbitraje_origen() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(btrim(split_part(COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1)), ''), 'sin-origen')
$$;

-- Un resultado es legal según el formato: un game ganado por 2 llegando al objetivo, o 2 games en mejor de 3.
CREATE OR REPLACE FUNCTION public._arbitraje_resultado_legal(f jsonb, r jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  obj int := (f->>'a')::int;
  pa int := (r->>'puntosA')::int;
  pb int := (r->>'puntosB')::int;
  g jsonb; ga int := 0; gb int := 0;
BEGIN
  IF pa IS NULL OR pb IS NULL OR pa = pb THEN RETURN false; END IF;
  IF COALESCE((f->>'mejorDe')::int, 1) = 1 THEN
    RETURN GREATEST(pa, pb) >= obj AND abs(pa - pb) >= 2;
  END IF;
  IF GREATEST(pa, pb) <> 2 OR LEAST(pa, pb) > 1 OR jsonb_typeof(r->'games') <> 'array' THEN RETURN false; END IF;
  FOR g IN SELECT * FROM jsonb_array_elements(r->'games') LOOP
    IF NOT (GREATEST((g->>'a')::int, (g->>'b')::int) >= obj AND abs((g->>'a')::int - (g->>'b')::int) >= 2) THEN RETURN false; END IF;
    IF (g->>'a')::int > (g->>'b')::int THEN ga := ga + 1; ELSE gb := gb + 1; END IF;
  END LOOP;
  RETURN ga = pa AND gb = pb;
END $$;

-- Entrar con el código: devuelve el partido o un error genérico (y anota el intento fallido).
CREATE OR REPLACE FUNCTION public.arbitro_entrar(p_codigo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_origen text := _arbitraje_origen();
  v_c arbitraje_codigos%ROWTYPE;
  v_p arbitraje_partidos%ROWTYPE;
BEGIN
  IF (SELECT count(*) FROM arbitraje_intentos WHERE origen = v_origen AND cuando > now() - interval '10 minutes') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Demasiados códigos incorrectos: esperá unos minutos.');
  END IF;
  SELECT * INTO v_c FROM arbitraje_codigos WHERE codigo = btrim(COALESCE(p_codigo, ''));
  IF NOT FOUND THEN
    INSERT INTO arbitraje_intentos (origen) VALUES (v_origen);
    DELETE FROM arbitraje_intentos WHERE cuando < now() - interval '1 day';
    RETURN jsonb_build_object('ok', false, 'error', 'Código incorrecto o el partido ya terminó.');
  END IF;
  SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id;
  RETURN jsonb_build_object('ok', true, 'torneo_id', v_c.torneo_id, 'partido_id', v_c.partido_id,
    'formato', v_p.formato, 'dobles', v_p.dobles, 'jugadas', v_p.jugadas, 'version', v_p.version, 'estado', v_p.estado);
END $$;

-- Guardar el estado del partido (lista de jugadas + resumen). version = control de concurrencia.
CREATE OR REPLACE FUNCTION public.arbitro_marcar(p_codigo text, p_version int, p_jugadas jsonb, p_marcador jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_c arbitraje_codigos%ROWTYPE;
  v_p arbitraje_partidos%ROWTYPE;
  v_nueva int;
BEGIN
  SELECT * INTO v_c FROM arbitraje_codigos WHERE codigo = btrim(COALESCE(p_codigo, ''));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'El código ya no es válido.'); END IF;
  IF jsonb_typeof(p_jugadas) <> 'array' OR jsonb_array_length(p_jugadas) > 1500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Jugadas inválidas.');
  END IF;
  UPDATE arbitraje_partidos SET jugadas = p_jugadas, marcador = p_marcador, version = version + 1,
         estado = CASE WHEN jsonb_array_length(p_jugadas) > 0 THEN 'en_juego' ELSE 'pendiente' END, actualizado = now()
   WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id AND version = p_version AND estado <> 'terminado'
  RETURNING version INTO v_nueva;
  IF v_nueva IS NULL THEN
    SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id;
    RETURN jsonb_build_object('ok', false, 'error', 'desfasado', 'jugadas', v_p.jugadas, 'version', v_p.version);
  END IF;
  RETURN jsonb_build_object('ok', true, 'version', v_nueva);
END $$;

-- Terminar: escribe el resultado en el cuadro, libera la cancha y da de baja el código.
CREATE OR REPLACE FUNCTION public.arbitro_terminar(p_codigo text, p_version int, p_jugadas jsonb, p_marcador jsonb, p_resultado jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_c arbitraje_codigos%ROWTYPE;
  v_p arbitraje_partidos%ROWTYPE;
  v_data jsonb;
  v_lista text;
  v_idx int;
  v_elem jsonb;
  v_ahora text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  SELECT * INTO v_c FROM arbitraje_codigos WHERE codigo = btrim(COALESCE(p_codigo, ''));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'El código ya no es válido.'); END IF;
  SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id FOR UPDATE;
  IF v_p.version <> p_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'desfasado', 'jugadas', v_p.jugadas, 'version', v_p.version);
  END IF;
  IF NOT _arbitraje_resultado_legal(v_p.formato, p_resultado) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El resultado no cierra con el formato del partido.');
  END IF;

  SELECT data INTO v_data FROM rk_torneos WHERE id = v_c.torneo_id FOR UPDATE;
  IF v_data IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'El torneo ya no existe.'); END IF;
  FOREACH v_lista IN ARRAY ARRAY['partidosGrupo', 'partidosLlave'] LOOP
    SELECT (o - 1)::int, x INTO v_idx, v_elem
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_data->v_lista) = 'array' THEN v_data->v_lista ELSE '[]'::jsonb END) WITH ORDINALITY y(x, o)
     WHERE x->>'id' = v_c.partido_id;
    EXIT WHEN v_idx IS NOT NULL;
  END LOOP;
  IF v_idx IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'El partido ya no está en el cuadro (¿se rearmó?).'); END IF;
  IF v_elem->>'puntosA' IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese partido ya tiene un resultado cargado.');
  END IF;

  v_elem := v_elem || jsonb_build_object('puntosA', (p_resultado->>'puntosA')::int, 'puntosB', (p_resultado->>'puntosB')::int, 'cargadoEl', v_ahora);
  IF jsonb_typeof(p_resultado->'games') = 'array' THEN v_elem := v_elem || jsonb_build_object('games', p_resultado->'games'); END IF;
  UPDATE rk_torneos SET data = jsonb_set(v_data, ARRAY[v_lista, v_idx::text], v_elem), updated_at = now() WHERE id = v_c.torneo_id;
  UPDATE rk_en_cancha SET torneo_id = NULL, partido_id = NULL, updated_at = now() WHERE partido_id = v_c.partido_id;
  UPDATE arbitraje_partidos SET jugadas = p_jugadas, marcador = p_marcador, estado = 'terminado', version = version + 1, actualizado = now()
   WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id;
  DELETE FROM arbitraje_codigos WHERE codigo = v_c.codigo;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Gestor: crea los códigos que falten y actualiza el formato de los que no empezaron.
-- p_partidos = [{partido_id, formato}] (lo arma la web con partidosArbitrables + formatoDe).
CREATE OR REPLACE FUNCTION public.admin_codigos_torneo(p_torneo_id text, p_dobles boolean, p_partidos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  x jsonb;
  v_codigo text;
  v_estado text;
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo el equipo'); END IF;
  IF jsonb_typeof(p_partidos) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'error', 'lista inválida'); END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_partidos) LOOP
    INSERT INTO arbitraje_partidos (torneo_id, partido_id, formato, dobles)
    VALUES (p_torneo_id, x->>'partido_id', x->'formato', p_dobles)
    ON CONFLICT (torneo_id, partido_id) DO UPDATE SET formato = EXCLUDED.formato, dobles = EXCLUDED.dobles
      WHERE arbitraje_partidos.estado = 'pendiente';
    SELECT estado INTO v_estado FROM arbitraje_partidos WHERE torneo_id = p_torneo_id AND partido_id = x->>'partido_id';
    IF v_estado <> 'terminado' AND NOT EXISTS (SELECT 1 FROM arbitraje_codigos WHERE torneo_id = p_torneo_id AND partido_id = x->>'partido_id') THEN
      LOOP
        v_codigo := lpad(floor(random() * 10000)::int::text, 4, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM arbitraje_codigos WHERE codigo = v_codigo);
      END LOOP;
      INSERT INTO arbitraje_codigos (codigo, torneo_id, partido_id) VALUES (v_codigo, p_torneo_id, x->>'partido_id');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'codigos',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('partido_id', c.partido_id, 'codigo', c.codigo)) FROM arbitraje_codigos c WHERE c.torneo_id = p_torneo_id), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.arbitro_entrar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.arbitro_marcar(text, int, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.arbitro_terminar(text, int, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_codigos_torneo(text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.arbitro_entrar(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arbitro_marcar(text, int, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arbitro_terminar(text, int, jsonb, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_codigos_torneo(text, boolean, jsonb) TO authenticated;
```

- [ ] **Step 2:** Commit `"Arbitraje: migración v35"`. Se aplica al final (la pega Brian; el modo auto bloquea `apply_migration`). Antes de pedírselo, verificar el SQL con un `BEGIN; … ROLLBACK;` no es posible desde acá: revisar a mano los nombres de columnas de `rk_torneos` (`data`, `updated_at`) y `rk_en_cancha` (`torneo_id`, `partido_id`, `updated_at`).

---

### Task 5: Servicio

**Files:** Create `src/torneos/arbitraje/servicio.ts`

- [ ] **Step 1:**

```ts
// file: src/torneos/arbitraje/servicio.ts
// Acceso a la base del tanteador de árbitros. El árbitro no tiene sesión: todo pasa por RPC con el código.
import { supabase } from '../../services/supabaseClient';
import type { FormatoArbitraje, Torneo } from '../engine/tipos';
import type { Jugada, Marcador } from './motor';
import { esDobles, formatoDe, partidosArbitrables } from './partido';

export type PartidoDelArbitro = {
  torneoId: string; partidoId: string; formato: FormatoArbitraje; dobles: boolean;
  jugadas: Jugada[]; version: number; estado: 'pendiente' | 'en_juego' | 'terminado';
};
type Res<T> = { ok: true; valor: T } | { ok: false; error: string; jugadas?: Jugada[]; version?: number };

const sinConexion = { ok: false as const, error: 'Sin conexión con el servidor' };

export async function entrar(codigo: string): Promise<Res<PartidoDelArbitro>> {
  if (!supabase) return sinConexion;
  const { data, error } = await supabase.rpc('arbitro_entrar', { p_codigo: codigo });
  if (error) return { ok: false, error: 'No se pudo conectar. Probá de nuevo.' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'Código incorrecto' };
  return { ok: true, valor: {
    torneoId: data.torneo_id, partidoId: data.partido_id, formato: data.formato, dobles: data.dobles !== false,
    jugadas: (data.jugadas ?? []) as Jugada[], version: data.version ?? 0, estado: data.estado,
  } };
}

export async function marcar(codigo: string, version: number, jugadas: Jugada[], marcador: Marcador): Promise<Res<number>> {
  if (!supabase) return sinConexion;
  const { data, error } = await supabase.rpc('arbitro_marcar', { p_codigo: codigo, p_version: version, p_jugadas: jugadas, p_marcador: marcador });
  if (error) return { ok: false, error: 'red' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'error', jugadas: data?.jugadas, version: data?.version };
  return { ok: true, valor: data.version as number };
}

export async function terminar(codigo: string, version: number, jugadas: Jugada[], marcador: Marcador, resultado: { puntosA: number; puntosB: number; games?: { a: number; b: number }[] }): Promise<Res<null>> {
  if (!supabase) return sinConexion;
  const { data, error } = await supabase.rpc('arbitro_terminar', { p_codigo: codigo, p_version: version, p_jugadas: jugadas, p_marcador: marcador, p_resultado: resultado });
  if (error) return { ok: false, error: 'red' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'error', jugadas: data?.jugadas, version: data?.version };
  return { ok: true, valor: null };
}

/** Torneo leído como público (para los nombres). null si no se pudo (p. ej. torneo oculto). */
export async function leerTorneo(torneoId: string): Promise<Torneo | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('rk_torneos').select('data').eq('id', torneoId).maybeSingle();
  return (data?.data as Torneo | undefined) ?? null;
}

/** Gestor: crea/actualiza los códigos del torneo y los devuelve por partido. */
export async function codigosDelTorneo(t: Torneo): Promise<Res<Map<string, string>>> {
  if (!supabase) return sinConexion;
  const partidos = partidosArbitrables(t).map((p) => ({ partido_id: p.partidoId, formato: formatoDe(t, p.fase) }));
  const { data, error } = await supabase.rpc('admin_codigos_torneo', { p_torneo_id: t.id, p_dobles: esDobles(t), p_partidos: partidos });
  if (error) return { ok: false, error: error.message.includes('admin_codigos_torneo') ? 'Falta la actualización de la base (v35).' : 'No se pudieron generar los códigos (¿sesión vencida?)' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'error' };
  return { ok: true, valor: new Map((data.codigos as { partido_id: string; codigo: string }[]).map((c) => [c.partido_id, c.codigo])) };
}

export type MarcadorEnVivo = { torneoId: string; partidoId: string; estado: string; marcador: Marcador | null; actualizado: string };

export async function marcadoresEnJuego(): Promise<MarcadorEnVivo[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('arbitraje_partidos').select('torneo_id, partido_id, estado, marcador, actualizado').eq('estado', 'en_juego');
  if (error || !data) return [];
  return data.map((r) => ({ torneoId: r.torneo_id, partidoId: r.partido_id, estado: r.estado, marcador: r.marcador as Marcador | null, actualizado: r.actualizado }));
}

export function suscribirMarcadores(alCambiar: () => void): () => void {
  const sb = supabase;
  if (!sb) return () => {};
  const canal = sb.channel('arbitraje-marcadores')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'arbitraje_partidos' }, alCambiar)
    .subscribe();
  return () => { void sb.removeChannel(canal); };
}
```

- [ ] **Step 2:** `npx tsc -b` OK. Commit `"Arbitraje: servicio"`.

---

### Task 6: Marcador en vivo (hook + componente)

**Files:** Create `src/torneos/arbitraje/MarcadorVivo.tsx`

- [ ] **Step 1:**

```tsx
// file: src/torneos/arbitraje/MarcadorVivo.tsx
// Marcadores de los partidos con árbitro, en vivo (Realtime + refresco cada 20 s por las dudas).
import { useEffect, useState } from 'react';
import type { Marcador } from './motor';
import { marcadoresEnJuego, suscribirMarcadores } from './servicio';

export const claveMarcador = (torneoId: string, partidoId: string) => `${torneoId}:${partidoId}`;

export function useMarcadores(): Map<string, Marcador> {
  const [mapa, setMapa] = useState<Map<string, Marcador>>(new Map());
  useEffect(() => {
    let vivo = true;
    const pedir = async () => {
      const lista = await marcadoresEnJuego();
      if (vivo) setMapa(new Map(lista.filter((m) => m.marcador).map((m) => [claveMarcador(m.torneoId, m.partidoId), m.marcador as Marcador])));
    };
    void pedir();
    const cortar = suscribirMarcadores(() => void pedir());
    const reloj = window.setInterval(() => void pedir(), 20000);
    return () => { vivo = false; cortar(); window.clearInterval(reloj); };
  }, []);
  return mapa;
}

/** Marcador chico: "G2 · 8-5" con el que saca marcado. lados = qué lado es "A" y cuál "B" en el texto. */
export function MarcadorVivo({ m, tamano = 1 }: { m: Marcador; tamano?: number }) {
  const games = m.games.length > 0 || m.game > 1 ? `${m.gamesA}-${m.gamesB} · ` : '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em', fontWeight: 900, fontVariantNumeric: 'tabular-nums', fontSize: `${tamano}em` }}>
      <span style={{ background: '#CCFF00', color: '#001F3F', borderRadius: 6, padding: '0.05em 0.45em' }}>EN VIVO</span>
      <span>{games}{m.saca === 'A' ? '●' : ''}{m.puntos.a}-{m.puntos.b}{m.saca === 'B' ? '●' : ''}</span>
    </span>
  );
}
```

- [ ] **Step 2:** `npx tsc -b` OK. Commit `"Arbitraje: marcador en vivo"`.

---

### Task 7: Pantalla del árbitro

**Files:** Create `src/torneos/arbitraje/ArbitroPage.tsx`; Modify `src/App.tsx`

- [ ] **Step 1:** Componente (Tailwind, celular en vertical):

```tsx
// file: src/torneos/arbitraje/ArbitroPage.tsx
// /arbitro: el árbitro pone el código del partido y lo marca punto a punto. Sin login.
// Lo marcado se guarda en el teléfono y se sube en cuanto hay señal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Torneo } from '../engine/tipos';
import { estadoDe, resultadoFinal, resumen, type Jugada, type Lado } from './motor';
import { ladosDelPartido, type PartidoArbitrado } from './partido';
import { entrar, leerTorneo, marcar, terminar, type PartidoDelArbitro } from './servicio';

const GUARDADO = (codigo: string) => `volea_arbitro_${codigo}`;
type Local = { jugadas: Jugada[]; version: number; pendiente: boolean };

function leerLocal(codigo: string): Local | null {
  try { const s = localStorage.getItem(GUARDADO(codigo)); return s ? (JSON.parse(s) as Local) : null; } catch { return null; }
}
function guardarLocal(codigo: string, l: Local) {
  try { localStorage.setItem(GUARDADO(codigo), JSON.stringify(l)); } catch { /* sin almacenamiento: sigue en memoria */ }
}

export default function ArbitroPage() {
  const [codigo, setCodigo] = useState('');
  const [partido, setPartido] = useState<PartidoDelArbitro | null>(null);
  const [torneo, setTorneo] = useState<Torneo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function ingresar(c: string) {
    setCargando(true); setError(null);
    const r = await entrar(c);
    setCargando(false);
    if (!r.ok) { setError(r.error); return; }
    const local = leerLocal(c);
    // Si en el teléfono hay más jugadas sin subir que en el servidor, mandan las del teléfono.
    const p = local && local.pendiente && local.jugadas.length > r.valor.jugadas.length
      ? { ...r.valor, jugadas: local.jugadas }
      : r.valor;
    setPartido(p);
    setTorneo(await leerTorneo(p.torneoId));
  }

  if (!partido) {
    return (
      <Marco>
        <h1 className="text-2xl font-black uppercase tracking-wide">Árbitro</h1>
        <p className="mt-1 text-sm opacity-75">Poné el código de 4 números del partido.</p>
        <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); void ingresar(codigo); }}>
          <input
            inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 4))}
            aria-label="Código del partido"
            className="w-40 rounded-xl bg-white/10 px-4 py-3 text-center text-3xl font-black tracking-[0.4em] text-white outline-none ring-2 ring-white/20 focus:ring-[#CCFF00]"
          />
          <button disabled={codigo.length !== 4 || cargando} className="rounded-xl bg-[#CCFF00] px-5 text-lg font-black text-[#001F3F] disabled:opacity-40">
            {cargando ? '…' : 'Entrar'}
          </button>
        </form>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-500/20 p-3 text-sm">{error}</p>}
      </Marco>
    );
  }
  return <Partido codigo={codigo} inicial={partido} torneo={torneo} onSalir={() => { setPartido(null); setCodigo(''); }} />;
}

function Marco({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-[#001F3F] px-4 py-6 text-white"><div className="mx-auto max-w-md">{children}</div></main>;
}

function Partido({ codigo, inicial, torneo, onSalir }: { codigo: string; inicial: PartidoDelArbitro; torneo: Torneo | null; onSalir: () => void }) {
  const f = inicial.formato;
  const [jugadas, setJugadas] = useState<Jugada[]>(inicial.jugadas);
  const [version, setVersion] = useState(inicial.version);
  const [sinSubir, setSinSubir] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [terminado, setTerminado] = useState(inicial.estado === 'terminado');
  const [confirmar, setConfirmar] = useState(false);
  const enviando = useRef(false);
  const datos: PartidoArbitrado | null = useMemo(() => (torneo ? ladosDelPartido(torneo, inicial.partidoId) : null), [torneo, inicial.partidoId]);
  const e = useMemo(() => estadoDe(f, inicial.dobles, jugadas), [f, inicial.dobles, jugadas]);
  const nombre = (l: Lado) => (l === 'A' ? datos?.a?.nombre : datos?.b?.nombre) ?? (l === 'A' ? 'Equipo A' : 'Equipo B');
  const jugadores = (l: Lado) => (l === 'A' ? datos?.a?.jugadores : datos?.b?.jugadores) ?? ['Jugador 1', 'Jugador 2'];

  const subir = useCallback(async (lista: Jugada[], ver: number) => {
    if (enviando.current) return;
    enviando.current = true;
    const r = await marcar(codigo, ver, lista, resumen(estadoDe(f, inicial.dobles, lista)));
    enviando.current = false;
    if (r.ok) {
      setVersion(r.valor); setSinSubir(false); guardarLocal(codigo, { jugadas: lista, version: r.valor, pendiente: false });
    } else if (r.error === 'desfasado' && r.jugadas && typeof r.version === 'number') {
      setJugadas(r.jugadas); setVersion(r.version); setSinSubir(false);
      setAviso('Otro dispositivo cambió este partido: se trajo lo que había en el servidor.');
    } else {
      setSinSubir(true); guardarLocal(codigo, { jugadas: lista, version: ver, pendiente: true });
    }
  }, [codigo, f, inicial.dobles]);

  // Reintento si quedó algo sin subir (cada 5 s y al volver la señal).
  useEffect(() => {
    if (!sinSubir) return;
    const intentar = () => void subir(jugadas, version);
    const reloj = window.setInterval(intentar, 5000);
    window.addEventListener('online', intentar);
    return () => { window.clearInterval(reloj); window.removeEventListener('online', intentar); };
  }, [sinSubir, subir, jugadas, version]);

  function jugar(j: Jugada | 'deshacer') {
    const lista = j === 'deshacer' ? jugadas.slice(0, -1) : [...jugadas, j];
    setJugadas(lista); setAviso(null);
    guardarLocal(codigo, { jugadas: lista, version, pendiente: true });
    void subir(lista, version);
  }

  async function cerrar() {
    const res = resultadoFinal(f, e);
    if (!res) return;
    const r = await terminar(codigo, version, jugadas, resumen(e), res);
    if (r.ok) { setTerminado(true); setConfirmar(false); try { localStorage.removeItem(GUARDADO(codigo)); } catch { /* nada */ } }
    else setAviso(r.error === 'red' ? 'Sin señal: probá de nuevo en un momento.' : r.error);
  }

  if (terminado) {
    return (
      <Marco>
        <p className="text-sm uppercase opacity-70">{datos?.titulo}</p>
        <h1 className="mt-2 text-3xl font-black">Resultado cargado ✓</h1>
        <p className="mt-2">{nombre('A')} {e.games.map((g) => `${g.a}-${g.b}`).join(' / ')} {nombre('B')}</p>
        <button onClick={onSalir} className="mt-6 rounded-xl bg-[#CCFF00] px-5 py-3 font-black text-[#001F3F]">Otro partido</button>
      </Marco>
    );
  }

  if (!e.iniciado) return <Inicio datos={datos} dobles={inicial.dobles} jugadores={jugadores} nombre={nombre} onEmpezar={(j) => jugar(j)} onSalir={onSalir} faltanRivales={!!torneo && (!datos?.a || !datos?.b)} />;

  const recibe: Lado = e.saca === 'A' ? 'B' : 'A';
  const tiempo = (l: Lado) => (
    <button onClick={() => jugar({ t: 'tiempo', equipo: l })} disabled={e.tiempos[l] >= e.maxTiempos}
      className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold disabled:opacity-40">
      Tiempo {nombre(l).split(' ')[0]} ({e.maxTiempos - e.tiempos[l]})
    </button>
  );

  return (
    <Marco>
      <div className="flex items-center justify-between text-xs uppercase opacity-70">
        <span>{datos?.titulo ?? 'Partido'}</span>
        <span>{f.tipo === 'rally' ? 'Rally' : 'Saque'} a {f.a}{f.mejorDe === 3 ? ` · Game ${e.game}` : ''}</span>
      </div>
      {f.mejorDe === 3 && <p className="mt-1 text-center text-sm font-bold">Games {e.gamesA}-{e.gamesB}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(['A', 'B'] as Lado[]).map((l) => (
          <div key={l} className={`rounded-2xl p-3 ${e.saca === l ? 'bg-[#CCFF00] text-[#001F3F]' : 'bg-white/10'}`}>
            <p className="text-xs font-bold uppercase leading-tight">{nombre(l)}</p>
            <p className="text-6xl font-black tabular-nums">{l === 'A' ? e.puntos.a : e.puntos.b}</p>
            {e.saca === l && <p className="text-xs font-bold">Saca {inicial.dobles ? jugadores(l)[e.sirve] : ''}</p>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-5xl font-black tracking-wider tabular-nums">{e.canto}</p>
      {e.cambiarLado && <p className="mt-2 rounded-lg bg-orange-500 p-2 text-center font-black">CAMBIO DE LADO</p>}
      {e.finDeGame && <p className="mt-2 rounded-lg bg-sky-500 p-2 text-center font-black">FIN DEL GAME {e.game - 1} · cambio de lado</p>}
      {aviso && <p role="alert" className="mt-2 rounded-lg bg-red-500/30 p-2 text-sm">{aviso}</p>}
      {sinSubir && <p className="mt-2 text-center text-xs text-yellow-300">Sin señal: lo marcado queda guardado y se sube solo.</p>}

      {e.terminado ? (
        <div className="mt-6 grid gap-2">
          <p className="text-center text-lg font-black">Ganó {nombre(e.ganador as Lado)}</p>
          {!confirmar
            ? <button onClick={() => setConfirmar(true)} className="rounded-2xl bg-[#CCFF00] py-5 text-xl font-black text-[#001F3F]">Terminar partido</button>
            : <button onClick={() => void cerrar()} className="rounded-2xl bg-[#CCFF00] py-5 text-xl font-black text-[#001F3F]">Confirmar {e.games.map((g) => `${g.a}-${g.b}`).join(' / ')}</button>}
          <button onClick={() => jugar('deshacer')} className="rounded-xl bg-white/10 py-3 font-bold">↶ Deshacer último punto</button>
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          <button onClick={() => jugar({ t: 'rally', gana: e.saca })} className="rounded-2xl bg-[#CCFF00] py-7 text-2xl font-black text-[#001F3F] active:scale-95">
            Ganó el que saca
          </button>
          <button onClick={() => jugar({ t: 'rally', gana: recibe })} className="rounded-2xl bg-white py-7 text-2xl font-black text-[#001F3F] active:scale-95">
            Ganó el que recibe
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button onClick={() => jugar('deshacer')} disabled={jugadas.length <= 1} className="rounded-lg bg-white/10 px-4 py-2 font-bold disabled:opacity-40">↶ Deshacer</button>
            <div className="flex gap-2">{tiempo('A')}{tiempo('B')}</div>
          </div>
        </div>
      )}
    </Marco>
  );
}

function Inicio({ datos, dobles, jugadores, nombre, onEmpezar, onSalir, faltanRivales }: {
  datos: PartidoArbitrado | null; dobles: boolean; jugadores: (l: Lado) => string[]; nombre: (l: Lado) => string;
  onEmpezar: (j: Jugada) => void; onSalir: () => void; faltanRivales: boolean;
}) {
  const [saca, setSaca] = useState<Lado | null>(null);
  const [der, setDer] = useState<{ A: 0 | 1; B: 0 | 1 }>({ A: 0, B: 0 });
  if (faltanRivales) {
    return (
      <Marco>
        <p className="text-sm uppercase opacity-70">{datos?.titulo}</p>
        <h1 className="mt-2 text-2xl font-black">Todavía no se sabe quién juega</h1>
        <p className="mt-2 text-sm opacity-80">Este cruce depende de un partido anterior. Volvé a entrar cuando termine.</p>
        <button onClick={onSalir} className="mt-6 rounded-xl bg-white/10 px-5 py-3 font-bold">Volver</button>
      </Marco>
    );
  }
  return (
    <Marco>
      <p className="text-sm uppercase opacity-70">{datos?.titulo ?? 'Partido'}</p>
      <h1 className="mt-1 text-xl font-black">{nombre('A')} <span className="text-[#CCFF00]">vs</span> {nombre('B')}</h1>
      <p className="mt-5 text-sm font-bold uppercase opacity-75">¿Quién saca primero?</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(['A', 'B'] as Lado[]).map((l) => (
          <button key={l} onClick={() => setSaca(l)} className={`rounded-xl p-3 text-left text-sm font-bold ${saca === l ? 'bg-[#CCFF00] text-[#001F3F]' : 'bg-white/10'}`}>{nombre(l)}</button>
        ))}
      </div>
      {dobles && (['A', 'B'] as Lado[]).map((l) => (
        <div key={l} className="mt-4">
          <p className="text-sm font-bold uppercase opacity-75">¿Quién arranca a la derecha? · {nombre(l)}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {jugadores(l).slice(0, 2).map((j, i) => (
              <button key={j} onClick={() => setDer({ ...der, [l]: i as 0 | 1 })} className={`rounded-xl p-3 text-sm font-bold ${der[l] === i ? 'bg-white text-[#001F3F]' : 'bg-white/10'}`}>{j}</button>
            ))}
          </div>
        </div>
      ))}
      <button disabled={!saca} onClick={() => saca && onEmpezar({ t: 'inicio', saca, derechaA: der.A, derechaB: der.B })}
        className="mt-6 w-full rounded-2xl bg-[#CCFF00] py-5 text-xl font-black text-[#001F3F] disabled:opacity-40">
        Empezar partido
      </button>
    </Marco>
  );
}
```

- [ ] **Step 2:** En `src/App.tsx`, junto a los otros lazy de torneos agregar
  `const ArbitroPageLazy = lazyConRecarga(() => import('./torneos/arbitraje/ArbitroPage'));`,
  una función `ArbitroRoute` igual a `ProgramacionRoute` (title "Árbitro", description "Marcador del árbitro VOLEA") y la ruta
  `<Route path="/arbitro" element={<ArbitroRoute />} />` al lado de `/programacion`.
- [ ] **Step 3:** `npx tsc -b` OK. Commit `"Arbitraje: pantalla del árbitro"`.

---

### Task 8: Gestor — formato y hoja de códigos

**Files:** Create `src/torneos/ui/SelectorArbitraje.tsx`, `src/torneos/arbitraje/HojaCodigos.tsx`; Modify `src/torneos/TorneosApp.tsx`

- [ ] **Step 1: Selector**

```tsx
// file: src/torneos/ui/SelectorArbitraje.tsx
// Cómo cuenta el árbitro: rally o saque, a cuántos puntos y si es a un game o al mejor de 3.
import type { FormatoArbitraje, Torneo } from '../engine/tipos';
import { Campo, Selector } from '../../admin/ui';
import { formatoDe } from '../arbitraje/partido';

const valor = (f: FormatoArbitraje) => `${f.tipo}-${f.a}-${f.mejorDe}`;
const OPCIONES: { valor: string; texto: string }[] = [
  { valor: 'rally-15-1', texto: 'Rally a 15 · un game' }, { valor: 'rally-21-1', texto: 'Rally a 21 · un game' },
  { valor: 'rally-11-3', texto: 'Rally a 11 · mejor de 3' }, { valor: 'rally-15-3', texto: 'Rally a 15 · mejor de 3' },
  { valor: 'sideout-11-1', texto: 'Saque a 11 · un game' }, { valor: 'sideout-15-1', texto: 'Saque a 15 · un game' },
  { valor: 'sideout-11-3', texto: 'Saque a 11 · mejor de 3' },
];
const leer = (v: string): FormatoArbitraje => {
  const [tipo, a, m] = v.split('-');
  return { tipo: tipo as FormatoArbitraje['tipo'], a: Number(a) as FormatoArbitraje['a'], mejorDe: Number(m) as 1 | 3 };
};

export default function SelectorArbitraje({ torneo, actualizar }: { torneo: Torneo; actualizar: (c: (t: Torneo) => Torneo) => void }) {
  const tieneGrupos = torneo.partidosGrupo.length > 0 || torneo.grupos.length > 0;
  const cambiar = (fase: 'grupos' | 'llave', v: string) =>
    actualizar((t) => ({ ...t, arbitraje: { ...t.arbitraje, [fase]: leer(v) } }));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {tieneGrupos && (
        <Campo etiqueta="Árbitro · fase de grupos" ayuda="Cómo cuenta el tanteador en los grupos.">
          <Selector value={valor(formatoDe(torneo, 'grupo'))} onChange={(e) => cambiar('grupos', e.target.value)}>
            {OPCIONES.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
          </Selector>
        </Campo>
      )}
      <Campo etiqueta="Árbitro · llave" ayuda="Semis, final y demás cruces.">
        <Selector value={valor(formatoDe(torneo, 'llave'))} onChange={(e) => cambiar('llave', e.target.value)}>
          {OPCIONES.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </Selector>
      </Campo>
    </div>
  );
}
```

- [ ] **Step 2: Hoja de códigos**

```tsx
// file: src/torneos/arbitraje/HojaCodigos.tsx
// Hoja de códigos de árbitro del cuadro: para imprimir o copiar por WhatsApp.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Torneo } from '../engine/tipos';
import { Boton, Dialogo } from '../../admin/ui';
import { ladosDelPartido, partidosArbitrables } from './partido';
import { codigosDelTorneo } from './servicio';

export default function HojaCodigos({ torneo, onCerrar }: { torneo: Torneo; onCerrar: () => void }) {
  const [codigos, setCodigos] = useState<Map<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void codigosDelTorneo(torneo).then((r) => (r.ok ? setCodigos(r.valor) : setError(r.error)));
  }, [torneo]);

  const filas = partidosArbitrables(torneo).map(({ partidoId }) => {
    const d = ladosDelPartido(torneo, partidoId);
    return { partidoId, codigo: codigos?.get(partidoId) ?? null, titulo: d?.titulo ?? '', a: d?.a?.nombre ?? 'A definir', b: d?.b?.nombre ?? 'A definir', jugado: d?.jugado ?? false };
  }).filter((f) => !f.jugado);

  const texto = [`Árbitros · ${torneo.nombre}`, 'Entrar en volea.vercel.app/arbitro', '',
    ...filas.filter((f) => f.codigo).map((f) => `${f.codigo} · ${f.titulo} · ${f.a} vs ${f.b}`)].join('\n');

  return (
    <Dialogo abierto titulo="Códigos de árbitro" descripcion="Un código por partido. Se entra en volea.vercel.app/arbitro." alCerrar={onCerrar} ancho="lg"
      pie={(
        <>
          <Boton variante="secundario" onClick={() => window.print()} disabled={!codigos}>Imprimir</Boton>
          <Boton disabled={!codigos} onClick={() => void navigator.clipboard.writeText(texto).then(() => toast.success('Copiado: pegalo en WhatsApp'))}>Copiar para WhatsApp</Boton>
        </>
      )}>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!codigos && !error && <p className="text-sm text-gray-500">Generando códigos…</p>}
      {codigos && (
        <ul className="divide-y divide-gray-100">
          {filas.map((f) => (
            <li key={f.partidoId} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-16 font-mono text-xl font-black tracking-widest text-navy-700">{f.codigo ?? '—'}</span>
              <span className="min-w-0 flex-1"><span className="text-gray-500">{f.titulo} · </span>{f.a} <b>vs</b> {f.b}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialogo>
  );
}
```

- [ ] **Step 3:** En `src/torneos/TorneosApp.tsx`, dentro del panel de Ajustes (después del bloque de `SelectorFormato`), agregar:

```tsx
          {!esIndividual && (
            <div className="space-y-3 sm:col-span-2">
              <SelectorArbitraje torneo={torneo} actualizar={actualizar} />
              <Boton variante="secundario" onClick={() => setHojaCodigos(true)}>Códigos de árbitro</Boton>
              {hojaCodigos && <HojaCodigos torneo={torneo} onCerrar={() => setHojaCodigos(false)} />}
            </div>
          )}
```

con `const [hojaCodigos, setHojaCodigos] = useState(false);` en el componente del panel y los imports
`import SelectorArbitraje from './ui/SelectorArbitraje';`, `import HojaCodigos from './arbitraje/HojaCodigos';`
(y `Boton` desde `../admin/ui` si no estaba).

- [ ] **Step 4:** `npx tsc -b` OK. Commit `"Arbitraje: formato y códigos en el gestor"`.

---

### Task 9: Marcador en En vivo y en la TV

**Files:** Modify `src/torneos/publico/ProgramacionPage.tsx`, `src/torneos/publico/PantallaTv.tsx`

- [ ] **Step 1:** En `ProgramacionPage`, `const marcadores = useMarcadores();` dentro del componente de la página y,
  en la columna "En cancha", debajo de `{et.a} vs {et.b}`:

```tsx
                    {e.torneoId && e.partidoId && marcadores.get(claveMarcador(e.torneoId, e.partidoId)) && (
                      <div style={{ marginTop: 6 }}><MarcadorVivo m={marcadores.get(claveMarcador(e.torneoId, e.partidoId))!} /></div>
                    )}
```

- [ ] **Step 2:** En el armado de `canchasTv` agregar `marcador: e?.torneoId && e?.partidoId ? marcadores.get(claveMarcador(e.torneoId, e.partidoId)) ?? null : null`.
- [ ] **Step 3:** En `PantallaTv.tsx`: `CanchaTv` suma `marcador?: Marcador | null` y, en la tarjeta, si hay marcador,
  junto a cada nombre el puntaje grande (`c.marcador.puntos.a` / `.b`) y un `●` al que saca; si es mejor de 3, `Games x-y`.
- [ ] **Step 4:** `npx tsc -b` + suite completa (`npx vitest run --no-file-parallelism`) + `npm run build`. Commit `"Arbitraje: marcador en En vivo y TV"`.

---

### Task 10: Prueba de punta a punta y entrega

- [ ] **Step 1:** Harness de Playwright con la base en memoria (patrón de `ver-flujo-aniversario.cjs`): mockear
  `rpc/arbitro_entrar|arbitro_marcar|arbitro_terminar|admin_codigos_torneo` y `arbitraje_partidos`, entrar con un
  código en ancho de celular (390 px), marcar un partido completo de side out a 11, deshacer, cortar la red a mitad
  (route abort) y verificar que se sube al volver, terminar y comprobar el `p_resultado` enviado.
- [ ] **Step 2:** Push de la rama `feat/arbitros` (preview de Vercel), dejar `v35_arbitraje.sql` en el Escritorio de
  Brian para pegar en Supabase, verificar con SQL que las tablas y funciones existen, y recién con su OK mergear a master.
- [ ] **Step 3:** Memoria: `volea-arbitraje-estado.md` con el estado y el índice en MEMORY.md.
