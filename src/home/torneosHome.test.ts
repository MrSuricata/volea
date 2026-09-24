import { describe, expect, it, vi } from 'vitest';
import type { Jugador, Pareja } from '../torneos/engine/tipos';
import { CONFIG_PUNTOS_DEFAULT } from '../torneos/engine/tipos';
import type { TorneoPublico } from '../torneos/publico/datos';
import { hayContenido, nombreCortoCategoria, nombrePropio, partirNombreEvento, resumenTorneosHome } from './torneosHome';

// datos.ts importa el cliente de Supabase, que al cargarse sale a chequear la red.
// Acá solo se usan sus funciones puras (agruparPorEvento, torneoEnVivo). vi.mock se
// eleva por encima de los imports.
vi.mock('../services/supabaseClient', () => ({ supabase: null }));

const AHORA = Date.parse('2026-09-24T15:00:00.000Z');
const HACE_UNA_HORA = new Date(AHORA - 60 * 60 * 1000).toISOString();
const HACE_DIAS = '2026-09-01T12:00:00.000Z';

type Opciones = {
  id: string;
  nombre: string;
  evento: string | null;
  creadoEl?: string;
  /** p1 le gana la final a p2 (terminado); false = torneo a medio jugar, sin campeón. */
  terminado?: boolean;
  individual?: boolean;
  categoria?: 'A' | 'B';
  parejas?: Pareja[];
  updatedAt?: string | null;
};

// Torneo mínimo válido: dos parejas y una final (p1 le gana a p2 si está terminado).
function torneo(o: Opciones): TorneoPublico {
  const terminado = o.terminado ?? true;
  return {
    id: o.id,
    nombre: o.nombre,
    creadoEl: o.creadoEl ?? '2026-08-21T23:00:00.000Z',
    formato: o.individual ? 'individual' : 'grupos',
    fase: terminado ? 'terminado' : 'llave',
    parejas: o.parejas ?? [
      { id: 'p1', nombre: 'ANA PÉREZ y LUIS DÍAZ', jugadorIds: ['ana', 'luis'] },
      { id: 'p2', nombre: 'SOFÍA RUIZ y PEDRO GÓMEZ', jugadorIds: ['sofia', 'pedro'] },
    ],
    grupos: [],
    partidosGrupo: [],
    configLlave: null,
    partidosLlave: [
      {
        id: `${o.id}-final`, ronda: 1, posicion: 0,
        a: { tipo: 'seed', parejaId: 'p1' }, b: { tipo: 'seed', parejaId: 'p2' },
        puntosA: terminado ? 11 : null, puntosB: terminado ? 6 : null, esTercerPuesto: false,
      },
    ],
    categoria: o.categoria ?? 'A',
    evento: o.evento,
    updatedAt: o.updatedAt ?? HACE_DIAS,
  };
}

const JUGADORES: Jugador[] = [
  { id: 'ana', nombre: 'ANA PÉREZ' },
  { id: 'luis', nombre: 'LUIS DÍAZ DE LEÓN' },
  { id: 'sofia', nombre: 'SOFÍA RUIZ' },
  { id: 'pedro', nombre: 'PEDRO GÓMEZ' },
  { id: 'caro', nombre: 'CAROLINA SOSA' },
];

const RR = 'VOLEA Racket Roll · 22-23 ago';

describe('nombrePropio', () => {
  it('pasa de mayúsculas a nombre propio, con partículas en minúscula y tildes', () => {
    expect(nombrePropio('LUIS DÍAZ DE LEÓN')).toBe('Luis Díaz de León');
    expect(nombrePropio('  ana   laura  frascheri ')).toBe('Ana Laura Frascheri');
    expect(nombrePropio("D'ALESSANDRO ANA-LAURA")).toBe("D'Alessandro Ana-Laura");
  });

  it('respeta la letra de nivel y los números', () => {
    expect(nombrePropio('MIXTO A')).toBe('Mixto A');
    expect(nombrePropio('MASCULINO +50')).toBe('Masculino +50');
    expect(nombrePropio('ONE POINT CHALLENGE 1RA EDICION')).toBe('One Point Challenge 1ra Edicion');
  });
});

