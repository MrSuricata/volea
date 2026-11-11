import type { PartidoLlave, SlotLlave } from './tipos';
import { conWo, nuevoId, resultadoDe } from './tipos';

export type SeedInfo = { parejaId: string; grupoId: string };

// Orden estándar de posiciones de bracket: [1,2] -> [1,4,2,3] -> [1,8,4,5,2,7,3,6] ...
// tamano debe ser potencia de 2 (armarLlave siempre la pasa así).
export function ordenSeeds(tamano: number): number[] {
  let orden = [1];
  while (orden.length < tamano) {
    const m = orden.length * 2 + 1;
    const siguiente: number[] = [];
    for (const s of orden) siguiente.push(s, m - s);
    orden = siguiente;
  }
  return orden;
}

// Máximo emparejamiento (Kuhn) entre filas y columnas con aristas permitidas. Tamaños chicos (≤ 16).
function maxEmparejamiento(filas: number, columnas: number, permitido: (f: number, c: number) => boolean): number {
  const duenio: (number | null)[] = Array(columnas).fill(null);
  const intentar = (f: number, visto: boolean[]): boolean => {
    for (let c = 0; c < columnas; c++) {
      if (visto[c] || !permitido(f, c)) continue;
      visto[c] = true;
      if (duenio[c] === null || intentar(duenio[c]!, visto)) { duenio[c] = f; return true; }
    }
    return false;
  };
  let total = 0;
  for (let f = 0; f < filas; f++) if (intentar(f, Array(columnas).fill(false))) total += 1;
  return total;
}

/**
 * Primera ronda sin cruces del mismo grupo cuando se puede, tocando lo mínimo el orden por siembra.
 * `orden` = número de seed por posición del dibujo (null = bye). Los partidos con bye no se tocan y
 * en cada partido el mejor sembrado ("de arriba") queda fijo: solo se reparten los de abajo.
 * Se recorre de mejor a peor sembrado de arriba: cada uno se queda con su rival original si con eso
 * todavía se puede llegar al máximo posible de cruces sin mismo grupo; si no, con el rival de siembra
 * más cercana a la original que lo permita. Así, si existe una asignación sin mismo grupo, sale esa;
 * si no existe, se minimizan los cruces repetidos.
 */
function evitarMismoGrupo(orden: (number | null)[], seeds: SeedInfo[]): (number | null)[] {
  const grupo = (s: number) => seeds[s - 1].grupoId;
  const partidos: { pos: number; arriba: number; abajo: number }[] = [];
  for (let i = 0; i < orden.length / 2; i++) {
    const x = orden[2 * i];
    const y = orden[2 * i + 1];
    if (x === null || y === null) continue;
    partidos.push({ pos: i, arriba: Math.min(x, y), abajo: Math.max(x, y) });
  }
  if (partidos.every((p) => grupo(p.arriba) !== grupo(p.abajo))) return orden;
  partidos.sort((p, q) => p.arriba - q.arriba);
  const libres = partidos.map((p) => p.abajo);
  const bien = (arriba: number, abajo: number) => grupo(arriba) !== grupo(abajo);
  const alcanzable = (desde: number, cols: number[]) =>
    maxEmparejamiento(partidos.length - desde, cols.length, (f, c) => bien(partidos[desde + f].arriba, cols[c]));
  const objetivo = alcanzable(0, libres);
  let logrados = 0;
  const elegido = new Map<number, number>();
  partidos.forEach((p, k) => {
    // candidatos por cercanía a la siembra original (a igual distancia, el más débil: el que le tocaba)
    const candidatos = [...libres].sort((u, v) => Math.abs(u - p.abajo) - Math.abs(v - p.abajo) || v - u);
    for (const c of candidatos) {
      const resto = libres.filter((x) => x !== c);
      const suma = (bien(p.arriba, c) ? 1 : 0) + alcanzable(k + 1, resto);
      if (logrados + suma === objetivo) {
        elegido.set(p.pos, c);
        if (bien(p.arriba, c)) logrados += 1;
        libres.splice(libres.indexOf(c), 1);
        return;
      }
    }
  });
  const nuevo = [...orden];
  for (const p of partidos) {
    nuevo[2 * p.pos] = p.arriba;
    nuevo[2 * p.pos + 1] = elegido.get(p.pos)!;
  }
  return nuevo;
}

