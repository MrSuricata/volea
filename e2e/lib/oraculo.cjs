// Oráculo de la prueba: qué TIENE que mostrar la app según los resultados que cargó la prueba.
//
// Truco para que el oráculo sea simple y no dependa de la app: cada pareja tiene una "fuerza" fija
// (su lugar en la lista de inscriptos, 0 = la mejor) y en TODOS los partidos gana la más fuerte.
// Así, dentro de cada grupo la tabla queda ordenada por fuerza sin empates de PG, y en la llave
// avanza siempre la más fuerte. Los puntos del perdedor varían (fórmula fija) para que las
// comparaciones entre grupos (mejores terceros, tabla general de copas, llave de 6) se decidan
// por diferencia de puntos, que el oráculo calcula por su cuenta con las reglas documentadas.

const NOMBRES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eli', 'Facu', 'Gise', 'Hernán', 'Inés', 'Juan', 'Kari', 'Lucas', 'Majo', 'Nico', 'Olga', 'Pablo', 'Quimey', 'Rocío', 'Santi', 'Tati', 'Uri', 'Vale', 'Walter', 'Ximena', 'Yago', 'Zoe'];
const APELLIDOS = ['Acosta', 'Benítez', 'Cabrera', 'Duarte', 'Espinoza', 'Ferreira', 'Gómez', 'Herrera', 'Ibarra', 'Juárez', 'Lima', 'Méndez', 'Núñez', 'Olivera', 'Pereira', 'Quiroga', 'Rodríguez', 'Silva', 'Torres', 'Urrutia', 'Vázquez', 'Zabala'];

/** n parejas "Nombre Apellido y Nombre Apellido", la 0 es la más fuerte. */
function parejasDePrueba(n, semilla = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const j1 = `${NOMBRES[(2 * i + semilla) % NOMBRES.length]} ${APELLIDOS[(i * 3 + semilla) % APELLIDOS.length]}`;
    const j2 = `${NOMBRES[(2 * i + 1 + semilla) % NOMBRES.length]} ${APELLIDOS[(i * 5 + 7 + semilla) % APELLIDOS.length]}`;
    out.push(`${j1} y ${j2}`);
  }
  return out;
}

/** Resultado que carga la prueba: gana la más fuerte 11 a algo entre 0 y 9. */
function resultado(fuerzaA, fuerzaB, vuelta = 0) {
  const fuerte = Math.min(fuerzaA, fuerzaB);
  const debil = Math.max(fuerzaA, fuerzaB);
  const perdedor = (debil * 7 + fuerte * 3 + vuelta * 5) % 10;
  return fuerzaA < fuerzaB ? { a: 11, b: perdedor } : { a: perdedor, b: 11 };
}

function tablaGrupo(parejaIds, partidos) {
  const s = new Map(parejaIds.map((id) => [id, { parejaId: id, pj: 0, pg: 0, pp: 0, pf: 0, pc: 0 }]));
  for (const p of partidos) {
    if (p.puntosA === null || p.puntosB === null || p.puntosA === p.puntosB) continue;
    const a = s.get(p.aId); const b = s.get(p.bId);
    if (!a || !b) continue;
    a.pj++; b.pj++; a.pf += p.puntosA; a.pc += p.puntosB; b.pf += p.puntosB; b.pc += p.puntosA;
    if (p.puntosA > p.puntosB) { a.pg++; b.pp++; } else { b.pg++; a.pp++; }
  }
  const filas = [...s.values()].map((f) => ({ ...f, dif: f.pf - f.pc }));
  // Por construcción no hay empates de PG dentro de un grupo; si los hubiera, el oráculo lo dice.
  filas.sort((x, y) => y.pg - x.pg || y.dif - x.dif || y.pf - x.pf);
  for (let i = 1; i < filas.length; i++) if (filas[i].pg === filas[i - 1].pg) filas.empateEnPG = true;
  return filas.map((f, i) => ({ ...f, posicion: i + 1 }));
}

function metricas(f) {
  const tot = f.pf + f.pc;
  return { pj: f.pj, winPct: f.pj ? f.pg / f.pj : 0, difRatio: tot ? (f.pf - f.pc) / tot : 0, pfPct: tot ? f.pf / tot : 0 };
}
function compararMetricas(a, b) {
  return (b.pj > 0) - (a.pj > 0) || b.winPct - a.winPct || b.difRatio - a.difRatio || b.pfPct - a.pfPct;
}

function tablasDe(t) {
  return t.grupos.map((g) => ({ grupo: g, filas: tablaGrupo(g.parejaIds, t.partidosGrupo.filter((p) => p.grupoId === g.id)) }));
}

/** Clasificados en orden de seed (regla de clasificacion.ts, re-escrita acá). */
function clasificados(t, porGrupo, mejoresExtra) {
  const tablas = tablasDe(t);
  const res = [];
  for (let puesto = 1; puesto <= porGrupo; puesto++) {
    const lista = tablas.map((tg, i) => ({ f: tg.filas[puesto - 1], i, g: tg.grupo })).filter((x) => x.f);
    lista.sort((x, y) => compararMetricas(metricas(x.f), metricas(y.f)) || x.i - y.i);
    res.push(...lista.map((x) => ({ parejaId: x.f.parejaId, grupo: x.g.nombre, puesto })));
  }
  const cand = tablas.map((tg, i) => ({ f: tg.filas[porGrupo], i, g: tg.grupo })).filter((x) => x.f);
  cand.sort((x, y) => compararMetricas(metricas(x.f), metricas(y.f)) || x.i - y.i);
  const empateEnCorte = mejoresExtra > 0 && cand.length > mejoresExtra && compararMetricas(metricas(cand[mejoresExtra - 1].f), metricas(cand[mejoresExtra].f)) === 0;
  res.push(...cand.slice(0, mejoresExtra).map((x) => ({ parejaId: x.f.parejaId, grupo: x.g.nombre, puesto: porGrupo + 1 })));
  return { lista: res, empateEnCorte };
}

