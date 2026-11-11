import { describe, expect, it } from 'vitest';
import { armarLlaveRolling } from '../../engine/llaveIndividual';
import { campeonDe } from '../../engine/llave';
import { armarModelo, borradosSiMarco, cruceInicial, describirLugar, limpiarListaJugadores, marcar, nombreRonda, proximoListo } from './modelo';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const AHORA = '2026-11-20T15:00:00.000Z';

describe('armarModelo', () => {
  it('13 jugadores: rondas 6/3/2/1, quién pasa directo en cada ronda y nombres', () => {
    const m = armarModelo(armarLlaveRolling(ids(13)));
    expect(m.rondas.map((r) => r.cruces.length)).toEqual([6, 3, 2, 1]);
    expect(m.rondas.map((r) => r.vivos)).toEqual([13, 7, 4, 2]);
    expect(m.rondas.map((r) => r.nombre)).toEqual(['Ronda 1', 'Ronda 2', 'Semifinal', 'Final']);
    expect(m.rondas[0].pasaDirecto?.id).toBe('p13'); // el 13 zafa la ronda 1
    expect(m.rondas[1].pasaDirecto?.id).toBeNull(); // en la ronda 2 zafa el ganador del cruce 6 (todavía no se sabe)
    expect(describirLugar(m, m.rondas[1].pasaDirecto!.slot)).toBe('Ganador del cruce 6 · Ronda 1');
    expect(m.rondas[2].pasaDirecto).toBeNull();
    expect(m.total).toBe(12);
    expect(m.jugados).toBe(0);
    expect(m.rondaActual).toBe(1);
    expect(m.cruces.map((c) => c.orden)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(m.cruces.filter((c) => c.estado === 'listo')).toHaveLength(6);
    expect(m.cruces[6].numero).toBe(1);
    expect(m.cruces[6].deRonda).toBe(3);
  });

  it('3 jugadores: semifinal con uno que pasa directo a la final', () => {
    const m = armarModelo(armarLlaveRolling(ids(3)));
    expect(m.rondas.map((r) => r.nombre)).toEqual(['Semifinal', 'Final']);
    expect(m.rondas[0].pasaDirecto?.id).toBe('p3');
  });

  it('nombreRonda por vivos', () => {
    expect(nombreRonda(2, 6)).toBe('Final');
    expect(nombreRonda(3, 5)).toBe('Semifinal');
    expect(nombreRonda(4, 3)).toBe('Semifinal');
    expect(nombreRonda(5, 4)).toBe('Ronda 4');
  });
});

describe('marcar y avanzar', () => {
  it('un toque guarda 1-0 con la hora, avanza y se juega hasta el campeón', () => {
    let ps = armarLlaveRolling(ids(5));
    let m = armarModelo(ps);
    let actual = cruceInicial(m, null);
    let vueltas = 0;
    while (actual && actual.estado === 'listo') {
      ps = marcar(ps, actual.partido.id, 'a', AHORA);
      const p = ps.find((x) => x.id === actual!.partido.id)!;
      expect([p.puntosA, p.puntosB, p.cargadoEl]).toEqual([1, 0, AHORA]);
      m = armarModelo(ps);
      actual = proximoListo(m, actual.partido.id);
      vueltas += 1;
    }
    expect(vueltas).toBe(4);
    expect(m.jugados).toBe(4);
    // siempre gana "arriba": R1 p1 y p3 (p5 zafa); R2 p5 le gana a p1 (p3 zafa); final p3 vs p5
    expect(campeonDe(ps)).toBe('p3');
    expect(m.campeon).toBe('p3');
    expect(m.subcampeon).toBe('p5');
  });

  it('proximoListo da la vuelta y respeta el excluido', () => {
    const ps = armarLlaveRolling(ids(8));
    const m = armarModelo(ps);
    const r1 = m.rondas[0].cruces;
    expect(proximoListo(m, r1[3].partido.id)?.partido.id).toBe(r1[0].partido.id);
    expect(proximoListo(m, r1[0].partido.id)?.partido.id).toBe(r1[1].partido.id);
    expect(proximoListo(m, null, [r1[0].partido.id])?.partido.id).toBe(r1[1].partido.id);
  });

  it('corregir: cambiar el ganador avisa cuántos se borran; deshacer saca la hora', () => {
    let ps = armarLlaveRolling(ids(4));
    const [c1, c2] = armarModelo(ps).rondas[0].cruces;
    ps = marcar(ps, c1.partido.id, 'a', AHORA);
    ps = marcar(ps, c2.partido.id, 'a', AHORA);
    const final = armarModelo(ps).rondas[1].cruces[0];
    ps = marcar(ps, final.partido.id, 'b', AHORA);
    expect(borradosSiMarco(ps, c1.partido.id, 'a')).toBe(0);
    expect(borradosSiMarco(ps, c1.partido.id, 'b')).toBe(1);
    expect(borradosSiMarco(ps, c1.partido.id, null)).toBe(1);
    const corregido = marcar(ps, c1.partido.id, 'b', '2026-11-20T16:00:00.000Z');
    expect(corregido.find((p) => p.id === c1.partido.id)!.cargadoEl).toBe(AHORA); // conserva la primera carga
    expect(corregido.find((p) => p.id === final.partido.id)!.puntosA).toBeNull();
    const deshecho = marcar(ps, c2.partido.id, null, AHORA);
    const p2 = deshecho.find((p) => p.id === c2.partido.id)!;
    expect([p2.puntosA, p2.puntosB, 'cargadoEl' in p2]).toEqual([null, null, false]);
  });

  it('cruceInicial: el guardado si existe; si no, el primero para jugar', () => {
    const m = armarModelo(armarLlaveRolling(ids(6)));
    expect(cruceInicial(m, 'no-existe')?.orden).toBe(1);
    expect(cruceInicial(m, m.cruces[2].partido.id)?.orden).toBe(3);
  });
});

describe('limpiarListaJugadores', () => {
  it('saca numeración, viñetas, espacios y líneas vacías', () => {
    expect(limpiarListaJugadores('1. Ana Pérez\n2) Beto\n\n - Carla  Gómez \n• Diego\n10- Elena\n3 Mosqueteros\nJuan-Pablo')).toEqual([
      'Ana Pérez', 'Beto', 'Carla Gómez', 'Diego', 'Elena', '3 Mosqueteros', 'Juan-Pablo',
    ]);
  });
});
