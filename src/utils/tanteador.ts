// Lógica pura del tanteador de bádminton dobles (Copa Badminton, 06/09/2026).
// Réplica de la planilla en papel: sets a 15 (desde 14-14 se define por 2, tope
// 21), al mejor de 3, cambio de lado cuando alguien llega a 8 en el 3er set.
// Todo inmutable: cada función devuelve un partido nuevo, nunca muta el que recibe.
import type {
  TanteadorCategoria,
  TanteadorLado,
  TanteadorModo,
  TanteadorPartido,
  TanteadorSet,
} from '../types';

export interface ReglasTanteador {
  obj: number;
  cap: number;
  cambioEn: number;
}

/** Las dos variantes que usa la copa: a 15 (tope 21) o a 21 (tope 30). */
export function reglasPara(obj: 15 | 21): ReglasTanteador {
  return obj === 15 ? { obj: 15, cap: 21, cambioEn: 8 } : { obj: 21, cap: 30, cambioEn: 11 };
}

export function crearPartido(datos: {
  id: string;
  categoria: TanteadorCategoria;
  modo?: TanteadorModo;
  parejaA: string;
  parejaB: string;
  jugadoresA?: string[];
  jugadoresB?: string[];
  juez?: string;
  cancha?: string;
  obj?: 15 | 21;
  torneoId?: string | null;
  creadoPor?: string;
}): TanteadorPartido {
  const reglas = reglasPara(datos.obj ?? 15);
  const ahora = new Date().toISOString();
  return {
    id: datos.id,
    torneoId: datos.torneoId ?? null,
    categoria: datos.categoria,
    modo: datos.modo ?? 'fijas',
    parejaA: datos.parejaA,
    parejaB: datos.parejaB,
    jugadoresA: datos.jugadoresA ?? [],
    jugadoresB: datos.jugadoresB ?? [],
    juez: datos.juez || null,
    cancha: datos.cancha || '1',
    ...reglas,
    sets: [],
    hist: [[]],
    estado: 'en_juego',
    ganador: null,
    invertido: false,
    avisos: {},
    creadoPor: datos.creadoPor || '',
    createdAt: ahora,
    updatedAt: ahora,
    terminadoAt: null,
  };
}

/** Marcador de un set a partir de su historial de puntos. */
export function marcadorDe(hist: TanteadorLado[]): TanteadorSet {
  let a = 0;
  let b = 0;
  for (const p of hist) p === 'A' ? a++ : b++;
  return { a, b };
}

export function marcadorActual(p: TanteadorPartido): TanteadorSet {
  return marcadorDe(p.hist[p.hist.length - 1] || []);
}

/** Quién ganó un set cerrado según las reglas del partido; null = sigue abierto. */
export function ganadorSet(s: TanteadorSet, obj: number, cap: number): TanteadorLado | null {
  if ((s.a >= obj && s.a - s.b >= 2) || s.a === cap) return 'A';
  if ((s.b >= obj && s.b - s.a >= 2) || s.b === cap) return 'B';
  return null;
}

export function setsGanados(p: TanteadorPartido): { A: number; B: number } {
  const g = { A: 0, B: 0 };
  for (const s of p.sets) {
    const w = ganadorSet(s, p.obj, p.cap);
    if (w) g[w]++;
  }
  return g;
}

export function resumenSets(p: TanteadorPartido): string {
  return p.sets.map((s) => `${s.a}-${s.b}`).join(' · ');
}

export type AvisoPunto =
  | { tipo: 'cambio_lado' }
  | { tipo: 'fin_set'; numero: number; ganador: TanteadorLado; marcador: TanteadorSet }
  | { tipo: 'fin_partido'; ganador: TanteadorLado }
  | null;

