import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PartidoLlave, SlotLlave, Torneo } from '../engine/tipos';
import { resultadoDe } from '../engine/tipos';
import { normalizar } from '../../utils/nombres';
import { nombreDe } from '../ui/util';
import { listarTorneosPublicos } from './datos';
import { RkCargando, RkError } from './Estados';
import { supabase } from '../../services/supabaseClient';
import '../torneos.css';

// ─── Programación en vivo del Racket Roll ────────────────────────────────────
// Dos vistas en una: los partidos PENDIENTES con hora y cancha proyectadas
// (greedy sobre las canchas, anclado en la hora actual) y los RESULTADOS que se
// van cargando en el gestor, con puntaje. Pensada para el celular en la cancha:
// tarjetas grandes, filtro por categoría con un toque, refresh cada 60s.

type Dia = 'SAB' | 'DOM';

// 3 canchas (definido por Brian la víspera): el greedy reparte sobre estas.
const CANCHAS = ['Cancha 1', 'Cancha 2', 'Cancha 3'];
// El domingo depende de cuántas canchas haya (se define el sábado): hasta entonces
// NO se publican horarios por partido, solo los inicios de bloque del flyer.
const DOM_CONFIRMADO = true;   // 22/08 23h: 3 canchas confirmadas y los 6 cuadros sorteados
const BLOQUES_DOM: [string, string][] = [
  ['9:30', 'Femenino B'], ['11:00', 'Mixto B'], ['12:30', 'Masculino B'],
  ['14:00', 'Femenino A'], ['15:30', 'Mixto A'], ['17:00', 'Masculino A'],
];
const FECHA_DIA: Record<Dia, string> = { SAB: '2026-08-22', DOM: '2026-08-23' };
const NOMBRE_DIA: Record<Dia, string> = { SAB: 'Sábado 22', DOM: 'Domingo 23' };
// Duración real por partido con calentamiento (dato de Brian, 22/08): ~15 min
// tanto a 11 standard como a 21 rally (las C). La final lleva 5 min extra.
const DUR_PARTIDO = 15;
// OPC del sábado 18:00-19:30: ocupa todas las canchas; los singles arrancan después.
const OPC_INICIO = 18 * 60;
const OPC_FIN = 19 * 60 + 30;

// Hora de inicio de cada categoría según el flyer (minutos desde las 00:00).
const PROGRAMA: Record<string, { dia: Dia; inicio: number }> = {
  'FEMENINO C RACKET ROLL': { dia: 'SAB', inicio: 10 * 60 },
  'MIXTO C RACKET ROLL': { dia: 'SAB', inicio: 12 * 60 },
  'MIXTO +50 RACKET ROLL': { dia: 'SAB', inicio: 12 * 60 },
  'MASCULINO C RACKET ROLL': { dia: 'SAB', inicio: 14 * 60 },
  'MASCULINO +50 RACKET ROLL': { dia: 'SAB', inicio: 14 * 60 },
  'SINGLES MASCULINO B RACKET ROLL': { dia: 'SAB', inicio: OPC_FIN },
  'SINGLES FEMENINO RACKET ROLL': { dia: 'SAB', inicio: OPC_FIN },
  'SINGLES MASCULINO A RACKET ROLL': { dia: 'SAB', inicio: 21 * 60 },
  'FEMENINO B RACKET ROLL': { dia: 'DOM', inicio: 9 * 60 + 30 },
  'MIXTO B RACKET ROLL': { dia: 'DOM', inicio: 11 * 60 },
  'MASCULINO B RACKET ROLL': { dia: 'DOM', inicio: 12 * 60 + 30 },
  'FEMENINO A RACKET ROLL': { dia: 'DOM', inicio: 14 * 60 },
  'MIXTO A RACKET ROLL': { dia: 'DOM', inicio: 15 * 60 + 30 },
  'MASCULINO A RACKET ROLL': { dia: 'DOM', inicio: 17 * 60 },
};

// torneoId/partidoId/tipo solo existen en partidos REALES del fixture: son los que
// el modo admin puede cargar desde esta pantalla. Los proyectados no se editan.
type RefPartido = { torneoId?: string; partidoId?: string; tipo?: 'grupo' | 'llave' };
type PartidoProg = { a: string; b: string; fase: string } & RefPartido;
type ResultadoItem = { fase: string; a: string; b: string; pa: number; pb: number } & RefPartido;
type CatProg = {
  nombre: string;
  corto: string;
  dia: Dia;
  inicio: number;
  rondas: PartidoProg[][][]; // [grupo][ronda][partidos en paralelo]
  llave: PartidoProg[][]; // olas: 4tos → semis → final
  resultados: ResultadoItem[];
  jugados: number;
  total: number;
  terminado: boolean;
  campeon: string | null;
  torneoId: string;
  nGrupos: number;
  gruposCompletos: boolean;
  llaveArmada: boolean;
};
type Fila = { dia: Dia; ini: number; cancha: string; categoria: string; fase: string; a: string; b: string } & RefPartido;

const aHora = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// "ANTONELLA TERRA y CRISTINA MAICH" -> "Antonella y Cristina" (para la cinta:
// nombres de pila capitalizados; en nombres triples conserva el compuesto: "Ana Laura").
function nombresPila(nombre: string): string {
  const pila = (persona: string) => {
    const partes = persona.trim().split(/\s+/);
    const sinApellido = partes.length > 1 ? partes.slice(0, -1) : partes;
    return sinApellido.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  };
  return nombre.split(/\s+y\s+/i).map(pila).join(' y ');
}

// Rondas todos-contra-todos con descansos repartidos (método del círculo), por tamaño.
const RONDAS_RR: Record<number, [number, number][][]> = {
  2: [[[1, 2]]],
  3: [[[1, 2]], [[1, 3]], [[2, 3]]],
  4: [[[1, 2], [3, 4]], [[1, 3], [2, 4]], [[1, 4], [2, 3]]],
  5: [[[2, 5], [3, 4]], [[1, 3], [4, 5]], [[2, 4], [1, 5]], [[3, 5], [1, 2]], [[1, 4], [2, 3]]],
};

// Tamaños de grupo si todavía no se sorteó (mismas reglas que usó el organizador).
function tamanosProyectados(n: number): number[] {
  if (n <= 5) return [n];
  const mapa: Record<number, number[]> = {
    6: [3, 3], 7: [4, 3], 8: [4, 4], 9: [3, 3, 3], 10: [4, 3, 3],
    11: [4, 4, 3], 12: [4, 4, 4], 13: [4, 3, 3, 3], 14: [4, 4, 3, 3],
  };
  return mapa[n] ?? [4, 4, 4, 4];
}

