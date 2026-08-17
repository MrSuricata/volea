// Lógica pura de la pestaña Inscripciones del admin: parejas por categoría
// (con fallback al campo legacy) y armado de secciones "spliteadas" por
// categoría con duplas por mención mutua, como la planilla de Brian.

import type { Inscripcion, TarifaEvento } from '../types';
import { normalizar } from './nombres';

/** Costo de una inscripción: $base incluye N categorías, cada adicional suma $extra. */
export function costoInscripcion(nCategorias: number, tarifa: TarifaEvento): number {
  return tarifa.base + Math.max(0, nCategorias - tarifa.incluye) * tarifa.extra;
}

// ── Marca de "última visita" del badge de nuevas ──
// Vive acá (y no en AdminInscripcionesTab) para que AdminPage y BarraAdmin
// puedan consultar el badge sin arrastrar el chunk lazy de la pestaña.

/** localStorage: ISO de la última vez que este navegador miró la pestaña. */
export const MARCA_INSC_VISTAS = 'volea_insc_vistas';

/** Marca de última visita; si nunca se visitó, una semana atrás. */
export const marcaVisitaInscripciones = (): string => {
  const guardada = localStorage.getItem(MARCA_INSC_VISTAS);
  if (guardada && !isNaN(Date.parse(guardada))) return guardada;
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
};

// La marca ANTERIOR se congela una vez por carga de página: si se capturara en
// cada montaje de la pestaña, el chip «nueva» moriría al ir a otra pestaña y
// volver (y con el doble-mount de StrictMode en dev, directamente no aparecía).
let marcaPreviaCongelada: string | null = null;

/** Marca de la visita anterior a esta carga de página (para el chip «nueva»). */
export const marcaVisitaPrevia = (): string => {
  if (marcaPreviaCongelada === null) marcaPreviaCongelada = marcaVisitaInscripciones();
  return marcaPreviaCongelada;
};

export function categoriasDe(i: Inscripcion): string[] {
  return i.categorias.split(',').map(c => c.trim()).filter(Boolean);
}

/** Pareja declarada para una categoría: mapa nuevo, con fallback al campo legacy. */
export function parejaDe(i: Inscripcion, categoria: string): string {
  const m = i.parejas?.[categoria];
  if (m && m.trim()) return m.trim();
  // Las inscripciones viejas tienen un único texto de pareja: vale para
  // cualquier categoría de dobles, nunca para singles.
  if (categoria.toLowerCase().includes('doble') && i.pareja.trim()) return i.pareja.trim();
  return '';
}

export interface SeccionCategoria {
  categoria: string;
  /** Pares de ids de inscripciones emparejadas por mención mutua. */
  duplas: [string, string][];
  /** Ids sin dupla armada (con o sin pareja declarada). */
  sueltos: string[];
  total: number;
}

// ── Gestión del armado del torneo (2026-08-15) ──

/** Umbral de Brian: con 4 duplas (o 4 jugadores en singles) la categoría se juega. */
export const MIN_UNIDADES_VIABLE = 4;

export type Genero = 'F' | 'M' | null;

/**
 * Género inferido por las categorías que juega (para no sugerir parejas
 * imposibles en mixto): algo "Femenino" → F, "Masculino" → M, ambas o ninguna
 * → desconocido (se le da el beneficio de la duda en las sugerencias).
 */
export function generoDe(i: Inscripcion): Genero {
  const cats = categoriasDe(i).map(c => c.toLowerCase());
  const f = cats.some(c => c.includes('femenino'));
  const m = cats.some(c => c.includes('masculino'));
  if (f && !m) return 'F';
  if (m && !f) return 'M';
  return null;
}

export interface ArmadoCategoria {
  categoria: string;
  esDoble: boolean;
  duplasArmadas: number;
  /** Sueltos CON pareja declarada: el compañero existe aunque no se haya anotado. */
  duplasDeclaradas: number;
  /** Sueltos SIN pareja declarada. */
  buscanPareja: number;
  totalPersonas: number;
  /** Dobles: armadas + declaradas · singles: personas. */
  unidades: number;
  nivel: 'verde' | 'ambar' | 'gris';
}

/** Semáforo por categoría: qué se está armando y qué no llega. */
export function resumenArmado(secciones: SeccionCategoria[], inscripciones: Inscripcion[]): ArmadoCategoria[] {
  const porId = new Map(inscripciones.map(i => [i.id, i]));
  return secciones.map(sec => {
    const esDoble = sec.categoria.toLowerCase().includes('doble');
    let declaradas = 0;
    let sinPareja = 0;
    for (const id of sec.sueltos) {
      const i = porId.get(id);
      if (i && parejaDe(i, sec.categoria)) declaradas++;
      else sinPareja++;
    }
    const unidades = esDoble ? sec.duplas.length + declaradas : sec.total;
    const nivel = unidades >= MIN_UNIDADES_VIABLE ? 'verde' : unidades >= 2 ? 'ambar' : 'gris';
    return {
      categoria: sec.categoria, esDoble,
      duplasArmadas: sec.duplas.length, duplasDeclaradas: declaradas, buscanPareja: sinPareja,
      totalPersonas: sec.total, unidades, nivel,
    };
  });
}