/** Anota un punto y devuelve el partido nuevo + el aviso a mostrar (si hay). */
export function anotarPunto(
  p: TanteadorPartido,
  lado: TanteadorLado,
): { partido: TanteadorPartido; aviso: AvisoPunto } {
  if (p.estado !== 'en_juego') return { partido: p, aviso: null };
  const hist = p.hist.map((h) => [...h]);
  hist[hist.length - 1].push(lado);
  const s = marcadorDe(hist[hist.length - 1]);
  const numeroSet = p.sets.length + 1;

  const g = ganadorSet(s, p.obj, p.cap);
  if (g) {
    const sets = [...p.sets, s];
    const cerrado: TanteadorPartido = { ...p, hist, sets };
    const sg = setsGanados(cerrado);
    if (sg.A === 2 || sg.B === 2) {
      const ganador: TanteadorLado = sg.A === 2 ? 'A' : 'B';
      return {
        partido: { ...cerrado, estado: 'final', ganador, terminadoAt: new Date().toISOString() },
        aviso: { tipo: 'fin_partido', ganador },
      };
    }
    return {
      partido: { ...cerrado, hist: [...hist, []] },
      aviso: { tipo: 'fin_set', numero: numeroSet, ganador: g, marcador: s },
    };
  }

  // El aviso de la planilla: "Cambio de cancha" cuando alguien llega a 8 (a 15)
  // u 11 (a 21) en el 3er set. Una sola vez por partido.
  if (numeroSet === 3 && !p.avisos.cambio3 && (s.a === p.cambioEn || s.b === p.cambioEn)) {
    return {
      partido: { ...p, hist, avisos: { ...p.avisos, cambio3: true } },
      aviso: { tipo: 'cambio_lado' },
    };
  }

  return { partido: { ...p, hist }, aviso: null };
}

/**
 * Deshace el último punto. Cruza límites: reabre el set anterior si el actual
 * está vacío, y reabre el partido si estaba final (también uno cerrado a mano).
 */
export function deshacerPunto(p: TanteadorPartido): TanteadorPartido {
  const hist = p.hist.map((h) => [...h]);
  let sets = [...p.sets];
  let i = hist.length - 1;
  const reabierto = { estado: 'en_juego' as const, ganador: null, terminadoAt: null };

  if (p.estado === 'final') {
    // ¿El último set guardado es el hist en curso? Si además cumple las reglas
    // de cierre, el partido terminó con el punto de partido: se des-guarda el
    // set Y se borra ese punto. Si no las cumple (o el set en curso estaba
    // vacío), fue un "terminar a mano": reabrir alcanza, sin borrar puntos.
    if (sets.length === hist.length && ganadorSet(sets[sets.length - 1], p.obj, p.cap)) {
      sets = sets.slice(0, -1);
    } else {
      if (sets.length === hist.length) sets = sets.slice(0, -1);
      return { ...p, hist, sets, ...reabierto };
    }
  } else if (!hist[i].length) {
    if (i === 0) return p; // no hay nada para deshacer
    hist.pop();
    sets = sets.slice(0, -1);
    i--;
  }

  if (hist[i].length) hist[i] = hist[i].slice(0, -1);
  return { ...p, hist, sets, ...reabierto };
}

/**
 * Cierra el partido como está (se suspendió, se retiró una dupla). El set en
 * curso con puntos se guarda parcial; el ganador sale por sets a favor simple
 * (acá un set parcial cuenta para el que va arriba) y puede quedar null si empatan.
 */
/** Jugadores de un lado; partidos viejos sin jugadoresX se parten por " / " o " - ". */
export function jugadoresDe(p: TanteadorPartido, lado: TanteadorLado): string[] {
  const directos = lado === 'A' ? p.jugadoresA : p.jugadoresB;
  if (directos && directos.length) return directos;
  const texto = lado === 'A' ? p.parejaA : p.parejaB;
  return texto.split(/\s*[/\-]\s*/).map((s) => s.trim()).filter(Boolean);
}

export interface FilaAmericano {
  nombre: string;
  pj: number;
  pg: number;
  pf: number;
  pc: number;
  dif: number;
}

/**
 * Tabla INDIVIDUAL del americano (parejas rotativas): cada jugador acumula lo
 * de los partidos FINALIZADOS de su categoría. Orden: partidos ganados, luego
 * diferencia de puntos, luego puntos a favor (los partidos al mejor de 3
 * duran distinto, así que la suma cruda de puntos sola sería injusta).
 */
