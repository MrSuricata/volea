export type PartidoFixture = { ronda: number; aId: string; bId: string };

export type OpcionesFixture = { idaYVuelta?: boolean };

const LIBRE = '__libre__'; // sentinela interno; seguro: los ids reales son base36 (nunca tienen "_")

// Método del círculo: se fija el primer elemento y el resto rota cada ronda.
// Con idaYVuelta (doble rueda) se repite la rueda entera a continuación, mismas rondas
// en el mismo orden pero con los lados invertidos (la "vuelta").
export function generarFixture(parejaIds: string[], opciones?: OpcionesFixture): PartidoFixture[] {
  const lista = [...parejaIds];
  if (lista.length < 2) return [];
  if (lista.length % 2 === 1) lista.push(LIBRE);
  const n = lista.length;
  const partidos: PartidoFixture[] = [];
  const rot = [...lista];
  for (let ronda = 1; ronda <= n - 1; ronda++) {
    for (let i = 0; i < n / 2; i++) {
      const a = rot[i];
      const b = rot[n - 1 - i];
      if (a !== LIBRE && b !== LIBRE) partidos.push({ ronda, aId: a, bId: b });
    }
    rot.splice(1, 0, rot.pop()!); // rotar: el último pasa a la posición 1 (el primero queda fijo)
  }
  if (!opciones?.idaYVuelta) return partidos;
  const rondasIda = n - 1;
  const vuelta = partidos.map((p) => ({ ronda: p.ronda + rondasIda, aId: p.bId, bId: p.aId }));
  return [...partidos, ...vuelta];
}
