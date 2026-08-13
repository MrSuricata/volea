import { describe, expect, it, vi } from 'vitest';
import type { Jugador, Torneo } from '../engine/tipos';
import type { Dialogos } from './dialogos';
import { reconciliarTorneo } from './reconciliar';

/** Diálogos que fallan el test si la UI pregunta algo que no debería preguntar. */
function dialogosMudos(): Dialogos {
  const noEsperado = (que: string) => () => {
    throw new Error(`no se esperaba que la UI pidiera ${que}`);
  };
  return {
    confirmar: noEsperado('confirmar') as Dialogos['confirmar'],
    pedirTexto: noEsperado('un texto') as Dialogos['pedirTexto'],
    avisar: noEsperado('avisar') as Dialogos['avisar'],
    pedirTextoConOpcion: noEsperado('texto con opción') as Dialogos['pedirTextoConOpcion'],
    elegirDeLista: noEsperado('elegir de una lista') as Dialogos['elegirDeLista'],
  };
}

function torneo(parcial: Partial<Torneo>): Torneo {
  return {
    id: 't1', nombre: 'T', creadoEl: '2026-08-09T12:00:00.000Z', fase: 'terminado',
    parejas: [], grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: null,
    ...parcial,
  } as Torneo;
}

const jugador = (id: string, nombre: string): Jugador => ({ id, nombre });