// Sigue la cadena ganadorDe/perdedorDe hasta la pareja real, si ya se puede saber.
function parejaDeSlot(s: SlotLlave | null, porId: Map<string, PartidoLlave>): string | null {
  if (!s) return null;
  if (s.tipo === 'seed') return s.parejaId;
  const p = porId.get(s.partidoId);
  if (!p) return null;
  const r = resultadoDe(p);
  if (!r) return null;
  const ganoA = r.a > r.b;
  const siguiente = (s.tipo === 'ganadorDe') === ganoA ? p.a : p.b;
  return parejaDeSlot(siguiente, porId);
}

function llaveProyectada(nGrupos: number): PartidoProg[][] {
  if (nGrupos <= 1) return [[{ a: '1° de la liga', b: '2° de la liga', fase: 'FINAL' }]];
  if (nGrupos === 2) {
    return [
      [{ a: '1° Grupo A', b: '2° Grupo B', fase: 'SEMIS' }, { a: '1° Grupo B', b: '2° Grupo A', fase: 'SEMIS' }],
      [{ a: 'Ganador SF1', b: 'Ganador SF2', fase: 'FINAL' }],
    ];
  }
  return [
    Array.from({ length: 4 }, (_, i) => ({ a: `Cruce ${i + 1}`, b: 'según tabla', fase: '4TOS' })),
    [{ a: 'Ganador QF1', b: 'Ganador QF2', fase: 'SEMIS' }, { a: 'Ganador QF3', b: 'Ganador QF4', fase: 'SEMIS' }],
    [{ a: 'Ganador SF1', b: 'Ganador SF2', fase: 'FINAL' }],
  ];
}

// Campeón declarado: ganador de la final (la ronda más alta de la llave, sin
// contar 3er puesto) cuando ya tiene resultado. Antes de eso, null.
function campeonDe(t: Torneo): string | null {
  if (!t.partidosLlave || t.partidosLlave.length === 0) return null;
  const finales = t.partidosLlave.filter((p) => !p.esTercerPuesto && p.a !== null && p.b !== null);
  if (finales.length === 0) return null;
  const maxRonda = Math.max(...finales.map((p) => p.ronda));
  const final = finales.find((p) => p.ronda === maxRonda);
  if (!final) return null;
  const r = resultadoDe(final);
  if (!r) return null;
  const porId = new Map(t.partidosLlave.map((p) => [p.id, p]));
  const id = parejaDeSlot(r.a > r.b ? final.a : final.b, porId);
  return id ? nombreDe(t, id) : null;
}

// Extrae del torneo lo pendiente (real si existe, proyectado si no) y lo jugado.
function armarCategoria(t: Torneo, cfg: { dia: Dia; inicio: number }): CatProg {
  const rondas: PartidoProg[][][] = [];
  let llave: PartidoProg[][] = [];
  const resultados: ResultadoItem[] = [];
  let jugados = 0;
  let total = 0;

  if (t.partidosGrupo.length > 0) {
    for (const g of t.grupos) {
      const delGrupo = t.partidosGrupo.filter((p) => p.grupoId === g.id);
      total += delGrupo.length;
      const porRonda = new Map<number, PartidoProg[]>();
      for (const p of delGrupo) {
        const r = resultadoDe(p);
        if (r) {
          jugados += 1;
          resultados.push({
            fase: `Grupo ${g.nombre}`, a: nombreDe(t, p.aId), b: nombreDe(t, p.bId), pa: r.a, pb: r.b,
            torneoId: t.id, partidoId: p.id, tipo: 'grupo',
          });
          continue;
        }
        const lista = porRonda.get(p.ronda) ?? [];
        lista.push({
          a: nombreDe(t, p.aId), b: nombreDe(t, p.bId), fase: `Grupo ${g.nombre}`,
          torneoId: t.id, partidoId: p.id, tipo: 'grupo',
        });
        porRonda.set(p.ronda, lista);
      }
      rondas.push([...porRonda.entries()].sort((x, y) => x[0] - y[0]).map(([, lista]) => lista));
    }
  } else if (t.grupos.length > 0) {
    for (const g of t.grupos) {
      const n = Math.min(g.parejaIds.length, 5);
      const plan = (RONDAS_RR[n] ?? []).map((ronda) =>
        ronda.map(([a, b]) => ({
          a: nombreDe(t, g.parejaIds[a - 1]), b: nombreDe(t, g.parejaIds[b - 1]), fase: `Grupo ${g.nombre}`,
        })),
      );
      rondas.push(plan);
      total += plan.reduce((s, r) => s + r.length, 0);
    }
  } else {
    const tams = tamanosProyectados(t.parejas.length);
    tams.forEach((n, gi) => {
      const plan = (RONDAS_RR[Math.min(n, 5)] ?? []).map((ronda) =>
        ronda.map(([a, b]) => ({ a: `Dupla ${a}`, b: `Dupla ${b}`, fase: `Grupo ${gi + 1}` })),
      );
      rondas.push(plan);
      total += plan.reduce((s, r) => s + r.length, 0);
    });
  }

  if (t.partidosLlave && t.partidosLlave.length > 0) {
    const porId = new Map(t.partidosLlave.map((p) => [p.id, p]));
    const jugables = t.partidosLlave.filter((p) => p.a !== null && p.b !== null);
    total += jugables.length;
    const maxRonda = Math.max(...t.partidosLlave.map((p) => p.ronda));
    const nombreSlot = (s: SlotLlave | null): string => {
      const id = parejaDeSlot(s, porId);
      if (id) return nombreDe(t, id);
      if (!s) return 'BYE';
      return s.tipo === 'ganadorDe' ? 'Ganador ronda previa' : 'Perdedor ronda previa';
    };
    const porRonda = new Map<number, PartidoProg[]>();
    for (const p of jugables) {
      const fase = p.esTercerPuesto ? '3er PUESTO'
        : p.ronda === maxRonda ? 'FINAL'
        : p.ronda === maxRonda - 1 ? 'SEMIS' : '4TOS';
      const r = resultadoDe(p);
      if (r) {
        jugados += 1;
        resultados.push({
          fase, a: nombreSlot(p.a), b: nombreSlot(p.b), pa: r.a, pb: r.b,
          torneoId: t.id, partidoId: p.id, tipo: 'llave',
        });
        continue;
      }
      const lista = porRonda.get(p.ronda) ?? [];
      lista.push({ a: nombreSlot(p.a), b: nombreSlot(p.b), fase, torneoId: t.id, partidoId: p.id, tipo: 'llave' });
      porRonda.set(p.ronda, lista);
    }
    llave = [...porRonda.entries()].sort((x, y) => x[0] - y[0]).map(([, lista]) => lista);
  } else if (t.fase !== 'terminado') {
    const nGrupos = Math.max(t.grupos.length, tamanosProyectados(t.parejas.length).length);
    llave = llaveProyectada(nGrupos);
    llave.forEach((ola) => { total += ola.length; });
  }

  // Lo último que se juega (llave) arriba: los resultados se apilan al revés.
  resultados.reverse();

  return {
    nombre: t.nombre, corto: t.nombre.replace(' RACKET ROLL', ''), dia: cfg.dia, inicio: cfg.inicio,
    rondas, llave, resultados, jugados, total, terminado: t.fase === 'terminado',
    campeon: campeonDe(t),
    torneoId: t.id,
    nGrupos: t.grupos.length,
    gruposCompletos: t.partidosGrupo.length > 0 && t.partidosGrupo.every((p) => resultadoDe(p) !== null),
    llaveArmada: !!t.partidosLlave && t.partidosLlave.length > 0,
  };
}

