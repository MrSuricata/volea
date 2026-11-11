import type { PartidoGrupo, PartidoLlave, Torneo } from './engine/tipos';
import { resolverSlot } from './engine/llave';

// Fusión de tres vías de UN torneo, a nivel de partido.
//
// PROPÓSITO (incidente E2E arbitro-gestor-pisa-resultado, 2026-11): el gestor subía el torneo
// ENTERO y pisaba lo que había escrito otro dispositivo (un árbitro con arbitro_terminar, o la
// otra tablet del organizador en el One Point Challenge). Ahora la escritura es condicionada al
// updated_at conocido, y cuando el server avanzó se llega acá con:
//   base   = el torneo tal como estaba en el server cuando este equipo empezó a editarlo
//   local  = lo que tiene este equipo (base + lo que cargó acá)
//   remoto = lo que tiene hoy el server (base + lo que cargaron otros)
// Reglas:
//   · si solo cambió un lado, gana ese lado entero;
//   · resultados de partidos (puntos, W.O., games): por partido. Cambió solo uno → ese; los
//     dos con EL MISMO resultado → ese (no es choque); los dos distintos → CHOQUE;
//   · campos "sueltos" del torneo (nombre, fase, visible, …): por campo, igual criterio;
//   · ESTRUCTURA (parejas, grupos, config de la llave, qué partidos hay y entre quiénes):
//     si cambió de un lado y del otro se cargaron resultados o también cambió la estructura
//     (distinta), es CHOQUE: no se adivina cómo encajar resultados en un cuadro rearmado;
//   · cascada de la llave: un resultado de llave fusionado tiene que haberse cargado con los
//     MISMOS rivales que tiene en el cuadro fusionado. Si un lado cambió el ganador de un
//     partido del que dependía otro que el otro lado ya jugó, eso es CHOQUE, no fusión.
// Ante la duda, choque: avisar de más antes que pisar de menos (mismo criterio que sync.ts).

export type Choque = {
  partidoId?: string; // ausente: choque de estructura o de un dato del torneo
  descripcion: string; // "Grupo A: Pérez/Gómez vs Ruiz/Díaz — acá 11-7, en el server 9-11"
};

export type ResultadoFusion = { ok: true; torneo: Torneo } | { ok: false; choques: Choque[] };

// Campos del torneo que se fusionan uno por uno (no cambian qué partidos hay ni entre quiénes).
const CAMPOS_SUELTOS = new Set(['nombre', 'fase', 'visible', 'categoria', 'cuentaParaRanking', 'evento', 'canchas', 'arbitraje']);
const LISTAS = ['partidosGrupo', 'partidosLlave'] as const;
// Campos de un partido que son "el resultado"; todo lo demás del partido es estructura.
const CAMPOS_RESULTADO = ['puntosA', 'puntosB', 'wo', 'games'] as const;

const ETIQUETA_CAMPO: Record<string, string> = {
  nombre: 'el nombre del torneo', fase: 'el paso del torneo', visible: 'si lo ve el público', categoria: 'la categoría',
  cuentaParaRanking: 'si cuenta para el ranking', evento: 'el evento', canchas: 'las canchas', arbitraje: 'el formato de árbitro',
};

// Igualdad de JSON: lo que importa es lo que se guarda en rk_torneos.data. Claves con valor
// undefined no existen en JSON (p.ej. `cargadoEl: undefined` que deja PasoFaseGrupos al borrar
// un resultado), así que se ignoran: si no, un torneo recién bajado y el mismo en memoria
// darían "distintos" y habría choques falsos.
export function igualesJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!igualesJson(a[i], bb[i])) return false;
    return true;
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const ka = Object.keys(oa).filter((k) => oa[k] !== undefined);
  const kb = Object.keys(ob).filter((k) => ob[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!(k in ob) || !igualesJson(oa[k], ob[k])) return false;
  return true;
}

type Partido = PartidoGrupo | PartidoLlave;

function resultado(p: Partido | undefined): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  if (!p) return r;
  for (const k of CAMPOS_RESULTADO) r[k] = (p as Record<string, unknown>)[k];
  // "sin resultado" es null en puntos; normalizar ausente/null para comparar
  r.puntosA = r.puntosA ?? null;
  r.puntosB = r.puntosB ?? null;
  return r;
}

function sinResultado(p: Partido): Record<string, unknown> {
  const o: Record<string, unknown> = { ...p };
  for (const k of CAMPOS_RESULTADO) delete o[k];
  delete o.cargadoEl;
  return o;
}

// El "esqueleto" del torneo: todo menos los campos sueltos y los resultados de los partidos.
function esqueleto(t: Torneo): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) {
    if (CAMPOS_SUELTOS.has(k)) continue;
    if ((LISTAS as readonly string[]).includes(k)) {
      o[k] = Array.isArray(v) ? (v as Partido[]).map(sinResultado) : v;
      continue;
    }
    o[k] = v;
  }
  return o;
}