describe('partirNombreEvento', () => {
  it('separa la fecha que viene después del último " · "', () => {
    expect(partirNombreEvento(RR)).toEqual({ nombre: 'VOLEA Racket Roll', fecha: '22-23 ago' });
    expect(partirNombreEvento('Torneo +50 y Singles · 9 ago')).toEqual({ nombre: 'Torneo +50 y Singles', fecha: '9 ago' });
  });

  it('sin " · " o sin números no inventa fecha', () => {
    expect(partirNombreEvento('BADMINTON')).toEqual({ nombre: 'BADMINTON', fecha: null });
    expect(partirNombreEvento('Copa · Edición Primavera')).toEqual({ nombre: 'Copa · Edición Primavera', fecha: null });
  });
});

describe('nombreCortoCategoria', () => {
  it('saca la cola que repite el nombre del evento', () => {
    expect(nombreCortoCategoria('MIXTO A RACKET ROLL', RR)).toBe('Mixto A');
    expect(nombreCortoCategoria('SINGLES MASCULINO B RACKET ROLL', RR)).toBe('Singles Masculino B');
    expect(nombreCortoCategoria('ONE POINT CHALLENGE RACKET ROLL', RR)).toBe('One Point Challenge');
  });

  it('saca la fecha pegada al final', () => {
    expect(nombreCortoCategoria('MASCULINO A 26/7', 'Torneo Masculino · 26 jul')).toBe('Masculino A');
    expect(nombreCortoCategoria('+50 MIXTO 9/08/2026', 'Torneo +50 y Singles · 9 ago')).toBe('+50 Mixto');
  });

  it('es conservador: una sola palabra suelta no se saca y nunca queda vacío', () => {
    expect(nombreCortoCategoria('TORNEO MASCULINO', 'Torneo Masculino · 26 jul')).toBe('Torneo Masculino');
    expect(nombreCortoCategoria('RACKET ROLL', RR)).toBe('Racket Roll');
    expect(nombreCortoCategoria('COPA BADMINTON - DOBLES MASCULINO', null)).toBe('Copa Badminton - Dobles Masculino');
    expect(nombreCortoCategoria('MIXTO A', null)).toBe('Mixto A');
  });
});

