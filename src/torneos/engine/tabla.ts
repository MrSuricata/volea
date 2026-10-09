import type { Pareja, PartidoGrupo } from './tipos';
import { resultadoDe } from './tipos';

export type FilaTabla = {
  parejaId: string;
  pj: number;
  pg: number;
  pp: number;
  pf: number;
  pc: number;
  dif: number;
  posicion: number;
  desempatePorSorteo: boolean;
};

type Stats = Omit<FilaTabla, 'posicion' | 'desempatePorSorteo'>;

function statsBase(parejaIds: string[], partidos: PartidoGrupo[]): Map<string, Stats> {
  const map = new Map<string, Stats>();
  for (const id of parejaIds) {
    map.set(id, { parejaId: id, pj: 0, pg: 0, pp: 0, pf: 0, pc: 0, dif: 0 });
  }
  for (const p of partidos) {
    const r = resultadoDe(p); // empates, NaN o puntajes faltantes no cuentan
    if (!r) continue;
    const a = map.get(p.aId);
    const b = map.get(p.bId);
    if (!a || !b) continue;
    a.pj += 1; b.pj += 1;
    a.pf += r.a; a.pc += r.b;
    b.pf += r.b; b.pc += r.a;
    if (r.a > r.b) { a.pg += 1; b.pp += 1; } else { b.pg += 1; a.pp += 1; }
    a.dif = a.pf - a.pc;
    b.dif = b.pf - b.pc;
  }
  return map;
}

// Devuelve el ganador del duelo directo entre dos, o null si no jugaron / sin resultado
// Asume una sola confrontación por par (invariante del fixture); si hubiera más, usa la primera.
function ganadorH2h(x: string, y: string, partidos: PartidoGrupo[]): string | null {
  for (const p of partidos) {
    const r = resultadoDe(p);
    if (!r) continue;
    const esXY = (p.aId === x && p.bId === y) || (p.aId === y && p.bId === x);
    if (!esXY) continue;
    return r.a > r.b ? p.aId : p.bId;
  }
  return null;
}

function difEntre(subset: string[], partidos: PartidoGrupo[]): Map<string, number> {
  const set = new Set(subset);
  const dif = new Map<string, number>(subset.map((id) => [id, 0]));
  for (const p of partidos) {
    const r = resultadoDe(p);
    if (!r) continue;
    if (!set.has(p.aId) || !set.has(p.bId)) continue;
    dif.set(p.aId, dif.get(p.aId)! + r.a - r.b);
    dif.set(p.bId, dif.get(p.bId)! + r.b - r.a);
  }
  return dif;
}

// Separa un subset empatado aplicando criterios en orden. Devuelve grupos ordenados;
// cada grupo interno que siga empatado tras todos los criterios queda marcado como sorteo.
function resolverEmpate(
  subset: string[],
  stats: Map<string, Stats>,
  partidos: PartidoGrupo[],
): { orden: string[]; porSorteo: Set<string> } {
  const porSorteo = new Set<string>();

  // criterio: devuelve un valor numérico por id (mayor = mejor). null = no aplica.
  type Criterio = (ids: string[]) => Map<string, number> | null;
  const criterios: Criterio[] = [
    (ids) => {
      if (ids.length !== 2) return null; // h2h solo entre exactamente 2
      const g = ganadorH2h(ids[0], ids[1], partidos);
      if (g === null) return null;
      return new Map(ids.map((id) => [id, id === g ? 1 : 0]));
    },
    (ids) => new Map(ids.map((id) => [id, stats.get(id)!.dif])),
    (ids) => difEntre(ids, partidos),
    (ids) => new Map(ids.map((id) => [id, stats.get(id)!.pf])),
  ];

  function aplicar(ids: string[]): string[] {
    if (ids.length <= 1) return ids;
    for (const criterio of criterios) {
      const valores = criterio(ids);
      if (valores === null) continue;
      const distintos = new Set(valores.values());
      if (distintos.size === 1) continue; // no separa nada, siguiente criterio
      // ordenar por valor desc manteniendo orden de entrada entre iguales
      const ordenados = [...ids].sort((x, y) => valores.get(y)! - valores.get(x)!);
      // cada sub-empate se re-evalúa desde el principio de la cascada (estilo FIFA/ATP:
      // un sub-empate de 2 vuelve al h2h). Termina porque el subconjunto siempre se achica.
      const resultado: string[] = [];
      let i = 0;
      while (i < ordenados.length) {
        const v = valores.get(ordenados[i])!;
        const iguales = ordenados.filter((id) => valores.get(id) === v);
        resultado.push(...aplicar(iguales));
        i += iguales.length;
      }
      return resultado;
    }
    // ningún criterio separó: orden de entrada; el flag de sorteo solo tiene sentido si ya jugaron
    if (ids.some((id) => stats.get(id)!.pj > 0)) {
      for (const id of ids) porSorteo.add(id);
    }
    return ids;
  }

  return { orden: aplicar(subset), porSorteo };
}