export function armarLlave(seeds: SeedInfo[], tercerPuesto: boolean): PartidoLlave[] {
  const total = seeds.length;
  let tamano = 2;
  while (tamano < total) tamano *= 2;

  // ubicar seeds en posiciones de bracket; los números que exceden el total son byes (null)
  const numeros = evitarMismoGrupo(ordenSeeds(tamano).map((s) => (s <= total ? s : null)), seeds);
  const porPosicion: (SeedInfo | null)[] = numeros.map((s) => (s === null ? null : seeds[s - 1]));
  const cantPartidos = tamano / 2;

  const partidos: PartidoLlave[] = [];
  let rondaActual: PartidoLlave[] = [];
  for (let i = 0; i < cantPartidos; i++) {
    const a = porPosicion[2 * i];
    const b = porPosicion[2 * i + 1];
    rondaActual.push({
      id: nuevoId(), ronda: 1, posicion: i,
      a: a ? { tipo: 'seed', parejaId: a.parejaId } : null,
      b: b ? { tipo: 'seed', parejaId: b.parejaId } : null,
      puntosA: null, puntosB: null, esTercerPuesto: false,
    });
  }
  partidos.push(...rondaActual);

  let ronda = 2;
  while (rondaActual.length > 1) {
    const siguiente: PartidoLlave[] = [];
    for (let i = 0; i < rondaActual.length; i += 2) {
      siguiente.push({
        id: nuevoId(), ronda, posicion: i / 2,
        a: { tipo: 'ganadorDe', partidoId: rondaActual[i].id },
        b: { tipo: 'ganadorDe', partidoId: rondaActual[i + 1].id },
        puntosA: null, puntosB: null, esTercerPuesto: false,
      });
    }
    partidos.push(...siguiente);
    rondaActual = siguiente;
    ronda += 1;
  }

  if (tercerPuesto && tamano >= 4) {
    const rondaFinal = ronda - 1;
    const semis = partidos.filter((p) => p.ronda === rondaFinal - 1);
    partidos.push({
      id: nuevoId(), ronda: rondaFinal, posicion: 1,
      a: semis[0].a === null || semis[0].b === null ? null : { tipo: 'perdedorDe', partidoId: semis[0].id },
      b: semis[1].a === null || semis[1].b === null ? null : { tipo: 'perdedorDe', partidoId: semis[1].id },
      puntosA: null, puntosB: null, esTercerPuesto: true,
    });
  }

  return partidos;
}

// Resuelve quién ocupa un slot (o null si todavía no se sabe). null de slot = bye.
export function resolverSlot(slot: SlotLlave | null, partidos: PartidoLlave[]): string | null {
  if (slot === null) return null;
  if (slot.tipo === 'seed') return slot.parejaId;
  const partido = partidos.find((p) => p.id === slot.partidoId);
  if (!partido) return null;
  const ganador = ganadorPartido(partido, partidos);
  if (ganador === null) return null;
  if (slot.tipo === 'ganadorDe') return ganador;
  const a = resolverSlot(partido.a, partidos);
  const b = resolverSlot(partido.b, partidos);
  return ganador === a ? b : a;
}

export function ganadorPartido(partido: PartidoLlave, partidos: PartidoLlave[]): string | null {
  const a = resolverSlot(partido.a, partidos);
  const b = resolverSlot(partido.b, partidos);
  if (partido.a === null && b !== null) return b; // bye
  if (partido.b === null && a !== null) return a; // bye
  if (a === null || b === null) return null;
  const r = resultadoDe(partido);
  if (!r) return null;
  return r.a > r.b ? a : b;
}

