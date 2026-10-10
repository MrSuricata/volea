// Copas de Oro y Plata: al terminar la fase de grupos, una tabla general ordena a TODAS las
// parejas y las mejores `oro` van a una llave (Copa de Oro) y el resto a otra (Copa de Plata).
// Cada copa es un torneo aparte (solo llave), así En vivo, el gestor y la página pública lo
// tratan como cualquier cuadro.
import type { PartidoGrupo, PartidoLlave, SlotLlave, Torneo } from './tipos';
import { nuevoId, resultadoDe } from './tipos';
import { calcularTabla } from './tabla';
import { armarLlave } from './llave';

export type FilaGeneral = {
  parejaId: string;
  grupoId: string;
  grupo: string;
  posicion: number;
  /** Lo jugado en el grupo tal cual. */
  pj: number; pg: number; dif: number; pf: number;
  /** Sin contar los partidos contra las parejas que sobran respecto del grupo más chico
   *  (en un grupo de 4 contra un grupo de 3: se descuenta el partido contra la 4ª). */
  ajustado: { pj: number; pg: number; dif: number; pf: number };
};

function stats(parejaId: string, partidos: PartidoGrupo[], excluir: Set<string>) {
  const s = { pj: 0, pg: 0, dif: 0, pf: 0 };
  for (const p of partidos) {
    if (p.aId !== parejaId && p.bId !== parejaId) continue;
    const rival = p.aId === parejaId ? p.bId : p.aId;
    if (excluir.has(rival)) continue;
    const r = resultadoDe(p);
    if (!r) continue;
    const propios = p.aId === parejaId ? r.a : r.b;
    const ajenos = p.aId === parejaId ? r.b : r.a;
    s.pj += 1; s.pf += propios; s.dif += propios - ajenos;
    if (propios > ajenos) s.pg += 1;
  }
  return s;
}

const prom = (x: number, n: number) => (n > 0 ? x / n : 0);

/**
 * Tabla general de un torneo con varios grupos: primero por posición en el grupo. Entre
 * primeras (y segundas) desempata lo ajustado (sin el partido contra la última de los grupos
 * grandes): PG, diferencia, PF. De terceras para abajo, por promedio por partido jugado.
 */
export function tablaGeneral(t: Torneo): FilaGeneral[] {
  const minimo = Math.min(...t.grupos.map((g) => g.parejaIds.length));
  const filas: FilaGeneral[] = [];
  for (const g of t.grupos) {
    const partidos = t.partidosGrupo.filter((p) => p.grupoId === g.id);
    const tabla = calcularTabla(g.parejaIds, partidos);
    const sobran = new Set(tabla.filter((f) => f.posicion > minimo).map((f) => f.parejaId));
    for (const f of tabla) {
      filas.push({
        parejaId: f.parejaId, grupoId: g.id, grupo: g.nombre, posicion: f.posicion,
        pj: f.pj, pg: f.pg, dif: f.dif, pf: f.pf,
        ajustado: stats(f.parejaId, partidos, sobran.has(f.parejaId) ? new Set() : sobran),
      });
    }
  }
  return filas.sort((x, y) => {
    if (x.posicion !== y.posicion) return x.posicion - y.posicion;
    if (x.posicion <= 2) {
      return y.ajustado.pg - x.ajustado.pg || y.ajustado.dif - x.ajustado.dif || y.ajustado.pf - x.ajustado.pf || x.grupo.localeCompare(y.grupo);
    }
    return prom(y.pg, y.pj) - prom(x.pg, x.pj) || prom(y.dif, y.pj) - prom(x.dif, x.pj) || prom(y.pf, y.pj) - prom(x.pf, x.pj) || x.grupo.localeCompare(y.grupo);
  });
}

export const gruposCompletos = (t: Torneo) => t.partidosGrupo.length > 0 && t.partidosGrupo.every((p) => resultadoDe(p) !== null);

/** Partidos por ronda de una llave de n (byes a los mejores): [primera ronda, ..., final]. */
export function rondasDeLlave(n: number): number[] {
  if (n < 2) return [];
  let s = 2;
  while (s < n) s *= 2;
  const rondas = [n - s / 2];
  for (let r = s / 4; r >= 1; r /= 2) rondas.push(r);
  return rondas;
}

export type Copas = { oro: Torneo; plata: Torneo; general: FilaGeneral[] };