describe('reconciliarTorneo', () => {
  // REGRESIÓN (SINGLES 9/08/2026): un torneo de singles jugado con formato "grupos"
  // tiene una persona por entrada. Antes se buscaba el " y " del nombre de pareja,
  // no se encontraba, se DESCARTABA el nombre real y se pedían dos integrantes
  // vacíos por teclado ("Integrante de FABIÁN PERDOMO"). Resultado: no se podía
  // vincular y el torneo nunca sumaba al ranking.
  it('singles con formato "grupos": confirma una vez y vincula por el nombre', async () => {
    const padron = [jugador('j1', 'Fabián Perdomo'), jugador('j2', 'Hernán Bonjour')];
    const confirmar = vi.fn().mockResolvedValue(true);
    const t = torneo({
      formato: 'grupos',
      parejas: [
        { id: 'p1', nombre: 'FABIÁN PERDOMO' },
        { id: 'p2', nombre: 'HERNAN BONJOUR' },
      ],
    });

    const r = await reconciliarTorneo(t, padron, { ...dialogosMudos(), confirmar });

    expect(r.cancelado).toBe(false);
    expect(confirmar).toHaveBeenCalledTimes(1); // una sola pregunta para todo el torneo
    // Engancha con los que YA existen (la búsqueda normaliza tildes y mayúsculas):
    // no se crean duplicados en el padrón.
    expect(r.torneo.parejas[0].jugadorIds).toEqual(['j1']);
    expect(r.torneo.parejas[1].jugadorIds).toEqual(['j2']);
    expect(r.jugadores).toHaveLength(2);
  });

  // Si son todos nombres de fantasía, asumir "singles" daba de alta personas
  // inventadas que después sumaban puntos en el ranking.
  it('si dice que NO es de singles, trata cada entrada como pareja', async () => {
    const padron = [jugador('j1', 'Ana Pérez'), jugador('j2', 'Juan Gómez')];
    const confirmar = vi.fn().mockResolvedValue(false);
    const pedirTexto = vi.fn().mockResolvedValue('Ana Pérez y Juan Gómez');
    const t = torneo({ formato: 'grupos', parejas: [{ id: 'p1', nombre: 'LOS PUMAS' }] });

    const r = await reconciliarTorneo(t, padron, { ...dialogosMudos(), confirmar, pedirTexto });

    expect(r.torneo.parejas[0].jugadorIds).toEqual(['j1', 'j2']);
    // Un solo diálogo, precargado con el nombre real para saber qué se corrige.
    expect(pedirTexto).toHaveBeenCalledTimes(1);
    expect(pedirTexto.mock.calls[0][0]).toMatchObject({ valorInicial: 'LOS PUMAS' });
    expect(r.jugadores).toHaveLength(2); // no inventó a "LOS PUMAS" como persona
  });

  // El every() miraba TODAS las parejas: una sola ya vinculada con " y " en el nombre
  // apagaba la detección de singles y volvía el bug (con puntos dobles, ver abajo).
  it('detecta singles mirando solo lo que falta vincular', async () => {
    const padron = [jugador('j1', 'Fabián Perdomo')];
    const confirmar = vi.fn().mockResolvedValue(true);
    const t = torneo({
      formato: 'grupos',
      parejas: [
        { id: 'p1', nombre: 'ALGUIEN y OTRO', jugadorIds: ['jx', 'jy'] }, // ya vinculada
        { id: 'p2', nombre: 'FABIÁN PERDOMO' },
      ],
    });

    const r = await reconciliarTorneo(t, padron, { ...dialogosMudos(), confirmar });

    expect(r.torneo.parejas[1].jugadorIds).toEqual(['j1']);
  });

  // Repetir el id le paga los puntos DOS veces al mismo jugador (ranking.ts empuja
  // un aporte por cada id de la pareja).
  it('no repite el mismo jugador dentro de una pareja', async () => {
    const padron = [jugador('j1', 'Ana Pérez')];
    const confirmar = vi.fn().mockResolvedValue(false);
    const pedirTexto = vi.fn().mockResolvedValue('Ana Pérez y Ana Pérez');
    const t = torneo({ formato: 'grupos', parejas: [{ id: 'p1', nombre: 'LOS PUMAS' }] });

    const r = await reconciliarTorneo(t, padron, { ...dialogosMudos(), confirmar, pedirTexto });

    expect(r.torneo.parejas[0].jugadorIds).toEqual(['j1']);
  });

  it('sin nada que vincular devuelve el mismo torneo (no lo ensucia para el sync)', async () => {
    const t = torneo({ formato: 'grupos', parejas: [] });

    const r = await reconciliarTorneo(t, [], dialogosMudos());

    expect(r.torneo).toBe(t);
    expect(r.cancelado).toBe(false);
  });

  it('dobles: parte el nombre por la "y", también con Y mayúscula', async () => {
    const padron = [
      jugador('j1', 'Gustavo Alegre'), jugador('j2', 'Lucía De Feo'),
      jugador('j3', 'Luis Conde'), jugador('j4', 'Andreina Lehrmann'),
    ];
    const t = torneo({
      formato: 'grupos',
      parejas: [
        { id: 'p1', nombre: 'GUSTAVO ALEGRE Y LUCÍA DE FEO' },
        { id: 'p2', nombre: 'LUIS CONDE y ANDREINA LEHRMANN' },
      ],
    });

    const r = await reconciliarTorneo(t, padron, dialogosMudos());

    expect(r.cancelado).toBe(false);
    expect(r.torneo.parejas[0].jugadorIds).toEqual(['j1', 'j2']);
    expect(r.torneo.parejas[1].jugadorIds).toEqual(['j3', 'j4']);
  });

  // Torneo de dobles con una pareja de nombre raro: las que tienen " y " se parten
  // solas y solo la rara pregunta (una vez, precargada).
  it('dobles con una pareja de nombre raro: pregunta solo por esa', async () => {
    const padron = [
      jugador('j1', 'Luis Conde'), jugador('j2', 'Andreina Lehrmann'),
      jugador('j3', 'Ana Pérez'), jugador('j4', 'Juan Gómez'),
    ];
    const pedirTexto = vi.fn().mockResolvedValue('Ana Pérez y Juan Gómez');
    const t = torneo({
      formato: 'grupos',
      parejas: [
        { id: 'p1', nombre: 'LUIS CONDE y ANDREINA LEHRMANN' },
        { id: 'p2', nombre: 'Los Pumas' },
      ],
    });

    const r = await reconciliarTorneo(t, padron, { ...dialogosMudos(), pedirTexto });

    expect(r.cancelado).toBe(false);
    expect(pedirTexto).toHaveBeenCalledTimes(1);
    expect(r.torneo.parejas[0].jugadorIds).toEqual(['j1', 'j2']);
    expect(r.torneo.parejas[1].jugadorIds).toEqual(['j3', 'j4']);
  });

  it('individual (One Point Challenge): una persona por entrada', async () => {
    const padron = [jugador('j1', 'Mario Neves')];
    const t = torneo({ formato: 'individual', parejas: [{ id: 'p1', nombre: 'MARIO NEVES' }] });

    const r = await reconciliarTorneo(t, padron, dialogosMudos());

    expect(r.torneo.parejas[0].jugadorIds).toEqual(['j1']);
  });

  it('no vuelve a tocar las parejas que ya estaban vinculadas', async () => {
    const t = torneo({
      formato: 'grupos',
      parejas: [{ id: 'p1', nombre: 'CUALQUIER COSA', jugadorIds: ['jx'] }],
    });

    const r = await reconciliarTorneo(t, [], dialogosMudos());

    expect(r.torneo.parejas[0].jugadorIds).toEqual(['jx']);
  });

  it('si se cancela a mitad, no devuelve nada a medio vincular', async () => {
    const padron = [jugador('j1', 'Luis Conde'), jugador('j2', 'Andreina Lehrmann')];
    // Torneo de dobles de verdad (hay una pareja con " y "), así que la de nombre
    // raro pregunta — y ahí el usuario cierra el diálogo.
    const t = torneo({
      formato: 'grupos',
      parejas: [
        { id: 'p1', nombre: 'LUIS CONDE y ANDREINA LEHRMANN' },
        { id: 'p2', nombre: 'Los Pumas' },
      ],
    });

    const r = await reconciliarTorneo(t, padron, {
      ...dialogosMudos(),
      pedirTexto: vi.fn().mockResolvedValue(null), // el usuario cierra el diálogo
    });

    expect(r.cancelado).toBe(true);
    expect(r.torneo).toBe(t); // misma referencia: no se guarda nada a medias
    expect(r.jugadores).toBe(padron);
  });
});
