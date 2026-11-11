import type { Torneo } from './engine/tipos';
import type { EstadoTorneos } from './TorneosApp';
import type { Cache } from './cacheTorneos';
import { fusionarTorneo, igualesJson } from './fusion';

// Merge local-first por torneo:
// - torneo limpio (no sucio): manda el server (o desaparece si el server lo borro)
// - torneo sucio con base == server: se queda lo local (pendiente de push)
// - torneo sucio igual al server (mismo contenido): queda limpio con la base del server
//   (p.ej. un push que llego al server pero cuya respuesta se perdio por timeout)
// - torneo sucio con server avanzado y COPIA BASE conocida (`baseDatos[id]`: el torneo tal como
//   estaba en el server cuando se empezo a editar aca): FUSION por partido (ver fusion.ts). Lo
//   que no choca se combina y la base avanza al server; si choca, CONFLICTO.
// - torneo sucio con base desconocida, o sin copia base (cache vieja, de antes de la fusion),
//   y server avanzado: CONFLICTO (se queda lo local y se avisa; sin saber de donde partimos no
//   se puede fusionar, asi que mejor avisar de mas que pisar de menos)
// - torneo local sin base y sucio y SIN entrada remota: nuevo local, se conserva
// - torneo borrado localmente (tombstone en `borrados`): nunca resucita desde el remoto,
//   y no deja entrada en `base` (no hay nada que rastrear una vez que se fue)
export type EntradaRemota = { torneo: Torneo; updatedAt: string };
export type ResultadoMerge = {
  torneos: Torneo[];
  base: Record<string, string>;
  conflictos: string[];
  // copia base de los torneos que siguen sucios (los limpios no la necesitan: su contenido ES
  // el del server en `base[id]`)
  baseDatos: Record<string, Torneo>;
  // sucios que dejaron de estarlo (la fusion dio exactamente lo del server)
  limpios: string[];
  // por torneo en conflicto: que partidos/datos chocan, en castellano, para el aviso
  detalles: Record<string, string[]>;
};

// Compara dos marcas de tiempo por INSTANTE, no por texto.
// PROPÓSITO (incidente 2026-08-09/10): la base se guarda con el toISOString() del
// cliente ("2026-08-09T17:44:19.957Z") mientras que PostgREST devuelve el MISMO
// instante como "2026-08-09T17:44:19.957+00:00" (la columna es timestamptz y
// Postgres nunca emite "Z"). Comparando como texto, un torneo recién subido y
// vuelto a editar quedaba en CONFLICTO FALSO para siempre; y un torneo en
// conflicto se excluye del push (useSyncTorneos), así que sus resultados no
// volvían a subir nunca y la web pública los mostraba "sin jugar" — sin ningún
// aviso. Fechas ausentes o ilegibles devuelven false: base desconocida sigue
// siendo conflicto, que es el lado seguro (avisar de más antes que pisar).
export function mismoInstante(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const ta = instanteMicro(a);
  const tb = instanteMicro(b);
  return ta !== null && tb !== null && ta === tb;
}

// Instante en MICROsegundos. Postgres guarda µs (arbitro_terminar escribe now()) y PostgREST los
// devuelve ("…19.957123+00:00"); Date.parse los trunca a ms. Dos escrituras distintas dentro del
// mismo milisegundo se verian "iguales" y el pull creeria que el server no avanzo. Se suman los
// digitos de la fraccion a mano (faltantes = 0: "…957Z" y "…957000+00:00" son el mismo instante).
function instanteMicro(s: string): number | null {
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  const segundos = Math.floor(ms / 1000);
  const m = /T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(s);
  const micro = m ? Number((m[1] + '000000').slice(0, 6)) : 0;
  return segundos * 1_000_000 + micro;
}

export const DETALLE_SIN_BASE = 'No se sabe desde qué versión del server partieron los cambios sin subir de este dispositivo (son de antes de esta actualización de la app, o el torneo se creó también en otro lado): no se pueden combinar solos.';

// Que hacer con UN torneo local frente a su fila del server. Pura; la usan el pull (todos los
// torneos) y el push (cuando la escritura condicionada encuentra el server avanzado).
export type Reconciliacion = {
  torneo: Torneo;
  base?: string; // ausente = no hay base conocida
  baseDato?: Torneo; // copia base si sigue sucio
  sucio: boolean;
  conflicto?: string[]; // presente = conflicto, con el detalle
};

