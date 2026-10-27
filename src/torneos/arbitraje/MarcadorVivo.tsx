// Marcadores de los partidos con árbitro, en vivo (Realtime + refresco cada 20 s por las dudas).
import { createContext, useContext, useEffect, useState } from 'react';
import type { Marcador } from './motor';
import { marcadoresEnJuego, suscribirMarcadores } from './servicio';

export const claveMarcador = (torneoId: string, partidoId: string) => `${torneoId}:${partidoId}`;

// Para las páginas con muchos partidos (cuadro público): se lee una vez arriba y cada partido lo consulta.
export const MarcadoresContext = createContext<Map<string, Marcador>>(new Map());
export const useMarcadorDe = (torneoId: string, partidoId: string): Marcador | null =>
  useContext(MarcadoresContext).get(claveMarcador(torneoId, partidoId)) ?? null;

export function useMarcadores(): Map<string, Marcador> {
  const [mapa, setMapa] = useState<Map<string, Marcador>>(new Map());
  useEffect(() => {
    let vivo = true;
    const pedir = async () => {
      const lista = await marcadoresEnJuego();
      if (vivo) setMapa(new Map(lista.filter((m) => m.marcador).map((m) => [claveMarcador(m.torneoId, m.partidoId), m.marcador as Marcador])));
    };
    void pedir();
    const cortar = suscribirMarcadores(() => void pedir());
    const reloj = window.setInterval(() => void pedir(), 20000);
    return () => { vivo = false; cortar(); window.clearInterval(reloj); };
  }, []);
  return mapa;
}

/** Marcador chico: "G2 · 8-5" con el que saca marcado. lados = qué lado es "A" y cuál "B" en el texto. */
export function MarcadorVivo({ m, tamano = 1 }: { m: Marcador; tamano?: number }) {
  const games = m.games.length > 0 || m.game > 1 ? `${m.gamesA}-${m.gamesB} · ` : '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em', fontWeight: 900, fontVariantNumeric: 'tabular-nums', fontSize: `${tamano}em` }}>
      <span style={{ background: '#CCFF00', color: '#001F3F', borderRadius: 6, padding: '0.05em 0.45em' }}>EN VIVO</span>
      <span>{games}{m.saca === 'A' ? '●' : ''}{m.puntos.a}-{m.puntos.b}{m.saca === 'B' ? '●' : ''}</span>
    </span>
  );
}
