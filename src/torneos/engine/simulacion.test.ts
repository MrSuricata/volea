// Simulación permanente: torneos de 3 a 32 parejas, todas las cantidades de grupos que ofrece la
// app, una rueda e ida y vuelta, todos los formatos de llave y todas las opciones de clasificación,
// jugados de punta a punta con resultados al azar (semilla fija: siempre los mismos). Mezcla
// partidos a un game, mejor de 3 (con `games`) y W.O.
import { describe, expect, it } from 'vitest';
import type { PartidoGrupo, PartidoLlave, Torneo } from './tipos';
import { CONFIG_PUNTOS_DEFAULT, conWo } from './tipos';
import { crearRng } from './rng';
import { generarPartidosGrupos, opcionesCantidadGrupos, repartirEnGrupos } from './grupos';
import { armarLlave, campeonDe, cargarResultadoLlave, podio, resolverSlot } from './llave';
import { calcularClasificados, opcionesClasificacion } from './clasificacion';
import { calcularTabla } from './tabla';
import { armarCopas } from './copas';
import { armarLlaveFormato, conFormato, formatoEfectivo, formatosPosibles, llaveDesactualizada, modoArmado } from './formatoLlave';
import { calcularRanking } from './ranking';

type Rng = () => number;
type Res = { puntosA: number; puntosB: number; games?: { a: number; b: number }[]; wo?: boolean };

function resultadoAlAzar(rng: Rng): Res {
  const ganaA = rng() < 0.5;
  const x = rng();
  if (x < 0.05) return { puntosA: ganaA ? 11 : 0, puntosB: ganaA ? 0 : 11, wo: true };
  if (x < 0.25) {
    // mejor de 3 a 11
    const games: { a: number; b: number }[] = [];
    let ga = 0;
    let gb = 0;
    const tres = rng() < 0.5;
    for (const ganaEste of tres ? [ganaA, !ganaA, ganaA] : [ganaA, ganaA]) {
      const perdedor = Math.floor(rng() * 10);
      games.push(ganaEste ? { a: 11, b: perdedor } : { a: perdedor, b: 11 });
      if (ganaEste) ga += 1; else gb += 1;
    }
    return { puntosA: ga, puntosB: gb, games };
  }
  const tope = rng() < 0.5 ? 11 : 15;
  const perdedor = Math.floor(rng() * (tope - 1));
  return { puntosA: ganaA ? tope : perdedor, puntosB: ganaA ? perdedor : tope };
}

function aplicar<T extends { wo?: boolean }>(p: T, r: Res): T {
  const conRes = { ...p, puntosA: r.puntosA, puntosB: r.puntosB, ...(r.games ? { games: r.games } : {}) };
  return conWo(conRes, !!r.wo);
}

/** Juega la llave entera; devuelve la llave jugada. */
function jugarLlave(l0: PartidoLlave[], rng: Rng): PartidoLlave[] {
  let l = l0;
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    let cambio = false;
    for (const p of l) {
      if (p.puntosA !== null || p.a === null || p.b === null) continue;
      if (resolverSlot(p.a, l) === null || resolverSlot(p.b, l) === null) continue;
      const r = resultadoAlAzar(rng);
      l = cargarResultadoLlave(l, p.id, r.puntosA, r.puntosB).partidos.map((x) => (x.id === p.id ? aplicar(x, r) : x));
      cambio = true;
    }
    if (!cambio) break;
  }
  return l;
}

/** Errores de una llave jugada: campeón, nadie dos veces por ronda, cada sembrado una vez. */
function revisarLlave(l: PartidoLlave[], sembrados: string[], ctx: string, errores: string[]) {
  const campeon = campeonDe(l);
  if (campeon === null) errores.push(`${ctx}: sin campeón`);
  else if (!sembrados.includes(campeon)) errores.push(`${ctx}: campeón ${campeon} no clasificado`);
  for (const r of new Set(l.map((p) => p.ronda))) {
    const ids = l.filter((p) => p.ronda === r && p.a && p.b).flatMap((p) => [resolverSlot(p.a, l), resolverSlot(p.b, l)]);
    if (ids.some((x) => x === null)) errores.push(`${ctx}: ronda ${r} con un lado sin definir`);
    if (new Set(ids).size !== ids.length) errores.push(`${ctx}: alguien juega dos veces en la ronda ${r}`);
  }
  const enSlots = l.flatMap((p) => [p.a, p.b]).filter((s) => s?.tipo === 'seed').map((s) => (s as { parejaId: string }).parejaId);
  if (enSlots.length !== sembrados.length || new Set(enSlots).size !== enSlots.length || !sembrados.every((x) => enSlots.includes(x))) {
    errores.push(`${ctx}: los sembrados de la llave no son los clasificados`);
  }
}

