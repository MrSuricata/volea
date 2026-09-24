import type { ConfigPuntos, Jugador, Torneo } from '../torneos/engine/tipos';
import { calcularRanking } from '../torneos/engine/ranking';
import { podioDeTorneo } from '../torneos/publico/resultado';
import { agruparPorEvento, torneoEnVivo } from '../torneos/publico/datos';
import type { TorneoPublico } from '../torneos/publico/datos';
import { nombreDe } from '../torneos/ui/util';
import { normalizar } from '../utils/nombres';

// Resumen de torneos para la sección de la HOME: funciones puras (sin React ni fetch)
// sobre lo mismo que ya leen /torneos y /ranking. Las reglas de fondo (quién es campeón,
// cuántos puntos da cada cosa, qué está "en vivo") NO se recalculan acá: se reusan
// podioDeTorneo, calcularRanking y agruparPorEvento/torneoEnVivo tal cual.

export type EnVivoHome = { nombre: string; to: string };
export type CategoriaHome = {
  id: string;
  nombreCorto: string;
  /** Nombres de los campeones ("Ana Pérez / Juan Díaz"; uno solo en individuales). */
  campeon: string;
  cantidadParejas: number;
  individual: boolean;
};
export type UltimaFechaHome = {
  nombre: string;
  /** "22-23 ago" cuando el nombre del evento la trae ("… · 22-23 ago"); si no, null. */
  fecha: string | null;
  totalCategorias: number;
  categorias: CategoriaHome[];
};
export type FilaTopHome = { jugadorId: string; posicion: number; nombre: string; puntos: number; torneosJugados: number };
export type StatsHome = { jugadores: number; categoriasJugadas: number; fechas: number };
export type ResumenTorneosHome = {
  enVivo: EnVivoHome | null;
  ultimaFecha: UltimaFechaHome | null;
  anio: number;
  top: FilaTopHome[];
  stats: StatsHome;
};

// ─── Nombres para mostrar ────────────────────────────────────────────────────

// Partículas que en un nombre propio van en minúscula ("Juan de León", "Ana y Luis").
const PARTICULAS = new Set(['y', 'de', 'del', 'la', 'las', 'los', 'da', 'do', 'dos', 'van', 'von']);

/** "AGUSTINA TORRIERI" → "Agustina Torrieri". El padrón y las categorías se cargan en
 *  mayúsculas; en la home, en blanco sobre navy, todo en mayúsculas se lee a los gritos. */
export function nombrePropio(texto: string): string {
  return texto
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra, i) => {
      const min = palabra.toLocaleLowerCase('es');
      if (i > 0 && PARTICULAS.has(min)) return min;
      // Letra suelta = nivel de la categoría ("Mixto A"): queda en mayúscula.
      if (/^[a-zñ]$/i.test(palabra)) return palabra.toLocaleUpperCase('es');
      // Mayúscula al arranque y después de guion/apóstrofo ("Ana-Laura", "D'Alessandro").
      // Sin \p{L}: los Smart TV viejos (build legacy) no la entienden en todos lados.
      return min.replace(/(^|[-'’])([a-záéíóúüñàèìòùç])/g, (_m, sep: string, letra: string) => sep + letra.toLocaleUpperCase('es'));
    })
    .join(' ');
}

/** Separa "VOLEA Racket Roll · 22-23 ago" en nombre y fecha. Solo toma como fecha lo que
 *  va después del último " · " si tiene algún número (si no, es parte del nombre). */
export function partirNombreEvento(nombre: string): { nombre: string; fecha: string | null } {
  const limpio = nombre.trim();
  const i = limpio.lastIndexOf(' · ');
  if (i <= 0) return { nombre: limpio, fecha: null };
  const fecha = limpio.slice(i + 3).trim();
  if (!/\d/.test(fecha)) return { nombre: limpio, fecha: null };
  return { nombre: limpio.slice(0, i).trim(), fecha };
}

const TOKEN_FECHA = /^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/;
const TOKEN_SEPARADOR = /^[-–—·|/]+$/;

function contieneSecuencia(pajar: string[], aguja: string[]): boolean {
  for (let i = 0; i + aguja.length <= pajar.length; i++) {
    if (aguja.every((p, k) => pajar[i + k] === p)) return true;
  }
  return false;
}

/**
 * Nombre corto de una categoría para la lista de campeones: saca lo que repite el
 * evento ("MIXTO A RACKET ROLL" en "VOLEA Racket Roll" → "Mixto A") y la fecha pegada
 * al final ("MASCULINO A 26/7" → "Masculino A"). Conservador a propósito: del evento
 * solo saca una cola de 2+ palabras seguidas que aparezca igual en su nombre (una sola
 * palabra suelta coincide demasiado fácil: "TORNEO MASCULINO" en "Torneo Masculino"
 * quedaría "Torneo"), y nunca deja el nombre vacío.
 */
export function nombreCortoCategoria(nombre: string, evento: string | null): string {
  const tokens = nombre.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && TOKEN_FECHA.test(tokens[tokens.length - 1])) tokens.pop();
  if (evento) {
    const palabrasEvento = normalizar(partirNombreEvento(evento).nombre).split(' ');
    for (let largo = tokens.length - 1; largo >= 2; largo--) {
      if (contieneSecuencia(palabrasEvento, tokens.slice(-largo).map(normalizar))) {
        tokens.splice(tokens.length - largo);
        break;
      }
    }
  }
  while (tokens.length > 1 && TOKEN_SEPARADOR.test(tokens[tokens.length - 1])) tokens.pop();
  return nombrePropio(tokens.join(' '));
}

/** Nombres de los jugadores de una pareja, desde el padrón (jugadorIds). Si la pareja no
 *  está vinculada, cae al nombre cargado en el torneo (el mismo nombreDe de /torneos). */