/** Arma las dos copas a partir de la tabla general. `ids` fija los ids (para reintentos). */
export function armarCopas(t: Torneo, opts: { ahora?: string; ids?: { oro: string; plata: string } } = {}): Copas {
  const cuantas = t.copas?.oro ?? 0;
  if (!t.copas || cuantas < 2 || t.parejas.length - cuantas < 2) throw new Error('Copas: hacen falta al menos 2 parejas por copa');
  if (!gruposCompletos(t)) throw new Error('Copas: quedan partidos de grupo sin resultado');
  const general = tablaGeneral(t);
  const ahora = opts.ahora ?? new Date().toISOString();
  // Regla del Aniversario (3 grupos, Oro de 6, Plata de 5): el 7º es el mejor tercero de los
  // grupos más grandes; 8º y 9º los otros terceros; 10º y 11º los últimos.
  const tresGrupos = t.grupos.length === 3 && cuantas === 6;
  const maxTam = Math.max(...t.grupos.map((g) => g.parejaIds.length));
  const tam = (f: FilaGeneral) => t.grupos.find((g) => g.id === f.grupoId)!.parejaIds.length;
  let restantes = general.slice(cuantas);
  if (tresGrupos && restantes.length === 5) {
    const terceros = restantes.filter((f) => f.posicion === 3);
    const septimo = terceros.find((f) => tam(f) === maxTam) ?? terceros[0];
    restantes = [septimo, ...restantes.filter((f) => f !== septimo)];
  }
  const llaveDe = (filas: FilaGeneral[], esOro: boolean): PartidoLlave[] => {
    if (tresGrupos && esOro) return armarLlaveSeis(t);
    if (tresGrupos && !esOro && filas.length === 5) return llavePlataCinco(filas.map((f) => f.parejaId));
    return armarLlave(filas.map((f) => ({ parejaId: f.parejaId, grupoId: f.grupoId })), false);
  };
  const copa = (id: string, titulo: string, filas: FilaGeneral[], cuenta: boolean): Torneo => ({
    id,
    nombre: `${t.nombre} · ${titulo}`,
    creadoEl: ahora,
    fase: 'llave',
    parejas: filas.map((f) => ({ ...t.parejas.find((p) => p.id === f.parejaId)! })),
    grupos: [],
    partidosGrupo: [],
    configLlave: null,
    partidosLlave: llaveDe(filas, cuenta),
    canchas: t.canchas,
    categoria: t.categoria,
    cuentaParaRanking: cuenta ? t.cuentaParaRanking : false,
    visible: t.visible,
    evento: t.evento,
    copaDe: t.id,
  });
  return {
    general,
    oro: copa(opts.ids?.oro ?? nuevoId(), 'COPA DE ORO', general.slice(0, cuantas), true),
    plata: copa(opts.ids?.plata ?? nuevoId(), 'COPA DE PLATA', restantes, false),
  };
}

/**
 * Llave de 6 para 3 grupos (regla del Aniversario): clasifican 1º y 2º de cada grupo, ordenados
 * por la tabla general (entre primeros y segundos sin el partido contra el último de los grupos
 * grandes). Los dos mejores primeros esperan en semis; 4tos: 3er primero vs peor segundo y
 * mejor segundo vs segundo segundo. Semis: mejor primero vs ganador de los segundos, segundo
 * mejor primero vs ganador del otro cuarto.
 */
export function armarLlaveSeis(t: Torneo): PartidoLlave[] {
  if (t.grupos.length !== 3) throw new Error('La llave de 6 es para 3 grupos');
  if (!gruposCompletos(t)) throw new Error('Quedan partidos de grupo sin resultado');
  const g = tablaGeneral(t);
  const [p1, p2, p3] = g.filter((f) => f.posicion === 1).map((f) => f.parejaId);
  const [s1, s2, s3] = g.filter((f) => f.posicion === 2).map((f) => f.parejaId);
  if (!p3 || !s3) throw new Error('Faltan primeros o segundos de grupo');
  const seed = (parejaId: string): SlotLlave => ({ tipo: 'seed', parejaId });
  const gan = (partidoId: string): SlotLlave => ({ tipo: 'ganadorDe', partidoId });
  const base = { puntosA: null, puntosB: null, esTercerPuesto: false };
  // posiciones: el cuarto que alimenta a la semi 1 va arriba, así el dibujo de la llave coincide
  const qf1: PartidoLlave = { ...base, id: nuevoId(), ronda: 1, posicion: 1, a: seed(p3), b: seed(s3) };
  const qf2: PartidoLlave = { ...base, id: nuevoId(), ronda: 1, posicion: 0, a: seed(s1), b: seed(s2) };
  const sf1: PartidoLlave = { ...base, id: nuevoId(), ronda: 2, posicion: 0, a: seed(p1), b: gan(qf2.id) };
  const sf2: PartidoLlave = { ...base, id: nuevoId(), ronda: 2, posicion: 1, a: seed(p2), b: gan(qf1.id) };
  const fin: PartidoLlave = { ...base, id: nuevoId(), ronda: 3, posicion: 0, a: gan(sf1.id), b: gan(sf2.id) };
  return [qf2, qf1, sf1, sf2, fin];
}

/** Plata de 5 (7º..11º): semi 1 = 8º vs 9º; 4tos = 10º vs 11º; semi 2 = 7º vs ganador de 4tos. */
export function llavePlataCinco(ids: string[]): PartidoLlave[] {
  const [s7, s8, s9, s10, s11] = ids;
  const seed = (parejaId: string): SlotLlave => ({ tipo: 'seed', parejaId });
  const gan = (partidoId: string): SlotLlave => ({ tipo: 'ganadorDe', partidoId });
  const base = { puntosA: null, puntosB: null, esTercerPuesto: false };
  const qf: PartidoLlave = { ...base, id: nuevoId(), ronda: 1, posicion: 1, a: seed(s10), b: seed(s11) };
  const sf1: PartidoLlave = { ...base, id: nuevoId(), ronda: 2, posicion: 0, a: seed(s8), b: seed(s9) };
  const sf2: PartidoLlave = { ...base, id: nuevoId(), ronda: 2, posicion: 1, a: seed(s7), b: gan(qf.id) };
  const fin: PartidoLlave = { ...base, id: nuevoId(), ronda: 3, posicion: 0, a: gan(sf1.id), b: gan(sf2.id) };
  return [qf, sf1, sf2, fin];
}