// Posiciones de un grupo: victorias, y los empates se resuelven por DUELO DIRECTO
// entre las empatadas (mini-liga: victorias y luego diferencia entre ellas) antes
// que por diferencia global — la regla de la casa (caso Fem C del 22/08).
function posicionesDeGrupo(t: Torneo, parejaIds: string[]): string[] {
  const stats = new Map(parejaIds.map((id) => [id, { w: 0, dif: 0 }]));
  const jugadosEntre = (ids: Set<string>) =>
    t.partidosGrupo.filter((p) => ids.has(p.aId) && ids.has(p.bId) && resultadoDe(p) !== null);
  for (const p of jugadosEntre(new Set(parejaIds))) {
    const r = resultadoDe(p)!;
    const sa = stats.get(p.aId)!;
    const sb = stats.get(p.bId)!;
    sa.dif += r.a - r.b;
    sb.dif += r.b - r.a;
    (r.a > r.b ? sa : sb).w += 1;
  }
  const orden = [...parejaIds].sort((x, y) => stats.get(y)!.w - stats.get(x)!.w);
  // desempate por bloques de igual cantidad de victorias
  const resultado: string[] = [];
  let i = 0;
  while (i < orden.length) {
    let j = i;
    while (j < orden.length && stats.get(orden[j])!.w === stats.get(orden[i])!.w) j++;
    const bloque = orden.slice(i, j);
    if (bloque.length > 1) {
      const ids = new Set(bloque);
      const mini = new Map(bloque.map((id) => [id, { w: 0, dif: 0 }]));
      for (const p of jugadosEntre(ids)) {
        const r = resultadoDe(p)!;
        const sa = mini.get(p.aId)!;
        const sb = mini.get(p.bId)!;
        sa.dif += r.a - r.b;
        sb.dif += r.b - r.a;
        (r.a > r.b ? sa : sb).w += 1;
      }
      bloque.sort((x, y) =>
        mini.get(y)!.w - mini.get(x)!.w
        || mini.get(y)!.dif - mini.get(x)!.dif
        || stats.get(y)!.dif - stats.get(x)!.dif);
    }
    resultado.push(...bloque);
    i = j;
  }
  return resultado;
}

const idCorto = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

// Arma la llave en el servidor cuando la fase de grupos está completa. Soporta
// liga única (final 1° vs 2°) y 2 grupos (semis cruzadas + final). Con 3+ grupos
// (mejores terceros) devuelve un aviso para armarla desde el gestor.
async function armarLlaveEnServidor(torneoId: string): Promise<string | null> {
  const sb = supabase;
  if (!sb) return 'Sin conexión con el servidor';
  const { data: fila, error } = await sb.from('rk_torneos').select('data, updated_at').eq('id', torneoId).maybeSingle();
  if (error || !fila) return 'No se pudo leer el torneo';
  const t = fila.data as Torneo;
  if (t.partidosLlave && t.partidosLlave.length > 0) return null; // ya estaba armada
  if (t.partidosGrupo.length === 0 || t.partidosGrupo.some((p) => resultadoDe(p) === null)) {
    return 'Todavía quedan partidos de grupo sin resultado';
  }
  const seed = (parejaId: string): SlotLlave => ({ tipo: 'seed', parejaId });
  let llave: PartidoLlave[];
  if (t.grupos.length === 1) {
    const pos = posicionesDeGrupo(t, t.grupos[0].parejaIds);
    llave = [{ id: idCorto(), ronda: 1, posicion: 0, esTercerPuesto: false, a: seed(pos[0]), b: seed(pos[1]), puntosA: null, puntosB: null }];
  } else if (t.grupos.length === 2) {
    const posA = posicionesDeGrupo(t, t.grupos[0].parejaIds);
    const posB = posicionesDeGrupo(t, t.grupos[1].parejaIds);
    const sf1 = { id: idCorto(), ronda: 1, posicion: 0, esTercerPuesto: false, a: seed(posA[0]), b: seed(posB[1]), puntosA: null, puntosB: null };
    const sf2 = { id: idCorto(), ronda: 1, posicion: 1, esTercerPuesto: false, a: seed(posB[0]), b: seed(posA[1]), puntosA: null, puntosB: null };
    const final = {
      id: idCorto(), ronda: 2, posicion: 0, esTercerPuesto: false,
      a: { tipo: 'ganadorDe', partidoId: sf1.id } as SlotLlave,
      b: { tipo: 'ganadorDe', partidoId: sf2.id } as SlotLlave,
      puntosA: null, puntosB: null,
    };
    llave = [sf1, sf2, final];
  } else {
    return 'Esta categoría lleva mejores terceros: armá la llave desde el gestor';
  }
  t.partidosLlave = llave;
  t.configLlave = { porGrupo: 2, mejoresExtra: 0, tercerPuesto: false };
  const { data: upd, error: e2 } = await sb.from('rk_torneos')
    .update({ data: t, updated_at: new Date().toISOString() })
    .eq('id', torneoId)
    .eq('updated_at', fila.updated_at as string)
    .select('id');
  if (e2) return 'No se pudo guardar (¿sesión vencida?)';
  if (!upd || upd.length === 0) return 'Se editó desde otro lado: probá de nuevo';
  return null;
}