/** Primera ronda: si se podía evitar el cruce del mismo grupo, no tiene que haber ninguno. */
function revisarMismoGrupo(l: PartidoLlave[], grupoDe: Map<string, string>, ctx: string, errores: string[]) {
  const r1 = l.filter((p) => p.ronda === 1 && p.a?.tipo === 'seed' && p.b?.tipo === 'seed')
    .map((p) => [resolverSlot(p.a, l)!, resolverSlot(p.b, l)!]);
  const cuenta = new Map<string, number>();
  for (const id of r1.flat()) cuenta.set(grupoDe.get(id)!, (cuenta.get(grupoDe.get(id)!) ?? 0) + 1);
  const evitable = Math.max(0, ...cuenta.values()) <= r1.length;
  const repetidos = r1.filter(([a, b]) => grupoDe.get(a) === grupoDe.get(b));
  if (evitable && repetidos.length > 0) errores.push(`${ctx}: cruce del mismo grupo evitable ${repetidos.map((x) => x.join('-')).join(', ')}`);
}

function revisarRanking(t: Torneo, ctx: string, errores: string[]) {
  const filas = calcularRanking([{ ...t, fase: 'terminado', categoria: 'A' }], [], CONFIG_PUNTOS_DEFAULT);
  const jugadores = t.parejas.flatMap((p) => p.jugadorIds ?? []);
  if (filas.length !== jugadores.length) errores.push(`${ctx}: ranking con ${filas.length} jugadores de ${jugadores.length}`);
  if (filas.some((f) => f.aportes.length !== 1 || f.puntos <= 0)) errores.push(`${ctx}: ranking paga mal`);
}

