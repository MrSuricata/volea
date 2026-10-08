import type { PartidoLlave, SlotLlave, Torneo } from '../engine/tipos';
import { resultadoDe } from '../engine/tipos';
import { generarFixture } from '../engine/fixture';
import { calcularTabla } from '../engine/tabla';
import { ganadorPartido, resolverSlot } from '../engine/llave';
import { repartirEnCanchas } from '../engine/programacion';
import type { PartidoAProgramar } from '../engine/programacion';
import { normalizar } from '../../utils/nombres';
import { nombreDe } from '../ui/util';

// ─── Programa del evento en curso ────────────────────────────────────────────
// La pantalla En vivo (/programacion) sale de acá: qué cuadros del gestor son del evento,
// qué día juega cada uno, cuántas canchas hay y cuánto dura un partido. Lo que el
// organizador cambia desde la pantalla (horas de inicio, duración, mover una categoría)
// se guarda en rk_programa y pisa estos valores.

export type DiaPrograma = { clave: string; fecha: string; nombre: string; inicio: number };

/** Ventana en la que no se usa ninguna cancha para los cuadros (One Point Challenge). */
export type BloquePrograma = { dia: string; desde: number; hasta: number; titulo: string; detalle: string };

export type Programa = {
  /** Fila de rk_programa donde se guardan los ajustes hechos desde la pantalla. */
  clave: string;
  titulo: string;
  /** Colores del flyer del evento: barra de arriba y luces del fondo. */
  colores: [string, string, string];
  /** Qué cuadros del gestor son categorías de este evento. */
  esDelEvento: (t: { nombre: string; evento?: string | null }) => boolean;
  /** Nombre de la categoría sin el nombre del evento, para chips y filtros. */
  nombreCorto: (nombre: string) => string;
  /** Día en que juega una categoría mientras nadie la mueva a mano. */
  diaDe: (nombre: string) => string;
  dias: DiaPrograma[];
  /** Minutos que ocupa cada partido en la cancha, entrada en calor incluida. */
  duracion: number;
  /** Canchas que se usan si el tablero todavía no dice otra cosa. */
  canchas: string[];
  bloque: BloquePrograma | null;
  /** Lo que lee el público mientras no hay cuadros cargados. */
  avisoSinCuadros: string;
};

// Aniversario Pickleball City (9 y 10 de octubre de 2026): viernes los singles desde las
// 19:00, sábado los dobles desde las 10:00. Dos canchas, 20 minutos por partido (Brian, 5/10).
export const PROGRAMA: Programa = {
  clave: 'aniversario-pbcity-2026',
  titulo: 'ANIVERSARIO PICKLEBALL CITY',
  colores: ['#F05A28', '#9CCBEE', '#CCFF00'],
  esDelEvento: (t) => /aniversario/i.test(t.nombre) || /aniversario/i.test(t.evento ?? ''),
  nombreCorto: (nombre) =>
    nombre.replace(/\b(aniversario|pickleball city|2026)\b/gi, ' ').replace(/[\s·-]+$/, '').replace(/^[\s·-]+/, '').replace(/\s+/g, ' ').trim()
    || nombre,
  diaDe: (nombre) => (/single/i.test(nombre) ? 'VIE' : 'SAB'),
  dias: [
    { clave: 'VIE', fecha: '2026-10-09', nombre: 'Viernes 9', inicio: 19 * 60 },
    { clave: 'SAB', fecha: '2026-10-10', nombre: 'Sábado 10', inicio: 10 * 60 },
  ],
  duracion: 20,
  canchas: ['Cancha 1', 'Cancha 2'],
  bloque: null,
  avisoSinCuadros: 'Los cuadros y los horarios se publican cuando cierran las inscripciones, el jueves 8 de octubre.',
};

export const BLOQUE_OPC = { titulo: 'ONE POINT CHALLENGE', detalle: 'Todos los anotados · eliminación directa a un punto' };

// ─── Ajustes guardados desde la pantalla ─────────────────────────────────────

export type AjustesPrograma = {
  duracion?: number;
  /** Hora de inicio por día (clave del día → minuto). */
  inicios?: Record<string, number>;
  /** Por cuadro (id del torneo): día en que juega, lugar en el orden del día y hora antes de la cual no arranca. */
  categorias?: Record<string, { dia?: string; orden?: number; noAntes?: number }>;
  /** undefined = el del programa · null = sin bloque. */
  bloque?: BloquePrograma | null;
};