describe('resumenTorneosHome', () => {
  it('arma la última fecha con campeones del padrón, ordenados A → B → C y los individuales al final', () => {
    const torneos = [
      torneo({ id: 'opc', nombre: 'ONE POINT CHALLENGE RACKET ROLL', evento: RR, individual: true, parejas: [
        { id: 'p1', nombre: 'CAROLINA SOSA', jugadorIds: ['caro'] },
        { id: 'p2', nombre: 'ANA PÉREZ', jugadorIds: ['ana'] },
      ] }),
      torneo({ id: 'mb', nombre: 'MIXTO B RACKET ROLL', evento: RR, categoria: 'B' }),
      torneo({ id: 'plus', nombre: 'MIXTO +50 RACKET ROLL', evento: RR, categoria: 'B' }),
      torneo({ id: 'fa', nombre: 'FEMENINO A RACKET ROLL', evento: RR }),
      torneo({ id: 'mc', nombre: 'MIXTO C RACKET ROLL', evento: RR, categoria: 'B' }),
      torneo({ id: 'ma', nombre: 'MIXTO A RACKET ROLL', evento: RR }),
    ];
    const r = resumenTorneosHome(torneos, JUGADORES, CONFIG_PUNTOS_DEFAULT, AHORA);
    expect(r.ultimaFecha?.nombre).toBe('VOLEA Racket Roll');
    expect(r.ultimaFecha?.fecha).toBe('22-23 ago');
    expect(r.ultimaFecha?.totalCategorias).toBe(6);
    expect(r.ultimaFecha?.categorias.map((c) => c.nombreCorto)).toEqual([
      'Femenino A', 'Mixto A', 'Mixto B', 'Mixto C', 'Mixto +50', 'One Point Challenge',
    ]);
    const mixtoA = r.ultimaFecha?.categorias.find((c) => c.id === 'ma');
    expect(mixtoA).toEqual({ id: 'ma', nombreCorto: 'Mixto A', campeon: 'Ana Pérez / Luis Díaz de León', cantidadParejas: 2, individual: false });
    expect(r.ultimaFecha?.categorias.find((c) => c.id === 'opc')?.campeon).toBe('Carolina Sosa');
  });

  it('elige el evento más reciente con TODO terminado; uno a medio jugar no cuenta', () => {
    const torneos = [
      torneo({ id: 'viejo', nombre: 'MASCULINO A 26/7', evento: 'Torneo Masculino · 26 jul', creadoEl: '2026-07-25T20:00:00.000Z' }),
      torneo({ id: 'rr', nombre: 'MIXTO A RACKET ROLL', evento: RR, creadoEl: '2026-08-21T23:00:00.000Z' }),
      // Más nuevo pero colgado sin terminar (y sin actividad): no es "la última fecha".
      torneo({ id: 'badm', nombre: 'ONE POINT CHALLENGE', evento: 'BADMINTON', creadoEl: '2026-09-06T00:00:00.000Z', terminado: false }),
    ];
    const r = resumenTorneosHome(torneos, JUGADORES, CONFIG_PUNTOS_DEFAULT, AHORA);
    expect(r.ultimaFecha?.nombre).toBe('VOLEA Racket Roll');
    expect(r.ultimaFecha?.categorias.map((c) => c.id)).toEqual(['rr']);
    expect(r.enVivo).toBeNull();
  });

  it('salta categorías sin campeón resoluble y eventos sin ninguno', () => {
    const sinVinculo = torneo({ id: 'sv', nombre: 'MIXTO B RACKET ROLL', evento: RR, parejas: [
      { id: 'p1', nombre: 'MARÍA ROJAS y JOSÉ PAZ' },
      { id: 'p2', nombre: 'OTRA PAREJA' },
    ] });
    // Final ganada por una pareja que no existe en la lista: no hay nombre que mostrar.
    const fantasma = torneo({ id: 'fx', nombre: 'MIXTO C RACKET ROLL', evento: RR, parejas: [{ id: 'p2', nombre: 'SOLA' }] });
    const r = resumenTorneosHome([sinVinculo, fantasma], JUGADORES, CONFIG_PUNTOS_DEFAULT, AHORA);
    // Pareja sin vincular al padrón: cae al nombre cargado, con el mismo separador.
    expect(r.ultimaFecha?.categorias).toEqual([
      { id: 'sv', nombreCorto: 'Mixto B', campeon: 'María Rojas / José Paz', cantidadParejas: 2, individual: false },
    ]);
    expect(r.ultimaFecha?.totalCategorias).toBe(2);

    const soloFantasma = resumenTorneosHome([fantasma], JUGADORES, CONFIG_PUNTOS_DEFAULT, AHORA);
    expect(soloFantasma.ultimaFecha).toBeNull();
  });

  it('en vivo: una sola categoría en juego linkea a su detalle; varias, a la lista', () => {
    const unaViva = [
      torneo({ id: 'v1', nombre: 'MIXTO A', evento: 'Copa Primavera · 24 set', terminado: false, updatedAt: HACE_UNA_HORA }),
      torneo({ id: 'v2', nombre: 'MIXTO B', evento: 'Copa Primavera · 24 set' }),
    ];
    expect(resumenTorneosHome(unaViva, JUGADORES, CONFIG_PUNTOS_DEFAULT, AHORA).enVivo).toEqual({
      nombre: 'Copa Primavera', to: '/torneos/v1',
    });

    const dosVivas = [
      torneo({ id: 'v1', nombre: 'MIXTO A', evento: 'Copa Primavera · 24 set', terminado: false, updatedAt: HACE_UNA_HORA }),
      torneo({ id: 'v2', nombre: 'MIXTO B', evento: 'Copa Primavera · 24 set', terminado: false, updatedAt: HACE_UNA_HORA }),
    ];
    expect(resumenTorneosHome(dosVivas, JUGADORES, CONFIG_PUNTOS_DEFAULT, AHORA).enVivo).toEqual({
      nombre: 'Copa Primavera', to: '/torneos',
    });
  });

  it('top 5 del año con la misma cuenta que /ranking (los años anteriores no suman)', () => {
    const torneos = [
      torneo({ id: 'a', nombre: 'MIXTO A', evento: RR }),
      torneo({ id: 'b', nombre: 'MIXTO B', evento: 'Otra · 9 ago', categoria: 'B', creadoEl: '2026-08-09T12:00:00.000Z', parejas: [
        { id: 'p1', nombre: 'CAROLINA SOSA y PEDRO GÓMEZ', jugadorIds: ['caro', 'pedro'] },
        { id: 'p2', nombre: 'ANA PÉREZ y SOFÍA RUIZ', jugadorIds: ['ana', 'sofia'] },
      ] }),
      // 2025: aporta al histórico pero no al ranking del año.
      torneo({ id: 'viejo', nombre: 'MIXTO A', evento: 'Final 2025 · 10 dic', creadoEl: '2025-12-10T12:00:00.000Z', parejas: [
        { id: 'p1', nombre: 'X', jugadorIds: ['sofia', 'caro'] },
        { id: 'p2', nombre: 'Y', jugadorIds: ['luis', 'pedro'] },
      ] }),
    ];
    const r = resumenTorneosHome(torneos, JUGADORES, CONFIG_PUNTOS_DEFAULT, AHORA);
    expect(r.anio).toBe(2026);
    // Default [100, 86, 72, …], B baja un escalón: campeón B = 86, finalista B = 72.
    expect(r.top).toEqual([
      { jugadorId: 'ana', posicion: 1, nombre: 'Ana Pérez', puntos: 172, torneosJugados: 2 },
      { jugadorId: 'pedro', posicion: 2, nombre: 'Pedro Gómez', puntos: 172, torneosJugados: 2 },
      { jugadorId: 'sofia', posicion: 3, nombre: 'Sofía Ruiz', puntos: 158, torneosJugados: 2 },
      { jugadorId: 'luis', posicion: 4, nombre: 'Luis Díaz de León', puntos: 100, torneosJugados: 1 },
      { jugadorId: 'caro', posicion: 5, nombre: 'Carolina Sosa', puntos: 86, torneosJugados: 1 },
    ]);
  });

  it('stats: jugadores con puntos (histórico), categorías terminadas y fechas con algo jugado', () => {
    const torneos = [
      torneo({ id: 'a', nombre: 'MIXTO A', evento: RR }),
      torneo({ id: 'b', nombre: 'MIXTO B', evento: RR, categoria: 'B' }),
      torneo({ id: 'c', nombre: 'SINGLES', evento: 'Otra · 9 ago', parejas: [
        { id: 'p1', nombre: 'CAROLINA SOSA', jugadorIds: ['caro'] },
        { id: 'p2', nombre: 'ANA PÉREZ', jugadorIds: ['ana'] },
      ] }),
      torneo({ id: 'viejo', nombre: 'MIXTO A', evento: 'Final 2025 · 10 dic', creadoEl: '2025-12-10T12:00:00.000Z' }),
      torneo({ id: 'colgado', nombre: 'DOBLES', evento: 'BADMINTON', terminado: false }),
    ];
    const r = resumenTorneosHome(torneos, JUGADORES, CONFIG_PUNTOS_DEFAULT, AHORA);
    expect(r.stats).toEqual({ jugadores: 5, categoriasJugadas: 4, fechas: 3 });
  });

  it('un documento manco (sin grupos ni partidosGrupo) no revienta el resumen', () => {
    const manco = { ...torneo({ id: 'm', nombre: 'MIXTO A', evento: RR }), grupos: undefined, partidosGrupo: undefined } as unknown as TorneoPublico;
    const r = resumenTorneosHome([manco], JUGADORES, CONFIG_PUNTOS_DEFAULT, AHORA);
    expect(r.ultimaFecha?.categorias).toHaveLength(1);
    expect(r.top).toHaveLength(4);
  });

  it('sin torneos no hay nada para mostrar', () => {
    const r = resumenTorneosHome([], JUGADORES, CONFIG_PUNTOS_DEFAULT, AHORA);
    expect(r).toEqual({ enVivo: null, ultimaFecha: null, anio: 2026, top: [], stats: { jugadores: 0, categoriasJugadas: 0, fechas: 0 } });
    expect(hayContenido(r)).toBe(false);
  });
});