// Greedy de canchas: cada partido toma la cancha que antes se libere; una ronda
// de un grupo no arranca sin cerrar la anterior.
function programar(cats: CatProg[], ancla: Record<Dia, number>, libreDesde: number[], hoy: Dia | null, enJuego: Set<string>): Fila[] {
  const filas: Fila[] = [];
  for (const dia of ['SAB', 'DOM'] as Dia[]) {
    // Para el día en curso cada cancha arranca cuando se libera (lo que está
    // jugando ahora la ocupa ~15 min desde que se marcó); los otros días, en el
    // horario del bloque.
    const canchas = CANCHAS.map((_, i) => (dia === hoy ? Math.max(ancla[dia], libreDesde[i]) : ancla[dia]));
    let opcMarcado = false;
    const delDia = cats.filter((c) => c.dia === dia && !c.terminado).sort((a, b) => a.inicio - b.inicio);
    for (const cat of delDia) {
      if (dia === 'SAB' && cat.inicio >= OPC_FIN && !opcMarcado) {
        opcMarcado = true;
        if (ancla.SAB < OPC_FIN) {
          filas.push({ dia, ini: Math.max(OPC_INICIO, ancla.SAB), cancha: 'TODAS', categoria: 'ONE POINT CHALLENGE', fase: 'Punto único', a: 'Todos los anotados', b: 'eliminación directa' });
          for (let i = 0; i < canchas.length; i++) canchas[i] = Math.max(canchas[i], OPC_FIN);
        }
      }
      const disp = cat.rondas.map(() => Math.max(cat.inicio, Math.min(...canchas)));
      const maxRondas = Math.max(0, ...cat.rondas.map((g) => g.length));
      for (let r = 0; r < maxRondas; r++) {
        cat.rondas.forEach((grupo, gi) => {
          if (r >= grupo.length) return;
          let finRonda = disp[gi];
          for (const p of grupo[r]) {
            if (p.partidoId && enJuego.has(p.partidoId)) continue;
            const ci = canchas.indexOf(Math.min(...canchas));
            const ini = Math.max(disp[gi], canchas[ci], cat.inicio);
            canchas[ci] = ini + DUR_PARTIDO;
            finRonda = Math.max(finRonda, ini + DUR_PARTIDO);
            filas.push({ dia, ini, cancha: CANCHAS[ci], categoria: cat.corto, fase: p.fase, a: p.a, b: p.b, torneoId: p.torneoId, partidoId: p.partidoId, tipo: p.tipo });
          }
          disp[gi] = finRonda;
        });
      }
      let listo = Math.max(cat.inicio, ...disp);
      for (const ola of cat.llave) {
        let finOla = listo;
        for (const p of ola) {
          if (p.partidoId && enJuego.has(p.partidoId)) continue;
          const d = p.fase === 'FINAL' ? DUR_PARTIDO + 5 : DUR_PARTIDO;
          const ci = canchas.indexOf(Math.min(...canchas));
          const ini = Math.max(listo, canchas[ci]);
          canchas[ci] = ini + d;
          finOla = Math.max(finOla, ini + d);
          filas.push({ dia, ini, cancha: CANCHAS[ci], categoria: cat.corto, fase: p.fase, a: p.a, b: p.b, torneoId: p.torneoId, partidoId: p.partidoId, tipo: p.tipo });
        }
        listo = finOla;
      }
    }
  }
  return filas.sort((a, b) => a.ini - b.ini || a.cancha.localeCompare(b.cancha));
}

// Escritura del modo admin: lee la fila fresca, anota el puntaje en ESE partido y
// guarda solo si nadie tocó el torneo en el medio (updated_at como candado optimista).
// El gestor detecta cambios remotos por baseline, así que nunca pisa en silencio.
async function guardarResultado(torneoId: string, tipo: 'grupo' | 'llave', partidoId: string, pa: number | null, pb: number | null): Promise<string | null> {
  const sb = supabase;
  if (!sb) return 'Sin conexión con el servidor';
  for (let intento = 0; intento < 2; intento++) {
    const { data: fila, error } = await sb.from('rk_torneos').select('data, updated_at').eq('id', torneoId).maybeSingle();
    if (error || !fila) return 'No se pudo leer el torneo';
    const t = fila.data as Torneo;
    const lista = tipo === 'grupo' ? t.partidosGrupo : t.partidosLlave ?? [];
    const p = lista.find((x) => x.id === partidoId);
    if (!p) return 'El partido ya no existe (¿se rearmó el cuadro?)';
    p.puntosA = pa;
    p.puntosB = pb;
    const { data: upd, error: e2 } = await sb.from('rk_torneos')
      .update({ data: t, updated_at: new Date().toISOString() })
      .eq('id', torneoId)
      .eq('updated_at', fila.updated_at as string)
      .select('id');
    if (e2) return 'No se pudo guardar (¿sesión vencida?)';
    if (upd && upd.length > 0) {
      // el partido terminó: si estaba marcado en una cancha, la libera (mejor esfuerzo)
      if (pa !== null) {
        await sb.from('rk_en_cancha')
          .update({ torneo_id: null, partido_id: null, updated_at: new Date().toISOString() })
          .eq('partido_id', partidoId);
      }
      return null;
    }
    // otro dispositivo escribió entre la lectura y el guardado: reintenta con la versión fresca
  }
  return 'Se está editando desde otro lado: probá de nuevo';
}

type EnCancha = { cancha: string; torneoId: string | null; partidoId: string | null; desde: string | null };

// Datos legibles de un partido marcado en cancha, buscándolo en los datos vivos.
function etiquetaEnCancha(torneos: Torneo[], e: EnCancha): { cat: string; a: string; b: string; tipo: 'grupo' | 'llave' } | null {
  if (!e.torneoId || !e.partidoId) return null;
  const t = torneos.find((x) => x.id === e.torneoId);
  if (!t) return null;
  const pg = t.partidosGrupo.find((p) => p.id === e.partidoId);
  if (pg) {
    return { cat: t.nombre.replace(' RACKET ROLL', ''), a: nombreDe(t, pg.aId), b: nombreDe(t, pg.bId), tipo: 'grupo' };
  }
  const pl = (t.partidosLlave ?? []).find((p) => p.id === e.partidoId);
  if (pl) {
    const porId = new Map((t.partidosLlave ?? []).map((p) => [p.id, p]));
    const nom = (s: SlotLlave | null) => {
      const id = parejaDeSlot(s, porId);
      return id ? nombreDe(t, id) : '¿?';
    };
    return { cat: t.nombre.replace(' RACKET ROLL', ''), a: nom(pl.a), b: nom(pl.b), tipo: 'llave' };
  }
  return null;
}

