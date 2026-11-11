import { describe, expect, it } from 'vitest';
import type { PartidoLlave, Torneo } from '../../engine/tipos';
import { armarLlaveRolling } from '../../engine/llaveIndividual';
import { campeonDe, ganadorPartido, resolverSlot } from '../../engine/llave';
import { aplicarAusentes, borradosSiDesmarco, conAusente, resolverAusentes } from './ausentes';
import { armarModelo, borradosSiMarco, marcar, proximoListo } from './modelo';

const AHORA = '2026-11-20T15:00:00.000Z';
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

function opc(n: number): Torneo {
  return {
    id: 't', nombre: 'OPC', creadoEl: AHORA, formato: 'individual', fase: 'llave',
    parejas: ids(n).map((id) => ({ id, nombre: id.toUpperCase() })),
    grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: armarLlaveRolling(ids(n)),
  };
}
const llave = (t: Torneo) => t.partidosLlave as PartidoLlave[];
/** Cruce `numero` (1-based) de la ronda `ronda`. */
const cruce = (t: Torneo, ronda: number, numero: number) =>
  llave(t).filter((p) => p.ronda === ronda).sort((a, b) => a.posicion - b.posicion)[numero - 1];
const rivales = (t: Torneo, p: PartidoLlave) => [resolverSlot(p.a, llave(t)), resolverSlot(p.b, llave(t))];
const ganador = (t: Torneo, p: PartidoLlave) => ganadorPartido(p, llave(t));
/** Un toque como en la pantalla (con la resolución de ausentes adentro del mismo updater). */
const tocar = (t: Torneo, p: PartidoLlave, lado: 'a' | 'b'): Torneo =>
  ({ ...t, partidosLlave: marcar(llave(t), p.id, lado, AHORA, t.ausentes ?? []) });

/** Juega todo lo que queda listo (gana siempre el lado `lado`) hasta que no haya nada para jugar. */
function jugarTodo(t: Torneo, elegir: (k: number) => 'a' | 'b' = () => 'a'): Torneo {
  let k = 0;
  for (;;) {
    const m = armarModelo(llave(t), t.ausentes ?? []);
    expect(m.cruces.filter((c) => c.estado === 'listo' && (c.ausenteA || c.ausenteB))).toEqual([]); // nunca un listo con ausente
    const prox = proximoListo(m, null);
    if (!prox) return t;
    t = tocar(t, prox.partido, elegir(k++));
  }
}

