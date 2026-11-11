import { describe, expect, it } from 'vitest';
import { escalonDePareja, escalonEnLlave } from './ranking';
import { cargarResultadoLlave, ganadorPartido, resolverSlot } from './llave';
import type { Escalon, Torneo } from './tipos';
import { armarLlaveRolling } from './llaveIndividual';
import { aplicarAusentes } from '../ui/opc/ausentes';
import { jugarTodo } from './llaveIndividual.prueba';

// ¿Qué paga el ranking en una llave rolling? escalonEnLlave mide "distancia a la final" en rondas.
// En el rolling cada ronda deja ceil(vivos/2), así que esa distancia equivale exactamente a
// "cuántos quedaban vivos cuando perdiste", redondeado a la potencia de 2: perder con 2 vivos =
// FINALISTA, con 3-4 = SEMI, 5-8 = CUARTOS, 9-16 = OCTAVOS, más = PARTICIPO (0 en individuales).
// Es la misma regla que en una llave común con byes; acá se fija con tests para 2..64.
function escalonPorVivos(vivos: number): Escalon {
  if (vivos <= 2) return 'FINALISTA';
  if (vivos <= 4) return 'SEMI';
  if (vivos <= 8) return 'CUARTOS';
  if (vivos <= 16) return 'OCTAVOS';
  return 'PARTICIPO';
}

describe('escalonEnLlave en el One Point Challenge (rolling)', () => {
  for (let n = 2; n <= 64; n++) {
    it(`${n} jugadores: el escalón sale de cuántos quedaban vivos al perder`, () => {
      const ps = jugarTodo(n, n);
      const rondas = Math.max(...ps.map((p) => p.ronda));
      let vivos = n;
      const conteo: Record<string, number> = {};
      for (let r = 1; r <= rondas; r++) {
        for (const p of ps.filter((x) => x.ronda === r)) {
          const a = resolverSlot(p.a, ps)!;
          const b = resolverSlot(p.b, ps)!;
          const perdedor = ganadorPartido(p, ps) === a ? b : a;
          const e = escalonEnLlave(ps, perdedor);
          expect(e).toBe(escalonPorVivos(vivos));
          conteo[e] = (conteo[e] ?? 0) + 1;
        }
        vivos = Math.ceil(vivos / 2);
      }
      const campeon = ps.map((p) => ganadorPartido(p, ps)).find((g) => g !== null && escalonEnLlave(ps, g) === 'CAMPEON');
      expect(campeon).toBeDefined();
      // nunca más premiados que en una llave común del mismo tamaño
      expect(conteo.FINALISTA ?? 0).toBe(1);
      expect(conteo.SEMI ?? 0).toBeLessThanOrEqual(2);
      expect(conteo.CUARTOS ?? 0).toBeLessThanOrEqual(4);
      expect(conteo.OCTAVOS ?? 0).toBeLessThanOrEqual(8);
    });
  }
});

// "No se presentó": el ausente que nunca jugó un cruce de verdad no cobra el escalón al que lo
// llevaron los W.O.; el que jugó y después faltó cobra donde quedó afuera (como siempre).
describe('escalonDePareja con ausentes (One Point Challenge)', () => {
  const opc = (n: number, ausentes?: string[]): Torneo => ({
    id: 't', nombre: 'OPC', creadoEl: '2026-11-20T15:00:00.000Z', formato: 'individual', fase: 'terminado',
    parejas: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, nombre: `P${i + 1}` })),
    grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: armarLlaveRolling(Array.from({ length: n }, (_, i) => `p${i + 1}`)),
    ...(ausentes ? { ausentes } : {}),
  });
  const jugar = (t: Torneo, ronda: number, pos: number, lado: 'a' | 'b'): Torneo => {
    const p = t.partidosLlave!.find((x) => x.ronda === ronda && x.posicion === pos)!;
    return aplicarAusentes({ ...t, partidosLlave: cargarResultadoLlave(t.partidosLlave!, p.id, lado === 'a' ? 1 : 0, lado === 'a' ? 0 : 1).partidos });
  };

  it('dos ausentes en la semi: el que "pasó" por W.O. y perdió la final por W.O. no es finalista', () => {
    let t = aplicarAusentes(opc(4, ['p1', 'p2'])); // semi 1: pasa p1 (los dos ausentes)
    t = jugar(t, 1, 1, 'a'); // p3 le gana a p4 jugando; final p1 vs p3 → p3 por W.O.
    // hoy, sin la regla, el W.O. contaría como llegar a la final
    expect(escalonEnLlave(t.partidosLlave!, 'p1')).toBe('FINALISTA');
    expect(escalonDePareja(t, 'p1')).toBe('PARTICIPO');
    expect(escalonDePareja(t, 'p2')).toBe('PARTICIPO');
    expect(escalonDePareja(t, 'p3')).toBe('CAMPEON'); // campeón aunque la final fue W.O.
    expect(escalonDePareja(t, 'p4')).toBe('SEMI');
  });

  it('el que jugó y ganó, y después no se presentó, cobra donde quedó afuera', () => {
    let t = opc(4);
    t = jugar(t, 1, 0, 'a'); // p1 jugando
    t = jugar(t, 1, 1, 'a'); // p3 jugando
    t = aplicarAusentes({ ...t, ausentes: ['p1'] }); // final por W.O. para p3
    expect(escalonDePareja(t, 'p1')).toBe('FINALISTA');
    expect(escalonDePareja(t, 'p3')).toBe('CAMPEON');
  });

  it('sin el campo ausentes, un W.O. se paga como siempre', () => {
    let t = opc(4);
    t = jugar(t, 1, 0, 'a');
    t = { ...t, partidosLlave: t.partidosLlave!.map((p) => (p.ronda === 1 && p.posicion === 0 ? { ...p, wo: true } : p)) };
    expect(escalonDePareja(t, 'p2')).toBe('SEMI');
  });
});
