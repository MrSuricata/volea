// Bugs de la auditoría previa al Sudamericano: cada describe fija uno (B1..B6 y la alerta de
// llave desactualizada). La simulación completa de torneos está en simulacion.test.ts.
import { describe, expect, it } from 'vitest';
import type { Grupo, PartidoGrupo, PartidoLlave, Torneo } from './tipos';
import { CONFIG_PUNTOS_DEFAULT, puntosDePartido } from './tipos';
import { armarLlave, cargarResultadoLlave, resolverSlot } from './llave';
import type { SeedInfo } from './llave';
import { armarCopas, armarLlaveSeis, tablaGeneral } from './copas';
import { calcularClasificados, metricasPareja, opcionesClasificacion } from './clasificacion';
import { calcularTabla, calcularTablaIndividual } from './tabla';
import { armarLlaveFormato, conFormato, formatoDe, formatoEfectivo, formatosPosibles, llaveDesactualizada, modoArmado } from './formatoLlave';
import { calcularRanking } from './ranking';
import { generarPartidosGrupos } from './grupos';
import { crearRng } from './rng';

const pg = (id: string, g: string, aId: string, bId: string, pa: number, pb: number, extra: Partial<PartidoGrupo> = {}): PartidoGrupo =>
  ({ id, grupoId: g, ronda: 1, aId, bId, puntosA: pa, puntosB: pb, ...extra });

const base = (grupos: Grupo[], partidosGrupo: PartidoGrupo[]): Torneo => ({
  id: 't', nombre: 'T', creadoEl: '2026-11-01T00:00:00.000Z', fase: 'faseGrupos',
  parejas: grupos.flatMap((g) => g.parejaIds).map((id) => ({ id, nombre: id.toUpperCase() })),
  grupos, partidosGrupo, configLlave: null, partidosLlave: null,
});

const ronda1 = (l: PartidoLlave[]) =>
  l.filter((p) => p.ronda === 1).sort((x, y) => x.posicion - y.posicion).map((p) => `${resolverSlot(p.a, l)} vs ${resolverSlot(p.b, l)}`);

// 3 grupos de 3 (caso de la auditoría): en C, c1 11-0 c2, c1 11-9 c3, c2 11-10 c3.
function tresDeTres(): Torneo {
  const grupos = ['a', 'b', 'c'].map((g) => ({ id: g.toUpperCase(), nombre: g.toUpperCase(), parejaIds: [`${g}1`, `${g}2`, `${g}3`] }));
  return base(grupos, [
    pg('a1', 'A', 'a1', 'a2', 11, 0), pg('a2', 'A', 'a1', 'a3', 11, 0), pg('a3', 'A', 'a2', 'a3', 11, 5),
    pg('b1', 'B', 'b1', 'b2', 11, 0), pg('b2', 'B', 'b1', 'b3', 11, 0), pg('b3', 'B', 'b2', 'b3', 11, 6),
    pg('c1', 'C', 'c1', 'c2', 11, 0), pg('c2', 'C', 'c1', 'c3', 11, 9), pg('c3', 'C', 'c2', 'c3', 11, 10),
  ]);
}

const grupoDe = (t: Torneo) => new Map(t.grupos.flatMap((g) => g.parejaIds.map((id) => [id, g.id] as const)));

function cruceMismoGrupo(l: PartidoLlave[], grupo: Map<string, string>): string[] {
  return l.filter((p) => p.ronda === 1 && p.a?.tipo === 'seed' && p.b?.tipo === 'seed')
    .map((p) => [resolverSlot(p.a, l)!, resolverSlot(p.b, l)!])
    .filter(([a, b]) => grupo.get(a) === grupo.get(b))
    .map(([a, b]) => `${a} vs ${b}`);
}

