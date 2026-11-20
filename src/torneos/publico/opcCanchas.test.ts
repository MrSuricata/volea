import { describe, expect, it } from 'vitest';
import type { Torneo } from '../engine/tipos';
import { armarLlave } from '../engine/llave';
import { marcar } from '../ui/opc/modelo';
import { planOpc } from './opcCanchas';

function torneo(n: number): Torneo {
  const parejas = Array.from({ length: n }, (_, i) => ({ id: `j${i + 1}`, nombre: `JUGADOR ${i + 1}` }));
  return {
    id: 'opc', nombre: 'ONE POINT CHALLENGE', creadoEl: '2026-11-20T00:00:00.000Z', formato: 'individual', fase: 'llave',
    parejas, grupos: [], partidosGrupo: [], configLlave: null,
    partidosLlave: armarLlave(parejas.map((p) => ({ parejaId: p.id, grupoId: p.id })), false),
  };
}

describe('planOpc', () => {
  it('los byes quedan todos en la primera ronda', () => {
    for (const n of [5, 11, 20, 23, 32, 37, 57]) {
      const t = torneo(n);
      const conBye = (t.partidosLlave ?? []).filter((p) => p.a === null || p.b === null);
      expect(conBye.every((p) => p.ronda === 1)).toBe(true);
      const plan = planOpc(t);
      expect(plan.total).toBe(n - 1);
      expect(plan.pasanDirecto).toHaveLength(conBye.length);
      expect(plan.vivos).toBe(n);
    }
  });

  it('reparte las rondas grandes en 3 canchas y cierra en la Cancha 1', () => {
    const plan = planOpc(torneo(23));
    const canchasDe = (ronda: number) => new Set(plan.partidos.filter((p) => p.ronda === ronda).map((p) => p.cancha)).size;
    expect(canchasDe(1)).toBe(3); // 7 cruces
    expect(canchasDe(2)).toBe(3); // 8 cruces
    expect(canchasDe(3)).toBe(3); // cuartos
    expect(plan.partidos.filter((p) => p.ronda >= 4).every((p) => p.cancha === 1)).toBe(true); // semis y final
    expect(plan.canchas.map((c) => c.nombre)).toEqual(['Cancha 1', 'Cancha 2', 'Cancha 3']);
  });

  it('respeta la configuración del torneo (canchas y hasta qué ronda)', () => {
    const plan = planOpc({ ...torneo(23), opc: { canchas: 2, hastaRonda: 1 } });
    expect(new Set(plan.partidos.filter((p) => p.ronda === 1).map((p) => p.cancha)).size).toBe(2);
    expect(plan.partidos.filter((p) => p.ronda >= 2).every((p) => p.cancha === 1)).toBe(true);
  });

  it('se juega entero tocando siempre el cruce de cada cancha', () => {
    for (const n of [6, 20, 37]) {
      let t = torneo(n);
      let toques = 0;
      for (;;) {
        const plan = planOpc(t);
        if (plan.campeon) break;
        const conCruce = plan.canchas.filter((c) => c.ahora);
        expect(conCruce.length).toBeGreaterThan(0); // nunca queda trabado
        for (const c of conCruce) {
          expect(c.ahora?.estado).toBe('listo');
          t = { ...t, partidosLlave: marcar(t.partidosLlave ?? [], c.ahora!.id, toques % 2 ? 'a' : 'b', new Date(Date.UTC(2026, 10, 20, 0, 0, toques)).toISOString()) };
          toques += 1;
        }
      }
      const fin = planOpc(t);
      expect(toques).toBe(n - 1);
      expect(fin.jugados).toBe(n - 1);
      expect(fin.vivos).toBe(1);
      expect(fin.canchas).toHaveLength(0);
      expect(fin.subcampeon).not.toBeNull();
      expect(fin.resultados[0].nombreRonda).toBe('Final');
    }
  });
});