export function reconciliarTorneo(args: {
  local: Torneo;
  remoto: EntradaRemota;
  sucio: boolean;
  base: string | undefined;
  baseDato: Torneo | undefined;
}): Reconciliacion {
  const { local, remoto: rem, sucio, base, baseDato } = args;
  if (!sucio) {
    // limpio: manda el server. Si el contenido no cambio se conserva la MISMA referencia, asi
    // las relecturas periodicas no re-renderizan (ni re-montan) el gestor mientras se tipea.
    return { torneo: igualesJson(local, rem.torneo) ? local : rem.torneo, base: rem.updatedAt, sucio: false };
  }
  if (mismoInstante(base, rem.updatedAt)) {
    // el server no avanzo desde la base: lo local sigue pendiente de push
    return { torneo: local, base: rem.updatedAt, baseDato, sucio: true };
  }
  if (igualesJson(local, rem.torneo)) {
    // el server ya tiene exactamente esto (otro camino lo subio, o el push llego y su
    // respuesta se perdio): nada que subir
    return { torneo: local, base: rem.updatedAt, sucio: false };
  }
  if (base !== undefined && baseDato !== undefined) {
    const f = fusionarTorneo(baseDato, local, rem.torneo);
    if (f.ok) {
      if (igualesJson(f.torneo, rem.torneo)) return { torneo: rem.torneo, base: rem.updatedAt, sucio: false };
      return { torneo: f.torneo, base: rem.updatedAt, baseDato: rem.torneo, sucio: true };
    }
    // CONFLICTO: la base NO avanza (ver abajo) y la copia base se conserva, para que el
    // proximo pull vuelva a intentar la fusion (y vuelva a marcar el conflicto si sigue).
    return { torneo: local, base, baseDato, sucio: true, conflicto: f.choques.map((c) => c.descripcion) };
  }
  // CONFLICTO sin copia base: la base NO avanza al updatedAt del server. Si adoptaramos
  // rem.updatedAt aca, el proximo pull (con el mismo server y el mismo local sin resolver)
  // dejaria de detectar el conflicto - se "autoresolveria" en silencio. Se deja la entrada
  // vieja (o ausente si nunca hubo una) para que vuelva a marcarse en cada pull hasta que se
  // resuelva explicitamente.
  return { torneo: local, base, baseDato, sucio: true, conflicto: [DETALLE_SIN_BASE] };
}

export function mergeTorneos(args: {
  locales: Torneo[];
  remotos: EntradaRemota[];
  sucios: Set<string>;
  borrados: Set<string>;
  base: Record<string, string>;
  baseDatos?: Record<string, Torneo>;
}): ResultadoMerge {
  const { locales, remotos, sucios, borrados, base } = args;
  const baseDatos = args.baseDatos ?? {};
  const remotoPorId = new Map(remotos.map((r) => [r.torneo.id, r]));
  const nuevaBase: Record<string, string> = {};
  const nuevaBaseDatos: Record<string, Torneo> = {};
  const conflictos: string[] = [];
  const detalles: Record<string, string[]> = {};
  const limpios: string[] = [];
  const resultado: Torneo[] = [];
  const vistos = new Set<string>();

  for (const local of locales) {
    if (vistos.has(local.id)) continue; // copia repetida en la lista local: se queda la primera
    vistos.add(local.id);
    const rem = remotoPorId.get(local.id);
    const esSucio = sucios.has(local.id);
    if (!rem) {
      if (esSucio) {
        // nuevo local o borrado remoto con cambios locales: conservar
        resultado.push(local);
        if (baseDatos[local.id]) nuevaBaseDatos[local.id] = baseDatos[local.id];
      }
      continue; // limpio y no esta en el server: borrado remoto
    }
    const r = reconciliarTorneo({ local, remoto: rem, sucio: esSucio, base: base[local.id], baseDato: baseDatos[local.id] });
    resultado.push(r.torneo);
    if (r.base !== undefined) nuevaBase[local.id] = r.base;
    if (r.sucio && r.baseDato) nuevaBaseDatos[local.id] = r.baseDato;
    if (esSucio && !r.sucio) limpios.push(local.id);
    if (r.conflicto) {
      conflictos.push(local.id);
      detalles[local.id] = r.conflicto;
    }
  }

  for (const rem of remotos) {
    if (vistos.has(rem.torneo.id)) continue;
    if (borrados.has(rem.torneo.id)) continue; // tombstone: no resucitar, sin entrada en base
    resultado.push(rem.torneo);
    nuevaBase[rem.torneo.id] = rem.updatedAt;
  }

  return { torneos: resultado, base: nuevaBase, conflictos, baseDatos: nuevaBaseDatos, limpios, detalles };
}

