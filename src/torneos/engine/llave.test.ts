import { describe, expect, it } from 'vitest';
import {
  armarLlave,
  borradosSiCorrijo,
  campeonDe,
  cargarResultadoLlave,
  ganadorPartido,
  ordenSeeds,
  podio,
  resolverSlot,
} from './llave';
import type { SeedInfo } from './llave';

function seeds(specs: [string, string][]): SeedInfo[] {
  return specs.map(([parejaId, grupoId]) => ({ parejaId, grupoId }));
}

describe('ordenSeeds', () => {
  it('genera el orden estándar de bracket', () => {
    expect(ordenSeeds(2)).toEqual([1, 2]);
    expect(ordenSeeds(4)).toEqual([1, 4, 2, 3]);
    expect(ordenSeeds(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe('armarLlave', () => {
  it('4 seeds sin byes: (s1 vs s4) y (s2 vs s3) + final', () => {
    const partidos = armarLlave(seeds([['p1', 'gA'], ['p2', 'gB'], ['p3', 'gC'], ['p4', 'gD']]), false);
    expect(partidos).toHaveLength(3);
    const r1 = partidos.filter((p) => p.ronda === 1);
    expect(resolverSlot(r1[0].a, partidos)).toBe('p1');
    expect(resolverSlot(r1[0].b, partidos)).toBe('p4');
    expect(resolverSlot(r1[1].a, partidos)).toBe('p2');
    expect(resolverSlot(r1[1].b, partidos)).toBe('p3');
    const final = partidos.find((p) => p.ronda === 2)!;
    expect(final.a).toEqual({ tipo: 'ganadorDe', partidoId: r1[0].id });
    expect(final.b).toEqual({ tipo: 'ganadorDe', partidoId: r1[1].id });
  });

  it('6 seeds: llave de 8 con byes para seeds 1 y 2, que avanzan solos', () => {
    const partidos = armarLlave(
      seeds([['p1', 'g1'], ['p2', 'g2'], ['p3', 'g3'], ['p4', 'g4'], ['p5', 'g5'], ['p6', 'g6']]),
      false,
    );
    const r1 = partidos.filter((p) => p.ronda === 1);
    expect(r1).toHaveLength(4);
    const conBye = r1.filter((p) => p.a === null || p.b === null);
    expect(conBye).toHaveLength(2);
    for (const p of conBye) {
      expect(ganadorPartido(p, partidos)).not.toBeNull(); // el que tiene bye avanza sin jugar
    }
    const ganadoresBye = conBye.map((p) => ganadorPartido(p, partidos)).sort();
    expect(ganadoresBye).toEqual(['p1', 'p2']);
  });

  it('swap anti mismo-grupo: evita p1-p4 del mismo grupo en primera ronda', () => {
    // seeds: p1(gA), p2(gB), p3(gB), p4(gA) -> apareo directo daría (p1 vs p4) y (p2 vs p3), ambos mismo grupo
    const partidos = armarLlave(seeds([['p1', 'gA'], ['p2', 'gB'], ['p3', 'gB'], ['p4', 'gA']]), false);
    const r1 = partidos.filter((p) => p.ronda === 1);
    for (const p of r1) {
      const a = resolverSlot(p.a, partidos)!;
      const b = resolverSlot(p.b, partidos)!;
      const grupoDe: Record<string, string> = { p1: 'gA', p2: 'gB', p3: 'gB', p4: 'gA' };
      expect(grupoDe[a]).not.toBe(grupoDe[b]);
    }
  });
});

describe('resultados y avance', () => {
  it('el ganador de una semi aparece en la final; el campeón sale de la final', () => {
    let partidos = armarLlave(seeds([['p1', 'gA'], ['p2', 'gB'], ['p3', 'gC'], ['p4', 'gD']]), false);
    const r1 = partidos.filter((p) => p.ronda === 1);
    partidos = cargarResultadoLlave(partidos, r1[0].id, 11, 7).partidos; // gana p1
    partidos = cargarResultadoLlave(partidos, r1[1].id, 9, 11).partidos; // gana p3
    const final = partidos.find((p) => p.ronda === 2)!;
    expect(resolverSlot(final.a, partidos)).toBe('p1');
    expect(resolverSlot(final.b, partidos)).toBe('p3');
    expect(campeonDe(partidos)).toBeNull(); // final sin jugar
    partidos = cargarResultadoLlave(partidos, final.id, 11, 5).partidos;
    expect(campeonDe(partidos)).toBe('p1');
  });

  it('corregir un resultado que cambia el ganador borra los partidos posteriores', () => {
    let partidos = armarLlave(seeds([['p1', 'gA'], ['p2', 'gB'], ['p3', 'gC'], ['p4', 'gD']]), false);
    const r1 = partidos.filter((p) => p.ronda === 1);
    partidos = cargarResultadoLlave(partidos, r1[0].id, 11, 7).partidos;
    partidos = cargarResultadoLlave(partidos, r1[1].id, 11, 7).partidos;
    const final = partidos.find((p) => p.ronda === 2)!;
    partidos = cargarResultadoLlave(partidos, final.id, 11, 9).partidos; // campeón p1
    // dry-run: corregir la semi 1 invirtiendo el ganador borraría 1 partido (la final)
    expect(borradosSiCorrijo(partidos, r1[0].id, 5, 11)).toBe(1);
    // corregir solo el marcador (mismo ganador) no borra nada
    expect(borradosSiCorrijo(partidos, r1[0].id, 15, 13)).toBe(0);
    const resultado = cargarResultadoLlave(partidos, r1[0].id, 5, 11); // ahora gana p4
    expect(resultado.borrados).toBe(1);
    const finalDespues = resultado.partidos.find((p) => p.ronda === 2)!;
    expect(finalDespues.puntosA).toBeNull();
    expect(campeonDe(resultado.partidos)).toBeNull();
    expect(resolverSlot(finalDespues.a, resultado.partidos)).toBe('p4');
  });

  it('tercer puesto: perdedores de semis, y el podio queda completo', () => {
    let partidos = armarLlave(seeds([['p1', 'gA'], ['p2', 'gB'], ['p3', 'gC'], ['p4', 'gD']]), true);
    expect(partidos).toHaveLength(4);
    const tercero = partidos.find((p) => p.esTercerPuesto)!;
    const r1 = partidos.filter((p) => p.ronda === 1 && !p.esTercerPuesto);
    partidos = cargarResultadoLlave(partidos, r1[0].id, 11, 7).partidos; // gana p1, pierde p4
    partidos = cargarResultadoLlave(partidos, r1[1].id, 11, 7).partidos; // gana p2, pierde p3
    expect(resolverSlot(tercero.a, partidos)).toBe('p4');
    expect(resolverSlot(tercero.b, partidos)).toBe('p3');
    const final = partidos.find((p) => p.ronda === 2 && !p.esTercerPuesto)!;
    partidos = cargarResultadoLlave(partidos, final.id, 11, 3).partidos; // campeón p1
    partidos = cargarResultadoLlave(partidos, tercero.id, 7, 11).partidos; // tercero p3
    expect(podio(partidos)).toEqual({ campeon: 'p1', subcampeon: 'p2', tercero: 'p3' });
  });

  it('llave de 2 (final directa)', () => {
    let partidos = armarLlave(seeds([['p1', 'gA'], ['p2', 'gB']]), false);
    expect(partidos).toHaveLength(1);
    partidos = cargarResultadoLlave(partidos, partidos[0].id, 11, 8).partidos;
    expect(campeonDe(partidos)).toBe('p1');
  });

  it('3 seeds + tercer puesto: el bronce va solo al perdedor de la única semi real', () => {
    let partidos = armarLlave(seeds([['p1', 'gA'], ['p2', 'gB'], ['p3', 'gC']]), true);
    const tercero = partidos.find((p) => p.esTercerPuesto)!;
    expect(tercero.a).toBeNull(); // la semi con bye no tiene perdedor
    const semiReal = partidos.find((p) => p.ronda === 1 && p.a !== null && p.b !== null && !p.esTercerPuesto)!;
    partidos = cargarResultadoLlave(partidos, semiReal.id, 11, 7).partidos; // gana p2, pierde p3
    expect(ganadorPartido(partidos.find((x) => x.esTercerPuesto)!, partidos)).toBe('p3');
    const final = partidos.find((p) => p.ronda === 2 && !p.esTercerPuesto)!;
    partidos = cargarResultadoLlave(partidos, final.id, 11, 9).partidos;
    expect(podio(partidos)).toEqual({ campeon: 'p1', subcampeon: 'p2', tercero: 'p3' });
  });

  it('no se puede cargar resultado en un partido sin participantes definidos', () => {
    const partidos = armarLlave(seeds([['p1', 'gA'], ['p2', 'gB'], ['p3', 'gC'], ['p4', 'gD']]), false);
    const final = partidos.find((p) => p.ronda === 2)!;
    const resultado = cargarResultadoLlave(partidos, final.id, 11, 5);
    expect(resultado.partidos.find((p) => p.ronda === 2)!.puntosA).toBeNull(); // rechazado
    expect(resultado.borrados).toBe(0);
  });

  it('corrección multinivel: cuartos corregidos borran semi, final y 3er puesto', () => {
    let partidos = armarLlave(seeds([
      ['p1', 'g1'], ['p2', 'g2'], ['p3', 'g3'], ['p4', 'g4'],
      ['p5', 'g5'], ['p6', 'g6'], ['p7', 'g7'], ['p8', 'g8'],
    ]), true);
    // jugar todo (siempre gana el lado a); la ronda 3 incluye final y 3er puesto
    for (const ronda of [1, 2, 3]) {
      for (const p of partidos.filter((x) => x.ronda === ronda)) {
        partidos = cargarResultadoLlave(partidos, p.id, 11, 5).partidos;
      }
    }
    expect(podio(partidos).campeon).not.toBeNull();
    const cuarto0 = partidos.filter((p) => p.ronda === 1).sort((a, b) => a.posicion - b.posicion)[0];
    expect(borradosSiCorrijo(partidos, cuarto0.id, 3, 11)).toBe(3); // semi + final + 3er puesto
    const corregido = cargarResultadoLlave(partidos, cuarto0.id, 3, 11);
    expect(corregido.borrados).toBe(3);
    expect(campeonDe(corregido.partidos)).toBeNull();
  });
});