export function tablaAmericano(
  partidos: TanteadorPartido[],
  categoria: TanteadorCategoria,
): FilaAmericano[] {
  const filas = new Map<string, FilaAmericano>();
  const fila = (nombre: string): FilaAmericano => {
    let f = filas.get(nombre);
    if (!f) { f = { nombre, pj: 0, pg: 0, pf: 0, pc: 0, dif: 0 }; filas.set(nombre, f); }
    return f;
  };

  for (const p of partidos) {
    if (p.estado !== 'final' || p.categoria !== categoria) continue;
    let pfA = 0;
    let pfB = 0;
    for (const s of p.sets) { pfA += s.a; pfB += s.b; }
    for (const lado of ['A', 'B'] as const) {
      const propios = lado === 'A' ? pfA : pfB;
      const rivales = lado === 'A' ? pfB : pfA;
      for (const nombre of jugadoresDe(p, lado)) {
        const f = fila(nombre);
        f.pj++;
        f.pf += propios;
        f.pc += rivales;
        if (p.ganador === lado) f.pg++;
      }
    }
  }

  const lista = [...filas.values()];
  for (const f of lista) f.dif = f.pf - f.pc;
  lista.sort((x, y) => y.pg - x.pg || y.dif - x.dif || y.pf - x.pf || x.nombre.localeCompare(y.nombre));
  return lista;
}

/**
 * Tabla por PAREJA (duplas fijas, todos contra todos: el masculino de la copa).
 * Misma matemática y orden que la individual, pero la unidad es la dupla.
 */
export function tablaParejas(
  partidos: TanteadorPartido[],
  categoria: TanteadorCategoria,
): FilaAmericano[] {
  const filas = new Map<string, FilaAmericano>();
  const fila = (nombre: string): FilaAmericano => {
    let f = filas.get(nombre);
    if (!f) { f = { nombre, pj: 0, pg: 0, pf: 0, pc: 0, dif: 0 }; filas.set(nombre, f); }
    return f;
  };

  for (const p of partidos) {
    if (p.estado !== 'final' || p.categoria !== categoria) continue;
    let pfA = 0;
    let pfB = 0;
    for (const s of p.sets) { pfA += s.a; pfB += s.b; }
    for (const lado of ['A', 'B'] as const) {
      const f = fila(lado === 'A' ? p.parejaA : p.parejaB);
      f.pj++;
      f.pf += lado === 'A' ? pfA : pfB;
      f.pc += lado === 'A' ? pfB : pfA;
      if (p.ganador === lado) f.pg++;
    }
  }

  const lista = [...filas.values()];
  for (const f of lista) f.dif = f.pf - f.pc;
  lista.sort((x, y) => y.pg - x.pg || y.dif - x.dif || y.pf - x.pf || x.nombre.localeCompare(y.nombre));
  return lista;
}

/** Vuelve el partido a 0-0: borra sets y puntos, queda listo para arrancar. */
export function reiniciarPartido(p: TanteadorPartido): TanteadorPartido {
  return { ...p, sets: [], hist: [[]], estado: 'en_juego', ganador: null, avisos: {}, terminadoAt: null };
}

/**
 * Corrige a mano el marcador del set EN CURSO (me comí un punto, marqué de más).
 * Reconstruye el historial del set como a puntos de A y b de B — se pierde el
 * orden exacto (solo afecta el indicador de saque). Rechaza marcadores que ya
 * cerrarían el set: ese último punto se anota con el botón, para que dispare
 * el cierre y los avisos como corresponde.
 */
export function corregirMarcadorActual(
  p: TanteadorPartido,
  a: number,
  b: number,
): { ok: true; partido: TanteadorPartido } | { ok: false; error: string } {
  if (p.estado !== 'en_juego') return { ok: false, error: 'El partido ya terminó.' };
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > p.cap || b > p.cap) {
    return { ok: false, error: `Los puntos van de 0 a ${p.cap}.` };
  }
  if (ganadorSet({ a, b }, p.obj, p.cap)) {
    return { ok: false, error: 'Ese marcador cerraría el set: cargá un punto menos y anotá el último con el botón.' };
  }
  const hist = p.hist.map((h) => [...h]);
  hist[hist.length - 1] = [
    ...Array.from({ length: a }, () => 'A' as const),
    ...Array.from({ length: b }, () => 'B' as const),
  ];
  return { ok: true, partido: { ...p, hist } };
}

export function terminarManual(p: TanteadorPartido): TanteadorPartido {
  if (p.estado === 'final') return p;
  const s = marcadorActual(p);
  const sets = s.a + s.b > 0 ? [...p.sets, s] : [...p.sets];
  const g = { A: 0, B: 0 };
  for (const st of sets) {
    if (st.a > st.b) g.A++;
    else if (st.b > st.a) g.B++;
  }
  const ganador: TanteadorLado | null = g.A > g.B ? 'A' : g.B > g.A ? 'B' : null;
  return { ...p, sets, estado: 'final', ganador, terminadoAt: new Date().toISOString() };
}