describe('B1: primera ronda sin cruces del mismo grupo cuando se puede', () => {
  it('llave de 6: el 3er primero no repite el partido de grupo con el peor segundo', () => {
    const t = tresDeTres();
    const l = armarLlaveSeis(t);
    expect(cruceMismoGrupo(l, grupoDe(t))).toEqual([]);
    // los dos mejores primeros siguen esperando en semis
    const semis = l.filter((p) => p.ronda === 2).map((p) => resolverSlot(p.a, l));
    expect(semis.sort()).toEqual(['a1', 'b1']);
  });

  it('llave genérica, 3 grupos 2+0: el caso de la auditoría', () => {
    const t = tresDeTres();
    const seeds = calcularClasificados(t.grupos, t.partidosGrupo, { porGrupo: 2, mejoresExtra: 0 });
    const l = armarLlave(seeds, false);
    expect(cruceMismoGrupo(l, grupoDe(t))).toEqual([]);
    // los byes siguen siendo de los dos mejores seeds, en su lugar
    expect(ronda1(l)[0]).toBe(`${seeds[0].parejaId} vs null`);
    expect(ronda1(l)[2]).toBe(`${seeds[1].parejaId} vs null`);
  });

  it('el intercambio mira toda la llave, no solo el partido de al lado', () => {
    // 8 seeds: 1A 2B 3C 4D | 5D 6C 7B 8A ⇒ apareo directo 1-8 (A-A), 4-5 (D-D), 2-7 (B-B), 3-6 (C-C)
    const s: SeedInfo[] = [['1', 'A'], ['2', 'B'], ['3', 'C'], ['4', 'D'], ['5', 'D'], ['6', 'C'], ['7', 'B'], ['8', 'A']]
      .map(([parejaId, grupoId]) => ({ parejaId, grupoId }));
    const l = armarLlave(s, false);
    const g = new Map(s.map((x) => [x.parejaId, x.grupoId]));
    expect(cruceMismoGrupo(l, g)).toEqual([]);
    // los mejores sembrados quedan arriba de cada cruce, en el mismo lugar del dibujo
    expect(l.filter((p) => p.ronda === 1).sort((x, y) => x.posicion - y.posicion).map((p) => resolverSlot(p.a, l))).toEqual(['1', '4', '2', '3']);
  });

  it('si no hace falta, no toca nada (orden por siembra intacto)', () => {
    const s: SeedInfo[] = ['A', 'B', 'C', 'D', 'B', 'A', 'D', 'C'].map((grupoId, i) => ({ parejaId: String(i + 1), grupoId }));
    expect(ronda1(armarLlave(s, false))).toEqual(['1 vs 8', '4 vs 5', '2 vs 7', '3 vs 6']);
  });

  it('propiedad: con 2 a 8 grupos y todas las opciones de clasificación, si es evitable no ocurre', () => {
    let casos = 0;
    for (let cantGrupos = 2; cantGrupos <= 8; cantGrupos++) {
      for (const tam of [3, 4, 5]) {
        for (let semilla = 1; semilla <= 6; semilla++) {
          const rng = crearRng(semilla * 100 + cantGrupos * 10 + tam);
          const grupos: Grupo[] = Array.from({ length: cantGrupos }, (_, i) => ({
            id: `G${i}`, nombre: String.fromCharCode(65 + i),
            parejaIds: Array.from({ length: tam + (i === 0 && semilla % 2 ? 1 : 0) }, (_, k) => `g${i}p${k}`),
          }));
          const partidos = generarPartidosGrupos(grupos).map((p) => {
            const gana = rng() < 0.5;
            const perdedor = Math.floor(rng() * 11);
            return { ...p, puntosA: gana ? 11 : perdedor, puntosB: gana ? perdedor : 11 };
          });
          for (const o of opcionesClasificacion(grupos)) {
            const seeds = calcularClasificados(grupos, partidos, o);
            const l = armarLlave(seeds, false);
            const grupo = new Map(seeds.map((x) => [x.parejaId, x.grupoId]));
            const jugando = l.filter((p) => p.ronda === 1 && p.a && p.b).flatMap((p) => [resolverSlot(p.a, l)!, resolverSlot(p.b, l)!]);
            const porGrupo = new Map<string, number>();
            for (const id of jugando) porGrupo.set(grupo.get(id)!, (porGrupo.get(grupo.get(id)!) ?? 0) + 1);
            const evitable = Math.max(0, ...porGrupo.values()) <= jugando.length / 2;
            if (evitable) expect(cruceMismoGrupo(l, grupo), `${cantGrupos}x${tam} ${o.descripcion}`).toEqual([]);
            // los byes siguen siendo de los mejores seeds
            const conBye = l.filter((p) => p.ronda === 1 && (!p.a || !p.b)).map((p) => resolverSlot(p.a ?? p.b, l));
            expect(new Set(conBye)).toEqual(new Set(seeds.slice(0, o.byes).map((x) => x.parejaId)));
            casos += 1;
          }
        }
      }
    }
    expect(casos).toBeGreaterThan(500);
  });
});