describe('No se presentó: resolución automática', () => {
  it('ausente en la ronda 1: el rival pasa solo, por W.O., sin hora de carga', () => {
    const t = conAusente(opc(13), 'p1', true);
    expect(t.ausentes).toEqual(['p1']);
    const c = cruce(t, 1, 1);
    expect([c.puntosA, c.puntosB, c.wo, 'cargadoEl' in c]).toEqual([0, 1, true, false]);
    expect(ganador(t, c)).toBe('p2');
    expect(llave(t).filter((p) => p.puntosA !== null)).toHaveLength(1); // nada más
    const m = armarModelo(llave(t), t.ausentes);
    expect(m.jugados).toBe(1);
    expect(m.porWo).toBe(1);
    expect(m.cruces[0].wo).toBe(true);
    expect(proximoListo(m, null)?.orden).toBe(2); // el "Sigue" ya no propone ese cruce
  });

  it('ausente que tenía pase directo: pierde cuando su cruce queda listo', () => {
    let t = conAusente(opc(13), 'p13', true); // p13 zafa la ronda 1
    expect(llave(t).every((p) => p.puntosA === null)).toBe(true);
    t = tocar(t, cruce(t, 1, 1), 'b'); // gana p2 → ronda 2 cruce 1 = p13 vs p2
    const r2 = cruce(t, 2, 1);
    expect(rivales(t, r2)).toEqual(['p13', 'p2']);
    expect(r2.wo).toBe(true);
    expect(ganador(t, r2)).toBe('p2');
  });

  it('los dos de un cruce ausentes (marcados uno después del otro): el W.O. ya resuelto queda y el que pasó pierde el siguiente', () => {
    let t = conAusente(conAusente(opc(4), 'p1', true), 'p2', true);
    const c1 = cruce(t, 1, 1);
    expect([ganador(t, c1), c1.wo]).toEqual(['p2', true]); // al marcar a p1 pasó p2; ese cruce ya no se toca
    t = tocar(t, cruce(t, 1, 2), 'b'); // gana p4
    const final = cruce(t, 2, 1);
    expect([ganador(t, final), final.wo]).toEqual(['p4', true]);
    expect(campeonDe(llave(t))).toBe('p4');
    const m = armarModelo(llave(t), t.ausentes);
    expect([m.finalPorWo, m.campeon, m.subcampeon]).toEqual([true, 'p4', 'p2']);
  });

  it('dos ausentes en el mismo cruce listo (p. ej. llave rearmada o versiones fusionadas): pasa el de arriba y pierde el siguiente', () => {
    // 3 jugadores: p3 pasa directo a la final; p1 y p2 ya estaban ausentes cuando se resuelve
    const t = aplicarAusentes({ ...opc(3), ausentes: ['p2', 'p1'] });
    const semi = cruce(t, 1, 1);
    expect([ganador(t, semi), semi.wo]).toEqual(['p1', true]); // pasa el de arriba (lado a)
    const final = cruce(t, 2, 1);
    expect([rivales(t, final), ganador(t, final), final.wo]).toEqual([['p3', 'p1'], 'p3', true]);
    expect(aplicarAusentes({ ...opc(3), ausentes: ['p1', 'p2'] }).partidosLlave!.map((p) => [p.puntosA, p.puntosB]))
      .toEqual(llave(t).map((p) => [p.puntosA, p.puntosB])); // el orden de la lista no importa
    // los tres ausentes: igual sale un único campeón (el de arriba de la final)
    const u = aplicarAusentes({ ...opc(3), ausentes: ['p1', 'p2', 'p3'] });
    expect(campeonDe(llave(u))).toBe('p3');
    expect(llave(u).every((p) => p.wo)).toBe(true);
  });

  it('ausente marcado con rondas ya jugadas: lo jugado no se toca, pierde el cruce listo', () => {
    let t = opc(8);
    for (let k = 1; k <= 4; k++) t = tocar(t, cruce(t, 1, k), 'a'); // p1 p3 p5 p7
    const r1 = JSON.stringify(llave(t).filter((p) => p.ronda === 1));
    t = conAusente(t, 'p1', true);
    expect(JSON.stringify(llave(t).filter((p) => p.ronda === 1))).toBe(r1);
    const r2 = cruce(t, 2, 1);
    expect([ganador(t, r2), r2.wo]).toEqual(['p3', true]);
    expect(cruce(t, 2, 2).puntosA).toBeNull();
  });

  it('cruce ya jugado de verdad con el ausente: no se toca aunque después se lo marque', () => {
    let t = opc(4);
    t = tocar(t, cruce(t, 1, 1), 'a');
    t = conAusente(t, 'p2', true); // p2 ya perdió jugando
    expect(cruce(t, 1, 1).wo).toBeUndefined();
    expect(llave(t).filter((p) => p.wo)).toHaveLength(0);
  });

  it('idempotente: resolver dos veces no cambia nada (misma referencia) y marcar dos veces tampoco', () => {
    const t = conAusente(opc(13), 'p5', true);
    expect(resolverAusentes(llave(t), t.ausentes!)).toBe(llave(t));
    expect(aplicarAusentes(t)).toBe(t);
    expect(conAusente(t, 'p5', true)).toEqual(t);
    const sin = opc(5);
    expect(aplicarAusentes(sin)).toBe(sin); // sin el campo: exactamente como antes
    expect(resolverAusentes(llave(sin), [])).toBe(llave(sin));
  });

  it('quién figura como "no se presentó" en cada cruce (para las pantallas)', () => {
    let t = conAusente(opc(8), 'p1', true); // p2 pasa por W.O.
    for (let k = 2; k <= 4; k++) t = tocar(t, cruce(t, 1, k), 'a'); // p3 p5 p7
    t = tocar(t, cruce(t, 2, 1), 'a'); // p2 le gana a p3 jugando
    t = conAusente(t, 'p2', true); // y después se va: pierde por W.O. su cruce siguiente
    const m = armarModelo(llave(t), t.ausentes);
    const r1c1 = m.rondas[0].cruces[0];
    expect([r1c1.ausenteA, r1c1.ausenteB]).toEqual([true, false]); // en la ronda 1 p2 sí vino
    const r2c1 = m.rondas[1].cruces[0];
    expect([r2c1.wo, r2c1.ausenteA, r2c1.ausenteB]).toEqual([false, false, false]); // jugado de verdad
    // los dos de un cruce sin haber jugado nunca: figuran los dos
    const u = aplicarAusentes({ ...opc(4), ausentes: ['p1', 'p2'] });
    const c = armarModelo(llave(u), u.ausentes).rondas[0].cruces[0];
    expect([c.wo, c.ausenteA, c.ausenteB]).toEqual([true, true, true]);
  });

  it('un ausente que no es jugador del torneo se ignora', () => {
    const t = { ...opc(4), ausentes: ['nadie'] };
    expect(aplicarAusentes(t)).toBe(t);
  });
});