export type ProgramaVigente = {
  duracion: number;
  dias: DiaPrograma[];
  bloque: BloquePrograma | null;
  categoria: (torneoId: string, nombre: string) => { dia: string; orden: number | null; noAntes: number | null };
};

const esMinuto = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 36 * 60;

/** Programa con los ajustes aplicados. Lo que venga roto de la base se ignora y vale el programa. */
export function aplicarAjustes(programa: Programa, ajustes: AjustesPrograma | null | undefined): ProgramaVigente {
  const a = ajustes ?? {};
  const duracion = typeof a.duracion === 'number' && Number.isInteger(a.duracion) && a.duracion >= 5 && a.duracion <= 120
    ? a.duracion : programa.duracion;
  const dias = programa.dias.map((d) => {
    const inicio = a.inicios?.[d.clave];
    return esMinuto(inicio) ? { ...d, inicio } : d;
  });
  const claves = new Set(dias.map((d) => d.clave));
  const b = a.bloque === undefined ? programa.bloque : a.bloque;
  const bloque = b && claves.has(b.dia) && esMinuto(b.desde) && esMinuto(b.hasta) && b.hasta > b.desde ? b : null;
  return {
    duracion,
    dias,
    bloque,
    categoria: (torneoId, nombre) => {
      const c = a.categorias?.[torneoId];
      return {
        dia: c?.dia && claves.has(c.dia) ? c.dia : programa.diaDe(nombre),
        orden: typeof c?.orden === 'number' && Number.isFinite(c.orden) ? c.orden : null,
        noAntes: esMinuto(c?.noAntes) ? c.noAntes : null,
      };
    },
  };
}

// ─── Horas ───────────────────────────────────────────────────────────────────

// La madrugada cuenta como parte del día que empezó: a las 00:40 del sábado el torneo del
// viernes sigue en juego. El día de torneo cambia recién a las 5 de la mañana.
const CORTE_MADRUGADA = 5 * 60;

export const aHora = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "19:30" → 1170. Una hora de madrugada ("00:30") es después de medianoche: 1470. */
export function aMinuto(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const total = h * 60 + min;
  return total < CORTE_MADRUGADA ? total + 24 * 60 : total;
}

const fechaLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Día de torneo en curso (o null si hoy no se juega) y minuto contado desde las 00:00 de ese día. */
export function momentoDeTorneo(ahora: Date, dias: DiaPrograma[]): { fecha: string; dia: string | null; minuto: number } {
  const corrido = new Date(ahora.getTime() - CORTE_MADRUGADA * 60000);
  const fecha = fechaLocal(corrido);
  return {
    fecha,
    dia: dias.find((d) => d.fecha === fecha)?.clave ?? null,
    minuto: corrido.getHours() * 60 + corrido.getMinutes() + CORTE_MADRUGADA,
  };
}

/** Minuto de un instante contado desde las 00:00 de `fecha` (negativo si es de un día anterior). */
export function minutoDesde(fecha: string, instante: Date): number {
  const [a, m, d] = fecha.split('-').map(Number);
  return Math.floor((instante.getTime() - new Date(a, m - 1, d).getTime()) / 60000);
}

// ─── De un cuadro del gestor a lo que falta jugar ────────────────────────────

/** torneoId/partidoId/tipo solo existen en partidos REALES del fixture: son los que se
 *  pueden mandar a una cancha y cargar desde la pantalla. Los proyectados no. */
export type RefPartido = { torneoId?: string; partidoId?: string; tipo?: 'grupo' | 'llave' };

export type Pendiente = {
  /** Id para el reparto, único en todo el evento (dos cuadros pueden repetir el id de un partido). */
  clave: string;
  a: string;
  b: string;
  fase: string;
  /** Personas que lo juegan (nombres normalizados), para no citarlas en dos canchas a la vez. */
  jugadores: string[];
  despuesDe: string[];
  nivel: number;
  /** Partido real con los dos lados definidos. */
  listo: boolean;
} & RefPartido;

export type ResultadoItem = { fase: string; a: string; b: string; pa: number; pb: number; wo?: boolean } & RefPartido;

export type CatProg = {
  torneoId: string;
  nombre: string;
  corto: string;
  dia: string;
  /** Lugar en el orden del día si el organizador lo fijó; si no, van por nombre. */
  orden: number | null;
  noAntes: number | null;
  pendientes: Pendiente[];
  resultados: ResultadoItem[];
  jugados: number;
  total: number;
  terminado: boolean;
  campeon: string | null;
  nGrupos: number;
  gruposCompletos: boolean;
  llaveArmada: boolean;
  /** Americano: el campeón sale de la tabla, no hay llave que armar ni proyectar. */
  sinLlave: boolean;
};