describe('B2: un formato guardado que ya no es posible se trata como "auto"', () => {
  const cuatro = (): Torneo => {
    const grupos = ['A', 'B', 'C', 'D'].map((g) => ({ id: g, nombre: g, parejaIds: [`${g}1`, `${g}2`, `${g}3`] }));
    return conFormato(base(grupos, generarPartidosGrupos(grupos).map((p) => ({ ...p, puntosA: 11, puntosB: 5 }))), 'cruces');
  };
  it('cruces elegido con 4 grupos y después rearmado en 3', () => {
    const t = cuatro();
    expect(formatoDe(t)).toBe('cruces');
    const grupos = ['A', 'B', 'C'].map((g, i) => ({ id: g, nombre: g, parejaIds: t.parejas.slice(i * 4, i * 4 + 4).map((p) => p.id) }));
    const rearmado: Torneo = { ...t, grupos, partidosGrupo: generarPartidosGrupos(grupos).map((p) => ({ ...p, puntosA: 11, puntosB: 5 })) };
    expect(rearmado.formatoLlave).toBe('cruces'); // lo guardado no se toca
    expect(formatoDe(rearmado)).toBe('auto');
    expect(formatoEfectivo(rearmado)).toBe('auto');
    expect(formatosPosibles(rearmado).some((o) => o.valor === formatoDe(rearmado))).toBe(true);
    // el gestor va a la llave genérica (elegir cuántos clasifican), no a un botón muerto
    expect(modoArmado(rearmado)).toBe('libre');
  });
  it('copas o llave de 6 que ya no corresponden también caen en auto', () => {
    const uno = base([{ id: 'A', nombre: 'A', parejaIds: ['a', 'b', 'c', 'd'] }], []);
    expect(formatoDe({ ...uno, copas: { oro: 2 } })).toBe('auto');
    expect(formatoDe({ ...uno, llave6: true })).toBe('auto');
    expect(formatoDe({ ...uno, sinLlave: true })).toBe('tabla');
  });
  it('modo fijo siempre arma una llave (nunca un botón deshabilitado sin motivo)', () => {
    for (const nGrupos of [1, 2, 3, 4, 5]) {
      const grupos = Array.from({ length: nGrupos }, (_, i) => ({ id: `G${i}`, nombre: String.fromCharCode(65 + i), parejaIds: [`${i}a`, `${i}b`, `${i}c`, `${i}d`] }));
      const t0 = base(grupos, generarPartidosGrupos(grupos).map((p) => ({ ...p, puntosA: 11, puntosB: 3 })));
      for (const o of formatosPosibles(t0)) {
        const t = conFormato(t0, o.valor);
        if (modoArmado(t) === 'fijo') expect(armarLlaveFormato(t), `${nGrupos} grupos ${o.valor}`).not.toBeNull();
        else expect(armarLlaveFormato(t)).toBeNull();
      }
    }
  });
});

describe('B3: gestor y En vivo arman la misma llave', () => {
  it('auto con 4 grupos: el gestor usa los cruces fijos, igual que En vivo', () => {
    const grupos = ['A', 'B', 'C', 'D'].map((g) => ({ id: g, nombre: g, parejaIds: [`${g}1`, `${g}2`, `${g}3`] }));
    // gana siempre la de número menor; los 1º de C y D con más diferencia que los de A y B
    const partidos = generarPartidosGrupos(grupos).map((p) => {
      const [x, y] = p.aId < p.bId ? [p.aId, p.bId] : [p.bId, p.aId];
      const margen = x.startsWith('C') || x.startsWith('D') ? 11 : 1;
      return { ...p, aId: x, bId: y, puntosA: 11, puntosB: 11 - margen };
    });
    const t = base(grupos, partidos);
    expect(formatoDe(t)).toBe('auto');
    expect(formatoEfectivo(t)).toBe('cruces');
    expect(modoArmado(t)).toBe('fijo');
    expect(ronda1(armarLlaveFormato(t)!)).toEqual(['A1 vs B2', 'C1 vs D2', 'B1 vs A2', 'D1 vs C2']);
  });
  it('en todo formato posible, modoArmado sigue al formato efectivo que usa En vivo', () => {
    for (const nGrupos of [1, 2, 3, 4, 5, 6]) {
      const grupos = Array.from({ length: nGrupos }, (_, i) => ({ id: `G${i}`, nombre: String.fromCharCode(65 + i), parejaIds: [`${i}a`, `${i}b`, `${i}c`] }));
      const t0 = base(grupos, []);
      for (const o of formatosPosibles(t0)) {
        const t = conFormato(t0, o.valor);
        const f = formatoEfectivo(t);
        const esperado = f === 'copas' ? 'copas' : f === 'tabla' ? 'tabla' : f === 'auto' || f === 'libre' ? 'libre' : 'fijo';
        expect(modoArmado(t), `${nGrupos} ${o.valor}`).toBe(esperado);
      }
    }
  });
});

