// One Point Challenge en En vivo (/programacion y la tele): reparte los cruces de la llave en
// canchas, arma la cola de cada una y guarda el resultado de un toque. Las primeras rondas (las
// que tienen muchos cruces) se juegan en varias canchas a la vez, cada una con su árbitro; cuando
// quedan pocos cruces sigue todo en la Cancha 1. Lógica pura + la escritura al servidor.
import type { PartidoLlave, SlotLlave, Torneo } from '../engine/tipos';
import { conWo, resultadoValido } from '../engine/tipos';
import { ganadorPartido, podio, resolverSlot } from '../engine/llave';
import { nombreDe } from '../ui/util';
import { ausentesDe } from '../ui/opc/ausentes';
import { borradosSiMarco, marcar } from '../ui/opc/modelo';
import { supabase } from '../../services/supabaseClient';

export type PartidoOpc = {
  id: string;
  ronda: number;
  nombreRonda: string;
  /** 1-based entre los cruces que se juegan de la ronda (sin los que pasan directo). */
  numero: number;
  deRonda: number;
  /** Cancha en la que se juega (1-based). */
  cancha: number;
  idA: string | null;
  idB: string | null;
  /** Nombre del jugador o, si todavía no se sabe, de dónde sale ("ANA o BETO"). */
  a: string;
  b: string;
  estado: 'esperando' | 'listo' | 'jugado';
  ganador: 'a' | 'b' | null;
  wo: boolean;
  cargadoEl: string | null;
};

export type CanchaOpc = {
  numero: number;
  nombre: string;
  /** El cruce que se juega ahora (el primero de su cola con los dos jugadores definidos). */
  ahora: PartidoOpc | null;
  /** Lo que viene después en esta cancha, en orden. */
  siguen: PartidoOpc[];
  /** Lo último que se cargó en esta cancha (para deshacer un toque equivocado). */
  ultimo: PartidoOpc | null;
  pendientes: number;
};

export type RondaOpc = {
  ronda: number;
  nombre: string;
  /** Cruces que se juegan (sin los que pasan directo). */
  cruces: number;
  jugados: number;
  /** En cuántas canchas se reparte. */
  canchas: number;
  /** Hasta cuántas se puede elegir (nunca más canchas que cruces). */
  maximo: number;
};

export type PlanOpc = {
  torneoId: string;
  nombre: string;
  /** Todas las rondas con cruces, en orden. */
  rondas: RondaOpc[];
  partidos: PartidoOpc[];
  /** Canchas con cruces por jugar (vacío cuando terminó). */
  canchas: CanchaOpc[];
  ronda: { nombre: string; jugados: number; total: number } | null;
  total: number;
  jugados: number;
  /** Jugadores que siguen en carrera. */
  vivos: number;
  jugadores: number;
  /** Los que pasan directo a la segunda ronda (bye). */
  pasanDirecto: string[];
  /** Últimos resultados, el más nuevo primero. */
  resultados: PartidoOpc[];
  campeon: string | null;
  subcampeon: string | null;
  /** Cuándo se cargó la final (ms) o null. */
  terminadoEl: number | null;
};

const NOMBRE_RONDA: Record<number, string> = { 1: 'Final', 2: 'Semifinal', 4: 'Cuartos de final', 8: 'Octavos de final' };

export function esOpc(t: Torneo): boolean {
  return (t.formato ?? 'grupos') === 'individual' && Array.isArray(t.partidosLlave) && t.partidosLlave.length > 0;
}

/** En cuántas canchas se juega una ronda con `cruces` partidos reales. */
export const MAX_CANCHAS_OPC = 6;

/** Cuántas canchas hay disponibles para el One Point Challenge (3 si el torneo no dice otra cosa). */
export function canchasDisponibles(t: Pick<Torneo, 'opc'>): number {
  const n = Math.floor(Number(t.opc?.canchas ?? 3));
  return Number.isFinite(n) ? Math.min(MAX_CANCHAS_OPC, Math.max(1, n)) : 3;
}

export function canchasDeRonda(t: Pick<Torneo, 'opc'>, ronda: number, cruces: number): number {
  const n = canchasDisponibles(t);
  // Lo que se eligió a mano para esa ronda manda sobre la regla automática.
  const elegidas = t.opc?.porRonda?.[String(ronda)];
  if (typeof elegidas === 'number' && Number.isInteger(elegidas) && elegidas >= 1) {
    return Math.min(MAX_CANCHAS_OPC, elegidas, Math.max(1, cruces));
  }
  const hasta = t.opc?.hastaRonda;
  const varias = typeof hasta === 'number' ? ronda <= hasta : cruces >= 3;
  return varias ? Math.min(n, Math.max(1, cruces)) : 1;
}