/** Clave de un partido real dentro del evento. */
export const claveDePartido = (torneoId: string, partidoId: string) => `${torneoId}:${partidoId}`;

/** "ANA LAURA FRASCHERI y LARA PINO" → las dos personas, comparables entre categorías. */
export function personasDe(nombrePareja: string): string[] {
  return nombrePareja.split(/\s+y\s+/i).map((n) => normalizar(n)).filter(Boolean);
}

// Tamaños de grupo si todavía no se sorteó (las mismas reglas que usa el organizador).
function tamanosProyectados(n: number): number[] {
  if (n < 2) return [];
  if (n <= 5) return [n];
  const mapa: Record<number, number[]> = {
    6: [3, 3], 7: [4, 3], 8: [4, 4], 9: [3, 3, 3], 10: [4, 3, 3],
    11: [4, 4, 3], 12: [4, 4, 4], 13: [4, 3, 3, 3], 14: [4, 4, 3, 3],
  };
  return mapa[n] ?? [4, 4, 4, 4];
}

function llaveProyectada(nGrupos: number): { a: string; b: string; fase: string }[][] {
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

const esJugable = (p: PartidoLlave) => p.a !== null && p.b !== null;

/** Campeón declarado: quien ganó la final (la ronda más alta, sin contar 3er puesto). En un
 *  americano (o un grupo único que se dio por terminado), el 1° de la tabla con todo jugado. */
function campeonDe(t: Torneo): string | null {
  const llave = t.partidosLlave ?? [];
  const porTabla = (t.sinLlave || t.fase === 'terminado') && llave.length === 0 && t.grupos.length === 1;
  if (porTabla) {
    const completos = t.partidosGrupo.length > 0 && t.partidosGrupo.every((p) => resultadoDe(p) !== null);
    if (!completos) return null;
    const primero = calcularTabla(t.grupos[0].parejaIds, t.partidosGrupo)[0];
    return primero ? nombreDe(t, primero.parejaId) : null;
  }
  const finales = llave.filter((p) => !p.esTercerPuesto && esJugable(p));
  if (finales.length === 0) return null;
  const maxRonda = Math.max(...finales.map((p) => p.ronda));
  const final = finales.find((p) => p.ronda === maxRonda);
  const id = final ? ganadorPartido(final, llave) : null;
  return id ? nombreDe(t, id) : null;
}

// Partidos todavía sin definir de los que depende un lado de la llave. Un pase directo
// (bye) no se juega: se mira qué espera él.
function esperaA(slot: SlotLlave | null, llave: PartidoLlave[]): string[] {
  if (slot === null || slot.tipo === 'seed') return [];
  const previo = llave.find((p) => p.id === slot.partidoId);
  if (!previo || ganadorPartido(previo, llave) !== null) return [];
  if (esJugable(previo)) return [previo.id];
  return [...esperaA(previo.a, llave), ...esperaA(previo.b, llave)];
}

type PendienteDeGrupo = Omit<Pendiente, 'nivel'> & { grupo: number; ronda: number };

/** Lo que le falta jugar a un cuadro (real si ya está armado, proyectado si no) y lo jugado. */
export function armarCategoria(t: Torneo, cfg: { corto: string; dia: string; orden: number | null; noAntes: number | null }): CatProg {
  const resultados: ResultadoItem[] = [];
  const deGrupo: PendienteDeGrupo[] = [];
  let jugados = 0;
  let total = 0;
  let nGrupos = t.grupos.length;
  const llave = t.partidosLlave ?? [];

  if (t.partidosGrupo.length > 0) {
    t.grupos.forEach((g, gi) => {
      const fase = `Grupo ${g.nombre}`;
      for (const p of t.partidosGrupo.filter((x) => x.grupoId === g.id)) {
        total += 1;
        const a = nombreDe(t, p.aId);
        const b = nombreDe(t, p.bId);
        const r = resultadoDe(p);
        if (r) {
          jugados += 1;
          resultados.push({ fase, a, b, pa: r.a, pb: r.b, wo: p.wo, torneoId: t.id, partidoId: p.id, tipo: 'grupo' });
        } else {
          deGrupo.push({
            clave: claveDePartido(t.id, p.id), a, b, fase, jugadores: [...personasDe(a), ...personasDe(b)], despuesDe: [], listo: true,
            torneoId: t.id, partidoId: p.id, tipo: 'grupo', grupo: gi, ronda: p.ronda,
          });
        }
      }
    });
  } else if (llave.length === 0) {
    // Todavía sin fixture: se proyecta. Con los grupos sorteados ya se sabe quién juega con
    // quién; sin sortear, solo cuántos partidos van a ser.
    const sorteado = t.grupos.length > 0;
    const etiqueta = /single/i.test(t.nombre) ? 'Jugador' : 'Dupla';
    const grupos = sorteado
      ? t.grupos.map((g) => ({ nombre: g.nombre, ids: g.parejaIds }))
      : tamanosProyectados(t.parejas.length).map((n, gi) => ({
        nombre: String(gi + 1), ids: Array.from({ length: n }, (_, i) => String(i + 1)),
      }));
    nGrupos = grupos.length;
    grupos.forEach((g, gi) => {
      generarFixture(g.ids, { idaYVuelta: t.idaYVuelta }).forEach((p, k) => {
        total += 1;
        const a = sorteado ? nombreDe(t, p.aId) : `${etiqueta} ${p.aId}`;
        const b = sorteado ? nombreDe(t, p.bId) : `${etiqueta} ${p.bId}`;
        // sin sortear no hay nombres: cada lugar del grupo cuenta como una persona distinta,
        // así el reparto igual respeta que nadie juega dos partidos a la vez
        const jugadores = sorteado
          ? [...personasDe(a), ...personasDe(b)]
          : [`~${t.id}:${gi}:${p.aId}`, `~${t.id}:${gi}:${p.bId}`];
        deGrupo.push({
          clave: `${t.id}:g${gi}:${k}`, a, b, fase: `Grupo ${g.nombre}`, jugadores, despuesDe: [], listo: false,
          grupo: gi, ronda: p.ronda,
        });
      });
    });
  }

  const deLlave: Pendiente[] = [];
  let etapasDeLlave = 0;
  if (llave.length > 0) {
    const jugables = llave.filter(esJugable);
    total += jugables.length;
    const maxRonda = Math.max(...llave.filter((p) => !p.esTercerPuesto).map((p) => p.ronda));
    etapasDeLlave = maxRonda;
    const lado = (s: SlotLlave | null, id: string | null): string => {
      if (id) return nombreDe(t, id);
      return s !== null && s.tipo === 'perdedorDe' ? 'Perdedor ronda previa' : 'Ganador ronda previa';
    };
    for (const p of jugables) {
      const fase = p.esTercerPuesto ? '3er PUESTO'
        : p.ronda === maxRonda ? 'FINAL'
        : p.ronda === maxRonda - 1 ? 'SEMIS' : '4TOS';
      const idA = resolverSlot(p.a, llave);
      const idB = resolverSlot(p.b, llave);
      const a = lado(p.a, idA);
      const b = lado(p.b, idB);
      const r = resultadoDe(p);
      if (r && idA && idB) {
        jugados += 1;
        resultados.push({ fase, a, b, pa: r.a, pb: r.b, wo: p.wo, torneoId: t.id, partidoId: p.id, tipo: 'llave' });
        continue;
      }
      deLlave.push({
        clave: claveDePartido(t.id, p.id), a, b, fase,
        jugadores: [...(idA ? personasDe(a) : []), ...(idB ? personasDe(b) : [])],
        despuesDe: [...esperaA(p.a, llave), ...esperaA(p.b, llave)].map((id) => claveDePartido(t.id, id)),
        nivel: p.esTercerPuesto ? 1 : maxRonda - p.ronda + 1,
        listo: idA !== null && idB !== null,
        torneoId: t.id, partidoId: p.id, tipo: 'llave',
      });
    }
  } else if (t.fase !== 'terminado' && total > 0 && !t.sinLlave) {
    const olas = llaveProyectada(nGrupos);
    etapasDeLlave = olas.length;
    let previos = deGrupo.map((p) => p.clave);
    olas.forEach((ola, w) => {
      const claves: string[] = [];
      ola.forEach((p, k) => {
        total += 1;
        const clave = `${t.id}:l${w}:${k}`;
        claves.push(clave);
        deLlave.push({ clave, a: p.a, b: p.b, fase: p.fase, jugadores: [], despuesDe: previos, nivel: olas.length - w, listo: false });
      });
      previos = claves;
    });
  }

  // Nivel de un partido de grupo: las rondas que le quedan a SU grupo más las etapas de llave.
  const rondasDe = new Map<number, number[]>();
  for (const p of deGrupo) {
    const lista = rondasDe.get(p.grupo) ?? [];
    if (!lista.includes(p.ronda)) lista.push(p.ronda);
    rondasDe.set(p.grupo, lista);
  }
  for (const lista of rondasDe.values()) lista.sort((x, y) => x - y);
  const indiceDeRonda = (p: PendienteDeGrupo) => rondasDe.get(p.grupo)!.indexOf(p.ronda);
  const grupos: Pendiente[] = deGrupo
    .slice()
    // ronda por ronda y, dentro de cada una, un partido de cada grupo: todos avanzan parejo
    .sort((x, y) => indiceDeRonda(x) - indiceDeRonda(y) || x.grupo - y.grupo)
    .map(({ grupo, ronda, ...p }) => ({ ...p, nivel: rondasDe.get(grupo)!.length - rondasDe.get(grupo)!.indexOf(ronda) + etapasDeLlave }));

  // Lo último que se juega (la llave) arriba: los resultados se apilan al revés.
  resultados.reverse();

  return {
    torneoId: t.id, nombre: t.nombre, corto: cfg.corto, dia: cfg.dia, orden: cfg.orden, noAntes: cfg.noAntes,
    pendientes: [...grupos, ...deLlave],
    resultados, jugados, total,
    terminado: t.fase === 'terminado',
    campeon: campeonDe(t),
    nGrupos: t.grupos.length,
    gruposCompletos: t.partidosGrupo.length > 0 && t.partidosGrupo.every((p) => resultadoDe(p) !== null),
    llaveArmada: llave.length > 0,
    sinLlave: !!t.sinLlave,
  };
}

/** Las categorías del evento, cada una con su día y lo que le falta jugar. */
export function categoriasDelEvento(
  torneos: (Torneo & { evento?: string | null })[],
  programa: Programa,
  vigente: ProgramaVigente,
): CatProg[] {
  return torneos
    // el One Point Challenge (formato individual) se juega aparte: va como bloque, no como cuadro
    .filter((t) => programa.esDelEvento(t) && (t.formato ?? 'grupos') !== 'individual')
    .map((t) => armarCategoria(t, { corto: programa.nombreCorto(t.nombre), ...vigente.categoria(t.id, t.nombre) }))
    .sort(enOrdenDeJuego);
}

/** Orden en que arrancan las categorías de un día: el que fijó el organizador y, si no fijó ninguno, por nombre. */
export function enOrdenDeJuego(x: CatProg, y: CatProg): number {
  return (x.orden ?? Infinity) - (y.orden ?? Infinity) || x.corto.localeCompare(y.corto) || x.torneoId.localeCompare(y.torneoId);
}

// ─── Reparto del evento ──────────────────────────────────────────────────────

export type Fila = {
  dia: string;
  ini: number;
  cancha: string;
  categoria: string;
  fase: string;
  a: string;
  b: string;
  listo?: boolean;
  /** Fila del bloque que ocupa todas las canchas (no es un partido). */
  bloque?: boolean;
} & RefPartido;

export type CanchasAhora = {
  /** Canchas habilitadas, en orden. */
  activas: string[];
  /** Lo que se está jugando: en qué cancha y desde qué minuto. */
  enJuego: { cancha: string; torneoId: string; partidoId: string; desde: number }[];
};

export type ResumenDia = { partidos: number; termina: number | null };

/**
 * Hora y cancha estimadas de todo lo que falta. El día en curso arranca en la hora real y
 * con las canchas como están; los demás, en su hora de inicio. Las categorías entran en su
 * orden del día. Lo que quedó sin jugar de un día anterior pasa al día en curso y va primero.
 */
export function programarEvento(args: {
  cats: CatProg[];
  vigente: ProgramaVigente;
  ahora: { dia: string | null; minuto: number };
  canchas: CanchasAhora;
}): { filas: Fila[]; resumen: Record<string, ResumenDia> } {
  const { cats, vigente, ahora, canchas } = args;
  const { dias, duracion, bloque } = vigente;
  const filas: Fila[] = [];
  const resumen: Record<string, ResumenDia> = {};
  const indiceHoy = dias.findIndex((d) => d.clave === ahora.dia);
  const indiceDe = (clave: string) => dias.findIndex((d) => d.clave === clave);
  const vivas = cats.filter((c) => !c.terminado && c.pendientes.length > 0);
  const porClave = new Map<string, Pendiente>();
  for (const c of cats) for (const p of c.pendientes) porClave.set(p.clave, p);

  dias.forEach((dia, i) => {
    resumen[dia.clave] = { partidos: 0, termina: null };
    if (indiceHoy !== -1 && i < indiceHoy) return; // lo pendiente de ese día ya pasó a hoy
    const esHoy = i === indiceHoy;
    const inicio = esHoy ? Math.max(dia.inicio, ahora.minuto) : dia.inicio;
    const delDia = vivas
      .filter((c) => c.dia === dia.clave || (esHoy && indiceDe(c.dia) !== -1 && indiceDe(c.dia) < i))
      .map((c) => ({ cat: c, colgada: c.dia !== dia.clave }))
      .sort((x, y) => Number(y.colgada) - Number(x.colgada) || enOrdenDeJuego(x.cat, y.cat));

    const jugandose = esHoy
      ? canchas.enJuego
        .filter((e) => canchas.activas.includes(e.cancha))
        .map((e) => ({ ...e, clave: claveDePartido(e.torneoId, e.partidoId) }))
      : [];
    const finDe = (desde: number) => Math.max(ahora.minuto, desde + duracion);
    const enJuego = jugandose.map((e) => ({
      id: e.clave, jugadores: porClave.get(e.clave)?.jugadores ?? [], termina: finDe(e.desde),
    }));
    const yaEnCancha = new Set(jugandose.map((e) => e.clave));
    const disponibles = canchas.activas.map((nombre) => {
      const ocupada = jugandose.find((e) => e.cancha === nombre);
      return { nombre, libreDesde: ocupada ? Math.max(inicio, finDe(ocupada.desde)) : inicio };
    });

    const origen = new Map<string, { cat: CatProg; p: Pendiente }>();
    const partidos: PartidoAProgramar[] = [];
    for (const [prioridad, { cat, colgada }] of delDia.entries()) {
      for (const p of cat.pendientes) {
        if (yaEnCancha.has(p.clave)) continue;
        origen.set(p.clave, { cat, p });
        partidos.push({
          id: p.clave, jugadores: p.jugadores, despuesDe: p.despuesDe, prioridad, nivel: p.nivel,
          noAntes: colgada ? dia.inicio : Math.max(dia.inicio, cat.noAntes ?? dia.inicio),
          urgente: colgada,
        });
      }
    }

    const delBloque = bloque && bloque.dia === dia.clave && !(esHoy && ahora.minuto >= bloque.hasta) ? bloque : null;
    const opciones = { duracion, enJuego, bloqueos: delBloque ? [{ desde: delBloque.desde, hasta: delBloque.hasta }] : [] };
    const reparto = repartirEnCanchas(partidos, disponibles, opciones);
    const turnos = [...reparto.turnos];
    if (reparto.sinLugar.length > 0) {
      // No debería pasar (esperan a un partido que no está en la lista): van al final, sin
      // condiciones, para que al menos figuren.
      const fin = Math.max(inicio, ...turnos.map((x) => x.fin));
      const sueltos = partidos.filter((p) => reparto.sinLugar.includes(p.id)).map((p) => ({ ...p, despuesDe: [], noAntes: fin }));
      turnos.push(...repartirEnCanchas(sueltos, disponibles.map((c) => ({ ...c, libreDesde: fin })), opciones).turnos);
    }

    for (const turno of turnos) {
      const { cat, p } = origen.get(turno.id)!;
      filas.push({
        dia: dia.clave, ini: turno.inicio, cancha: turno.cancha, categoria: cat.corto, fase: p.fase, a: p.a, b: p.b,
        listo: p.listo, torneoId: p.torneoId, partidoId: p.partidoId, tipo: p.tipo,
      });
    }
    if (delBloque) {
      filas.push({
        dia: dia.clave, ini: esHoy ? Math.max(delBloque.desde, Math.min(ahora.minuto, delBloque.hasta)) : delBloque.desde,
        cancha: 'TODAS', categoria: delBloque.titulo, fase: `hasta ${aHora(delBloque.hasta)}`, a: delBloque.detalle, b: '', bloque: true,
      });
    }
    resumen[dia.clave] = { partidos: turnos.length, termina: turnos.length > 0 ? Math.max(...turnos.map((x) => x.fin)) : null };
  });

  const orden = (clave: string) => indiceDe(clave);
  filas.sort((x, y) => orden(x.dia) - orden(y.dia) || x.ini - y.ini || x.cancha.localeCompare(y.cancha, undefined, { numeric: true }));
  return { filas, resumen };
}