describe('B4: mejor de 3 suma puntos reales, no games', () => {
  // A 2-0 B (15-0, 15-0) · B 15-5 C · C 15-13 A
  const grupos = [{ id: 'G', nombre: 'G', parejaIds: ['A', 'B', 'C'] }];
  const partidos = [
    pg('1', 'G', 'A', 'B', 2, 0, { games: [{ a: 15, b: 0 }, { a: 15, b: 0 }] }),
    pg('2', 'G', 'B', 'C', 15, 5),
    pg('3', 'G', 'C', 'A', 15, 13),
  ];
  it('puntosDePartido: ganador por puntosA/B, puntos por la suma de games', () => {
    expect(puntosDePartido(partidos[0])).toEqual({ a: 30, b: 0 });
    expect(puntosDePartido(partidos[1])).toEqual({ a: 15, b: 5 });
    // games 1-1 pero puntos 2-1: gana A aunque haya sumado menos puntos
    expect(puntosDePartido(pg('x', 'G', 'A', 'B', 2, 1, { games: [{ a: 11, b: 0 }, { a: 5, b: 11 }, { a: 11, b: 9 }] }))).toEqual({ a: 27, b: 20 });
    expect(puntosDePartido(pg('x', 'G', 'A', 'B', 0, 0))).toBeNull();
    // games rotos (no enteros): se usan puntosA/B
    expect(puntosDePartido(pg('x', 'G', 'A', 'B', 2, 0, { games: [{ a: Number.NaN, b: 0 }] }))).toEqual({ a: 2, b: 0 });
  });
  it('tabla del grupo', () => {
    const tabla = calcularTabla(['A', 'B', 'C'], partidos);
    expect(tabla.map((f) => [f.parejaId, f.pg, f.pf, f.pc, f.dif])).toEqual([
      ['A', 1, 43, 15, 28], ['C', 1, 20, 28, -8], ['B', 1, 15, 35, -20],
    ]);
  });
  it('métricas entre grupos y tabla general', () => {
    expect(metricasPareja('A', partidos).difRatio).toBeCloseTo(28 / 58);
    const t = base(grupos, partidos);
    const general = tablaGeneral(t);
    expect(general[0]).toMatchObject({ parejaId: 'A', dif: 28, pf: 43 });
    expect(general[0].ajustado).toEqual({ pj: 2, pg: 1, dif: 28, pf: 43 });
  });
  it('tabla individual', () => {
    const parejas = [
      { id: 'A', nombre: 'ANA y BEA', jugadorIds: ['j1', 'j2'] },
      { id: 'B', nombre: 'CARO y DANI', jugadorIds: ['j3', 'j4'] },
    ];
    const t = calcularTablaIndividual(parejas, [partidos[0]]);
    expect(t.find((f) => f.nombre === 'ANA')).toMatchObject({ pf: 30, pc: 0, pg: 1 });
  });
});

