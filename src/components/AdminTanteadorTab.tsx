// Tanteador de bádminton dobles (Copa Badminton 06/09/2026). Réplica digital de
// la planilla en papel: dos zonas táctiles gigantes, la tira de puntos 1..tope
// que se va tachando, avisos de cambio de lado, deshacer, y todo persistido
// punto a punto en tanteador_partidos (Realtime refresca la lista en vivo entre
// dispositivos). Espejo en localStorage por si se corta la señal en la cancha.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Plus, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { SupabaseService } from '../services/supabaseService';
import type { TanteadorCategoria, TanteadorLado, TanteadorPartido } from '../types';
import { fechaHumana } from '../utils/fechas';
import {
  anotarPunto,
  crearPartido,
  deshacerPunto,
  marcadorActual,
  marcadorDe,
  resumenSets,
  setsGanados,
  terminarManual,
  type AvisoPunto,
} from '../utils/tanteador';

const ESPEJO_KEY = 'volea_tanteador_espejo';

function espejoLeer(): TanteadorPartido | null {
  try {
    const raw = localStorage.getItem(ESPEJO_KEY);
    return raw ? (JSON.parse(raw) as TanteadorPartido) : null;
  } catch {
    return null;
  }
}
function espejoGuardar(p: TanteadorPartido | null) {
  try {
    if (p) localStorage.setItem(ESPEJO_KEY, JSON.stringify(p));
    else localStorage.removeItem(ESPEJO_KEY);
  } catch { /* sin storage no hay espejo, el guardado en la nube sigue */ }
}

type Vista = 'lista' | 'nuevo' | 'juego';
interface Aviso {
  titulo: string;
  detalle: string;
  boton: string;
  onOk?: () => void;
  cancelable?: boolean;
}
interface Sugerencia { torneoId: string; torneo: string; parejas: string[] }