function lista(t: Torneo, l: (typeof LISTAS)[number]): Partido[] {
  return (t[l] ?? []) as Partido[];
}

// ¿Cambió algún resultado de `lado` respecto de `base`? (solo partidos que existen en los dos)
function cambioResultados(base: Torneo, lado: Torneo): boolean {
  for (const l of LISTAS) {
    const porId = new Map(lista(base, l).map((p) => [p.id, p]));
    for (const p of lista(lado, l)) {
      const b = porId.get(p.id);
      if (!b || !igualesJson(resultado(b), resultado(p))) return true;
    }
  }
  return false;
}

function textoResultado(p: Partido | undefined): string {
  if (!p || p.puntosA === null || p.puntosA === undefined || p.puntosB === null || p.puntosB === undefined) return 'sin resultado';
  const games = p.games && p.games.length > 0 ? ` (${p.games.map((g) => `${g.a}-${g.b}`).join(', ')})` : '';
  return `${p.puntosA}-${p.puntosB}${games}${p.wo ? ' W.O.' : ''}`;
}

function nombrePareja(t: Torneo, id: string | null | undefined): string {
  if (!id) return 'a definir';
  return t.parejas.find((p) => p.id === id)?.nombre ?? 'a definir';
}

function nombreRondaLlave(p: PartidoLlave, llave: PartidoLlave[]): string {
  if (p.esTercerPuesto) return 'Tercer puesto';
  const max = Math.max(...llave.filter((x) => !x.esTercerPuesto).map((x) => x.ronda));
  const desde = max - p.ronda;
  return desde === 0 ? 'Final' : desde === 1 ? 'Semifinal' : desde === 2 ? 'Cuartos' : desde === 3 ? 'Octavos' : `Llave, ronda ${p.ronda}`;
}

/** Nombre legible de un partido para el aviso de choque ("Grupo A: X vs Y", "Final: X vs Y"). */
export function describirPartido(t: Torneo, partidoId: string): string {
  const pg = t.partidosGrupo.find((p) => p.id === partidoId);
  if (pg) {
    const g = t.grupos.find((x) => x.id === pg.grupoId);
    const donde = g ? `Grupo ${g.nombre}` : `Ronda ${pg.ronda}`;
    return `${donde}: ${nombrePareja(t, pg.aId)} vs ${nombrePareja(t, pg.bId)}`;
  }
  const llave = t.partidosLlave ?? [];
  const pl = llave.find((p) => p.id === partidoId);
  if (pl) return `${nombreRondaLlave(pl, llave)}: ${nombrePareja(t, resolverSlot(pl.a, llave))} vs ${nombrePareja(t, resolverSlot(pl.b, llave))}`;
  return `Partido ${partidoId}`;
}

function rivales(p: PartidoLlave, llave: PartidoLlave[]): string {
  return `${resolverSlot(p.a, llave) ?? '?'}|${resolverSlot(p.b, llave) ?? '?'}`;
}

// Mismas entradas (por referencia) => MISMO resultado (por referencia). useSyncTorneos aplica
// cada cambio dos veces (sobre cacheRef y como updater de setCache) y despues decide si un torneo
// "se edito mientras viajaba el push" comparando referencias: si cada llamada devolviera un objeto
// nuevo, un torneo recien fusionado parecia editado y quedaba "Guardando…" hasta el reintento de
// 30 s (visto en el E2E gestor-dos-tablets-mismo-partido).
const memo = new WeakMap<Torneo, { base: Torneo; remoto: Torneo; preferir: boolean; r: ResultadoFusion }>();

export function fusionarTorneo(base: Torneo, local: Torneo, remoto: Torneo, opciones: { preferir?: 'local' } = {}): ResultadoFusion {
  const m = memo.get(local);
  const pref = opciones.preferir === 'local';
  if (m && m.base === base && m.remoto === remoto && m.preferir === pref) return m.r;
  const r = fusionarSinMemo(base, local, remoto, opciones);
  memo.set(local, { base, remoto, preferir: pref, r });
  return r;
}