describe('B6 y B5: ranking', () => {
  const cfg = CONFIG_PUNTOS_DEFAULT;
  // Cuadro de 2 grupos con copas: oro de 4 y plata de 3 (sin evento).
  function cuadroConCopas() {
    const grupos = [{ id: 'A', nombre: 'A', parejaIds: ['a1', 'a2', 'a3', 'a4'] }, { id: 'B', nombre: 'B', parejaIds: ['b1', 'b2', 'b3'] }];
    const partidos = generarPartidosGrupos(grupos).map((p) => {
      const [x, y] = p.aId < p.bId ? [p.aId, p.bId] : [p.bId, p.aId];
      return { ...p, aId: x, bId: y, puntosA: 11, puntosB: 6 };
    });
    const t: Torneo = {
      ...base(grupos, partidos), id: 'cua', categoria: 'A', copas: { oro: 4 },
      parejas: grupos.flatMap((g) => g.parejaIds).map((id) => ({ id, nombre: id, jugadorIds: [`${id}x`, `${id}y`] })),
    };
    const { oro, plata } = armarCopas(t, { ids: { oro: 'oro', plata: 'pla' }, ahora: '2026-11-02T00:00:00.000Z' });
    const jugar = (c: Torneo): Torneo => {
      let l = c.partidosLlave!;
      for (let i = 0; i < 10; i++) {
        for (const p of l) {
          if (p.puntosA !== null || !p.a || !p.b) continue;
          if (resolverSlot(p.a, l) && resolverSlot(p.b, l)) l = cargarResultadoLlave(l, p.id, 11, 4).partidos;
        }
      }
      return { ...c, partidosLlave: l, fase: 'terminado' };
    };
    return { cuadro: { ...t, fase: 'terminado' as const }, oro: jugar(oro), plata: jugar(plata) };
  }

  it('B6: cuadro + copas pagan una sola vez por jugador (su mejor escalón), sin dejar a nadie en cero', () => {
    const { cuadro, oro, plata } = cuadroConCopas();
    const filas = calcularRanking([cuadro, oro, plata], [], cfg);
    expect(filas).toHaveLength(14);
    for (const f of filas) {
      const cuentan = f.aportes.filter((a) => !a.descartadoPorEvento);
      expect(cuentan, f.jugadorId).toHaveLength(1);
      expect(f.puntos).toBeGreaterThan(0);
    }
    const enOro = new Set(oro.parejas.flatMap((p) => p.jugadorIds!));
    for (const f of filas) {
      if (enOro.has(f.jugadorId)) expect(f.aportes.find((a) => !a.descartadoPorEvento)!.torneoId).toBe('oro');
      else expect(f.puntos).toBe(40); // plata: la copa no paga, queda el cuadro (participó)
    }
    expect(filas[0].puntos).toBe(100); // campeón de oro: 100, no 100 + 40
  });

  it('B6: con evento sigue valiendo el máximo por evento (sin cambios)', () => {
    const { cuadro, oro, plata } = cuadroConCopas();
    const conEv = [cuadro, oro, plata].map((t) => ({ ...t, evento: 'Sud' }));
    const filas = calcularRanking(conEv, [], cfg);
    expect(filas[0].puntos).toBe(100);
    for (const f of filas) expect(f.aportes.filter((a) => !a.descartadoPorEvento)).toHaveLength(1);
  });

  it('B5: americano individual paga una vez por jugador según la tabla individual', () => {
    const parejas = [
      { id: 'p12', nombre: 'ANA y BEA', jugadorIds: ['j1', 'j2'] },
      { id: 'p34', nombre: 'CARO y DANI', jugadorIds: ['j3', 'j4'] },
      { id: 'p13', nombre: 'ANA y CARO', jugadorIds: ['j1', 'j3'] },
      { id: 'p24', nombre: 'BEA y DANI', jugadorIds: ['j2', 'j4'] },
    ];
    const t: Torneo = {
      id: 'am', nombre: 'AM', creadoEl: '2026-11-01', fase: 'terminado', categoria: 'A', americanoIndividual: true, sinLlave: true,
      parejas, grupos: [{ id: 'G', nombre: 'G', parejaIds: parejas.map((p) => p.id) }],
      partidosGrupo: [pg('1', 'G', 'p12', 'p34', 11, 5), pg('2', 'G', 'p13', 'p24', 9, 11)],
      configLlave: null, partidosLlave: null,
    };
    const filas = calcularRanking([t], [], cfg);
    // BEA 22 a favor (1ª), ANA 20 (2ª), DANI y CARO participan
    const de = (id: string) => filas.find((f) => f.jugadorId === id)!;
    expect(de('j2').aportes).toHaveLength(1);
    expect(de('j2').aportes[0].escalon).toBe('CAMPEON');
    expect(de('j1').aportes[0].escalon).toBe('FINALISTA');
    expect(de('j3').aportes[0].escalon).toBe('PARTICIPO');
    expect(de('j2').puntos).toBe(100);
    expect(de('j1').puntos).toBe(86);
  });
});

