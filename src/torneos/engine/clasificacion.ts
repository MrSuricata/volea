import type { ConfigLlave, Grupo, PartidoGrupo } from './tipos';
import { resultadoDe } from './tipos';
import { calcularTabla } from './tabla';

export type OpcionClasificacion = {
  porGrupo: 1 | 2 | 3;
  mejoresExtra: number;
  total: number;
  tamanoLlave: number;
  byes: number;
  descripcion: string;
};

export function siguientePotenciaDe2(n: number): number {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

const NOMBRE_PUESTO: Record<2 | 3 | 4, { singular: string; plural: string }> = {
  2: { singular: 'mejor segundo', plural: 'mejores segundos' },
  3: { singular: 'mejor tercero', plural: 'mejores terceros' },
  4: { singular: 'mejor cuarto', plural: 'mejores cuartos' },
};

function describir(cantGrupos: number, porGrupo: 1 | 2 | 3, mejoresExtra: number, total: number, tamanoLlave: number, byes: number): string {
  const sufijo = cantGrupos === 1 ? 'del grupo' : 'de cada grupo';
  const base = porGrupo === 1 ? 'Pasa el 1º ' + sufijo : `Pasan los ${porGrupo} primeros ${sufijo}`;
  const nombre = NOMBRE_PUESTO[(porGrupo + 1) as 2 | 3 | 4];
  const extra =
    mejoresExtra === 0 ? '' :
    mejoresExtra === 1 ? ` + el ${nombre.singular}` :
    ` + los ${mejoresExtra} ${nombre.plural}`;
  const cola = byes === 0
    ? tamanoLlave === 2 ? 'final directa' : `llave de ${tamanoLlave} justa`
    : `llave de ${tamanoLlave} con ${byes} ${byes === 1 ? 'bye' : 'byes'}`;
  return `${base}${extra} (${total} clasifican) → ${cola}`;
}

export function opcionesClasificacion(grupos: Grupo[]): OpcionClasificacion[] {
  const cantGrupos = grupos.length;
  const minTam = Math.min(...grupos.map((g) => g.parejaIds.length));
  const opciones: OpcionClasificacion[] = [];
  for (const porGrupo of [1, 2, 3] as const) {
    if (porGrupo > minTam) continue;
    // grupos que tienen a alguien en el puesto siguiente (candidatos a "mejores extra")
    const candidatos = grupos.filter((g) => g.parejaIds.length >= porGrupo + 1).length;
    const maxExtra = Math.min(cantGrupos - 1, candidatos);
    for (let mejoresExtra = 0; mejoresExtra <= maxExtra; mejoresExtra++) {
      const total = cantGrupos * porGrupo + mejoresExtra;
      if (total < 2) continue;
      const tamanoLlave = siguientePotenciaDe2(total);
      const byes = tamanoLlave - total;
      opciones.push({
        porGrupo, mejoresExtra, total, tamanoLlave, byes,
        descripcion: describir(cantGrupos, porGrupo, mejoresExtra, total, tamanoLlave, byes),
      });
    }
  }
  // recomendación: menos byes → total más cercano al ~60% del torneo → menos exigente → menos extras
  const totalParejas = grupos.reduce((suma, g) => suma + g.parejaIds.length, 0);
  const objetivo = 0.6 * totalParejas;
  opciones.sort(
    (x, y) =>
      x.byes - y.byes ||
      Math.abs(x.total - objetivo) - Math.abs(y.total - objetivo) ||
      x.porGrupo - y.porGrupo ||
      x.mejoresExtra - y.mejoresExtra,
  );
  return opciones;
}

export type Metricas = { pj: number; winPct: number; difRatio: number; pfPct: number };

// partidos: los del grupo de la pareja (calcularClasificados ya filtra por grupoId).
export function metricasPareja(parejaId: string, partidos: PartidoGrupo[]): Metricas {
  let pj = 0, pg = 0, pf = 0, pc = 0;
  for (const p of partidos) {
    const r = resultadoDe(p);
    if (!r) continue;
    if (p.aId !== parejaId && p.bId !== parejaId) continue;
    pj += 1;
    const [propios, rival] = p.aId === parejaId ? [r.a, r.b] : [r.b, r.a];
    pf += propios; pc += rival;
    if (propios > rival) pg += 1;
  }
  const totalPuntos = pf + pc;
  return {
    pj,
    winPct: pj > 0 ? pg / pj : 0,
    difRatio: totalPuntos > 0 ? (pf - pc) / totalPuntos : 0,
    pfPct: totalPuntos > 0 ? pf / totalPuntos : 0,
  };
}

// negativo si a es mejor que b → usado en sort, el de mejores métricas queda primero.
// Sin partidos jugados no se gana un cupo por métricas: los pj=0 van últimos de su franja.
// Devuelve 0 solo en empate TOTAL: en ese caso el orden lo decide el grupo (A antes que B) —
// exportada para que la UI pueda detectarlo y avisarlo.
export function compararMetricas(a: Metricas, b: Metricas): number {
  return (b.pj > 0 ? 1 : 0) - (a.pj > 0 ? 1 : 0) || b.winPct - a.winPct || b.difRatio - a.difRatio || b.pfPct - a.pfPct;
}

export type Clasificado = { parejaId: string; grupoId: string; grupoNombre: string; puesto: number };

export type CandidatoExtra = Clasificado & {
  pj: number; pg: number; pp: number; pf: number; pc: number; dif: number;
  metricas: Metricas;
  entra: boolean;
};

// Todos los candidatos al cupo de "mejores del puesto siguiente" (puesto porGrupo+1), ordenados
// por la regla de comparación entre grupos. Entran los primeros `mejoresExtra` — salvo que
// `extrasManuales` traiga una selección hecha a mano (para resolver empates en la cancha), en
// cuyo caso entran esos. Siempre en orden de métricas para el seeding.
export function candidatosMejoresExtra(
  grupos: Grupo[],
  partidosGrupo: PartidoGrupo[],
  config: Pick<ConfigLlave, 'porGrupo' | 'mejoresExtra' | 'extrasManuales'>,
): CandidatoExtra[] {
  const candidatos: (Omit<CandidatoExtra, 'entra'> & { indiceGrupo: number })[] = [];
  grupos.forEach((g, indiceGrupo) => {
    const partidos = partidosGrupo.filter((p) => p.grupoId === g.id);
    const fila = calcularTabla(g.parejaIds, partidos).find((f) => f.posicion === config.porGrupo + 1);
    if (!fila) return;
    candidatos.push({
      parejaId: fila.parejaId, grupoId: g.id, grupoNombre: g.nombre, puesto: fila.posicion,
      pj: fila.pj, pg: fila.pg, pp: fila.pp, pf: fila.pf, pc: fila.pc, dif: fila.dif,
      metricas: metricasPareja(fila.parejaId, partidos), indiceGrupo,
    });
  });
  candidatos.sort((x, y) => compararMetricas(x.metricas, y.metricas) || x.indiceGrupo - y.indiceGrupo);
  const cupos = Math.max(0, config.mejoresExtra);
  const manual = config.extrasManuales && config.extrasManuales.length > 0 ? new Set(config.extrasManuales) : null;
  return candidatos.map((c, i) => ({
    parejaId: c.parejaId, grupoId: c.grupoId, grupoNombre: c.grupoNombre, puesto: c.puesto,
    pj: c.pj, pg: c.pg, pp: c.pp, pf: c.pf, pc: c.pc, dif: c.dif,
    metricas: c.metricas, entra: manual ? manual.has(c.parejaId) : i < cupos,
  }));
}

// Devuelve los clasificados EN ORDEN DE SEED GLOBAL (spec §4.4 punto 1)
// Puede devolver menos que porGrupo*grupos+mejoresExtra si la config es infactible: dimensionar la llave por length.
export function calcularClasificados(
  grupos: Grupo[],
  partidosGrupo: PartidoGrupo[],
  config: Pick<ConfigLlave, 'porGrupo' | 'mejoresExtra' | 'extrasManuales'>,
): Clasificado[] {
  type Entrada = Clasificado & { metricas: Metricas; indiceGrupo: number };
  const porPuesto = new Map<number, Entrada[]>();

  grupos.forEach((g, indiceGrupo) => {
    const partidos = partidosGrupo.filter((p) => p.grupoId === g.id);
    const tabla = calcularTabla(g.parejaIds, partidos);
    tabla.forEach((fila) => {
      if (fila.posicion > config.porGrupo) return;
      const entrada: Entrada = {
        parejaId: fila.parejaId, grupoId: g.id, grupoNombre: g.nombre,
        puesto: fila.posicion, metricas: metricasPareja(fila.parejaId, partidos), indiceGrupo,
      };
      if (!porPuesto.has(fila.posicion)) porPuesto.set(fila.posicion, []);
      porPuesto.get(fila.posicion)!.push(entrada);
    });
  });

  const ordenar = (arr: Entrada[]) =>
    arr.sort((x, y) => compararMetricas(x.metricas, y.metricas) || x.indiceGrupo - y.indiceGrupo);

  const resultado: Clasificado[] = [];
  for (let puesto = 1; puesto <= config.porGrupo; puesto++) {
    resultado.push(...ordenar(porPuesto.get(puesto) ?? []).map(({ parejaId, grupoId, grupoNombre, puesto: p }) => ({ parejaId, grupoId, grupoNombre, puesto: p })));
  }
  // los "mejores extra" salen de la misma fuente que usa la UI para la comparación (una sola verdad)
  for (const c of candidatosMejoresExtra(grupos, partidosGrupo, config)) {
    if (c.entra) resultado.push({ parejaId: c.parejaId, grupoId: c.grupoId, grupoNombre: c.grupoNombre, puesto: c.puesto });
  }
  return resultado;
}
