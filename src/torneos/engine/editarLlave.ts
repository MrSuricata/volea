// Corregir a mano una llave ya armada (lo que en el Aniversario hubo que hacer por SQL): cambiar
// quién juega un cruce sin resultado (una pareja o "el ganador de" otro partido) y reordenar el
// dibujo. Los resultados cargados no se tocan.
import type { PartidoLlave, SlotLlave } from './tipos';
import { resultadoDe } from './tipos';

export function tieneResultado(p: PartidoLlave): boolean {
  return resultadoDe(p) !== null;
}

/** Ids de partidos que dependen (directa o indirectamente) de `id`. */
function dependientes(llave: PartidoLlave[], id: string): Set<string> {
  const out = new Set<string>();
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const p of llave) {
      if (out.has(p.id)) continue;
      const refs = [p.a, p.b].filter((s): s is Extract<SlotLlave, { partidoId: string }> => !!s && s.tipo !== 'seed').map((s) => s.partidoId);
      if (refs.some((r) => r === id || out.has(r))) { out.add(p.id); cambio = true; }
    }
  }
  return out;
}

/** Partidos que se pueden poner como "ganador de" en este cruce sin armar un círculo. */
export function origenesPosibles(llave: PartidoLlave[], partidoId: string): PartidoLlave[] {
  const prohibidos = dependientes(llave, partidoId);
  return llave.filter((p) => p.id !== partidoId && !prohibidos.has(p.id) && !p.esTercerPuesto);
}

/**
 * Las rondas siguen a las dependencias: un partido va una ronda después del último que espera.
 * Los que solo tienen parejas conservan su ronda. Las posiciones se compactan dentro de cada ronda.
 */
export function normalizarRondas(llave: PartidoLlave[]): PartidoLlave[] {
  const porId = new Map(llave.map((p) => [p.id, { ...p }]));
  for (let vuelta = 0; vuelta < llave.length + 1; vuelta++) {
    let cambio = false;
    for (const p of porId.values()) {
      if (p.esTercerPuesto) continue;
      const refs = [p.a, p.b].filter((s): s is Extract<SlotLlave, { partidoId: string }> => !!s && s.tipo !== 'seed').map((s) => porId.get(s.partidoId)?.ronda ?? 0);
      const minimo = refs.length ? Math.max(...refs) + 1 : 1;
      const ronda = refs.length ? minimo : Math.max(1, p.ronda);
      if (ronda !== p.ronda) { p.ronda = ronda; cambio = true; }
    }
    if (!cambio) break;
  }
  const lista = [...porId.values()];
  // compactar: rondas 1..n sin huecos
  const rondas = [...new Set(lista.filter((p) => !p.esTercerPuesto).map((p) => p.ronda))].sort((a, b) => a - b);
  const renum = new Map(rondas.map((r, i) => [r, i + 1]));
  for (const p of lista) if (!p.esTercerPuesto) p.ronda = renum.get(p.ronda) ?? p.ronda;
  const maxR = Math.max(...lista.filter((p) => !p.esTercerPuesto).map((p) => p.ronda));
  for (const p of lista) if (p.esTercerPuesto) p.ronda = maxR;
  for (const r of new Set(lista.map((p) => p.ronda))) {
    lista.filter((p) => p.ronda === r && !p.esTercerPuesto).sort((a, b) => a.posicion - b.posicion).forEach((p, i) => { p.posicion = i; });
  }
  return lista;
}

/** Cambia quién juega de un lado de un cruce sin resultado. */
export function editarSlot(llave: PartidoLlave[], partidoId: string, lado: 'a' | 'b', slot: SlotLlave | null): PartidoLlave[] {
  const p = llave.find((x) => x.id === partidoId);
  if (!p) throw new Error('No existe ese partido');
  if (tieneResultado(p)) throw new Error('Ese partido ya tiene resultado: borralo antes de cambiar el cruce');
  if (slot && slot.tipo !== 'seed' && !origenesPosibles(llave, partidoId).some((o) => o.id === slot.partidoId)) {
    throw new Error('Ese cruce armaría un círculo en la llave');
  }
  return normalizarRondas(llave.map((x) => (x.id === partidoId ? { ...x, [lado]: slot } : x)));
}

/** Mueve un partido arriba o abajo dentro de su ronda (solo el dibujo). */
export function moverEnRonda(llave: PartidoLlave[], partidoId: string, delta: -1 | 1): PartidoLlave[] {
  const p = llave.find((x) => x.id === partidoId);
  if (!p) return llave;
  const ronda = llave.filter((x) => x.ronda === p.ronda && !x.esTercerPuesto).sort((a, b) => a.posicion - b.posicion);
  const i = ronda.findIndex((x) => x.id === partidoId);
  const j = i + delta;
  if (j < 0 || j >= ronda.length) return llave;
  const otro = ronda[j];
  return llave.map((x) => (x.id === p.id ? { ...x, posicion: otro.posicion } : x.id === otro.id ? { ...x, posicion: p.posicion } : x));
}