export function calcularTabla(parejaIds: string[], partidos: PartidoGrupo[]): FilaTabla[] {
  const stats = statsBase(parejaIds, partidos);
  // franjas por victorias, desc; dentro de cada franja, cascada de desempates
  const porVictorias = new Map<number, string[]>();
  for (const id of parejaIds) {
    const pg = stats.get(id)!.pg;
    if (!porVictorias.has(pg)) porVictorias.set(pg, []);
    porVictorias.get(pg)!.push(id);
  }
  const franjas = [...porVictorias.keys()].sort((a, b) => b - a);
  const filas: FilaTabla[] = [];
  for (const pg of franjas) {
    const subset = porVictorias.get(pg)!;
    const { orden, porSorteo } = resolverEmpate(subset, stats, partidos);
    for (const id of orden) {
      filas.push({ ...stats.get(id)!, posicion: filas.length + 1, desempatePorSorteo: porSorteo.has(id) });
    }
  }
  return filas;
}

export type FilaIndividual = {
  jugadorId: string;
  nombre: string;
  pj: number;
  pg: number;
  pp: number;
  pf: number;
  pc: number;
  dif: number;
  posicion: number;
};

/** Nombre de cada integrante de una dupla "A y B" según el orden de jugadorIds. */
export function nombresDePareja(pareja: Pareja): Map<string, string> {
  const ids = pareja.jugadorIds ?? [];
  const partes = pareja.nombre.split(/\s+y\s+/i).map((s) => s.trim()).filter(Boolean);
  const m = new Map<string, string>();
  ids.forEach((id, i) => m.set(id, partes.length === ids.length ? partes[i] : pareja.nombre));
  return m;
}

/**
 * Tabla por jugador de un americano individual: cada partido suma a las dos personas de cada
 * dupla. Se posicionan por PUNTOS A FAVOR (regla del americano); desempate por diferencia,
 * partidos ganados y nombre.
 */
export function calcularTablaIndividual(parejas: Pareja[], partidos: PartidoGrupo[]): FilaIndividual[] {
  const porPareja = new Map(parejas.map((p) => [p.id, p]));
  const filas = new Map<string, FilaIndividual>();
  const fila = (id: string, nombre: string) => {
    let f = filas.get(id);
    if (!f) { f = { jugadorId: id, nombre, pj: 0, pg: 0, pp: 0, pf: 0, pc: 0, dif: 0, posicion: 0 }; filas.set(id, f); }
    return f;
  };
  for (const p of parejas) for (const [id, nombre] of nombresDePareja(p)) fila(id, nombre);
  for (const p of partidos) {
    const r = resultadoDe(p);
    const a = porPareja.get(p.aId);
    const b = porPareja.get(p.bId);
    if (!r || !a || !b) continue;
    for (const [lado, propios, rivales] of [[a, r.a, r.b], [b, r.b, r.a]] as const) {
      for (const [id, nombre] of nombresDePareja(lado)) {
        const f = fila(id, nombre);
        f.pj += 1; f.pf += propios; f.pc += rivales; f.dif = f.pf - f.pc;
        if (propios > rivales) f.pg += 1; else f.pp += 1;
      }
    }
  }
  const orden = [...filas.values()].sort((x, y) => y.pf - x.pf || y.dif - x.dif || y.pg - x.pg || x.nombre.localeCompare(y.nombre, 'es'));
  orden.forEach((f, i) => { f.posicion = i + 1; });
  return orden;
}