// Mini formulario de carga/edición (solo modo admin, solo partidos reales).
// Con `borrable` ofrece quitar el resultado: el partido vuelve a Próximos.
function CargaResultado({ partido, inicialA, inicialB, borrable, onGuardado }: {
  partido: { a: string; b: string } & RefPartido;
  inicialA?: number;
  inicialB?: number;
  borrable?: boolean;
  onGuardado: () => void;
}) {
  const [pa, setPa] = useState(inicialA !== undefined ? String(inicialA) : '');
  const [pb, setPb] = useState(inicialB !== undefined ? String(inicialB) : '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function mandar(a: number | null, b: number | null) {
    setGuardando(true);
    setError('');
    const problema = await guardarResultado(partido.torneoId!, partido.tipo!, partido.partidoId!, a, b);
    setGuardando(false);
    if (problema) {
      setError(problema);
      return;
    }
    onGuardado();
  }

  function guardar() {
    const a = Number(pa);
    const b = Number(pb);
    if (pa === '' || pb === '' || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      setError('Puntajes inválidos');
      return;
    }
    if (a === b) {
      setError('No puede haber empate');
      return;
    }
    void mandar(a, b);
  }

  function borrar() {
    if (!window.confirm('¿Quitar este resultado? El partido vuelve a Próximos.')) return;
    void mandar(null, null);
  }

  const caja: React.CSSProperties = { width: 62, textAlign: 'center', fontSize: '1.1rem', fontWeight: 800, padding: '7px 4px' };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
      <input type="number" inputMode="numeric" min={0} value={pa} onChange={(e) => setPa(e.target.value)} placeholder="—" aria-label={`Puntos ${partido.a}`} style={caja} />
      <span style={{ opacity: 0.6, fontWeight: 700 }}>–</span>
      <input type="number" inputMode="numeric" min={0} value={pb} onChange={(e) => setPb(e.target.value)} placeholder="—" aria-label={`Puntos ${partido.b}`} style={caja} />
      <button className="boton" disabled={guardando} onClick={guardar}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
      {borrable && (
        <button className="boton secundario" disabled={guardando} onClick={borrar}>Quitar</button>
      )}
      {error && <span style={{ color: '#ff8fa8', fontSize: '0.85rem' }}>{error}</span>}
    </div>
  );
}

