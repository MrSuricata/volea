import type { Torneo } from './engine/tipos';

// Merge local-first por torneo:
// - torneo limpio (no sucio): manda el server (o desaparece si el server lo borro)
// - torneo sucio con base == server: se queda lo local (pendiente de push)
// - torneo sucio con server avanzado: CONFLICTO (se queda lo local y se avisa)
// - torneo local sin base y sucio: nuevo local, se conserva
export type EntradaRemota = { torneo: Torneo; updatedAt: string };
export type ResultadoMerge = { torneos: Torneo[]; base: Record<string, string>; conflictos: string[] };

export function mergeTorneos(args: {
  locales: Torneo[];
  remotos: EntradaRemota[];
  sucios: Set<string>;
  base: Record<string, string>;
}): ResultadoMerge {
  const { locales, remotos, sucios, base } = args;
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
    // sucio: comparar la base conocida con el server
    if (base[local.id] && base[local.id] !== rem.updatedAt) conflictos.push(local.id);
    resultado.push(local);
    nuevaBase[local.id] = base[local.id] ?? rem.updatedAt;
  }

  for (const rem of remotos) {
    if (vistos.has(rem.torneo.id)) continue;
    resultado.push(rem.torneo);
    nuevaBase[rem.torneo.id] = rem.updatedAt;
  }

  return { torneos: resultado, base: nuevaBase, conflictos };
}