function simularTamano(n: number): { errores: string[]; casos: number } {
  const errores: string[] = [];
  let casos = 0;
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const parejas = ids.map((id) => ({ id, nombre: id.toUpperCase(), jugadorIds: [`${id}x`, `${id}y`] }));
  for (const cantGrupos of opcionesCantidadGrupos(n)) {
    for (const idaYVuelta of [false, true]) {
      const rng = crearRng(n * 1000 + cantGrupos * 10 + (idaYVuelta ? 1 : 0));
      const grupos = repartirEnGrupos(ids, cantGrupos, rng).map((parejaIds, i) => ({ id: `G${i}`, nombre: String.fromCharCode(65 + i), parejaIds }));
      const partidosGrupo: PartidoGrupo[] = generarPartidosGrupos(grupos, { idaYVuelta }).map((p) => aplicar(p, resultadoAlAzar(rng)));
      const t: Torneo = {
        id: `t${n}`, nombre: `T${n}`, creadoEl: '2026-11-20T00:00:00.000Z', fase: 'llave', idaYVuelta,
        parejas, grupos, partidosGrupo, configLlave: null, partidosLlave: null,
      };
      const grupoDe = new Map(grupos.flatMap((g) => g.parejaIds.map((id) => [id, g.id] as const)));
      const ctx0 = `${n} parejas, ${cantGrupos} grupos${idaYVuelta ? ', ida y vuelta' : ''}`;

      // Llave por siembra: todas las opciones de clasificación, con y sin 3er puesto.
      opcionesClasificacion(grupos).forEach((o, i) => {
        const ctx = `${ctx0}, ${o.descripcion}`;
        const clasif = calcularClasificados(grupos, partidosGrupo, o);
        const sembrados = clasif.map((c) => c.parejaId);
        if (clasif.length !== o.total || new Set(sembrados).size !== sembrados.length) errores.push(`${ctx}: clasifican ${clasif.length} (repetidos o faltan)`);
        const config = { porGrupo: o.porGrupo, mejoresExtra: o.mejoresExtra, tercerPuesto: i % 2 === 1 && o.tamanoLlave >= 4 };
        const l = armarLlave(clasif, config.tercerPuesto);
        const armado: Torneo = { ...conFormato(t, 'libre'), configLlave: config, partidosLlave: l };
        if (llaveDesactualizada(armado)) errores.push(`${ctx}: recién armada figura desactualizada`);
        revisarMismoGrupo(l, grupoDe, ctx, errores);
        const jugada = jugarLlave(l, rng);
        revisarLlave(jugada, sembrados, ctx, errores);
        // con un bye en semis el 3er puesto sale por bye (el otro semifinalista no tiene rival)
        if (config.tercerPuesto && podio(jugada).tercero === null) errores.push(`${ctx}: sin 3er puesto`);
        if (i === 0) revisarRanking({ ...armado, partidosLlave: jugada }, ctx, errores);
        casos += 1;
      });

      // Formatos de la web (los mismos que En vivo).
      for (const op of formatosPosibles(t)) {
        const ctx = `${ctx0}, formato ${op.valor}`;
        const tf = conFormato(t, op.valor);
        const modo = modoArmado(tf);
        if (modo === 'fijo') {
          const l = armarLlaveFormato(tf);
          if (!l) { errores.push(`${ctx}: modo fijo sin llave`); continue; }
          const sembrados = l.flatMap((p) => [p.a, p.b]).filter((s) => s?.tipo === 'seed').map((s) => (s as { parejaId: string }).parejaId);
          const esperados = formatoEfectivo(tf) === 'final' ? 2 : formatoEfectivo(tf) === 'semis' ? 4 : 2 * cantGrupos;
          if (sembrados.length !== esperados) errores.push(`${ctx}: clasifican ${sembrados.length} y no ${esperados}`);
          if (llaveDesactualizada({ ...tf, partidosLlave: l })) errores.push(`${ctx}: recién armada figura desactualizada`);
          if (cantGrupos > 1) revisarMismoGrupo(l, grupoDe, ctx, errores);
          const jugada = jugarLlave(l, rng);
          revisarLlave(jugada, sembrados, ctx, errores);
          revisarRanking({ ...tf, partidosLlave: jugada }, ctx, errores);
        } else if (modo === 'copas') {
          const oros = new Set([2, Math.ceil(n / 2), n - 2, ...(cantGrupos === 3 && n >= 8 ? [6] : [])].filter((x) => x >= 2 && n - x >= 2));
          for (const oro of oros) {
            const c = `${ctx} oro ${oro}`;
            const copas = armarCopas(conFormato(t, 'copas', oro));
            const todas = [...copas.oro.parejas, ...copas.plata.parejas].map((p) => p.id);
            if (copas.oro.parejas.length !== oro || todas.length !== n || new Set(todas).size !== n) errores.push(`${c}: las copas pierden o repiten parejas`);
            if (cantGrupos === 3 && oro === 6) revisarMismoGrupo(copas.oro.partidosLlave!, grupoDe, `${c} (oro de 6)`, errores);
            for (const copa of [copas.oro, copas.plata]) {
              const jugada = jugarLlave(copa.partidosLlave!, rng);
              revisarLlave(jugada, copa.parejas.map((p) => p.id), `${c} ${copa.nombre}`, errores);
            }
          }
        } else if (modo === 'tabla') {
          const tabla = calcularTabla(grupos[0].parejaIds, partidosGrupo);
          if (tabla.length !== n || !tabla[0]) errores.push(`${ctx}: tabla sin campeón`);
          revisarRanking({ ...tf, partidosLlave: null }, ctx, errores);
        }
        casos += 1;
      }
    }
  }
  return { errores, casos };
}

describe('simulación de torneos completos (3 a 32 parejas)', () => {
  const tamanos = Array.from({ length: 30 }, (_, i) => i + 3);
  it.each(tamanos)('%i parejas: todos los formatos se juegan de punta a punta', (n) => {
    const { errores, casos } = simularTamano(n);
    expect(errores).toEqual([]);
    expect(casos).toBeGreaterThan(0);
  });
});