// Un resultado en la lista: en modo carga muestra "Editar" para corregir o quitar.
function FilaResultado({ r, borde, modoCarga, onGuardado }: {
  r: ResultadoItem;
  borde: boolean;
  modoCarga: boolean;
  onGuardado: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const ganaA = r.pa > r.pb;
  return (
    <div style={{ borderTop: borde ? '1px solid var(--borde)' : 'none', paddingTop: borde ? 8 : 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: '0.72rem', opacity: 0.6, textTransform: 'uppercase', fontWeight: 700 }}>{r.fase}</span>
        {modoCarga && r.partidoId && (
          <button
            onClick={() => setEditando(!editando)}
            style={{ background: 'none', border: 'none', color: 'var(--lima)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, padding: 0 }}
          >
            {editando ? 'Cancelar' : 'Editar'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '1rem', fontWeight: ganaA ? 700 : 400 }}>
        <span>{r.a}</span>
        <span style={{ color: ganaA ? 'var(--lima)' : 'inherit', fontWeight: 800 }}>{r.pa}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '1rem', fontWeight: ganaA ? 400 : 700 }}>
        <span>{r.b}</span>
        <span style={{ color: ganaA ? 'inherit' : 'var(--lima)', fontWeight: 800 }}>{r.pb}</span>
      </div>
      {editando && (
        <CargaResultado partido={r} inicialA={r.pa} inicialB={r.pb} borrable
          onGuardado={() => { setEditando(false); onGuardado(); }} />
      )}
    </div>
  );
}

type Estado = 'cargando' | 'ok' | 'error';

const chip: React.CSSProperties = {
  fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
  padding: '3px 9px', borderRadius: 999, border: '1px solid var(--borde)', whiteSpace: 'nowrap',
};
const carta: React.CSSProperties = {
  background: 'var(--navy-1)', border: '1px solid var(--borde)', borderRadius: 14, padding: '12px 16px',
};

export default function ProgramacionPage() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [mensajeError, setMensajeError] = useState('');
  const [torneos, setTorneos] = useState<Torneo[]>([]);
  const [actualizado, setActualizado] = useState<Date | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const hoyISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const [dia, setDia] = useState<Dia>(hoyISO === FECHA_DIA.DOM ? 'DOM' : 'SAB');
  const [filtro, setFiltro] = useState('');
  const [busqueda, setBusqueda] = useState('');
  // Modo admin: visible solo con sesión iniciada, y aún así apagado por defecto
  // (la misma página va en la TV del club: ahí nadie tiene que ver inputs).
  const [esAdmin, setEsAdmin] = useState(false);
  // persiste entre recargas (cada deploy recarga la pagina y lo apagaba);
  // en la TV no molesta: sin sesion de admin los controles no se muestran igual
  const [modoCarga, setModoCargaEstado] = useState(() => {
    try { return localStorage.getItem('volea_envivo_carga') === '1'; } catch { return false; }
  });
  const setModoCarga = (v: boolean) => {
    setModoCargaEstado(v);
    try { localStorage.setItem('volea_envivo_carga', v ? '1' : '0'); } catch { /* privado */ }
  };

  useEffect(() => {
    void supabase?.auth.getSession().then(({ data }) => setEsAdmin(!!data.session));
  }, []);

  const [enCancha, setEnCancha] = useState<EnCancha[]>([]);

  const cargar = useCallback(async (primera: boolean) => {
    if (primera) setEstado('cargando');
    const r = await listarTorneosPublicos();
    if (r.error) {
      if (primera) { setMensajeError(r.error); setEstado('error'); }
      return; // refresh silencioso fallido: se mantiene lo último que se vio
    }
    setTorneos(r.torneos);
    // Tablero de canchas (lectura pública). Si falla, se conserva lo último visto.
    if (supabase) {
      const { data } = await supabase.from('rk_en_cancha').select('cancha, torneo_id, partido_id, updated_at');
      if (data) {
        setEnCancha(data.map((f) => ({
          cancha: f.cancha as string,
          torneoId: (f.torneo_id as string | null) ?? null,
          partidoId: (f.partido_id as string | null) ?? null,
          desde: (f.updated_at as string | null) ?? null,
        })));
      }
    }
    setActualizado(new Date());
    setEstado('ok');
  }, []);

  async function mandarACancha(cancha: string, ref: { torneoId?: string | null; partidoId?: string | null }) {
    const sb = supabase;
    if (!sb || !ref.partidoId) return;
    const ahora = new Date().toISOString();
    // si ya estaba marcado en otra cancha, primero se lo saca de ahí
    await sb.from('rk_en_cancha').update({ torneo_id: null, partido_id: null, updated_at: ahora }).eq('partido_id', ref.partidoId);
    await sb.from('rk_en_cancha').update({ torneo_id: ref.torneoId, partido_id: ref.partidoId, updated_at: ahora }).eq('cancha', cancha);
    void cargar(false);
  }

  async function liberarCancha(cancha: string) {
    const sb = supabase;
    if (!sb) return;
    await sb.from('rk_en_cancha').update({ torneo_id: null, partido_id: null, updated_at: new Date().toISOString() }).eq('cancha', cancha);
    void cargar(false);
  }

  useEffect(() => {
    void cargar(true);
    const timer = window.setInterval(() => void cargar(false), 60000);
    return () => window.clearInterval(timer);
  }, [cargar]);

  const { filas, cats } = useMemo(() => {
    const cats = torneos
      .filter((t) => PROGRAMA[t.nombre])
      .map((t) => armarCategoria(t, PROGRAMA[t.nombre]));
    const ahora = new Date();
    const nowMin = ahora.getHours() * 60 + ahora.getMinutes();
    const hoy: Dia | null = hoyISO === FECHA_DIA.SAB ? 'SAB' : hoyISO === FECHA_DIA.DOM ? 'DOM' : null;
    // Antes de que arranque el día manda el horario del bloque; una vez arrancado,
    // la hora real (si no, lo pendiente se proyectaría en el pasado o de más).
    const ancla: Record<Dia, number> = {
      SAB: hoy === 'SAB' ? Math.max(10 * 60, nowMin) : 10 * 60,
      DOM: hoy === 'DOM' ? Math.max(9 * 60 + 30, nowMin) : 9 * 60 + 30,
    };
    const libreDesde = CANCHAS.map((c) => {
      const e = enCancha.find((x) => x.cancha === c);
      if (!e?.partidoId || !e.desde) return nowMin;
      const d = new Date(e.desde);
      return Math.max(nowMin, d.getHours() * 60 + d.getMinutes() + DUR_PARTIDO);
    });
    const enJuego = new Set(enCancha.filter((e) => e.partidoId).map((e) => e.partidoId as string));
    return { filas: programar(cats, ancla, libreDesde, hoy, enJuego), cats };
  }, [torneos, hoyISO, actualizado, enCancha]); // eslint-disable-line react-hooks/exhaustive-deps

  if (estado === 'cargando') return <RkCargando texto="Armando la programación…" />;
  if (estado === 'error') return <RkError mensaje={mensajeError} onReintentar={() => void cargar(true)} />;

  const catsDelDia = cats.filter((c) => c.dia === dia).sort((a, b) => a.inicio - b.inicio);
  // Búsqueda por jugador o categoría (acento- y mayúscula-insensible), combinable con los chips.
  const q = normalizar(busqueda);
  const coincide = (texto: string) => !q || normalizar(texto).includes(q);
  const canchaDePartido = new Map(enCancha.filter((e) => e.partidoId).map((e) => [e.partidoId as string, e.cancha]));
  const pendientes = filas
    .filter((f) =>
      f.dia === dia
      && (!filtro || f.categoria === filtro || f.categoria === 'ONE POINT CHALLENGE')
      && coincide(`${f.a} ${f.b} ${f.categoria}`)
      // los que están jugando viven en el tablero de arriba, no se repiten acá
      && !(f.partidoId && canchaDePartido.has(f.partidoId)));
  const visibles = verTodos || filtro || q ? pendientes : pendientes.slice(0, 12);
  const conResultados = catsDelDia
    .map((c) => ({
      ...c,
      resultados: !q || coincide(c.corto) ? c.resultados : c.resultados.filter((r) => coincide(`${r.a} ${r.b}`)),
    }))
    .filter((c) => c.resultados.length > 0 && (!filtro || c.corto === filtro));
  const domSinConfirmar = dia === 'DOM' && !DOM_CONFIRMADO;
  // Cinta de últimos resultados (todas las categorías, las más recientes primero:
  // categorías de inicio más tarde arriba y, dentro de cada una, la llave primero).
  const cinta = cats
    .slice()
    .sort((x, y) => y.inicio - x.inicio)
    .flatMap((c) => c.resultados.map((r) => ({ cat: c.corto, ...r })))
    .slice(0, 30);
  // Campeones en orden de aparición (el último título arriba).
  const campeones = cats
    .filter((c) => c.campeon)
    .sort((x, y) => (x.dia === y.dia ? x.inicio - y.inicio : x.dia === 'SAB' ? -1 : 1))
    .reverse();
  // Quién está jugando AHORA en alguna cancha (para avisar antes de mandar a
  // una misma persona a dos canchas: pasa con los que juegan varias categorías).
  const ocupados = new Map<string, string>();
  enCancha.forEach((e) => {
    const et = e.partidoId ? etiquetaEnCancha(torneos, e) : null;
    if (!et) return;
    [...et.a.split(/\s+y\s+/i), ...et.b.split(/\s+y\s+/i)].forEach((n) => ocupados.set(normalizar(n), e.cancha));
  });
  const conflictosDe = (f: Fila) =>
    [...f.a.split(/\s+y\s+/i), ...f.b.split(/\s+y\s+/i)]
      .map((n) => ({ jugador: n.trim(), cancha: ocupados.get(normalizar(n)) }))
      .filter((c): c is { jugador: string; cancha: string } => !!c.cancha);
  // Candidatos para llenar una cancha vacia: del dia, todavia no en cancha y sin
  // jugadores ocupados. Ignora el buscador a proposito (sugiere de TODO el dia,
  // incluso de otra categoria: asi no queda una cancha parada esperando el bloque).
  const canchasLibres = CANCHAS.filter((c) => !enCancha.find((e) => e.cancha === c)?.partidoId);
  // Primero los rezagados del OTRO dia (semis/finales que quedaron colgadas de
  // ayer), despues la cola del dia: una cancha libre siempre tiene que ofrecer algo.
  const jugable = (f: Fila) => !!f.partidoId && !canchaDePartido.has(f.partidoId!) && conflictosDe(f).length === 0;
  const sugeridos = [
    ...filas.filter((f) => f.dia !== dia && jugable(f)),
    ...filas.filter((f) => f.dia === dia && jugable(f)),
  ];

  return (
    <div className="rk" style={{ position: 'relative' }}>
      {/* Fondo con vida: glows en los colores del flyer (rosa/cian/lima) + puntillado
          disco, fijos y sin capturar toques. El contenido va arriba con zIndex 1. */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: [
          'radial-gradient(620px 420px at 88% -60px, rgba(255,45,158,0.16), transparent 70%)',
          'radial-gradient(720px 520px at -12% 34%, rgba(34,211,238,0.12), transparent 70%)',
          'radial-gradient(640px 640px at 72% 112%, rgba(204,255,0,0.09), transparent 70%)',
        ].join(', '),
      }} />
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.5,
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1.4px)',
        backgroundSize: '22px 22px',
      }} />
      <main className="contenedor" style={{ position: 'relative', zIndex: 1, maxWidth: 1760 }}>
        <div aria-hidden style={{
          height: 4, borderRadius: 999, marginBottom: 14,
          background: 'linear-gradient(90deg, #FF2D9E, #22D3EE 55%, #CCFF00)',
        }} />

        {cinta.length > 0 && (
          <div className="cinta-resultados" aria-label="Últimos resultados"
            style={{ border: '1px solid var(--borde)', borderRadius: 14, background: 'var(--navy-1)', marginBottom: 14 }}>
            <div className="cinta-track" style={{
              display: 'inline-flex', whiteSpace: 'nowrap', alignItems: 'center',
              animation: `rk-marquee ${Math.max(25, cinta.length * 6)}s linear infinite`, willChange: 'transform',
            }}>
              {[...cinta, ...cinta].map((r, i) => {
                const ganaA = r.pa > r.pb;
                return (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '12px 22px', textTransform: 'uppercase' }}>
                    <span style={{ color: 'var(--lima)', fontWeight: 800, fontSize: '0.95rem', letterSpacing: '0.06em' }}>{r.cat}</span>
                    <span style={{ fontSize: '1.25rem', letterSpacing: '0.02em', color: '#fff' }}>
                      <span style={{ fontWeight: ganaA ? 800 : 500, opacity: ganaA ? 1 : 0.85 }}>
                        {nombresPila(r.a)} <span style={{ color: ganaA ? 'var(--lima)' : '#fff' }}>{r.pa}</span>
                      </span>
                      <span style={{ opacity: 0.5 }}> – </span>
                      <span style={{ fontWeight: ganaA ? 500 : 800, opacity: ganaA ? 0.85 : 1 }}>
                        <span style={{ color: ganaA ? '#fff' : 'var(--lima)' }}>{r.pb}</span> {nombresPila(r.b)}
                      </span>
                    </span>
                    <span style={{ opacity: 0.3, color: 'var(--lima)' }}>◆</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <header className="cabecera">
          <h1><span className="marca">EN VIVO</span> RACKET ROLL 🪩</h1>
          <div className="acciones">
            <Link className="boton secundario" to="/torneos">Cuadros</Link>
            <button className="boton secundario" onClick={() => void cargar(false)}>Actualizar</button>
            {esAdmin && (
              <button className={`boton ${modoCarga ? '' : 'secundario'}`} onClick={() => setModoCarga(!modoCarga)}>
                {modoCarga ? '✓ Cargando resultados' : 'Cargar resultados'}
              </button>
            )}
          </div>
        </header>

        <div className="envivo-grid">
        <aside className="col-izq">
          <div style={{ ...carta, borderColor: 'var(--lima)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: '1.4rem' }}>🏆</span>
              <span style={{ fontWeight: 900, letterSpacing: '0.1em', fontSize: '1rem' }}>CAMPEONES</span>
            </div>
            {campeones.length === 0 ? (
              <div style={{ opacity: 0.5, fontSize: '0.9rem' }}>El primer título se está jugando…</div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {campeones.map((c, i) => (
                  <div key={c.corto} style={{ borderLeft: '3px solid var(--lima)', paddingLeft: 10 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--lima)', textTransform: 'uppercase' }}>
                        {c.corto}
                      </span>
                      {i === 0 && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 900, background: 'var(--lima)', color: '#101c33', borderRadius: 999, padding: '1px 7px', letterSpacing: '0.06em' }}>
                          ✨ NUEVO
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.3, textTransform: 'uppercase' }}>
                      {c.campeon}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        {conResultados.length > 0 && (
          <>
            <h2 style={{ fontSize: '1.05rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8, margin: '18px 0 10px' }}>
              Resultados
            </h2>
            <div style={{ display: 'grid', gap: 14 }}>
              {conResultados.map((c) => (
                <div key={c.corto} style={carta}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
                    <strong style={{ fontSize: '1.02rem' }}>{c.corto}</strong>
                    <span style={{ fontSize: '0.78rem', opacity: 0.6 }}>{c.jugados}/{c.total} jugados</span>
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {c.resultados.map((r, i) => (
                      <FilaResultado key={r.partidoId ?? i} r={r} borde={i > 0} modoCarga={modoCarga}
                        onGuardado={() => void cargar(false)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        </aside>
        <div className="col-centro">

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          {(['SAB', 'DOM'] as Dia[]).map((d) => (
            <button key={d} className={`boton ${dia === d ? '' : 'secundario'}`} onClick={() => { setDia(d); setFiltro(''); setVerTodos(false); }}>
              {NOMBRE_DIA[d]}
            </button>
          ))}
          <span style={{ fontSize: '0.8rem', opacity: 0.65, marginLeft: 'auto' }}>
            Horarios estimados{actualizado ? ` · ${actualizado.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        </div>

        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscá tu nombre o categoría…"
          aria-label="Buscar por jugador o categoría"
          style={{ width: '100%', marginBottom: 10, fontSize: '1rem' }}
        />

        {/* Filtro por categoría: un toque y ves solo lo tuyo */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 10 }}>
          <button onClick={() => setFiltro('')}
            style={{ ...chip, cursor: 'pointer', background: filtro === '' ? 'var(--lima)' : 'transparent', color: filtro === '' ? '#101c33' : 'var(--texto)' }}>
            Todas
          </button>
          {catsDelDia.map((c) => (
            <button key={c.corto} onClick={() => { setFiltro(filtro === c.corto ? '' : c.corto); setVerTodos(false); }}
              style={{ ...chip, cursor: 'pointer', background: filtro === c.corto ? 'var(--lima)' : 'transparent', color: filtro === c.corto ? '#101c33' : 'var(--texto)' }}>
              {c.corto} {c.terminado ? '✓' : `${c.jugados}/${c.total}`}
            </button>
          ))}
        </div>

        {domSinConfirmar ? (
          <div style={{ ...carta, marginBottom: 20 }}>
            <p style={{ margin: '0 0 10px', fontSize: '1.05rem' }}>
              <strong>Programación del domingo a confirmar</strong> — depende de las canchas
              disponibles; el detalle por partido se publica el sábado a la noche.
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 2, fontSize: '1.05rem' }}>
              {BLOQUES_DOM.map(([h, c]) => <li key={c}><strong>{h}</strong> — {c}</li>)}
            </ul>
          </div>
        ) : (
          <>
            {modoCarga && catsDelDia
              .filter((c) => c.gruposCompletos && !c.llaveArmada && !c.terminado)
              .map((c) => (
                <div key={c.corto} style={{ ...carta, borderColor: 'var(--lima)', marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800 }}>🏁 {c.corto}: grupos completos</span>
                  <button className="boton" onClick={async () => {
                    const problema = await armarLlaveEnServidor(c.torneoId);
                    if (problema) window.alert(problema);
                    void cargar(false);
                  }}>
                    {c.nGrupos === 1 ? 'Armar FINAL (1° vs 2°)' : c.nGrupos === 2 ? 'Armar SEMIS + FINAL' : 'Ver cómo armar'}
                  </button>
                </div>
              ))}

            <h2 style={{ fontSize: '1.05rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8, margin: '0 0 10px' }}>
              Próximos partidos
            </h2>
            {pendientes.length === 0 ? (
              <p className="vacio">No queda nada pendiente para este día 🎉</p>
            ) : (
              <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
                {visibles.map((f, i) => (
                  <div key={f.partidoId ?? i} style={carta}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--lima)' }}>{aHora(f.ini)}</span>
                      <span style={chip}>{f.cancha}</span>
                      <span style={chip}>{f.categoria}</span>
                      <span style={{ ...chip, border: 'none', opacity: 0.7, fontWeight: f.fase === 'FINAL' ? 800 : 700 }}>{f.fase}</span>
                    </div>
                    <div style={{ fontSize: '1.02rem', fontWeight: 600, lineHeight: 1.45 }}>
                      {f.a}
                      <span style={{ opacity: 0.55, fontWeight: 400 }}> vs </span>
                      {f.b}
                    </div>
                    {modoCarga && f.partidoId && (() => {
                      const choques = conflictosDe(f);
                      return (
                        <>
                          {choques.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#ffd28a', fontWeight: 700 }}>
                              ⚠ {choques.map((c) => `${c.jugador} está jugando en ${c.cancha}`).join(' · ')}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                            <span style={{ fontSize: '0.75rem', opacity: 0.6, fontWeight: 700 }}>Mandar a</span>
                            {CANCHAS.map((nombre) => (
                              <button key={nombre} className="boton secundario"
                                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                                onClick={() => {
                                  if (choques.length > 0 && !window.confirm(
                                    `${choques.map((c) => `${c.jugador} está jugando en ${c.cancha}`).join('. ')}. ¿Mandar igual?`)) return;
                                  void mandarACancha(nombre, f);
                                }}>
                                {nombre.replace('Cancha ', 'C')}
                              </button>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
            {!verTodos && !filtro && pendientes.length > visibles.length && (
              <button className="boton secundario" style={{ width: '100%', marginBottom: 20 }} onClick={() => setVerTodos(true)}>
                Ver los {pendientes.length} pendientes del día
              </button>
            )}
          </>
        )}


        </div>
        <div className="col-der">
          <h2 style={{ fontSize: '1.05rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8, margin: '0 0 10px' }}>
            En cancha
          </h2>
        {/* Tablero: quién está jugando en cada cancha AHORA (lo ve todo el mundo) */}
        <div style={{ display: 'grid', gap: 10 }}>
          {CANCHAS.map((nombre) => {
            const e = enCancha.find((x) => x.cancha === nombre);
            const et = e ? etiquetaEnCancha(torneos, e) : null;
            return (
              <div key={nombre} style={{ ...carta, borderColor: et ? 'var(--lima)' : 'var(--borde)' }}>
                <div style={{ marginBottom: 6 }}>
                  <span style={{ ...chip, background: et ? 'var(--lima)' : 'transparent', color: et ? '#101c33' : 'var(--texto)' }}>
                    {et ? '▶ ' : ''}{nombre}
                  </span>
                </div>
                {et ? (
                  <>
                    <div style={{ fontSize: '0.72rem', opacity: 0.65, textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>{et.cat}</div>
                    <div style={{ fontSize: '0.98rem', fontWeight: 700, lineHeight: 1.35 }}>{et.a} vs {et.b}</div>
                    {modoCarga && e?.torneoId && e?.partidoId && (
                      <>
                        <CargaResultado
                          partido={{ a: et.a, b: et.b, torneoId: e.torneoId, partidoId: e.partidoId, tipo: et.tipo }}
                          onGuardado={() => void cargar(false)}
                        />
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                          <span style={{ fontSize: '0.75rem', opacity: 0.6, fontWeight: 700 }}>Mover a</span>
                          {CANCHAS.filter((otra) => otra !== nombre).map((otra) => (
                            <button key={otra} className="boton secundario"
                              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                              onClick={() => void mandarACancha(otra, e)}>
                              {otra.replace('Cancha ', 'C')}
                            </button>
                          ))}
                          <button className="boton secundario" style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                            onClick={() => void liberarCancha(nombre)}>
                            ✕ Cancelar
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : (() => {
                  const sug = modoCarga ? sugeridos[canchasLibres.indexOf(nombre)] : undefined;
                  if (!sug) return <div style={{ opacity: 0.45, fontWeight: 600 }}>Libre</div>;
                  return (
                    <>
                      <div style={{ fontSize: '0.72rem', opacity: 0.6, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                        Libre — sugerido: {sug.categoria}
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.35, marginBottom: 8 }}>
                        {sug.a} <span style={{ opacity: 0.5, fontWeight: 400 }}>vs</span> {sug.b}
                      </div>
                      <button className="boton" style={{ width: '100%' }} onClick={() => void mandarACancha(nombre, sug)}>
                        Mandar a {nombre}
                      </button>
                    </>
                  );
                })()}
              </div>
            );
          })}
        </div>
        </div>
        </div>
      </main>
    </div>
  );
}