// Partidos posteriores que ya tienen resultado y dependen (directa o indirectamente) de partidoId
function dependientesConResultado(partidoId: string, partidos: PartidoLlave[]): PartidoLlave[] {
  const directos = partidos.filter((p) =>
    [p.a, p.b].some((s) => s !== null && s.tipo !== 'seed' && s.partidoId === partidoId),
  );
  const resultado: PartidoLlave[] = [];
  for (const p of directos) {
    if (p.puntosA !== null || p.puntosB !== null) resultado.push(p);
    resultado.push(...dependientesConResultado(p.id, partidos));
  }
  return resultado;
}

// Cuántos resultados se borrarían si se aplica esta corrección (0 si el ganador no cambia).
// Acepta null para "borrar el marcador" — eso también cambia el ganador y dispara la cascada.
export function borradosSiCorrijo(partidos: PartidoLlave[], partidoId: string, puntosA: number | null, puntosB: number | null): number {
  const actual = partidos.find((p) => p.id === partidoId);
  if (!actual) return 0;
  const ganadorAntes = ganadorPartido(actual, partidos);
  const simulados = partidos.map((p) => (p.id === partidoId ? { ...p, puntosA, puntosB } : p));
  const ganadorDespues = ganadorPartido(simulados.find((p) => p.id === partidoId)!, simulados);
  if (ganadorAntes === null || ganadorAntes === ganadorDespues) return 0;
  return new Set(dependientesConResultado(partidoId, partidos).map((p) => p.id)).size;
}

export function cargarResultadoLlave(
  partidos: PartidoLlave[],
  partidoId: string,
  puntosA: number | null,
  puntosB: number | null,
): { partidos: PartidoLlave[]; borrados: number } {
  const actual = partidos.find((p) => p.id === partidoId);
  const jugable = actual !== undefined && actual.a !== null && actual.b !== null
    && resolverSlot(actual.a, partidos) !== null && resolverSlot(actual.b, partidos) !== null;
  if (!jugable && (puntosA !== null || puntosB !== null)) return { partidos, borrados: 0 };
  const borrados = borradosSiCorrijo(partidos, partidoId, puntosA, puntosB);
  const aBorrar = borrados > 0
    ? new Set(dependientesConResultado(partidoId, partidos).map((p) => p.id))
    : new Set<string>();
  const nuevos = partidos.map((p) => {
    // Un W.O. sin resultado no existe: si el puntaje se borra, la marca se va con él.
    if (p.id === partidoId) return conWo({ ...p, puntosA, puntosB }, !!p.wo && puntosA !== null && puntosB !== null);
    if (aBorrar.has(p.id)) return conWo({ ...p, puntosA: null, puntosB: null }, false);
    return p;
  });
  return { partidos: nuevos, borrados: aBorrar.size };
}

function partidoFinal(partidos: PartidoLlave[]): PartidoLlave | undefined {
  return partidos
    .filter((p) => !p.esTercerPuesto)
    .sort((x, y) => y.ronda - x.ronda || x.posicion - y.posicion)[0];
}

export function campeonDe(partidos: PartidoLlave[]): string | null {
  const final = partidoFinal(partidos);
  return final ? ganadorPartido(final, partidos) : null;
}

export function podio(partidos: PartidoLlave[]): { campeon: string | null; subcampeon: string | null; tercero: string | null } {
  const final = partidoFinal(partidos);
  const campeon = final ? ganadorPartido(final, partidos) : null;
  let subcampeon: string | null = null;
  if (final && campeon !== null) {
    const a = resolverSlot(final.a, partidos);
    const b = resolverSlot(final.b, partidos);
    subcampeon = campeon === a ? b : a;
  }
  const partidoTercero = partidos.find((p) => p.esTercerPuesto);
  const tercero = partidoTercero ? ganadorPartido(partidoTercero, partidos) : null;
  return { campeon, subcampeon, tercero };
}