/** Tabla general (copas y llave de 6), según copas.ts: posición; 1º/2º por lo "ajustado"; 3º+ por promedio. */
function tablaGeneral(t) {
  const minimo = Math.min(...t.grupos.map((g) => g.parejaIds.length));
  const filas = [];
  for (const g of t.grupos) {
    const partidos = t.partidosGrupo.filter((p) => p.grupoId === g.id);
    const tabla = tablaGrupo(g.parejaIds, partidos);
    const sobran = new Set(tabla.filter((f) => f.posicion > minimo).map((f) => f.parejaId));
    for (const f of tabla) {
      const excluir = sobran.has(f.parejaId) ? new Set() : sobran;
      const aj = { pj: 0, pg: 0, dif: 0, pf: 0 };
      for (const p of partidos) {
        if (p.aId !== f.parejaId && p.bId !== f.parejaId) continue;
        const rival = p.aId === f.parejaId ? p.bId : p.aId;
        if (excluir.has(rival)) continue;
        const pr = p.aId === f.parejaId ? p.puntosA : p.puntosB;
        const aj2 = p.aId === f.parejaId ? p.puntosB : p.puntosA;
        aj.pj++; aj.pf += pr; aj.dif += pr - aj2; if (pr > aj2) aj.pg++;
      }
      filas.push({ ...f, grupo: g.nombre, grupoId: g.id, ajustado: aj });
    }
  }
  const prom = (x, n) => (n > 0 ? x / n : 0);
  return filas.sort((x, y) => {
    if (x.posicion !== y.posicion) return x.posicion - y.posicion;
    if (x.posicion <= 2) return y.ajustado.pg - x.ajustado.pg || y.ajustado.dif - x.ajustado.dif || y.ajustado.pf - x.ajustado.pf || x.grupo.localeCompare(y.grupo);
    return prom(y.pg, y.pj) - prom(x.pg, x.pj) || prom(y.dif, y.pj) - prom(x.dif, x.pj) || prom(y.pf, y.pj) - prom(x.pf, x.pj) || x.grupo.localeCompare(y.grupo);
  });
}

/** Cruces esperados de los formatos con reglas fijas, como pares de parejaId [a, b] de la 1ª ronda. */
function crucesFijos(t, formato) {
  const pos = tablasDe(t).map((tg) => tg.filas.map((f) => f.parejaId));
  const g = t.grupos.length;
  if (formato === 'final') return [[pos[0][0], pos[0][1]]];
  if (formato === 'semis') return [[pos[0][0], pos[0][3]], [pos[0][1], pos[0][2]]];
  if (formato === 'cruces' && g === 2) return [[pos[0][0], pos[1][1]], [pos[1][0], pos[0][1]]];
  if (formato === 'cruces' && g === 4) return [[pos[0][0], pos[1][1]], [pos[2][0], pos[3][1]], [pos[1][0], pos[0][1]], [pos[3][0], pos[2][1]]];
  if (formato === 'seis') {
    const gen = tablaGeneral(t);
    const [p1, p2, p3] = gen.filter((f) => f.posicion === 1).map((f) => f.parejaId);
    const [s1, s2, s3] = gen.filter((f) => f.posicion === 2).map((f) => f.parejaId);
    return { cuartos: [[s1, s2], [p3, s3]], esperanEnSemis: [p1, p2] };
  }
  throw new Error(`formato ${formato} sin cruces fijos`);
}

/** Simula una llave (la estructura de la app) con "gana la más fuerte". */
function simularLlave(partidos, fuerza) {
  const ganador = new Map();
  const perdedor = new Map();
  const resolver = (slot) => {
    if (slot === null) return null;
    if (slot.tipo === 'seed') return slot.parejaId;
    const p = partidos.find((x) => x.id === slot.partidoId);
    if (!p) return null;
    jugar(p);
    return slot.tipo === 'ganadorDe' ? ganador.get(p.id) ?? null : perdedor.get(p.id) ?? null;
  };
  const jugar = (p) => {
    if (ganador.has(p.id)) return;
    const a = resolver(p.a); const b = resolver(p.b);
    if (p.a === null) { ganador.set(p.id, b); perdedor.set(p.id, null); return; }
    if (p.b === null) { ganador.set(p.id, a); perdedor.set(p.id, null); return; }
    if (a === null || b === null) { ganador.set(p.id, null); return; }
    const ga = fuerza(a) < fuerza(b);
    ganador.set(p.id, ga ? a : b); perdedor.set(p.id, ga ? b : a);
  };
  for (const p of partidos) jugar(p);
  const maxRonda = Math.max(...partidos.filter((p) => !p.esTercerPuesto).map((p) => p.ronda));
  const final = partidos.find((p) => !p.esTercerPuesto && p.ronda === maxRonda);
  const tercero = partidos.find((p) => p.esTercerPuesto);
  return { campeon: ganador.get(final.id), subcampeon: perdedor.get(final.id), tercero: tercero ? ganador.get(tercero.id) : null };
}

module.exports = { parejasDePrueba, resultado, tablaGrupo, tablasDe, clasificados, tablaGeneral, crucesFijos, simularLlave, metricas, compararMetricas };