export function planOpc(t: Torneo): PlanOpc {
  const llave = (t.partidosLlave ?? []).filter((p) => !p.esTercerPuesto);
  const orden = [...llave].sort((x, y) => x.ronda - y.ronda || x.posicion - y.posicion);
  const porId = new Map(llave.map((p) => [p.id, p]));
  const nombre = (id: string) => nombreDe(t, id);
  // De dónde sale un lugar que todavía no tiene jugador.
  const texto = (s: SlotLlave | null): string => {
    const id = resolverSlot(s, llave);
    if (id) return nombre(id);
    if (!s || s.tipo === 'seed') return 'A definir';
    const previo = porId.get(s.partidoId);
    if (!previo) return 'A definir';
    const a = resolverSlot(previo.a, llave);
    const b = resolverSlot(previo.b, llave);
    return a && b ? `${nombre(a)} o ${nombre(b)}` : 'A definir';
  };

  const rondas = [...new Set(orden.map((p) => p.ronda))].sort((x, y) => x - y);
  const partidos: PartidoOpc[] = [];
  const rondasPlan: RondaOpc[] = [];
  const pasanDirecto: string[] = [];
  for (const r of rondas) {
    const deRonda = orden.filter((p) => p.ronda === r);
    const reales = deRonda.filter((p) => p.a !== null && p.b !== null);
    for (const p of deRonda) {
      if (p.a !== null && p.b !== null) continue;
      const id = resolverSlot(p.a ?? p.b, llave);
      if (id) pasanDirecto.push(nombre(id));
    }
    const canchas = canchasDeRonda(t, r, reales.length);
    const nombreRonda = NOMBRE_RONDA[deRonda.length] ?? `Ronda ${r}`;
    reales.forEach((p, i) => {
      const idA = resolverSlot(p.a, llave);
      const idB = resolverSlot(p.b, llave);
      const g = ganadorPartido(p, llave);
      const jugado = resultadoValido(p.puntosA, p.puntosB) && g !== null;
      partidos.push({
        id: p.id, ronda: r, nombreRonda, numero: i + 1, deRonda: reales.length, cancha: (i % canchas) + 1,
        idA, idB, a: texto(p.a), b: texto(p.b),
        estado: jugado ? 'jugado' : idA && idB ? 'listo' : 'esperando',
        ganador: jugado ? (g === idA ? 'a' : 'b') : null,
        wo: jugado && !!p.wo, cargadoEl: p.cargadoEl ?? null,
      });
    });
    if (reales.length > 0) {
      rondasPlan.push({
        ronda: r, nombre: nombreRonda, cruces: reales.length,
        jugados: partidos.filter((x) => x.ronda === r && x.estado === 'jugado').length,
        canchas, maximo: Math.min(canchasDisponibles(t), reales.length),
      });
    }
  }

  const instante = (p: PartidoOpc) => (p.cargadoEl ? Date.parse(p.cargadoEl) : 0);
  const jugadosLista = partidos.filter((p) => p.estado === 'jugado');
  const resultados = [...jugadosLista].sort((x, y) => instante(y) - instante(x) || y.ronda - x.ronda || y.numero - x.numero);
  const numeros = [...new Set(partidos.map((p) => p.cancha))].sort((x, y) => x - y);
  const canchas: CanchaOpc[] = numeros.map((n) => {
    const cola = partidos.filter((p) => p.cancha === n);
    const pendientes = cola.filter((p) => p.estado !== 'jugado');
    const ahora = pendientes.find((p) => p.estado === 'listo') ?? null;
    return {
      numero: n, nombre: `Cancha ${n}`, ahora,
      siguen: pendientes.filter((p) => p !== ahora),
      ultimo: resultados.find((p) => p.cancha === n && !p.wo) ?? null,
      pendientes: pendientes.length,
    };
  }).filter((c) => c.pendientes > 0);

  const rondaActual = rondas.find((r) => partidos.some((p) => p.ronda === r && p.estado !== 'jugado'));
  const deActual = partidos.filter((p) => p.ronda === rondaActual);
  const { campeon, subcampeon } = podio(llave);
  const final = partidos[partidos.length - 1];
  return {
    torneoId: t.id, nombre: t.nombre, rondas: rondasPlan, partidos, canchas,
    ronda: rondaActual !== undefined && deActual.length > 0
      ? { nombre: deActual[0].nombreRonda, jugados: deActual.filter((p) => p.estado === 'jugado').length, total: deActual.length }
      : null,
    total: partidos.length, jugados: jugadosLista.length,
    vivos: t.parejas.length - jugadosLista.length, jugadores: t.parejas.length,
    pasanDirecto, resultados,
    campeon: campeon ? nombre(campeon) : null, subcampeon: subcampeon ? nombre(subcampeon) : null,
    terminadoEl: campeon && final ? instante(final) || Date.now() : null,
  };
}

