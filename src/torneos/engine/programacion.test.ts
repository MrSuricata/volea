import { describe, expect, it } from 'vitest';
import { repartirEnCanchas } from './programacion';
import type { PartidoAProgramar, TurnoProgramado } from './programacion';

const DOS = [{ nombre: 'Cancha 1', libreDesde: 0 }, { nombre: 'Cancha 2', libreDesde: 0 }];

const partido = (id: string, jugadores: string[], extra: Partial<PartidoAProgramar> = {}): PartidoAProgramar => ({
  id, jugadores, despuesDe: [], noAntes: 0, prioridad: 0, nivel: 1, ...extra,
});

// Un grupo de 3 (todos contra todos): tres partidos que nunca pueden jugarse a la vez.
const grupoDe3 = (pre: string, [a, b, c]: string[], extra: Partial<PartidoAProgramar> = {}) => [
  partido(`${pre}1`, [a, b], { nivel: 3, ...extra }),
  partido(`${pre}2`, [a, c], { nivel: 2, ...extra }),
  partido(`${pre}3`, [b, c], { nivel: 1, ...extra }),
];

const turnoDe = (turnos: TurnoProgramado[], id: string) => turnos.find((t) => t.id === id)!;

describe('repartirEnCanchas', () => {
  it('llena las dos canchas mezclando categorías: dos grupos de 3 se juegan en una hora', () => {
    const { turnos, sinLugar } = repartirEnCanchas(
      [...grupoDe3('x', ['ana', 'bea', 'caro']), ...grupoDe3('y', ['dani', 'eli', 'flor'])],
      DOS, { duracion: 20 },
    );
    expect(sinLugar).toEqual([]);
    expect(turnos.map((t) => `${t.inicio} ${t.cancha} ${t.id}`)).toEqual([
      '0 Cancha 1 x1', '0 Cancha 2 y1',
      '20 Cancha 1 x2', '20 Cancha 2 y2',
      '40 Cancha 1 x3', '40 Cancha 2 y3',
    ]);
  });

  it('una sola categoría con un grupo de 3 ocupa una cancha: la otra queda libre porque no hay qué jugar', () => {
    const { turnos } = repartirEnCanchas(grupoDe3('x', ['ana', 'bea', 'caro']), DOS, { duracion: 20 });
    expect(turnos.map((t) => t.inicio)).toEqual([0, 20, 40]);
  });

  it('nadie queda citado en dos canchas a la vez aunque juegue dos categorías', () => {
    const { turnos } = repartirEnCanchas(
      [partido('singles', ['ana', 'bea']), partido('mas50', ['ana', 'caro']), partido('otro', ['dani', 'eli'])],
      DOS, { duracion: 20 },
    );
    expect(turnoDe(turnos, 'singles').inicio).toBe(0);
    expect(turnoDe(turnos, 'otro').inicio).toBe(0);
    expect(turnoDe(turnos, 'mas50').inicio).toBe(20);
  });

  it('la final no arranca antes de que terminen las dos semis', () => {
    const { turnos } = repartirEnCanchas(
      [
        partido('final', [], { despuesDe: ['sf1', 'sf2'], nivel: 1 }),
        partido('sf1', ['ana', 'bea'], { nivel: 2 }),
        partido('sf2', ['caro', 'dani'], { nivel: 2 }),
      ],
      DOS, { duracion: 20 },
    );
    expect(turnoDe(turnos, 'sf1').inicio).toBe(0);
    expect(turnoDe(turnos, 'sf2').inicio).toBe(0);
    expect(turnoDe(turnos, 'final').inicio).toBe(20);
  });

  it('una categoría no arranca antes de su hora y mientras tanto juegan las otras', () => {
    const { turnos } = repartirEnCanchas(
      [partido('tarde', ['ana', 'bea'], { noAntes: 60, nivel: 9 }), ...grupoDe3('x', ['caro', 'dani', 'eli'])],
      DOS, { duracion: 20 },
    );
    expect(turnoDe(turnos, 'tarde').inicio).toBe(60);
    expect(turnoDe(turnos, 'x1').inicio).toBe(0);
  });

  it('si no hay nada para jugar la cancha espera, y arranca apenas llega la hora', () => {
    const { turnos } = repartirEnCanchas([partido('p', ['ana', 'bea'], { noAntes: 45 })], DOS, { duracion: 20 });
    expect(turnos).toEqual([{ id: 'p', cancha: 'Cancha 1', inicio: 45, fin: 65 }]);
  });

  it('dentro de una categoría va primero la etapa más temprana', () => {
    const { turnos } = repartirEnCanchas(
      [partido('ronda3', ['ana', 'bea'], { nivel: 1 }), partido('ronda1', ['caro', 'dani'], { nivel: 3 })],
      [{ nombre: 'Cancha 1', libreDesde: 0 }], { duracion: 20 },
    );
    expect(turnos.map((t) => t.id)).toEqual(['ronda1', 'ronda3']);
  });

  it('la categoría que va primero en el día pasa antes, tenga las etapas que tenga', () => {
    const { turnos } = repartirEnCanchas(
      [partido('segunda', ['ana', 'bea'], { prioridad: 1, nivel: 9 }), partido('primera', ['caro', 'dani'], { prioridad: 0, nivel: 1 })],
      [{ nombre: 'Cancha 1', libreDesde: 0 }], { duracion: 20 },
    );
    expect(turnos.map((t) => t.id)).toEqual(['primera', 'segunda']);
  });

  it('dos categorías se alternan para descansar y la primera termina primero', () => {
    // dos grupos de 4 (todos juegan en cada ronda): sin la otra categoría jugarían tres seguidos
    const rondas = (pre: string, [a, b, c, d]: string[], prioridad: number) => [
      partido(`${pre}1a`, [a, d], { nivel: 3, prioridad }), partido(`${pre}1b`, [b, c], { nivel: 3, prioridad }),
      partido(`${pre}2a`, [a, c], { nivel: 2, prioridad }), partido(`${pre}2b`, [d, b], { nivel: 2, prioridad }),
      partido(`${pre}3a`, [a, b], { nivel: 1, prioridad }), partido(`${pre}3b`, [c, d], { nivel: 1, prioridad }),
    ];
    const { turnos } = repartirEnCanchas(
      [...rondas('x', ['ana', 'bea', 'caro', 'dani'], 0), ...rondas('y', ['eli', 'flor', 'gabi', 'ines'], 1)],
      DOS, { duracion: 20 },
    );
    const porTanda = [0, 20, 40, 60, 80, 100].map((t) => turnos.filter((x) => x.inicio === t).map((x) => x.id[0]).join(''));
    expect(porTanda).toEqual(['xx', 'yy', 'xx', 'yy', 'xx', 'yy']);
  });

  it('le da aire al que acaba de jugar si hay otro partido para poner', () => {
    // una cancha: ana acaba de jugar; aunque su segundo partido tiene más nivel, pasa el de las descansadas
    const { turnos } = repartirEnCanchas(
      [
        partido('ana1', ['ana', 'bea'], { nivel: 5 }),
        partido('ana2', ['ana', 'caro'], { nivel: 4 }),
        partido('otras', ['dani', 'eli'], { nivel: 1, prioridad: 1 }),
      ],
      [{ nombre: 'Cancha 1', libreDesde: 0 }], { duracion: 20 },
    );
    expect(turnos.map((t) => t.id)).toEqual(['ana1', 'otras', 'ana2']);
  });

  it('la final no va pegada a las semis si hay otra cosa para jugar', () => {
    const { turnos } = repartirEnCanchas(
      [
        partido('sf1', ['ana', 'bea'], { nivel: 2 }), partido('sf2', ['caro', 'dani'], { nivel: 2 }),
        partido('final', [], { despuesDe: ['sf1', 'sf2'], nivel: 1 }),
        partido('otra1', ['eli', 'flor'], { prioridad: 1 }), partido('otra2', ['gabi', 'ines'], { prioridad: 1 }),
      ],
      DOS, { duracion: 20 },
    );
    expect(turnos.map((t) => `${t.inicio} ${t.id}`)).toEqual(['0 sf1', '0 sf2', '20 otra1', '20 otra2', '40 final']);
  });

  it('pero no deja una cancha vacía por el descanso: si es lo único que hay, se juega', () => {
    const { turnos } = repartirEnCanchas(
      [partido('ana1', ['ana', 'bea']), partido('ana2', ['ana', 'caro'])],
      [{ nombre: 'Cancha 1', libreDesde: 0 }], { duracion: 20 },
    );
    expect(turnos.map((t) => t.inicio)).toEqual([0, 20]);
  });

  it('lo que quedó colgado de otro día pasa primero', () => {
    const { turnos } = repartirEnCanchas(
      [partido('hoy', ['ana', 'bea'], { nivel: 9 }), partido('ayer', ['caro', 'dani'], { nivel: 1, prioridad: 5, urgente: true })],
      [{ nombre: 'Cancha 1', libreDesde: 0 }], { duracion: 20 },
    );
    expect(turnos.map((t) => t.id)).toEqual(['ayer', 'hoy']);
  });

  it('cada cancha arranca cuando se libera', () => {
    const { turnos } = repartirEnCanchas(
      [partido('a', ['ana', 'bea']), partido('b', ['caro', 'dani'])],
      [{ nombre: 'Cancha 1', libreDesde: 30 }, { nombre: 'Cancha 2', libreDesde: 10 }], { duracion: 20 },
    );
    expect(turnos).toEqual([
      { id: 'a', cancha: 'Cancha 2', inicio: 10, fin: 30 },
      { id: 'b', cancha: 'Cancha 1', inicio: 30, fin: 50 },
    ]);
  });

  it('lo que se está jugando ocupa a sus jugadores y destraba lo que depende de él', () => {
    const { turnos } = repartirEnCanchas(
      [
        partido('final', [], { despuesDe: ['sf-en-juego'] }),
        partido('otro-de-ana', ['ana', 'eli']),
        partido('libre', ['flor', 'gabi']),
      ],
      [{ nombre: 'Cancha 1', libreDesde: 15 }, { nombre: 'Cancha 2', libreDesde: 0 }],
      { duracion: 20, enJuego: [{ id: 'sf-en-juego', jugadores: ['ana', 'bea'], termina: 15 }] },
    );
    expect(turnoDe(turnos, 'libre')).toEqual({ id: 'libre', cancha: 'Cancha 2', inicio: 0, fin: 20 });
    expect(turnoDe(turnos, 'final').inicio).toBe(15);
    expect(turnoDe(turnos, 'otro-de-ana').inicio).toBeGreaterThanOrEqual(15);
  });

  it('no pone partidos que pisen una ventana bloqueada (One Point Challenge)', () => {
    const { turnos } = repartirEnCanchas(
      [partido('a', ['ana', 'bea']), partido('b', ['caro', 'dani']), partido('c', ['eli', 'flor']), partido('d', ['gabi', 'ines'])],
      DOS, { duracion: 20, bloqueos: [{ desde: 30, hasta: 90 }] },
    );
    // entra una tanda antes (0-20); la siguiente pisaría el bloque (20-40) y espera a que termine
    expect(turnos.map((t) => t.inicio)).toEqual([0, 0, 90, 90]);
  });

  it('avisa lo que no puede ubicar en vez de colgarse', () => {
    const { turnos, sinLugar } = repartirEnCanchas(
      [partido('a', ['ana', 'bea'], { despuesDe: ['b'] }), partido('b', ['caro', 'dani'], { despuesDe: ['a'] }), partido('c', ['eli', 'flor'])],
      DOS, { duracion: 20 },
    );
    expect(turnos.map((t) => t.id)).toEqual(['c']);
    expect(sinLugar).toEqual(['a', 'b']);
  });

  it('una dependencia que no está en la lista se da por terminada', () => {
    const { turnos } = repartirEnCanchas([partido('final', [], { despuesDe: ['semi-ya-jugada'] })], DOS, { duracion: 20 });
    expect(turnos[0].inicio).toBe(0);
  });

  it('sin canchas no programa nada', () => {
    expect(repartirEnCanchas([partido('a', ['ana', 'bea'])], [], { duracion: 20 })).toEqual({ turnos: [], sinLugar: ['a'] });
  });

  it('rechaza una duración que no sirve', () => {
    expect(() => repartirEnCanchas([], DOS, { duracion: 0 })).toThrow();
  });

  it('un viernes entero: nunca hay una cancha parada con un partido listo para jugar', () => {
    // 4 categorías de singles con gente repetida entre categorías, como el aniversario
    const categorias: { pre: string; gente: string[]; noAntes: number }[] = [
      { pre: 'mA', gente: ['gaston', 'brian', 'fabian', 'enzo', 'facu'], noAntes: 0 },
      { pre: 'mB', gente: ['emilio', 'fabian', 'maxi', 'mauro', 'hernan', 'joaquin'], noAntes: 0 },
      { pre: 'fe', gente: ['paula', 'matilde', 'tatiana', 'mia'], noAntes: 0 },
      { pre: '50', gente: ['omar', 'gustavo', 'hernan', 'shai'], noAntes: 40 },
    ];
    const partidos: PartidoAProgramar[] = [];
    for (const [prioridad, c] of categorias.entries()) {
      const deGrupo: string[] = [];
      const rondas = c.gente.length % 2 === 0 ? c.gente.length - 1 : c.gente.length;
      let k = 0;
      for (let i = 0; i < c.gente.length; i++) {
        for (let j = i + 1; j < c.gente.length; j++) {
          const id = `${c.pre}-g${k++}`;
          deGrupo.push(id);
          partidos.push(partido(id, [c.gente[i], c.gente[j]], { noAntes: c.noAntes, prioridad, nivel: 1 + Math.max(1, rondas - (k % rondas)) }));
        }
      }
      partidos.push(partido(`${c.pre}-final`, [], { despuesDe: deGrupo, noAntes: c.noAntes, prioridad, nivel: 1 }));
    }
    const { turnos, sinLugar } = repartirEnCanchas(partidos, DOS, { duracion: 20 });
    expect(sinLugar).toEqual([]);
    expect(turnos).toHaveLength(partidos.length);

    const porId = new Map(partidos.map((p) => [p.id, p]));
    const cuando = new Map(turnos.map((t) => [t.id, t]));
    // una cancha, un partido a la vez
    for (const cancha of ['Cancha 1', 'Cancha 2']) {
      const suyos = turnos.filter((t) => t.cancha === cancha).sort((a, b) => a.inicio - b.inicio);
      for (let i = 1; i < suyos.length; i++) expect(suyos[i].inicio).toBeGreaterThanOrEqual(suyos[i - 1].fin);
    }
    // nadie en dos partidos a la vez, y cada partido después de los que espera
    for (const t of turnos) {
      const p = porId.get(t.id)!;
      expect(t.inicio).toBeGreaterThanOrEqual(p.noAntes);
      for (const d of p.despuesDe) expect(cuando.get(d)!.fin).toBeLessThanOrEqual(t.inicio);
      for (const otro of turnos) {
        if (otro.id === t.id || otro.inicio !== t.inicio) continue;
        expect(porId.get(otro.id)!.jugadores.filter((j) => p.jugadores.includes(j))).toEqual([]);
      }
    }
    // en cada tanda con una cancha vacía, ningún partido de los que faltaban se podía jugar
    const fin = Math.max(...turnos.map((t) => t.fin));
    for (let t = 0; t < fin; t += 20) {
      const jugando = turnos.filter((x) => x.inicio <= t && t < x.fin);
      if (jugando.length === 2) continue;
      const ocupados = new Set(jugando.flatMap((x) => porId.get(x.id)!.jugadores));
      const sePodia = turnos.filter((x) => x.inicio > t).filter((x) => {
        const p = porId.get(x.id)!;
        return p.noAntes <= t
          && p.despuesDe.every((d) => cuando.get(d)!.fin <= t)
          && p.jugadores.every((j) => !ocupados.has(j));
      });
      expect(sePodia.map((x) => x.id)).toEqual([]);
    }
  });
});
