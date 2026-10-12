// Formato de la llave elegible desde la web (gestor y En vivo usan este mismo armador).
// Los formatos viejos se guardaban como banderas sueltas (sinLlave, llave6, copas); acá se
// leen y se escriben juntas para que todo lo demás (programación, TV, ranking) siga igual.
import type { PartidoLlave, SlotLlave, Torneo } from './tipos';
import { nuevoId, resultadoDe } from './tipos';
import { calcularTabla } from './tabla';
import { armarLlaveSeis } from './copas';

export type FormatoLlave = 'auto' | 'final' | 'semis' | 'cruces' | 'seis' | 'copas' | 'tabla';

export function formatoDe(t: Torneo): FormatoLlave {
  if (t.copas) return 'copas';
  if (t.llave6) return 'seis';
  if (t.sinLlave || t.americanoIndividual) return 'tabla';
  return t.formatoLlave ?? 'auto';
}

/** Devuelve el torneo con el formato puesto (y las banderas viejas acomodadas). */
export function conFormato(t: Torneo, f: FormatoLlave, oro?: number): Torneo {
  const { copas: _c, llave6: _l, sinLlave: _s, formatoLlave: _f, ...resto } = t;
  const base: Torneo = { ...resto };
  if (f === 'copas') return { ...base, copas: { oro: oro ?? t.copas?.oro ?? Math.ceil(t.parejas.length / 2) } };
  if (f === 'seis') return { ...base, llave6: true };
  if (f === 'tabla') return { ...base, sinLlave: true };
  if (f === 'auto') return base;
  return { ...base, formatoLlave: f };
}

export type OpcionFormato = { valor: FormatoLlave; texto: string; ayuda: string };

/** Formatos que tienen sentido con esta cantidad de grupos y parejas. */
export function formatosPosibles(t: Torneo): OpcionFormato[] {
  const g = t.grupos.length;
  const n = t.parejas.length;
  const o: OpcionFormato[] = [];
  if (g <= 1) {
    o.push({ valor: 'final', texto: 'Final 1° vs 2°', ayuda: 'Todos contra todos y final entre los dos primeros.' });
    if (n >= 4) o.push({ valor: 'semis', texto: 'Semis y final', ayuda: 'Semis 1° vs 4° y 2° vs 3°, y la final.' });
    o.push({ valor: 'tabla', texto: 'Sin llave: gana la tabla', ayuda: 'Campeón el 1° y subcampeón el 2° (americano).' });
  }
  if (g === 2 || g === 4) {
    o.push({ valor: 'cruces', texto: g === 2 ? 'Semis cruzadas' : 'Cuartos cruzados', ayuda: g === 2 ? 'Pasan 1° y 2°: 1°A vs 2°B y 1°B vs 2°A.' : 'Pasan 1° y 2°: 1°A-2°B, 1°C-2°D, 1°B-2°A, 1°D-2°C.' });
  }
  if (g === 3) {
    o.push({ valor: 'seis', texto: 'Llave de 6', ayuda: 'Pasan 1° y 2°. Los 2 mejores primeros esperan en semis; el resto juega cuartos.' });
  }
  if (g >= 2) {
    o.push({ valor: 'copas', texto: 'Copa de Oro y Copa de Plata', ayuda: 'Tabla general: las mejores a Oro y el resto a Plata, cada una con su llave.' });
  }
  o.push({ valor: 'auto', texto: 'Elegir al armar', ayuda: 'Cuántos clasifican se elige en el paso Llave (incluye mejores terceros).' });
  return o;
}

const completo = (t: Torneo) => t.partidosGrupo.length > 0 && t.partidosGrupo.every((p) => resultadoDe(p) !== null);

function posiciones(t: Torneo, grupoIdx: number): string[] {
  const g = t.grupos[grupoIdx];
  const ids = new Set(g.parejaIds);
  return calcularTabla(g.parejaIds, t.partidosGrupo.filter((p) => ids.has(p.aId) && ids.has(p.bId))).map((f) => f.parejaId);
}

const seed = (parejaId: string): SlotLlave => ({ tipo: 'seed', parejaId });
const gan = (partidoId: string): SlotLlave => ({ tipo: 'ganadorDe', partidoId });
const partido = (ronda: number, posicion: number, a: SlotLlave, b: SlotLlave): PartidoLlave =>
  ({ id: nuevoId(), ronda, posicion, a, b, puntosA: null, puntosB: null, esTercerPuesto: false });

/** El formato que se usa de verdad: "auto" toma el obvio cuando lo hay. */
export function formatoEfectivo(t: Torneo): FormatoLlave {
  const f = formatoDe(t);
  if (f !== 'auto') return f;
  if (t.grupos.length <= 1) return 'final';
  if (t.grupos.length === 2 || t.grupos.length === 4) return 'cruces';
  return 'auto';
}

