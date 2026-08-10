import type { Torneo } from './engine/tipos';

// Merge local-first por torneo:
// - torneo limpio (no sucio): manda el server (o desaparece si el server lo borro)
// - torneo sucio con base == server: se queda lo local (pendiente de push)
// - torneo sucio con base desconocida o server avanzado: CONFLICTO (se queda lo local
//   y se avisa; con base desconocida no podemos garantizar que partimos del mismo punto
//   que el server, asi que mejor avisar de mas que pisar de menos)
// - torneo local sin base y sucio y SIN entrada remota: nuevo local, se conserva
// - torneo borrado localmente (tombstone en `borrados`): nunca resucita desde el remoto,
//   y no deja entrada en `base` (no hay nada que rastrear una vez que se fue)
export type EntradaRemota = { torneo: Torneo; updatedAt: string };
export type ResultadoMerge = { torneos: Torneo[]; base: Record<string, string>; conflictos: string[] };

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
function mismoInstante(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

export function mergeTorneos(args: {
  locales: Torneo[];
  remotos: EntradaRemota[];
  sucios: Set<string>;
  borrados: Set<string>;
  base: Record<string, string>;
}): ResultadoMerge {
  const { locales, remotos, sucios, borrados, base } = args;
  const remotoPorId = new Map(remotos.map((r) => [r.torneo.id, r]));
  const nuevaBase: Record<string, string> = {};
  const conflictos: string[] = [];
  const resultado: Torneo[] = [];
  const vistos = new Set<string>();

  for (const local of locales) {
    vistos.add(local.id);
    const rem = remotoPorId.get(local.id);
    const esSucio = sucios.has(local.id);
    if (!rem) {
      if (esSucio) resultado.push(local); // nuevo local o borrado remoto con cambios locales: conservar
      continue; // limpio y no esta en el server: borrado remoto
    }
    if (!esSucio) {
      resultado.push(rem.torneo);
      nuevaBase[local.id] = rem.updatedAt;
      continue;
    }
    // sucio: si la base conocida no coincide con el server (incluida una base
    // desconocida, que nunca coincide) es CONFLICTO; de lo contrario el server
    // no avanzo desde la ultima vez que sincronizamos y el local sigue pendiente.
    if (!mismoInstante(base[local.id], rem.updatedAt)) {
      // CONFLICTO: la base NO avanza al updatedAt del server. Si adoptaramos
      // rem.updatedAt aca, el proximo pull (con el mismo server y el mismo local
      // sin resolver) dejaria de detectar el conflicto - se "autoresolveria" en
      // silencio. Se deja la entrada vieja (o ausente si nunca hubo una) para que
      // vuelva a marcarse en cada pull hasta que se resuelva explicitamente.
      conflictos.push(local.id);
      resultado.push(local);
      if (local.id in base) nuevaBase[local.id] = base[local.id];
      continue;
    }
    resultado.push(local);
    nuevaBase[local.id] = rem.updatedAt;
  }

  for (const rem of remotos) {
    if (vistos.has(rem.torneo.id)) continue;
    if (borrados.has(rem.torneo.id)) continue; // tombstone: no resucitar, sin entrada en base
    resultado.push(rem.torneo);
    nuevaBase[rem.torneo.id] = rem.updatedAt;
  }

  return { torneos: resultado, base: nuevaBase, conflictos };
}