describe('No se presentó: desmarcar (llegó tarde)', () => {
  it('sin cruces jugados después: se borra el W.O. y el cruce vuelve a estar para jugar', () => {
    const marcado = conAusente(opc(13), 'p1', true);
    expect(borradosSiDesmarco(marcado, 'p1')).toEqual([]);
    const t = conAusente(marcado, 'p1', false);
    expect('ausentes' in t).toBe(false); // vuelve a la forma de siempre
    expect(llave(t).every((p) => p.puntosA === null && !('wo' in p))).toBe(true);
  });

  it('con un cruce jugado de verdad después: avisa cuál se borra y, si se confirma, lo borra', () => {
    let t = conAusente(opc(8), 'p1', true); // p2 pasa por W.O.
    t = tocar(t, cruce(t, 1, 2), 'a'); // p3
    t = tocar(t, cruce(t, 2, 1), 'a'); // p2 le gana a p3 JUGANDO
    const borrados = borradosSiDesmarco(t, 'p1');
    expect(borrados.map((p) => p.id)).toEqual([cruce(t, 2, 1).id]);
    const d = conAusente(t, 'p1', false);
    expect(cruce(d, 1, 1).puntosA).toBeNull();
    expect(cruce(d, 2, 1).puntosA).toBeNull();
    expect(cruce(d, 1, 2).puntosA).toBe(1); // lo que no dependía, intacto
  });

  it('desmarcar a uno de dos ausentes del mismo cruce: ahora pasa él y el otro sigue perdiendo', () => {
    let t = conAusente(conAusente(opc(4), 'p1', true), 'p2', true); // pasa p1 (arriba)
    t = tocar(t, cruce(t, 1, 2), 'a'); // p3; final p1 vs p3 → p3 por W.O.
    expect(campeonDe(llave(t))).toBe('p3');
    // desmarcar a p2 (perdió el W.O. contra p1): pasa p2, y la final p2 vs p3 queda para jugar
    t = conAusente(t, 'p2', false);
    expect(ganador(t, cruce(t, 1, 1))).toBe('p2');
    expect(cruce(t, 1, 1).wo).toBe(true);
    expect(cruce(t, 2, 1).puntosA).toBeNull();
    expect(rivales(t, cruce(t, 2, 1))).toEqual(['p2', 'p3']);
    // desmarcar a p1 (no perdió ningún W.O.: no hay nada que deshacer)
    expect(borradosSiDesmarco(t, 'p1')).toEqual([]);
  });

  it('el toque que deshace un cruce no cuenta como "borrado" el W.O. que dependía de él', () => {
    let t = conAusente(opc(4), 'p3', true); // p4 pasa por W.O.
    t = tocar(t, cruce(t, 1, 1), 'a'); // p1; final p1 vs p4 lista
    expect(borradosSiMarco(llave(t), cruce(t, 1, 1).id, null, t.ausentes)).toBe(0);
    t = conAusente(opc(4), 'p4', true); // p3 pasa
    t = tocar(t, cruce(t, 1, 1), 'a'); // final p1 vs p3, se juega
    t = tocar(t, cruce(t, 2, 1), 'b');
    expect(borradosSiMarco(llave(t), cruce(t, 1, 1).id, 'b', t.ausentes)).toBe(1);
  });
});

