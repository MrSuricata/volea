import { describe, expect, it } from 'vitest';
import { escalonEnLlave } from './ranking';
import { ganadorPartido, resolverSlot } from './llave';
import type { Escalon } from './tipos';
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
