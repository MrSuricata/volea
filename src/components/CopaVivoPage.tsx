// Pantalla pública EN VIVO de la Copa Badminton, pensada para una TV en
// Pickleball City: marcadores en vivo, tablas de posiciones y próximos cruces.
// Solo lectura (RLS tanteador_public_read, v19). Se refresca sola: Realtime +
// sondeo de respaldo + refetch al volver a la pestaña. Sin interacción.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { SupabaseService } from '../services/supabaseService';
import type { TanteadorPartido } from '../types';
import {
  marcadorActual,
  resumenSets,
  setsGanados,
  tablaAmericano,
  tablaParejas,
  type FilaAmericano,
} from '../utils/tanteador';

export default function CopaVivoPage() {
  const [partidos, setPartidos] = useState<TanteadorPartido[] | null>(null);
  const [actualizado, setActualizado] = useState<Date | null>(null);

  const cargar = useCallback(async () => {
    const ps = await SupabaseService.getTanteadorPartidos();
    if (ps) { setPartidos(ps); setActualizado(new Date()); }
  }, []);

  useEffect(() => {
    void cargar();
    const sb = supabase;
    let timer: number | undefined;
    const pedir = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void cargar(), 250);
    };
    const canal = sb
      ? sb.channel('copa-vivo')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tanteador_partidos' }, pedir)
          .subscribe()
      : null;
    const sondeo = window.setInterval(() => void cargar(), 30000);
    const alVolver = () => { if (document.visibilityState === 'visible') void cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(sondeo);
      document.removeEventListener('visibilitychange', alVolver);
      if (sb && canal) void sb.removeChannel(canal);
    };
  }, [cargar]);

  const vivos = (partidos || []).filter((p) => p.estado === 'en_juego');
  const puntosDe = (p: TanteadorPartido) => p.hist.reduce((n, h) => n + h.length, 0);
  const enJuego = vivos.filter((p) => puntosDe(p) > 0);
  const finales = (partidos || [])
    .filter((p) => p.estado === 'final')
    .sort((a, b) => (b.terminadoAt || b.updatedAt || '').localeCompare(a.terminadoAt || a.updatedAt || ''));

  const deCat = (cat: 'DM' | 'DF') => (partidos || []).filter((p) => p.categoria === cat);
  const tablas: { titulo: string; unidad: string; filas: FilaAmericano[] }[] = [
    { titulo: 'MASCULINO — DUPLAS', unidad: 'Dupla', filas: tablaParejas(deCat('DM').filter((p) => p.modo === 'fijas'), 'DM') },
    { titulo: 'FEMENINO — INDIVIDUAL', unidad: 'Jugadora', filas: tablaAmericano(deCat('DF').filter((p) => p.modo === 'rotativas'), 'DF') },
  ];

  return (
    <div className="min-h-screen bg-navy-900 px-4 py-6 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        {/* cabezal */}
        <div className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-lime-400 pb-3">
          <div>
            <h1 className="font-display text-3xl font-black tracking-tight text-lime-400 sm:text-5xl">
              COPA BADMINTON
            </h1>
            <p className="mt-1 text-sm font-semibold text-navy-200 sm:text-base">
              Pickleball City · dobles a 15, al mejor de 3
            </p>
          </div>
          <p className="flex items-center gap-2 text-xs font-semibold text-navy-200">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-lime-400" aria-hidden />
            EN VIVO{actualizado ? ` · ${actualizado.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>

        {partidos === null && (
          <p className="py-16 text-center text-lg text-navy-200">Cargando la copa…</p>
        )}

        {/* campeones (cuando la FINAL de una categoría está jugada) */}
        {(['DM', 'DF'] as const).map((cat) => {
          const f = (partidos || []).find(
            (p) => p.categoria === cat && p.fase === 'llave' && (p.titulo || '').toUpperCase() === 'FINAL' && p.estado === 'final' && p.ganador,
          );
          if (!f) return null;
          return (
            <div key={cat} className="mt-6 rounded-2xl bg-lime-400 p-4 text-center sm:p-6">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-navy-800">
                {cat === 'DM' ? 'Campeones — Masculino' : 'Campeonas — Femenino'} 🏆
              </p>
              <p className="mt-1 font-display text-3xl font-black text-navy-900 sm:text-5xl">
                {f.ganador === 'A' ? f.parejaA : f.parejaB}
              </p>
              <p className="mt-1 font-display text-sm font-bold text-navy-800">{resumenSets(f)}</p>
            </div>
          );
        })}

        {/* en juego */}
        {enJuego.length > 0 && (
          <div className={`mt-6 grid gap-4 ${enJuego.length > 1 ? 'lg:grid-cols-2' : ''}`}>
            {enJuego.map((p) => {
              const s = marcadorActual(p);
              const sg = setsGanados(p);
              return (
                <div key={p.id} className="rounded-2xl border-2 border-lime-400 bg-navy-800 p-4 sm:p-6">
                  <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-widest text-navy-200">
                    <span>
                      {p.fase === 'llave' && <span className="mr-1.5 rounded bg-lime-400 px-1.5 py-0.5 font-display font-black text-navy-900">{p.titulo || 'LLAVE'}</span>}
                      {p.categoria === 'DM' ? 'Masculino' : 'Femenino'} · Cancha {p.cancha}
                    </span>
                    <span className="text-lime-400">Set {p.sets.length + 1}</span>
                  </div>
                  {([['A', p.parejaA, s.a, sg.A], ['B', p.parejaB, s.b, sg.B]] as const).map(([lado, nombre, pts, sets]) => (
                    <div key={lado} className="flex items-center justify-between gap-3 py-1.5">
                      <p className={`min-w-0 truncate font-body text-lg font-bold sm:text-2xl ${lado === 'A' ? 'text-lime-400' : 'text-[#ff5fb1]'}`}>
                        {nombre}
                        <span className="ml-2 align-middle text-xs font-semibold text-navy-300">({sets})</span>
                      </p>
                      <p className="font-display text-5xl font-black leading-none sm:text-7xl">{pts}</p>
                    </div>
                  ))}
                  {p.sets.length > 0 && (
                    <p className="mt-1 text-right font-display text-sm font-bold text-navy-200">{resumenSets(p)}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* últimos resultados — van cayendo acá a medida que terminan */}
        {finales.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-2 font-display text-lg font-black tracking-wide text-lime-400 sm:text-xl">ÚLTIMOS RESULTADOS</h2>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {finales.slice(0, 8).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-navy-700 bg-navy-800 px-3 py-2.5 text-sm sm:text-base">
                  <span className="min-w-0 truncate">
                    {p.fase === 'llave' && <span className="mr-1.5 rounded bg-lime-400 px-1 py-0.5 font-display text-[10px] font-black text-navy-900">{p.titulo || 'LLAVE'}</span>}
                    <span className={`font-bold ${p.ganador === 'A' ? 'text-lime-400' : ''}`}>{p.parejaA}</span>
                    <span className="text-navy-300"> vs </span>
                    <span className={`font-bold ${p.ganador === 'B' ? 'text-lime-400' : ''}`}>{p.parejaB}</span>
                  </span>
                  <span className="whitespace-nowrap font-display text-sm font-bold">{resumenSets(p)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* tablas */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {tablas.map(({ titulo, unidad, filas }) => (
            <div key={titulo}>
              <h2 className="mb-2 font-display text-lg font-black tracking-wide text-lime-400 sm:text-xl">{titulo}</h2>
              {filas.length === 0 ? (
                <p className="rounded-xl border border-navy-700 bg-navy-800 p-4 text-sm text-navy-300">
                  Todavía sin partidos terminados.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-navy-700 bg-navy-800">
                  <table className="w-full text-sm sm:text-base" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <thead>
                      <tr className="border-b border-navy-700 text-left text-[10px] font-bold uppercase tracking-wider text-navy-300 sm:text-xs">
                        <th className="px-3 py-2">#</th>
                        <th className="py-2">{unidad}</th>
                        <th className="px-2 py-2 text-center">PJ</th>
                        <th className="px-2 py-2 text-center">PG</th>
                        <th className="px-2 py-2 text-center">Dif</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((f, i) => (
                        <tr key={f.nombre} className={`border-b border-navy-700/50 last:border-0 ${i === 0 ? 'bg-lime-400/15 font-bold' : i === 1 ? 'bg-white/5 font-semibold' : ''}`}>
                          <td className="px-3 py-2">{i === 0 ? '🥇' : i === 1 ? '🥈' : i + 1}</td>
                          <td className="py-2">{f.nombre}</td>
                          <td className="px-2 py-2 text-center">{f.pj}</td>
                          <td className="px-2 py-2 text-center">{f.pg}</td>
                          <td className="px-2 py-2 text-center">{f.dif > 0 ? `+${f.dif}` : f.dif}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* programación completa del día, por cancha */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {(['1', '2'] as const).map((c) => {
            const lista = (partidos || [])
              .filter((p) => p.cancha === c)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            if (!lista.length) return null;
            const cats = new Set(lista.map((p) => p.categoria));
            const rotulo = cats.size === 1 ? (cats.has('DM') ? ' — MASCULINO' : ' — FEMENINO') : '';
            return (
              <div key={c}>
                <h2 className="mb-2 font-display text-lg font-black tracking-wide text-white">
                  PROGRAMACIÓN · CANCHA {c}{rotulo}
                </h2>
                <div className="space-y-1.5">
                  {lista.map((p, i) => {
                    const vivo = p.estado === 'en_juego' && puntosDe(p) > 0;
                    const s = vivo ? marcadorActual(p) : null;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                          vivo ? 'border-lime-400 bg-navy-800'
                          : p.estado === 'final' ? 'border-navy-700 bg-navy-800/50 text-navy-200'
                          : 'border-navy-700 bg-navy-800'
                        }`}
                      >
                        <span className="min-w-0 truncate">
                          <span className="mr-2 font-display text-xs font-bold text-navy-400">{i + 1}</span>
                          {p.fase === 'llave' && <span className="mr-1.5 rounded bg-lime-400 px-1 py-0.5 font-display text-[10px] font-black text-navy-900">{p.titulo || 'LLAVE'}</span>}
                          <span className={`font-semibold ${p.ganador === 'A' ? 'font-bold text-lime-400' : ''}`}>{p.parejaA}</span>
                          <span className="text-navy-400"> vs </span>
                          <span className={`font-semibold ${p.ganador === 'B' ? 'font-bold text-lime-400' : ''}`}>{p.parejaB}</span>
                        </span>
                        <span className="whitespace-nowrap font-display text-xs font-bold">
                          {p.estado === 'final' ? <span className="text-navy-100">✓ {resumenSets(p)}</span>
                            : vivo && s ? <span className="text-lime-400">EN VIVO {s.a}-{s.b}</span>
                            : <span className="text-navy-400">por jugar</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-[11px] text-navy-400">
          Se actualiza solo · VOLEA · Agarrá y jugá
        </p>
      </div>
    </div>
  );
}