describe('No se presentó: llaves enteras', () => {
  // Ausentes repartidos (uno en la ronda 1, el que pasa directo si hay, dos de un mismo cruce) y
  // otro marcado a mitad del torneo; el resto se juega con ganadores alternados.
  for (const n of [2, 3, 5, 13, 32]) {
    it(`${n} jugadores: un único campeón y ${n - 1} cruces resueltos`, () => {
      let t = opc(n);
      const iniciales = n === 2 ? ['p2'] : n === 3 ? ['p3', 'p1'] : [`p${n}`, 'p3', 'p4', 'p1'];
      for (const id of iniciales) t = conAusente(t, id, true);
      t = jugarTodo(t, (k) => (k % 3 === 1 ? 'b' : 'a'));
      const ps = llave(t);
      expect(ps).toHaveLength(n - 1);
      expect(ps.every((p) => p.puntosA !== null && p.puntosB !== null)).toBe(true);
      const campeon = campeonDe(ps);
      expect(campeon).not.toBeNull();
      const ganadores = new Set(ps.map((p) => ganadorPartido(p, ps)));
      const perdedores = ps.map((p) => { const [a, b] = [resolverSlot(p.a, ps), resolverSlot(p.b, ps)]; return ganadorPartido(p, ps) === a ? b : a; });
      expect(new Set(perdedores).size).toBe(n - 1); // cada uno pierde una sola vez
      expect(perdedores).not.toContain(campeon);
      expect(ganadores.has(campeon)).toBe(true);
      const aus = new Set(t.ausentes);
      for (const p of ps) {
        const [a, b] = [resolverSlot(p.a, ps)!, resolverSlot(p.b, ps)!];
        if (aus.has(a) || aus.has(b)) expect(p.wo).toBe(true);
        else expect(p.wo).toBeUndefined();
        if (aus.has(a) !== aus.has(b)) expect(aus.has(ganadorPartido(p, ps)!)).toBe(false);
      }
      if (n > 3) expect(aus.has(campeon!)).toBe(false);
      // idempotente al final
      expect(aplicarAusentes(t)).toBe(t);
    });
  }

  it('32 jugadores con un ausente marcado a mitad (ya había ganado dos cruces jugando)', () => {
    // se juegan las rondas 1 y 2 con "gana arriba": p1 llega a la ronda 3
    let t = opc(32);
    for (let r = 1; r <= 2; r++) {
      const m = armarModelo(llave(t));
      for (const c of m.rondas[r - 1].cruces) t = tocar(t, c.partido, 'a');
    }
    const jugados = JSON.stringify(llave(t).filter((p) => p.puntosA !== null));
    t = conAusente(t, 'p1', true);
    const r3 = cruce(t, 3, 1);
    expect(r3.wo).toBe(true);
    expect(ganador(t, r3)).not.toBe('p1');
    expect(llave(t).filter((p) => p.puntosA !== null && !p.wo).length).toBe(JSON.parse(jugados).length);
    t = jugarTodo(t);
    expect(llave(t).every((p) => p.puntosA !== null)).toBe(true);
    expect(campeonDe(llave(t))).not.toBe('p1');
  });
});