export default function AdminTanteadorTab({ adminEmail }: { adminEmail: string }) {
  const [partidos, setPartidos] = useState<TanteadorPartido[] | null>(null);
  const [vista, setVista] = useState<Vista>('lista');
  const [actual, setActual] = useState<TanteadorPartido | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [espejo, setEspejo] = useState<TanteadorPartido | null>(() => espejoLeer());

  // formulario
  const [fCat, setFCat] = useState<TanteadorCategoria>('DM');
  const [fA, setFA] = useState('');
  const [fB, setFB] = useState('');
  const [fJuez, setFJuez] = useState('');
  const [fCancha, setFCancha] = useState('1');
  const [fObj, setFObj] = useState<15 | 21>(15);
  const [fTorneoId, setFTorneoId] = useState<string | null>(null);

  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const ultimoAvisoOffline = useRef(0);

  const cargar = useCallback(async () => {
    const ps = await SupabaseService.getTanteadorPartidos();
    if (ps) setPartidos(ps);
  }, []);

  useEffect(() => {
    void cargar();
    void SupabaseService.getTanteadorSugerencias().then((s) => { if (s) setSugerencias(s); });
  }, [cargar]);

  // Tiempo real (mismo patrón que el EN VIVO de torneos) + sondeo de respaldo.
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let timer: number | undefined;
    const pedir = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void cargar(), 250);
    };
    const canal = sb.channel('tanteador-partidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tanteador_partidos' }, pedir)
      .subscribe();
    const sondeo = window.setInterval(() => {
      if (vistaRef.current === 'lista') void cargar();
    }, 60000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(sondeo);
      void sb.removeChannel(canal);
    };
  }, [cargar]);

  const persistir = useCallback((p: TanteadorPartido) => {
    setActual(p);
    setPartidos((prev) => {
      const resto = (prev || []).filter((x) => x.id !== p.id);
      return [p, ...resto];
    });
    espejoGuardar(p.estado === 'en_juego' ? p : null);
    setEspejo(p.estado === 'en_juego' ? p : null);
    void SupabaseService.saveTanteadorPartido(p).then((ok) => {
      if (!ok && Date.now() - ultimoAvisoOffline.current > 60000) {
        ultimoAvisoOffline.current = Date.now();
        toast.error('Sin conexión: el partido sigue acá y se sube cuando vuelva la señal.');
      }
    });
  }, []);

  /* ───────── acciones de juego ───────── */
  const abrir = (p: TanteadorPartido) => {
    setActual(p);
    setVista('juego');
    window.scrollTo(0, 0);
  };

  const mostrarAviso = (a: AvisoPunto, p: TanteadorPartido) => {
    if (!a) return;
    if (a.tipo === 'cambio_lado') {
      setAviso({ titulo: 'CAMBIO DE LADO', detalle: `Un equipo llegó a ${p.cambioEn} en el 3er set.`, boton: 'Listo, seguimos' });
    } else if (a.tipo === 'fin_set') {
      const quien = a.ganador === 'A' ? p.parejaA : p.parejaB;
      setAviso({
        titulo: `FIN DEL ${a.numero}${a.numero === 1 ? 'ER' : 'DO'} SET`,
        detalle: `${quien} lo ganó ${a.marcador.a}-${a.marcador.b}. Cambio de lado.`,
        boton: '¡Seguimos!',
      });
    } else {
      const quien = a.ganador === 'A' ? p.parejaA : p.parejaB;
      setAviso({
        titulo: '¡PARTIDO!',
        detalle: `${quien} gana ${resumenSets(p)}.`,
        boton: 'Guardar y volver',
        onOk: () => setVista('lista'),
      });
    }
  };

  const tocar = (ladoPantalla: 'izq' | 'der') => {
    if (!actual || actual.estado !== 'en_juego') return;
    const lado: TanteadorLado = actual.invertido
      ? (ladoPantalla === 'izq' ? 'B' : 'A')
      : (ladoPantalla === 'izq' ? 'A' : 'B');
    const { partido: p, aviso: a } = anotarPunto(actual, lado);
    persistir(p);
    mostrarAviso(a, p);
  };

  const deshacer = () => {
    if (!actual) return;
    persistir(deshacerPunto(actual));
  };

  const terminar = () => {
    if (!actual) return;
    if (actual.estado === 'final') { setVista('lista'); return; }
    const s = marcadorActual(actual);
    setAviso({
      titulo: '¿Terminar partido?',
      detalle: `Va ${resumenSets(actual) || 'sin sets cerrados'}${s.a + s.b ? ` y el set actual ${s.a}-${s.b}` : ''}. Se guarda como está.`,
      boton: 'Sí, terminar',
      cancelable: true,
      onOk: () => {
        persistir(terminarManual(actual));
        setVista('lista');
      },
    });
  };

  const borrar = (p: TanteadorPartido) => {
    setAviso({
      titulo: '¿Borrar partido?',
      detalle: `${p.parejaA} vs ${p.parejaB}. No se puede deshacer.`,
      boton: 'Borrar',
      cancelable: true,
      onOk: () => {
        setPartidos((prev) => (prev || []).filter((x) => x.id !== p.id));
        if (espejo?.id === p.id) { espejoGuardar(null); setEspejo(null); }
        void SupabaseService.deleteTanteadorPartido(p.id).then((ok) => {
          if (!ok) { toast.error('No se pudo borrar en la nube.'); void cargar(); }
        });
      },
    });
  };

  /* ───────── nuevo partido ───────── */
  const abrirNuevo = () => {
    setFA(''); setFB(''); setFJuez(''); setFTorneoId(null);
    setVista('nuevo');
    window.scrollTo(0, 0);
  };

  const empezar = () => {
    const p = crearPartido({
      id: crypto.randomUUID(),
      categoria: fCat,
      parejaA: fA.trim().toUpperCase(),
      parejaB: fB.trim().toUpperCase(),
      juez: fJuez.trim(),
      cancha: fCancha,
      obj: fObj,
      torneoId: fTorneoId,
      creadoPor: adminEmail,
    });
    persistir(p);
    setVista('juego');
    window.scrollTo(0, 0);
  };

  const elegirSugerida = (lado: 'A' | 'B', nombre: string, s: Sugerencia) => {
    if (lado === 'A') setFA(nombre); else setFB(nombre);
    setFTorneoId(s.torneoId);
    if (/FEMENIN/i.test(s.torneo)) setFCat('DF');
    else if (/MASCULIN/i.test(s.torneo)) setFCat('DM');
  };

  const formValido = fA.trim() && fB.trim() && fA.trim().toUpperCase() !== fB.trim().toUpperCase();

  /* ───────── render ───────── */
  const enJuego = (partidos || []).filter((p) => p.estado === 'en_juego');
  const finales = (partidos || []).filter((p) => p.estado === 'final');
  const espejoPendiente = espejo && espejo.estado === 'en_juego' && !enJuego.some((p) => p.id === espejo.id)
    ? espejo : null;

  return (
    <div>
      <h1 className="hidden font-display text-2xl font-bold text-navy-700 lg:block">Tanteador</h1>

      {/* ============ LISTA ============ */}
      {vista === 'lista' && (
        <div className="mt-0 lg:mt-4">
          <div className="rounded-xl border border-navy-700 bg-navy-800 p-4 text-white">
            <p className="font-display text-sm font-bold text-lime-400">Copa Badminton · dobles · Pickleball City</p>
            <p className="mt-1 text-xs text-navy-100">
              Sets a 15 (desde 14-14 por 2, tope 21) · al mejor de 3 · cambio de lado a los 8 del 3er set.
            </p>
          </div>

          <button
            onClick={abrirNuevo}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-lime-400 px-4 py-3.5 font-display text-base font-bold text-navy-700 hover:bg-lime-300"
          >
            <Plus size={18} /> Nuevo partido
          </button>

          {espejoPendiente && (
            <button
              onClick={() => abrir(espejoPendiente)}
              className="mt-3 w-full rounded-xl border border-lime-400 bg-white p-3 text-left text-sm font-semibold text-navy-700"
            >
              ▶ Retomar partido en curso: {espejoPendiente.parejaA} vs {espejoPendiente.parejaB}
            </button>
          )}

          {partidos === null && (
            <p className="mt-6 text-center text-sm text-navy-500">Cargando partidos…</p>
          )}

          {enJuego.length > 0 && (
            <>
              <p className="mt-5 mb-2 text-xs font-bold uppercase tracking-widest text-navy-500">En juego</p>
              <div className="space-y-2">{enJuego.map((p) => <Card key={p.id} p={p} onAbrir={abrir} onBorrar={borrar} />)}</div>
            </>
          )}
          {finales.length > 0 && (
            <>
              <p className="mt-5 mb-2 text-xs font-bold uppercase tracking-widest text-navy-500">Finalizados</p>
              <div className="space-y-2">{finales.map((p) => <Card key={p.id} p={p} onAbrir={abrir} onBorrar={borrar} />)}</div>
            </>
          )}
          {partidos !== null && !enJuego.length && !finales.length && (
            <div className="mt-5 rounded-xl border border-dashed border-gray-300 bg-white p-4 opacity-70">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-bold text-navy-700">OLSZTYN / CARDOZO</p>
                  <p className="truncate text-navy-500">RIVERO / HERNANDEZ</p>
                </div>
                <p className="font-display text-sm font-bold text-navy-700">15-9 · 12-15 · 15-11</p>
              </div>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Ejemplo — tocá “Nuevo partido” para arrancar</p>
            </div>
          )}
        </div>
      )}

      {/* ============ NUEVO ============ */}
      {vista === 'nuevo' && (
        <div className="mt-0 max-w-xl lg:mt-4">
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="font-display text-lg font-bold text-navy-700">Nuevo partido</p>

            <label className="mt-4 block text-xs font-bold uppercase tracking-widest text-navy-500">Categoría</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(['DM', 'DF'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setFCat(c)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold ${fCat === c ? 'border-lime-400 bg-lime-400 text-navy-700' : 'border-gray-200 bg-white text-navy-700 hover:border-navy-700'}`}
                >
                  {c === 'DM' ? 'Dobles Masculino' : 'Dobles Femenino'}
                </button>
              ))}
            </div>

            {(['A', 'B'] as const).map((lado) => (
              <div key={lado}>
                <label className="mt-4 block text-xs font-bold uppercase tracking-widest text-navy-500">
                  Dupla {lado} {lado === 'A' ? '(lado lima)' : '(lado rosa)'}
                </label>
                <input
                  value={lado === 'A' ? fA : fB}
                  onChange={(e) => (lado === 'A' ? setFA(e.target.value.toUpperCase()) : setFB(e.target.value.toUpperCase()))}
                  placeholder="APELLIDO / APELLIDO"
                  className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-navy-700 focus:border-lime-400 focus:outline-none"
                />
                {sugerencias.map((s) => (
                  <div key={s.torneoId + lado} className="mt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{s.torneo}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {s.parejas.map((nombre) => {
                        const otro = (lado === 'A' ? fB : fA).trim().toUpperCase();
                        const sel = (lado === 'A' ? fA : fB).trim().toUpperCase() === nombre.toUpperCase();
                        return (
                          <button
                            key={nombre}
                            disabled={otro === nombre.toUpperCase()}
                            onClick={() => elegirSugerida(lado, nombre.toUpperCase(), s)}
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold disabled:opacity-30 ${sel ? 'border-lime-400 bg-lime-50 text-navy-700' : 'border-gray-200 text-navy-600 hover:border-navy-700'}`}
                          >
                            {nombre}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-navy-500">Juez (opcional)</label>
                <input
                  value={fJuez}
                  onChange={(e) => setFJuez(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-navy-700 focus:border-lime-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-navy-500">Cancha</label>
                <select
                  value={fCancha}
                  onChange={(e) => setFCancha(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-navy-700 focus:border-lime-400 focus:outline-none"
                >
                  {['1', '2', '3'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <label className="mt-4 block text-xs font-bold uppercase tracking-widest text-navy-500">Sets</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {([15, 21] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setFObj(n)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold ${fObj === n ? 'border-lime-400 bg-lime-400 text-navy-700' : 'border-gray-200 bg-white text-navy-700 hover:border-navy-700'}`}
                >
                  A {n} (tope {n === 15 ? 21 : 30})
                </button>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <button
                onClick={() => setVista('lista')}
                className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-navy-700 hover:border-navy-700"
              >
                Volver
              </button>
              <button
                onClick={empezar}
                disabled={!formValido}
                className="col-span-2 rounded-lg bg-lime-400 px-4 py-3 font-display text-sm font-bold text-navy-700 hover:bg-lime-300 disabled:bg-gray-200 disabled:text-gray-400"
              >
                Empezar partido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ JUEGO ============ */}
      {vista === 'juego' && actual && (
        <Juego
          p={actual}
          onTocar={tocar}
          onDeshacer={deshacer}
          onInvertir={() => persistir({ ...actual, invertido: !actual.invertido })}
          onTerminar={terminar}
          onVolver={() => setVista('lista')}
        />
      )}

      {/* ============ OVERLAY ============ */}
      {aviso && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-navy-900/95 p-6">
          <div className="w-full max-w-md text-center">
            <p className="font-display text-4xl font-black leading-tight text-lime-400 sm:text-5xl">{aviso.titulo}</p>
            <p className="mt-3 text-base font-semibold text-white">{aviso.detalle}</p>
            <button
              onClick={() => { const ok = aviso.onOk; setAviso(null); ok?.(); }}
              className="mt-6 w-full rounded-xl bg-lime-400 px-4 py-3.5 font-display text-base font-bold text-navy-700 hover:bg-lime-300"
            >
              {aviso.boton}
            </button>
            {aviso.cancelable && (
              <button
                onClick={() => setAviso(null)}
                className="mt-2.5 w-full rounded-xl border border-navy-600 px-4 py-3 text-sm font-semibold text-white"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── tarjeta de la lista ───────── */
function Card({ p, onAbrir, onBorrar }: {
  p: TanteadorPartido;
  onAbrir: (p: TanteadorPartido) => void;
  onBorrar: (p: TanteadorPartido) => void;
}) {
  const vivo = p.estado === 'en_juego';
  const s = vivo ? marcadorActual(p) : null;
  return (
    <div
      onClick={() => onAbrir(p)}
      className="cursor-pointer rounded-xl border border-gray-100 bg-white p-3 shadow-sm hover:border-navy-700 sm:p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className={`truncate ${p.ganador === 'A' ? 'font-bold text-navy-700' : 'text-navy-600'}`}>
            {p.ganador === 'A' && <span className="mr-1 rounded bg-lime-400 px-1 font-display text-[10px] font-black text-navy-800">W</span>}
            {p.parejaA}
          </p>
          <p className={`truncate ${p.ganador === 'B' ? 'font-bold text-navy-700' : 'text-navy-600'}`}>
            {p.ganador === 'B' && <span className="mr-1 rounded bg-lime-400 px-1 font-display text-[10px] font-black text-navy-800">W</span>}
            {p.parejaB}
          </p>
        </div>
        <p className="whitespace-nowrap font-display text-sm font-bold text-navy-700">
          {resumenSets(p)}
          {vivo && s && <span className="text-lime-600">{p.sets.length ? ' · ' : ''}{s.a}-{s.b}</span>}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-navy-500">
        <span className={`rounded-full border px-2 py-0.5 font-semibold ${p.categoria === 'DM' ? 'border-navy-200 text-navy-600' : 'border-pink-200 text-pink-600'}`}>
          {p.categoria === 'DM' ? 'Masculino' : 'Femenino'}
        </span>
        {vivo
          ? <span className="rounded-full border border-lime-500 px-2 py-0.5 font-bold text-lime-600">EN JUEGO</span>
          : <span className="rounded-full border border-gray-200 px-2 py-0.5 font-semibold">FINAL</span>}
        <span>Cancha {p.cancha}{p.juez ? ` · Juez: ${p.juez}` : ''}</span>
        <span>{fechaHumana(p.createdAt, Date.now())}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onBorrar(p); }}
          className="ml-auto rounded p-1 text-gray-300 hover:text-red-500"
          aria-label="Borrar partido"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

/* ───────── pantalla de juego ───────── */
function Juego({ p, onTocar, onDeshacer, onInvertir, onTerminar, onVolver }: {
  p: TanteadorPartido;
  onTocar: (lado: 'izq' | 'der') => void;
  onDeshacer: () => void;
  onInvertir: () => void;
  onTerminar: () => void;
  onVolver: () => void;
}) {
  const s = marcadorActual(p);
  const sg = setsGanados(p);
  const izqEsA = !p.invertido;
  const ult = p.hist[p.hist.length - 1]?.slice(-1)[0] ?? null;
  const puedeDeshacer = p.hist.some((h) => h.length) || p.estado === 'final';

  const zona = (ladoPantalla: 'izq' | 'der') => {
    const esA = ladoPantalla === 'izq' ? izqEsA : !izqEsA;
    const nombre = esA ? p.parejaA : p.parejaB;
    const puntos = esA ? s.a : s.b;
    const sets = esA ? sg.A : sg.B;
    const sirve = ult !== null && (esA ? ult === 'A' : ult === 'B');
    return (
      <button
        onClick={() => onTocar(ladoPantalla)}
        disabled={p.estado !== 'en_juego'}
        className={`relative flex min-h-[36vh] flex-col items-center justify-between rounded-2xl border-2 px-2 py-4 text-center active:brightness-125 disabled:opacity-70 ${
          esA ? 'border-lime-400 bg-lime-400/10' : 'border-[#E91E8C] bg-[#E91E8C]/10'
        }`}
        aria-label={`Punto para ${nombre}`}
      >
        <span className={`absolute right-3 top-2.5 text-lg transition-opacity ${sirve ? 'opacity-100' : 'opacity-0'}`} aria-hidden>🏸</span>
        <span className={`min-h-[2.5em] break-words font-body text-xs font-bold leading-snug sm:text-base ${esA ? 'text-lime-400' : 'text-[#ff5fb1]'}`}>
          {nombre}
        </span>
        <span className="font-display text-[clamp(64px,17vw,130px)] font-black leading-none text-white">{puntos}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-navy-200">
          Sets <span className="font-display text-sm text-white">{sets}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="mt-0 rounded-2xl bg-navy-800 p-3 sm:p-4 lg:mt-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <button onClick={onVolver} className="rounded-lg border border-navy-600 px-3 py-1.5 text-xs font-bold text-white">
          ‹ Partidos
        </button>
        <p className="text-right text-xs font-semibold text-navy-200">
          {p.categoria} · Cancha {p.cancha}{p.juez ? ` · ${p.juez}` : ''}
        </p>
      </div>

      <div className="mb-2.5 flex flex-wrap justify-center gap-1.5">
        {p.sets.map((x, k) => (
          <span key={k} className="rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-1 font-display text-xs font-bold text-navy-100">
            Set {k + 1} <span className="text-white">{x.a}-{x.b}</span>
          </span>
        ))}
        {p.estado === 'en_juego' && (
          <span className="rounded-lg border border-lime-400 bg-navy-900 px-2.5 py-1 font-display text-xs font-bold text-lime-400">
            Set {p.sets.length + 1} <span>{s.a}-{s.b}</span>
          </span>
        )}
        {p.estado === 'final' && (
          <span className="rounded-lg bg-lime-400 px-2.5 py-1 font-display text-xs font-black text-navy-800">
            FINAL{p.ganador ? ` · GANA ${p.ganador === 'A' ? p.parejaA : p.parejaB}` : ''}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {zona('izq')}
        {zona('der')}
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <button
          onClick={onDeshacer}
          disabled={!puedeDeshacer}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-navy-600 bg-navy-900 px-2 py-3 text-xs font-bold text-white disabled:opacity-40"
        >
          <Undo2 size={14} /> Deshacer
        </button>
        <button
          onClick={onInvertir}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-navy-600 bg-navy-900 px-2 py-3 text-xs font-bold text-white"
        >
          <ArrowLeftRight size={14} /> Lados
        </button>
        <button
          onClick={onTerminar}
          className="rounded-xl border border-navy-600 bg-navy-900 px-2 py-3 text-xs font-bold text-white"
        >
          {p.estado === 'final' ? 'Volver' : 'Terminar'}
        </button>
      </div>

      {/* La tira de la planilla: números 1..tope que se tachan al anotar */}
      <div className="mt-3 rounded-xl border border-navy-700 bg-navy-900/60 p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-navy-300">Planilla del partido</p>
        {p.hist.map((h, k) => {
          const ms = k < p.sets.length ? p.sets[k] : marcadorDe(h);
          return (
            <div key={k} className={k > 0 ? 'mt-3' : ''}>
              <div className="mb-1 flex justify-between text-[10px] font-bold text-navy-300">
                <span>{k + 1}{k === 0 ? 'ER' : k === 1 ? 'DO' : 'ER'} SET</span>
                <span className="font-display text-navy-100">{ms.a} - {ms.b}</span>
              </div>
              {(['A', 'B'] as const).map((lado) => (
                <div
                  key={lado}
                  className="mb-0.5 grid gap-[2px]"
                  style={{ gridTemplateColumns: `repeat(${p.cap}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: p.cap }, (_, n) => {
                    const num = n + 1;
                    const pts = lado === 'A' ? ms.a : ms.b;
                    const lleno = num <= pts;
                    return (
                      <span
                        key={num}
                        className={`rounded-sm border py-[3px] text-center font-display text-[8px] font-semibold leading-none ${
                          lleno
                            ? lado === 'A'
                              ? 'border-lime-400 bg-lime-400 text-navy-900 line-through'
                              : 'border-[#E91E8C] bg-[#E91E8C] text-white line-through'
                            : `border-navy-700 bg-navy-900 text-navy-500 ${num > p.obj ? 'border-dashed' : ''}`
                        }`}
                      >
                        {num}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
