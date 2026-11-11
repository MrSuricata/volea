import { describe, expect, it } from 'vitest';
import { jugarTodo } from './llaveIndividual.prueba';
import { borradosSiCorrijo, campeonDe, cargarResultadoLlave, ganadorPartido, podio, resolverSlot } from './llave';
import type { PartidoLlave } from './tipos';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

const perdedorDe = (p: PartidoLlave, ps: PartidoLlave[]) => {
  const a = resolverSlot(p.a, ps);
  const b = resolverSlot(p.b, ps);
  return ganadorPartido(p, ps) === a ? b : a;
};

describe('armarLlaveRolling: invariantes de 2 a 64 jugadores', () => {
  for (let n = 2; n <= 64; n++) {
    it(`${n} jugadores`, () => {
      for (const semilla of [1, 7, 42]) {
        const ps = jugarTodo(n, semilla);
        expect(ps).toHaveLength(n - 1); // n-1 partidos
        const rondas = Math.max(...ps.map((p) => p.ronda));
        expect(rondas).toBe(Math.ceil(Math.log2(n)));
        expect(ps.every((p) => p.puntosA !== null)).toBe(true); // se pudo jugar todo
        const campeon = campeonDe(ps);
        expect(campeon).not.toBeNull();
        const perdedores = ps.map((p) => perdedorDe(p, ps));
        expect(new Set(perdedores).size).toBe(n - 1); // cada uno pierde una sola vez
        expect(perdedores).not.toContain(campeon); // un solo invicto: el campeón
        let vivos = new Set(ids(n));
        let zafoAntes: string | null = null;
        for (let r = 1; r <= rondas; r++) {
          const deRonda = ps.filter((p) => p.ronda === r);
          const juegan = deRonda.flatMap((p) => [resolverSlot(p.a, ps)!, resolverSlot(p.b, ps)!]);
          expect(new Set(juegan).size).toBe(juegan.length); // nadie juega dos veces en la ronda
          expect(juegan.every((id) => vivos.has(id))).toBe(true); // solo juegan los vivos
          const zafan = [...vivos].filter((id) => !juegan.includes(id));
          expect(zafan.length).toBe(vivos.size % 2); // zafa uno solo, y solo con número impar
          if (zafoAntes !== null) expect(zafan).not.toContain(zafoAntes); // nunca dos rondas seguidas
          zafoAntes = zafan[0] ?? null;
          vivos = new Set([...zafan, ...deRonda.map((p) => ganadorPartido(p, ps)!)]);
        }
        expect([...vivos]).toEqual([campeon]);
        const jugaron = new Set(ps.flatMap((p) => [resolverSlot(p.a, ps), resolverSlot(p.b, ps)]));
        expect(jugaron.size).toBe(n); // todos juegan al menos un cruce
      }
    });
  }
});

describe('OPC: corrección en cascada y podio', () => {
  it('cambiar un cruce de la ronda 1 con la llave terminada borra exactamente su camino', () => {
    const ps = jugarTodo(13, 3);
    const r1 = ps.find((p) => p.ronda === 1)!;
    const n = borradosSiCorrijo(ps, r1.id, r1.puntosB, r1.puntosA);
    const res = cargarResultadoLlave(ps, r1.id, r1.puntosB, r1.puntosA);
    expect(n).toBeGreaterThan(0);
    expect(res.borrados).toBe(n);
    expect(res.partidos.filter((p) => p.puntosA === null)).toHaveLength(n);
    expect(campeonDe(res.partidos)).toBeNull();
    // el nuevo ganador queda en el cruce siguiente, listo para jugarse
    const nuevo = ganadorPartido(res.partidos.find((p) => p.id === r1.id)!, res.partidos);
    const sig = res.partidos.find((p) => [p.a, p.b].some((s) => s?.tipo === 'ganadorDe' && s.partidoId === r1.id))!;
    expect([resolverSlot(sig.a, res.partidos), resolverSlot(sig.b, res.partidos)]).toContain(nuevo);
    expect(sig.puntosA).toBeNull();
  });

  it('corregir sin cambiar el ganador no borra nada; borrar el resultado sí', () => {
    const ps = jugarTodo(9, 5);
    const r1 = ps.find((p) => p.ronda === 1)!;
    expect(borradosSiCorrijo(ps, r1.id, r1.puntosA, r1.puntosB)).toBe(0);
    expect(borradosSiCorrijo(ps, r1.id, null, null)).toBeGreaterThan(0);
  });

  it('podio: campeón y subcampeón salen de la final; sin tercer puesto', () => {
    for (const n of [2, 3, 5, 13, 32, 50]) {
      const ps = jugarTodo(n, 11);
      const r = podio(ps);
      const final = ps.find((p) => p.ronda === Math.max(...ps.map((x) => x.ronda)))!;
      const enFinal = [resolverSlot(final.a, ps), resolverSlot(final.b, ps)];
      expect(enFinal).toContain(r.campeon);
      expect(enFinal).toContain(r.subcampeon);
      expect(r.campeon).not.toBe(r.subcampeon);
      expect(r.tercero).toBeNull();
    }
  });
});