/**
 * Un toque del árbitro: `lado` ganó el punto (se guarda 1-0); null = deshacer. Lee la fila fresca
 * y guarda solo si nadie la tocó en el medio (tres árbitros cargan a la vez: reintenta).
 */
export async function marcarOpcEnServidor(torneoId: string, partidoId: string, lado: 'a' | 'b' | null, wo = false): Promise<string | null> {
  const sb = supabase;
  if (!sb) return 'Sin conexión con el servidor';
  for (let intento = 0; intento < 5; intento++) {
    const { data: fila, error } = await sb.from('rk_torneos').select('data, updated_at').eq('id', torneoId).maybeSingle();
    if (error || !fila) return 'No se pudo leer el torneo';
    const t = fila.data as Torneo;
    const llave: PartidoLlave[] = t.partidosLlave ?? [];
    const p = llave.find((x) => x.id === partidoId);
    if (!p) return 'El cruce ya no existe (¿se rearmó la llave?)';
    const ausentes = ausentesDe(t);
    const tenia = resultadoValido(p.puntosA, p.puntosB);
    if (lado !== null && tenia) return 'Ese cruce ya tiene resultado (lo cargó otro árbitro).';
    if (lado === null && !tenia) return null;
    if (lado === null && borradosSiMarco(llave, partidoId, null, ausentes) > 0) {
      return 'Ya se jugó el cruce siguiente: corregilo desde el gestor.';
    }
    const marcados = marcar(llave, partidoId, lado, new Date().toISOString(), ausentes);
    if (marcados === llave || (lado !== null && !resultadoValido(marcados.find((x) => x.id === partidoId)?.puntosA ?? null, marcados.find((x) => x.id === partidoId)?.puntosB ?? null))) {
      return 'Todavía no se puede cargar ese cruce.';
    }
    t.partidosLlave = marcados.map((x) => (x.id === partidoId ? conWo(x, lado !== null && wo) : x));
    const { data: upd, error: e2 } = await sb.from('rk_torneos')
      .update({ data: t, updated_at: new Date().toISOString() })
      .eq('id', torneoId)
      .eq('updated_at', fila.updated_at as string)
      .select('id');
    if (e2) return 'No se pudo guardar (¿sesión vencida?)';
    if (upd && upd.length > 0) return null;
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 250));
  }
  return 'Se está cargando desde otro lado: tocá de nuevo.';
}

/**
 * Elige en cuántas canchas se juega una ronda (se puede cambiar con la ronda empezada: los cruces
 * que faltan se reparten de nuevo). Misma escritura cuidada que un toque: fila fresca y reintento.
 */
export async function canchasOpcEnServidor(torneoId: string, ronda: number, canchas: number): Promise<string | null> {
  const sb = supabase;
  if (!sb) return 'Sin conexión con el servidor';
  if (!Number.isInteger(ronda) || !Number.isInteger(canchas) || canchas < 1 || canchas > MAX_CANCHAS_OPC) return 'Cantidad de canchas inválida';
  for (let intento = 0; intento < 5; intento++) {
    const { data: fila, error } = await sb.from('rk_torneos').select('data, updated_at').eq('id', torneoId).maybeSingle();
    if (error || !fila) return 'No se pudo leer el torneo';
    const t = fila.data as Torneo;
    if (t.opc?.porRonda?.[String(ronda)] === canchas) return null;
    t.opc = { ...(t.opc ?? {}), porRonda: { ...(t.opc?.porRonda ?? {}), [String(ronda)]: canchas } };
    const { data: upd, error: e2 } = await sb.from('rk_torneos')
      .update({ data: t, updated_at: new Date().toISOString() })
      .eq('id', torneoId)
      .eq('updated_at', fila.updated_at as string)
      .select('id');
    if (e2) return 'No se pudo guardar (¿sesión vencida?)';
    if (upd && upd.length > 0) return null;
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 250));
  }
  return 'Se está cargando desde otro lado: probá de nuevo.';
}