// ---- Edicion local: marca sucios/borrados y guarda la copia base ----
// La copia base se toma en la transicion limpio -> sucio: en ese momento el torneo limpio en
// memoria ES el contenido del server en `base[id]` (lo dejo asi el ultimo pull o el ultimo push
// confirmado). Si ya estaba sucio se conserva la copia que tenia. Sin base conocida (torneo nuevo,
// o cache vieja) no hay copia: ese torneo nunca se fusiona solo.
export function aplicarEdicion(prev: Cache, estadoNuevo: EstadoTorneos): Cache {
  const suciosAntes = new Set(prev.sucios);
  const suciosNuevos = new Set(prev.sucios);
  const borradosNuevos = new Set(prev.borrados);
  const baseNueva = { ...prev.base };
  const baseDatosNueva = { ...prev.baseDatos };
  const antesPorId = new Map(prev.estado.torneos.map((t) => [t.id, t]));
  const idsAhora = new Set(estadoNuevo.torneos.map((t) => t.id));
  for (const t of estadoNuevo.torneos) {
    const antes = antesPorId.get(t.id);
    if (antes !== t) {
      // referencia cambio: contenido editado
      if (!suciosAntes.has(t.id) && antes !== undefined && prev.base[t.id] !== undefined && !baseDatosNueva[t.id]) {
        baseDatosNueva[t.id] = antes;
      }
      suciosNuevos.add(t.id);
    }
    borradosNuevos.delete(t.id); // reaparecio (p.ej. reimport de un id previamente borrado): ya no es tombstone
  }
  for (const t of prev.estado.torneos) {
    if (!idsAhora.has(t.id)) {
      // desaparecio: es un borrado, no un "sucio" con contenido (no hay contenido que subir)
      suciosNuevos.delete(t.id);
      borradosNuevos.add(t.id);
      delete baseNueva[t.id];
      delete baseDatosNueva[t.id];
    }
  }
  return {
    ...prev,
    estado: estadoNuevo,
    sucios: [...suciosNuevos],
    borrados: [...borradosNuevos],
    base: baseNueva,
    baseDatos: baseDatosNueva,
    jugadoresSucios: prev.jugadoresSucios || estadoNuevo.jugadores !== prev.estado.jugadores,
    configSucia: prev.configSucia || estadoNuevo.configPuntos !== prev.estado.configPuntos,
  };
}

// ---- Versiones frescas del server que encontro el push (escritura condicionada rechazada) ----
// Se reconcilian contra lo que hay AHORA en la cache (que puede tener ediciones posteriores al
// snapshot del push): fusion si se puede, conflicto si no. `refusionados` = los que quedaron
// fusionados y siguen sucios: hay que volver a empujarlos (ahora con la base nueva).
export function aplicarRemotosFrescos(prev: Cache, frescos: EntradaRemota[]): { cache: Cache; refusionados: string[] } {
  if (frescos.length === 0) return { cache: prev, refusionados: [] };
  const torneos = [...prev.estado.torneos];
  const base = { ...prev.base };
  const baseDatos = { ...prev.baseDatos };
  const sucios = new Set(prev.sucios);
  const conflictos = new Set(prev.conflictos);
  const detalle = { ...prev.conflictosDetalle };
  const refusionados: string[] = [];
  for (const rem of frescos) {
    const id = rem.torneo.id;
    const i = torneos.findIndex((t) => t.id === id);
    if (i < 0) continue; // lo borraron aca mientras viajaba: el tombstone manda
    const r = reconciliarTorneo({ local: torneos[i], remoto: rem, sucio: true, base: prev.base[id], baseDato: prev.baseDatos[id] });
    torneos[i] = r.torneo;
    if (r.base !== undefined) base[id] = r.base; else delete base[id];
    if (r.sucio && r.baseDato) baseDatos[id] = r.baseDato; else delete baseDatos[id];
    if (r.sucio) sucios.add(id); else sucios.delete(id);
    if (r.conflicto) {
      conflictos.add(id);
      detalle[id] = r.conflicto;
    } else {
      conflictos.delete(id);
      delete detalle[id];
      if (r.sucio) refusionados.push(id);
    }
  }
  return {
    cache: {
      ...prev,
      estado: { ...prev.estado, torneos },
      base,
      baseDatos,
      sucios: [...sucios],
      conflictos: [...conflictos],
      conflictosDetalle: detalle,
    },
    refusionados,
  };
}