describe('alerta de llave desactualizada', () => {
  function dosGrupos(): Torneo {
    const grupos = [{ id: 'A', nombre: 'A', parejaIds: ['a1', 'a2', 'a3'] }, { id: 'B', nombre: 'B', parejaIds: ['b1', 'b2', 'b3'] }];
    return base(grupos, [
      pg('1', 'A', 'a1', 'a2', 11, 5), pg('2', 'A', 'a1', 'a3', 11, 5), pg('3', 'A', 'a2', 'a3', 11, 5),
      pg('4', 'B', 'b1', 'b2', 11, 5), pg('5', 'B', 'b1', 'b3', 11, 5), pg('6', 'B', 'b2', 'b3', 11, 5),
    ]);
  }
  const invertirA = (t: Torneo): Torneo => ({ ...t, partidosGrupo: t.partidosGrupo.map((p) => (p.id === '1' ? { ...p, puntosA: 5, puntosB: 11 } : p.id === '2' ? { ...p, puntosA: 5, puntosB: 11 } : p)) });

  it('formato fijo (cruces, sin resumen de clasificación): avisa si se invierten 1º y 2º', () => {
    const t = conFormato(dosGrupos(), 'cruces');
    const armado: Torneo = { ...t, partidosLlave: armarLlaveFormato(t), configLlave: { porGrupo: 2, mejoresExtra: 0, tercerPuesto: false } };
    expect(llaveDesactualizada(armado)).toBe(false);
    expect(llaveDesactualizada(invertirA(armado))).toBe(true);
  });

  it('final de grupo único (configLlave null)', () => {
    const t = base([{ id: 'A', nombre: 'A', parejaIds: ['a1', 'a2', 'a3'] }], [pg('1', 'A', 'a1', 'a2', 11, 5), pg('2', 'A', 'a1', 'a3', 11, 5), pg('3', 'A', 'a2', 'a3', 11, 5)]);
    const armado: Torneo = { ...t, partidosLlave: armarLlaveFormato(t) };
    expect(llaveDesactualizada(armado)).toBe(false);
    // a3 le gana a a2: ahora a3 es 2ª y la final debería ser a1-a3
    expect(llaveDesactualizada({ ...armado, partidosGrupo: armado.partidosGrupo.map((p) => (p.id === '3' ? { ...p, puntosA: 5, puntosB: 11 } : p)) })).toBe(true);
  });

  it('llave genérica: mismos clasificados pero en otro orden también avisa', () => {
    const t = conFormato(tresDeTres(), 'auto');
    const config = { porGrupo: 2 as const, mejoresExtra: 0, tercerPuesto: false };
    const armado: Torneo = { ...t, configLlave: config, partidosLlave: armarLlave(calcularClasificados(t.grupos, t.partidosGrupo, config), false) };
    expect(llaveDesactualizada(armado)).toBe(false);
    // en A, a2 le gana a a1: se invierten 1º y 2º (los clasificados son los mismos)
    const corregido = { ...armado, partidosGrupo: armado.partidosGrupo.map((p) => (p.id === 'a1' ? { ...p, puntosA: 0, puntosB: 11 } : p.id === 'a3' ? { ...p, puntosA: 11, puntosB: 0 } : p)) };
    expect(llaveDesactualizada(corregido)).toBe(true);
  });

  it('mover cruces en el dibujo no cuenta como desactualizada; grupos incompletos no avisan', () => {
    const t = conFormato(dosGrupos(), 'cruces');
    const l = armarLlaveFormato(t)!;
    const movida = l.map((p) => (p.ronda === 1 ? { ...p, posicion: 1 - p.posicion } : p));
    expect(llaveDesactualizada({ ...t, partidosLlave: movida })).toBe(false);
    expect(llaveDesactualizada({ ...t, partidosLlave: l, partidosGrupo: t.partidosGrupo.map((p, i) => (i === 0 ? { ...p, puntosA: null, puntosB: null } : p)) })).toBe(false);
  });
});
