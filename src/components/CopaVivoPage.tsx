// Pantalla pública EN VIVO de la Copa Badminton, pensada para una TV en
// Pickleball City: marcadores en vivo, tablas de posiciones y próximos cruces.
// Solo lectura (RLS tanteador_public_read, v19). Se refresca sola: Realtime +
// sondeo de respaldo + refetch al volver a la pestaña. Sin interacción.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { SupabaseService } from '../services/supabaseService';
import type { TanteadorPartido } from '../types';
import {
  jugadoresDe,
  marcadorActual,
  resumenSets,
  setsGanados,
  tablaAmericano,
  tablaParejas,
  type FilaAmericano,
} from '../utils/tanteador';

/** Los 2 nombres de un lado, apilados uno por línea (legible desde lejos). */
function Nombres({ p, lado, resaltar }: { p: TanteadorPartido; lado: 'A' | 'B'; resaltar?: boolean }) {
  return (
    <>
      {jugadoresDe(p, lado).map((n) => (
        <p key={n} className={`truncate leading-tight ${resaltar ? 'text-lime-400' : ''}`}>{n}</p>
      ))}
    </>
  );
}

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
  const llamados = vivos
    .filter((p) => puntosDe(p) === 0 && p.llamadoAt)
    .sort((a, b) => (a.llamadoAt || '').localeCompare(b.llamadoAt || ''));
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

        {/* llamados a la cancha (largados desde el panel) */}
        {llamados.length > 0 && (
          <div className={`mt-6 grid gap-4 ${llamados.length > 1 ? 'lg:grid-cols-2' : ''}`}>
            {llamados.map((p) => (
              <div key={p.id} className="rounded-2xl border-2 border-lime-400 bg-lime-400/10 p-4 sm:p-6">
                <div className="mb-3 flex items-center justify-between">
                  <span className="animate-pulse text-sm font-bold uppercase tracking-widest text-lime-400">🔔 A la cancha</span>
                  <span className="font-display text-2xl font-black text-white sm:text-3xl">CANCHA {p.cancha}</span>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-lg font-bold sm:text-2xl">
                  <div className="min-w-0 text-lime-400"><Nombres p={p} lado="A" /></div>
                  <span className="text-sm font-semibold text-navy-300">vs</span>
                  <div className="min-w-0 text-right text-[#ff5fb1]"><Nombres p={p} lado="B" /></div>
                </div>
              </div>
            ))}
          </div>
        )}

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
                  {([['A', s.a, sg.A], ['B', s.b, sg.B]] as const).map(([lado, pts, sets]) => (
                    <div key={lado} className="flex items-center justify-between gap-3 py-1.5">
                      <div className={`min-w-0 font-body text-xl font-bold sm:text-3xl ${lado === 'A' ? 'text-lime-400' : 'text-[#ff5fb1]'}`}>
                        <Nombres p={p} lado={lado} />
                        <p className="text-xs font-semibold text-navy-300">Sets: {sets}</p>
                      </div>
                      <p className="font-display text-6xl font-black leading-none sm:text-8xl">{pts}</p>
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
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-navy-700 bg-navy-800 px-3 py-2.5">
                  <div className="min-w-0 text-base font-bold sm:text-lg">
                    {p.fase === 'llave' && <span className="mb-1 inline-block rounded bg-lime-400 px-1.5 py-0.5 font-display text-[10px] font-black text-navy-900">{p.titulo || 'LLAVE'}</span>}
                    <Nombres p={p} lado="A" resaltar={p.ganador === 'A'} />
                    <p className="my-0.5 text-xs font-semibold text-navy-400">vs</p>
                    <Nombres p={p} lado="B" resaltar={p.ganador === 'B'} />
                  </div>
                  <span className="whitespace-nowrap font-display text-lg font-bold sm:text-xl">{resumenSets(p)}</span>
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
                        <div className="flex min-w-0 gap-2.5">
                          <span className="pt-0.5 font-display text-sm font-bold text-navy-400">{i + 1}</span>
                          <div className="min-w-0 text-base font-semibold sm:text-lg">
                            {p.fase === 'llave' && <span className="mb-1 inline-block rounded bg-lime-400 px-1.5 py-0.5 font-display text-[10px] font-black text-navy-900">{p.titulo || 'LLAVE'}</span>}
                            <Nombres p={p} lado="A" resaltar={p.ganador === 'A'} />
                            <p className="my-0.5 text-xs font-semibold text-navy-400">vs</p>
                            <Nombres p={p} lado="B" resaltar={p.ganador === 'B'} />
                          </div>
                        </div>
                        <div className="flex flex-col items-end justify-center whitespace-nowrap font-display text-sm font-bold sm:text-base">
                          {p.estado === 'final' ? <span className="text-navy-100">✓ {resumenSets(p)}</span>
                            : vivo && s ? <span className="text-lime-400">EN VIVO {s.a}-{s.b}</span>
                            : p.llamadoAt ? <span className="animate-pulse text-lime-400">🔔 EN CANCHA</span>
                            : <span className="text-navy-400">por jugar</span>}
                        </div>
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