// ---- Escritura condicionada de UN torneo ----
//
// PROPÓSITO (E2E arbitro-gestor-pisa-resultado): el push hacia upsert del torneo entero sin mirar
// si la fila habia cambiado en el server, y borraba en silencio el resultado que un arbitro
// acababa de cargar (o el de la otra tablet). Ahora:
//   · con base conocida: UPDATE ... WHERE id = $id AND updated_at = $base (PostgREST: PATCH con
//     dos filtros eq + return=representation). Es UNA sentencia UPDATE: Postgres la evalua de
//     forma atomica (si otra transaccion cambio la fila, el WHERE se re-evalua sobre la version
//     nueva y no matchea), asi que es un compare-and-swap sin SQL nuevo. Mismo patron que
//     guardarResultado de En vivo (ProgramacionPage).
//   · 0 filas afectadas: se relee la fila. Si avanzo, se devuelve la version del server para
//     fusionar (no se escribe nada). Si NO avanzo (mismo updated_at) la escritura fue rechazada
//     en silencio (RLS: sesion vencida o sin permiso) y es un error, no un "avance".
//   · sin base (torneo nuevo) o la fila ya no existe: INSERT puro (sin upsert): si ya hay una
//     fila con ese id, PostgREST responde 409/23505 y se trata como "server avanzado".
export type FilaTorneo = {
  id: string;
  nombre: string;
  fase: string;
  categoria: string | null;
  visible: boolean;
  cuenta_ranking: boolean;
  data: Torneo;
  creado_el: string;
  updated_at: string;
};

type Respuesta<T> = { data: T | null; error: unknown };
export type OperacionesTorneo = {
  actualizarSi: (fila: FilaTorneo, base: string) => PromiseLike<Respuesta<{ updated_at: string }[]>>;
  insertar: (fila: FilaTorneo) => PromiseLike<Respuesta<{ updated_at: string }[]>>;
  leer: (id: string) => PromiseLike<Respuesta<{ data: Torneo; updated_at: string }>>;
};

export type ResultadoSubida =
  | { tipo: 'ok'; updatedAt: string }
  | { tipo: 'avanzado'; remoto: EntradaRemota }
  | { tipo: 'error'; error: unknown };

export function filaDeTorneo(t: Torneo, ahora: string): FilaTorneo {
  return {
    id: t.id,
    nombre: t.nombre,
    fase: t.fase,
    categoria: t.categoria ?? null,
    visible: t.visible !== false,
    cuenta_ranking: t.cuentaParaRanking !== false,
    data: t,
    creado_el: t.creadoEl,
    updated_at: ahora,
  };
}

function esDuplicado(error: unknown): boolean {
  const e = error as { code?: string; status?: number } | null;
  return !!e && (e.code === '23505' || e.status === 409);
}

export async function subirTorneo(op: OperacionesTorneo, fila: FilaTorneo, base: string | undefined): Promise<ResultadoSubida> {
  if (base !== undefined) {
    const r = await op.actualizarSi(fila, base);
    if (r.error) return { tipo: 'error', error: r.error };
    if (r.data && r.data.length > 0) return { tipo: 'ok', updatedAt: r.data[0].updated_at ?? fila.updated_at };
    const fresca = await op.leer(fila.id);
    if (fresca.error) return { tipo: 'error', error: fresca.error };
    if (fresca.data) {
      if (mismoInstante(fresca.data.updated_at, base)) {
        return { tipo: 'error', error: new Error('el server no aceptó la escritura (¿sesión vencida o sin permiso?)') };
      }
      return { tipo: 'avanzado', remoto: { torneo: fresca.data.data, updatedAt: fresca.data.updated_at } };
    }
    // la fila ya no esta (la borraron en el server) y aca hay cambios: se vuelve a crear, como
    // hacia el upsert de antes (mergeTorneos tambien conserva un sucio borrado en el remoto)
  }
  const r = await op.insertar(fila);
  if (!r.error) return { tipo: 'ok', updatedAt: r.data?.[0]?.updated_at ?? fila.updated_at };
  if (!esDuplicado(r.error)) return { tipo: 'error', error: r.error };
  const fresca = await op.leer(fila.id);
  if (fresca.error || !fresca.data) return { tipo: 'error', error: fresca.error ?? r.error };
  return { tipo: 'avanzado', remoto: { torneo: fresca.data.data, updatedAt: fresca.data.updated_at } };
}