function fusionarSinMemo(base: Torneo, local: Torneo, remoto: Torneo, opciones: { preferir?: 'local' }): ResultadoFusion {
  const preferirLocal = opciones.preferir === 'local';
  if (igualesJson(local, remoto)) return { ok: true, torneo: remoto };
  if (igualesJson(remoto, base)) return { ok: true, torneo: local };
  if (igualesJson(local, base)) return { ok: true, torneo: remoto };

  const choques: Choque[] = [];
  const salida: Record<string, unknown> = {};

  // ---- campos sueltos: por campo ----
  const claves = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remoto)]);
  const rb = base as unknown as Record<string, unknown>;
  const rl = local as unknown as Record<string, unknown>;
  const rr = remoto as unknown as Record<string, unknown>;
  const sueltos: Record<string, unknown> = {};
  for (const k of claves) {
    if (!CAMPOS_SUELTOS.has(k)) continue;
    if (igualesJson(rl[k], rb[k])) sueltos[k] = rr[k];
    else if (igualesJson(rr[k], rb[k]) || igualesJson(rl[k], rr[k]) || preferirLocal) sueltos[k] = rl[k];
    else choques.push({ descripcion: `Cambiaron ${ETIQUETA_CAMPO[k] ?? k} acá y en el otro dispositivo` });
  }

  // ---- estructura ----
  const eb = esqueleto(base);
  const el = esqueleto(local);
  const er = esqueleto(remoto);
  if (!igualesJson(el, er)) {
    const soloRemota = igualesJson(el, eb);
    const soloLocal = igualesJson(er, eb);
    let ganador: Torneo | null = null;
    if (soloRemota && !cambioResultados(base, local)) ganador = remoto;
    else if (soloLocal && !cambioResultados(base, remoto)) ganador = local;
    else if (preferirLocal) ganador = local;
    if (ganador === null) {
      choques.push({
        descripcion: soloLocal
          ? 'Acá se cambió el armado del torneo (parejas, grupos o llave) y en el otro dispositivo se cargaron resultados'
          : soloRemota
            ? 'En el otro dispositivo se cambió el armado del torneo (parejas, grupos o llave) y acá se cargaron resultados'
            : 'El armado del torneo (parejas, grupos o llave) se cambió acá y en el otro dispositivo de forma distinta',
      });
      return { ok: false, choques };
    }
    if (choques.length > 0) return { ok: false, choques };
    const t = { ...(ganador as unknown as Record<string, unknown>) };
    for (const k of CAMPOS_SUELTOS) {
      if (sueltos[k] === undefined) delete t[k];
      else t[k] = sueltos[k];
    }
    return { ok: true, torneo: t as unknown as Torneo };
  }

  // ---- misma estructura: resultados partido por partido ----
  // Para cada partido, qué lado(s) aportan el resultado elegido (para el chequeo de cascada).
  const fuente = new Map<string, ('l' | 'r')[]>();
  for (const k of Object.keys(remoto)) salida[k] = rr[k];
  for (const l of LISTAS) {
    const pr = remoto[l] as Partido[] | null;
    if (!Array.isArray(pr)) continue;
    const pb = new Map(lista(base, l).map((p) => [p.id, p]));
    const pl = new Map(lista(local, l).map((p) => [p.id, p]));
    salida[l] = pr.map((r) => {
      const b = pb.get(r.id);
      const lo = pl.get(r.id)!;
      const [xb, xl, xr] = [resultado(b), resultado(lo), resultado(r)];
      if (igualesJson(xl, xr)) { fuente.set(r.id, ['l', 'r']); return r; }
      if (igualesJson(xl, xb)) { fuente.set(r.id, ['r']); return r; }
      if (igualesJson(xr, xb) || preferirLocal) { fuente.set(r.id, ['l']); return lo; }
      choques.push({
        partidoId: r.id,
        descripcion: `${describirPartido(remoto, r.id)} — acá ${textoResultado(lo)}, en el otro dispositivo ${textoResultado(r)}`,
      });
      return r;
    });
  }
  for (const k of CAMPOS_SUELTOS) {
    if (sueltos[k] === undefined) delete salida[k];
    else salida[k] = sueltos[k];
  }
  if (choques.length > 0) return { ok: false, choques };

  const torneo = salida as unknown as Torneo;

  // ---- cascada de la llave ----
  if (!preferirLocal && Array.isArray(torneo.partidosLlave)) {
    const llave = torneo.partidosLlave;
    const llaveL = local.partidosLlave ?? [];
    const llaveR = remoto.partidosLlave ?? [];
    for (const p of llave) {
      if (p.puntosA === null && p.puntosB === null) continue;
      const lados = fuente.get(p.id) ?? ['l', 'r'];
      const aqui = rivales(p, llave);
      const coincide = lados.some((lado) => {
        const propia = lado === 'l' ? llaveL : llaveR;
        const q = propia.find((x) => x.id === p.id);
        return q !== undefined && rivales(q, propia) === aqui;
      });
      if (!coincide) {
        choques.push({
          partidoId: p.id,
          descripcion: `${describirPartido(torneo, p.id)} — ya tiene resultado, pero en el otro dispositivo cambió quién llegaba a ese partido`,
        });
      }
    }
    if (choques.length > 0) return { ok: false, choques };
  }

  return { ok: true, torneo };
}