function nombreDePareja(t: Torneo, parejaId: string, padron: Map<string, string>): string | null {
  const pareja = t.parejas.find((p) => p.id === parejaId);
  if (!pareja) return null;
  const nombres = (pareja.jugadorIds ?? []).map((id) => padron.get(id));
  if (nombres.length > 0 && nombres.every((n): n is string => !!n && n.trim() !== '')) {
    return nombres.map(nombrePropio).join(' / ');
  }
  const crudo = nombreDe(t, parejaId);
  if (!crudo.trim() || crudo === '¿?') return null;
  // "ANA PÉREZ y LUIS DÍAZ" / "ANA PÉREZ - LUIS DÍAZ" → mismo separador que las vinculadas.
  const partes = (t.formato ?? 'grupos') === 'individual' ? [crudo] : crudo.split(/\s+(?:y|-|\/)\s+/i);
  return (partes.length === 2 ? partes : [crudo]).map(nombrePropio).join(' / ');
}

// Nivel de la categoría por la letra final ("Mixto A" → 0, "… B" → 1). Sin letra va
// después ("Singles Femenino", "Mixto +50") y los individuales (One Point Challenge)
// al final: son el evento lateral, no la categoría que la gente viene a ver.
function claveOrden(c: CategoriaHome): [number, number, string] {
  const letra = /\s([A-D])$/.exec(c.nombreCorto)?.[1];
  const nivel = letra ? letra.charCodeAt(0) - 65 : 9;
  return [c.individual ? 1 : 0, nivel, normalizar(c.nombreCorto)];
}

function compararCategorias(a: CategoriaHome, b: CategoriaHome): number {
  const ka = claveOrden(a);
  const kb = claveOrden(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
}

// ─── Resumen ─────────────────────────────────────────────────────────────────

// La lista pública solo garantiza parejas[] (filtro de datos.ts); a un documento manco
// le pueden faltar grupos/partidosGrupo y el motor los lee sin preguntar. Mismo criterio
// defensivo que TorneoDetallePage: se completan vacíos en vez de reventar la home.
function conDefaults(t: TorneoPublico): TorneoPublico {
  return {
    ...t,
    grupos: Array.isArray(t.grupos) ? t.grupos : [],
    partidosGrupo: Array.isArray(t.partidosGrupo) ? t.partidosGrupo : [],
  };
}

export function resumenTorneosHome(
  torneosCrudos: TorneoPublico[],
  jugadores: Jugador[],
  config: ConfigPuntos,
  ahoraMs: number,
): ResumenTorneosHome {
  const torneos = torneosCrudos.map(conDefaults);
  const eventos = agruparPorEvento(torneos, ahoraMs);
  const padron = new Map(jugadores.map((j) => [j.id, j.nombre]));

  // En vivo: el grupo más reciente con actividad real. Si hay UNA sola categoría en
  // juego, el link va directo a ella (es lo que la gente quiere mirar); si hay varias,
  // a la lista.
  let enVivo: EnVivoHome | null = null;
  const grupoVivo = eventos.find((e) => e.enVivo);
  if (grupoVivo) {
    const vivos = grupoVivo.torneos.filter((t) => torneoEnVivo(t, ahoraMs));
    enVivo = {
      nombre: partirNombreEvento(grupoVivo.nombre).nombre,
      to: vivos.length === 1 ? `/torneos/${vivos[0].id}` : '/torneos',
    };
  }

  // Última fecha: el evento más reciente con TODAS sus categorías terminadas y al menos
  // un campeón que se pueda mostrar (uno a medio cargar o colgado no es "la última fecha").
  let ultimaFecha: UltimaFechaHome | null = null;
  for (const ev of eventos) {
    if (!ev.terminado) continue;
    const categorias: CategoriaHome[] = [];
    for (const t of ev.torneos) {
      const { campeon } = podioDeTorneo(t);
      if (!campeon) continue;
      const nombres = nombreDePareja(t, campeon, padron);
      if (!nombres) continue;
      categorias.push({
        id: t.id,
        nombreCorto: nombreCortoCategoria(t.nombre, t.evento),
        campeon: nombres,
        cantidadParejas: t.parejas.length,
        individual: (t.formato ?? 'grupos') === 'individual',
      });
    }
    if (categorias.length === 0) continue;
    const { nombre, fecha } = partirNombreEvento(ev.nombre);
    ultimaFecha = { nombre, fecha, totalCategorias: ev.torneos.length, categorias: categorias.sort(compararCategorias) };
    break;
  }

  // Top del año: la MISMA cuenta que /ranking (pestaña del año en curso).
  const anio = new Date(ahoraMs).getFullYear();
  const top = calcularRanking(torneos, jugadores, config, { desde: `${anio}-01-01T00:00:00.000Z` })
    .filter((f) => f.puntos > 0)
    .slice(0, 5)
    .map((f, i) => ({
      jugadorId: f.jugadorId,
      posicion: i + 1,
      nombre: nombrePropio(f.nombre),
      puntos: f.puntos,
      torneosJugados: f.torneosJugados,
    }));

  const stats: StatsHome = {
    jugadores: calcularRanking(torneos, jugadores, config).filter((f) => f.puntos > 0).length,
    categoriasJugadas: torneos.filter((t) => t.fase === 'terminado').length,
    fechas: eventos.filter((e) => e.torneos.some((t) => t.fase === 'terminado')).length,
  };

  return { enVivo, ultimaFecha, anio, top, stats };
}

/** ¿Hay algo que valga la pena mostrar? Si no, la sección no se dibuja. */
export function hayContenido(r: ResumenTorneosHome): boolean {
  return r.enVivo !== null || r.ultimaFecha !== null || r.top.length > 0;
}
