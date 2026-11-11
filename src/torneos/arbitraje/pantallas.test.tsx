// Render estático (react-dom/server, sin navegador ni jsdom) de las pantallas del árbitro y de la TV:
// no corre efectos ni toques, pero comprueba lo que se dibuja en cada estado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormatoArbitraje } from '../engine/tipos';
import type { Jugada, Marcador } from './motor';
import type { PartidoArbitrado } from './partido';

vi.mock('../../services/supabaseClient', () => ({ supabase: null, isSupabaseConnected: () => false }));

const { default: ArbitroPage } = await import('./ArbitroPage');
const { MarcadorVivo } = await import('./MarcadorVivo');
const { default: PantallaTv } = await import('../publico/PantallaTv');

const RA15: FormatoArbitraje = { tipo: 'rally', a: 15, mejorDe: 1 };
const ini: Jugada = { t: 'inicio', saca: 'A', derechaA: 0, derechaB: 0 };
const r = (gana: 'A' | 'B'): Jugada => ({ t: 'rally', gana });

let almacen: Map<string, string>;
beforeEach(() => {
  almacen = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => void almacen.set(k, v),
    removeItem: (k: string) => void almacen.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

function guardado(jugadas: Jugada[], datos: PartidoArbitrado | null, formato: FormatoArbitraje = RA15, dobles = true) {
  almacen.set('volea_arbitro_ultimo', '123456');
  almacen.set('volea_arbitro_123456', JSON.stringify({
    v: 2, codigo: '123456',
    partido: { torneoId: 't', partidoId: 'm1', formato, dobles, estado: jugadas.length ? 'en_juego' : 'pendiente' },
    datos, cola: { jugadas, subido: jugadas, version: 3, enviados: [] },
  }));
}
const lados = (a: string, b: string, jugA: string[], jugB: string[]): PartidoArbitrado => ({
  fase: 'grupo', titulo: 'Grupo A · Ronda 1', jugado: false,
  a: { parejaId: 'p1', nombre: a, jugadores: jugA }, b: { parejaId: 'p2', nombre: b, jugadores: jugB },
});

describe('pantalla del código', () => {
  it('placeholder, ayuda y botón que no parece roto', () => {
    const html = renderToStaticMarkup(<ArbitroPage />);
    expect(html).toContain('placeholder="Código"');
    expect(html).toContain('Pedí el código en la mesa de control.');
    expect(html).toContain('maxLength="6"');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Entrar/); // no aparece deshabilitado
  });
});

describe('recargar la página en medio del partido (sin red)', () => {
  it('sigue desde lo guardado en el teléfono, con los nombres en los botones', () => {
    guardado([ini, r('A'), r('A')], lados('ANA Y LUIS', 'LOS TIGRES', ['ANA', 'LUIS'], ['LOS TIGRES']));
    const html = renderToStaticMarkup(<ArbitroPage />);
    expect(html).toContain('Ganó el que saca');
    expect(html).toMatch(/Ganó el que saca<\/span><span[^>]*>ANA Y LUIS/);
    expect(html).toMatch(/Ganó el que recibe<\/span><span[^>]*>LOS TIGRES/);
    expect(html).toContain('aria-live="polite"');
  });

  it('nunca "Saca " vacío: si la pareja no se separa, "Jugador 1/2"', () => {
    // B saca; "LOS TIGRES" no se puede separar en dos jugadores.
    guardado([{ ...ini, saca: 'B' }], lados('ANA Y LUIS', 'LOS TIGRES', ['ANA', 'LUIS'], ['LOS TIGRES']));
    const html = renderToStaticMarkup(<ArbitroPage />);
    expect(html).toMatch(/Saca Jugador [12]</);
    expect(html).not.toMatch(/Saca <\/p>/);
  });

  it('Deshacer y Tiempo con área de toque de 44px', () => {
    guardado([ini, r('A')], lados('A Y B', 'C Y D', ['A', 'B'], ['C', 'D']));
    const html = renderToStaticMarkup(<ArbitroPage />);
    expect(html).toMatch(/<button class="min-h-\[44px\][^"]*">↶ Deshacer/);
    expect(html).toMatch(/<button class="min-h-\[44px\] min-w-\[44px\][^"]*">Tiempo/);
  });

  it('partido terminado: "Terminar" sin la confirmación en el mismo lugar', () => {
    guardado([ini, ...Array.from({ length: 15 }, () => r('A'))], lados('A Y B', 'C Y D', ['A', 'B'], ['C', 'D']));
    const html = renderToStaticMarkup(<ArbitroPage />);
    expect(html).toContain('Terminar partido');
    expect(html).not.toContain('Sí, cargar resultado');
  });
});

describe('partido terminado', () => {
  it('el resultado se lee desde el ganador y desaparecen el canto y el "Saca"', () => {
    guardado([{ ...ini, saca: 'B' }, ...Array.from({ length: 15 }, () => r('B'))], lados('A Y B', 'C Y D', ['A', 'B'], ['C', 'D']));
    const html = renderToStaticMarkup(<ArbitroPage />);
    expect(html).toContain('Ganó C Y D · 15-0');
    expect(html).not.toMatch(/>Saca /);
    expect(html).not.toContain('15-0-');
  });
});

describe('pantalla de inicio', () => {
  it('muestra el formato de la organización y las opciones quedan escondidas', () => {
    guardado([], lados('A Y B', 'C Y D', ['A', 'B'], ['C', 'D']), { tipo: 'sideout', a: 11, mejorDe: 3 });
    const html = renderToStaticMarkup(<ArbitroPage />);
    expect(html).toContain('Formato que puso la organización');
    expect(html).toContain('Saque tradicional a 11 · al mejor de 3');
    expect(html).toContain('Cambiar formato…');
    expect(html).not.toContain('>Un game<');
  });

  it('si no se pudo leer el cuadro, no deja arrancar a ciegas', () => {
    guardado([], null);
    const html = renderToStaticMarkup(<ArbitroPage />);
    expect(html).toContain('No se pudo leer el cuadro del torneo');
    expect(html).not.toContain('Empezar partido');
  });

  it('cruce sin rivales definidos: no deja arrancar', () => {
    guardado([], { ...lados('A Y B', 'C Y D', ['A', 'B'], ['C', 'D']), b: null });
    const html = renderToStaticMarkup(<ArbitroPage />);
    expect(html).toContain('Todavía no se sabe quién juega');
    expect(html).not.toContain('Empezar partido');
  });
});

describe('marcador roto en la base', () => {
  const roto = { puntos: { a: 3, b: 1 }, saca: 'A' } as unknown as Marcador; // sin games
  const bueno: Marcador = { puntos: { a: 3, b: 1 }, games: [], gamesA: 0, gamesB: 0, game: 1, saca: 'A', servidor: 1, canto: '3-1', terminado: false, ganador: null };

  it('MarcadorVivo no se cae: no dibuja nada', () => {
    expect(renderToStaticMarkup(<MarcadorVivo m={roto} />)).toBe('');
    expect(renderToStaticMarkup(<MarcadorVivo m={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<MarcadorVivo m={bueno} />)).toContain('EN VIVO');
  });

  it('la TV no se cae y muestra la cancha como "VS"', () => {
    const props = {
      titulo: 'Sudamericano', colores: ['#000', '#111', '#222'] as [string, string, string], proximos: [], resultados: [], campeones: [], termina: null,
      ahora: new Date('2026-11-20T15:00:00'), tv: null,
      canchas: [
        { cancha: 'Cancha 1', cat: 'MIXTO', a: 'ANA Y LUIS', b: 'EVA Y JUAN', minutos: 5, sigue: null, marcador: roto },
        { cancha: 'Cancha 2', cat: 'MIXTO', a: 'SOL Y PEDRO', b: 'LIA Y TOMAS', minutos: 3, sigue: null, marcador: bueno },
      ],
    } as unknown as Parameters<typeof PantallaTv>[0];
    vi.stubGlobal('window', { location: { href: 'https://volea.test/programacion?tv', search: '?tv', hash: '' } });
    const html = renderToStaticMarkup(<PantallaTv {...props} />);
    expect(html).toContain('ANA Y LUIS');
    expect(html).toContain('VS');
    expect(html).toContain('EN VIVO');
  });
});
