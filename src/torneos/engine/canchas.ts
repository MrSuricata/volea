export type Turno = { partidoId: string; tanda: number; cancha: number };

// Ordena los partidos de UNA ronda intercalando grupos (A1, B1, C1, A2, B2...) y los
// reparte en tandas de `canchas` partidos simultáneos (Cancha 1..N dentro de cada tanda).
// Dentro de una ronda nadie juega dos veces, así que cualquier reparto es válido;
// intercalar grupos hace que todos los grupos avancen en paralelo.
export function ordenDeJuego(
  partidos: { id: string; grupoId: string }[],
  canchas: number,
): Turno[] {
  if (canchas < 1) throw new Error(`cantidad de canchas inválida: ${canchas}`);
  const porGrupo = new Map<string, { id: string; grupoId: string }[]>();
  for (const p of partidos) {
    if (!porGrupo.has(p.grupoId)) porGrupo.set(p.grupoId, []);
    porGrupo.get(p.grupoId)!.push(p);
  }
  const colas = [...porGrupo.values()];
  const intercalados: { id: string; grupoId: string }[] = [];
  for (let i = 0, quedan = colas.length > 0; quedan; i++) {
    quedan = false;
    for (const cola of colas) {
      if (i < cola.length) {
        intercalados.push(cola[i]);
        if (i + 1 < cola.length) quedan = true;
      }
    }
  }
  return intercalados.map((p, idx) => ({
    partidoId: p.id,
    tanda: Math.floor(idx / canchas) + 1,
    cancha: (idx % canchas) + 1,
  }));
}