/**
 * Arma la llave según el formato. Devuelve null cuando el formato no arma una llave en este
 * cuadro (copas, tabla, o "auto" con 3 grupos: ahí se elige en el gestor).
 */
export function armarLlaveFormato(t: Torneo): PartidoLlave[] | null {
  if (!completo(t)) throw new Error('Quedan partidos de grupo sin resultado');
  const f = formatoEfectivo(t);
  const g = t.grupos.length;
  if (f === 'final' && g === 1) {
    const [p1, p2] = posiciones(t, 0);
    return [partido(1, 0, seed(p1), seed(p2))];
  }
  if (f === 'semis' && g === 1 && t.grupos[0].parejaIds.length >= 4) {
    const [p1, p2, p3, p4] = posiciones(t, 0);
    const s1 = partido(1, 0, seed(p1), seed(p4));
    const s2 = partido(1, 1, seed(p2), seed(p3));
    return [s1, s2, partido(2, 0, gan(s1.id), gan(s2.id))];
  }
  if (f === 'cruces' && g === 2) {
    const [a, b] = [posiciones(t, 0), posiciones(t, 1)];
    const s1 = partido(1, 0, seed(a[0]), seed(b[1]));
    const s2 = partido(1, 1, seed(b[0]), seed(a[1]));
    return [s1, s2, partido(2, 0, gan(s1.id), gan(s2.id))];
  }
  if (f === 'cruces' && g === 4) {
    const [a, b, c, d] = [0, 1, 2, 3].map((i) => posiciones(t, i));
    const q = [partido(1, 0, seed(a[0]), seed(b[1])), partido(1, 1, seed(c[0]), seed(d[1])), partido(1, 2, seed(b[0]), seed(a[1])), partido(1, 3, seed(d[0]), seed(c[1]))];
    const s1 = partido(2, 0, gan(q[0].id), gan(q[1].id));
    const s2 = partido(2, 1, gan(q[2].id), gan(q[3].id));
    return [...q, s1, s2, partido(3, 0, gan(s1.id), gan(s2.id))];
  }
  if (f === 'seis' && g === 3) return armarLlaveSeis(t);
  return null;
}

/** Cómo se verá la llave antes de terminar los grupos (para la programación). */
export function proyeccionFormato(t: Torneo): { a: string; b: string; fase: string }[][] | null {
  const f = formatoEfectivo(t);
  const g = t.grupos.length;
  if (f === 'final' && g <= 1) return [[{ a: '1° de la liga', b: '2° de la liga', fase: 'FINAL' }]];
  if (f === 'semis' && g === 1) {
    return [
      [{ a: '1° de la liga', b: '4° de la liga', fase: 'SEMIS' }, { a: '2° de la liga', b: '3° de la liga', fase: 'SEMIS' }],
      [{ a: 'Ganador SF1', b: 'Ganador SF2', fase: 'FINAL' }],
    ];
  }
  if (f === 'cruces' && g === 2) {
    return [
      [{ a: '1° Grupo A', b: '2° Grupo B', fase: 'SEMIS' }, { a: '1° Grupo B', b: '2° Grupo A', fase: 'SEMIS' }],
      [{ a: 'Ganador SF1', b: 'Ganador SF2', fase: 'FINAL' }],
    ];
  }
  if (f === 'cruces' && g === 4) {
    return [
      [{ a: '1° A', b: '2° B', fase: '4TOS' }, { a: '1° C', b: '2° D', fase: '4TOS' }, { a: '1° B', b: '2° A', fase: '4TOS' }, { a: '1° D', b: '2° C', fase: '4TOS' }],
      [{ a: 'Ganador QF1', b: 'Ganador QF2', fase: 'SEMIS' }, { a: 'Ganador QF3', b: 'Ganador QF4', fase: 'SEMIS' }],
      [{ a: 'Ganador SF1', b: 'Ganador SF2', fase: 'FINAL' }],
    ];
  }
  if (f === 'seis' && g === 3) {
    return [
      [{ a: 'mejor 2°', b: '2° mejor 2°', fase: '4TOS' }, { a: '3er mejor 1°', b: 'peor 2°', fase: '4TOS' }],
      [{ a: 'mejor 1°', b: 'ganador 4tos', fase: 'SEMIS' }, { a: '2° mejor 1°', b: 'ganador 4tos', fase: 'SEMIS' }],
      [{ a: 'Ganador SF1', b: 'Ganador SF2', fase: 'FINAL' }],
    ];
  }
  return null;
}