export interface EstadisticasTorneo {
  jugadores: number;
  mujeres: number;
  hombres: number;
  sinGenero: number;
  masJugada: { categoria: string; personas: number } | null;
  /** ≈ 2×unidades − 1 por categoría con 2+ unidades (grupos + llave, ballpark). */
  partidosAprox: number;
}

/** Números generales del torneo para el resumen de la pestaña. */
export function estadisticasTorneo(inscripciones: Inscripcion[], armado: ArmadoCategoria[]): EstadisticasTorneo {
  const activos = inscripciones.filter(i => i.estado !== 'baja');
  let mujeres = 0;
  let hombres = 0;
  for (const i of activos) {
    const g = generoDe(i);
    if (g === 'F') mujeres++;
    else if (g === 'M') hombres++;
  }
  const conGente = armado.filter(a => a.totalPersonas > 0);
  const top = conGente.length > 0
    ? conGente.reduce((max, a) => (a.totalPersonas > max.totalPersonas ? a : max))
    : null;
  const partidosAprox = armado
    .filter(a => a.unidades >= 2)
    .reduce((s, a) => s + (2 * a.unidades - 1), 0);
  return {
    jugadores: activos.length,
    mujeres,
    hombres,
    sinGenero: activos.length - mujeres - hombres,
    masJugada: top ? { categoria: top.categoria, personas: top.totalPersonas } : null,
    partidosAprox,
  };
}

export interface BuscanCategoria {
  categoria: string;
  buscan: Inscripcion[];
  /** Pares de ids que podrían anotarse juntos (en mixto, géneros compatibles). */
  cruces: [string, string][];
}

/** Quiénes buscan pareja por categoría, con los cruces posibles entre ellos. */
export function buscanPareja(secciones: SeccionCategoria[], inscripciones: Inscripcion[]): BuscanCategoria[] {
  const porId = new Map(inscripciones.map(i => [i.id, i]));
  const out: BuscanCategoria[] = [];
  for (const sec of secciones) {
    if (!sec.categoria.toLowerCase().includes('doble')) continue;
    const buscan = sec.sueltos
      .map(id => porId.get(id))
      .filter((i): i is Inscripcion => !!i && !parejaDe(i, sec.categoria));
    if (buscan.length === 0) continue;
    const esMixto = sec.categoria.toLowerCase().includes('mixto');
    const cruces: [string, string][] = [];
    for (let a = 0; a < buscan.length; a++) {
      for (let b = a + 1; b < buscan.length; b++) {
        if (esMixto) {
          const ga = generoDe(buscan[a]);
          const gb = generoDe(buscan[b]);
          if (ga && gb && ga === gb) continue; // dos del mismo género no juegan mixto
        }
        cruces.push([buscan[a].id, buscan[b].id]);
      }
    }
    out.push({ categoria: sec.categoria, buscan, cruces });
  }
  return out;
}

export interface FaltaInscribirseItem {
  nombre: string;
  declaradaPor: { nombre: string; categoria: string }[];
}

/** Parejas declaradas cuyo nombre no matchea ninguna inscripción activa del evento. */
export function faltaInscribirse(inscripciones: Inscripcion[]): FaltaInscribirseItem[] {
  const activos = inscripciones.filter(i => i.estado !== 'baja');
  const inscriptos = new Set(activos.map(i => normalizar(i.nombre)));
  const porNombre = new Map<string, FaltaInscribirseItem>();
  for (const i of activos) {
    for (const c of categoriasDe(i)) {
      const p = parejaDe(i, c);
      if (!p || inscriptos.has(normalizar(p))) continue;
      const clave = normalizar(p);
      const item = porNombre.get(clave) ?? { nombre: p, declaradaPor: [] };
      item.declaradaPor.push({ nombre: i.nombre, categoria: c });
      porNombre.set(clave, item);
    }
  }
  return [...porNombre.values()];
}

/**
 * Secciones por categoría para la vista "spliteada": una por categoría del
 * evento (en su orden) más cualquier categoría presente en los datos que el
 * evento ya no liste (resiliente a renombres). Bajas excluidas. En cada
 * sección, dos inscriptos cuyas parejas declaradas se apuntan mutuamente
 * (normalizado, sin tildes) se muestran como dupla armada.
 */
export function armarSeccionesCategoria(
  inscripciones: Inscripcion[],
  categoriasEvento: string[],
): SeccionCategoria[] {
  const activos = inscripciones.filter(x => x.estado !== 'baja');
  const orden: string[] = [...categoriasEvento.map(c => c.trim()).filter(Boolean)];
  for (const i of activos) {
    for (const c of categoriasDe(i)) if (!orden.includes(c)) orden.push(c);
  }
  return orden.map(categoria => {
    const del = activos.filter(x => categoriasDe(x).includes(categoria));
    const usados = new Set<string>();
    const duplas: [string, string][] = [];
    for (const a of del) {
      if (usados.has(a.id)) continue;
      const objetivo = normalizar(parejaDe(a, categoria));
      if (!objetivo) continue;
      const b = del.find(x => x.id !== a.id && !usados.has(x.id)
        && normalizar(x.nombre) === objetivo
        && normalizar(parejaDe(x, categoria)) === normalizar(a.nombre));
      if (b) { usados.add(a.id); usados.add(b.id); duplas.push([a.id, b.id]); }
    }
    const sueltos = del.filter(x => !usados.has(x.id)).map(x => x.id);
    return { categoria, duplas, sueltos, total: del.length };
  });
}
