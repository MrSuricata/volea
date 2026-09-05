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
import type { TanteadorCategoria, TanteadorLado, TanteadorModo, TanteadorPartido } from '../types';
import { fechaHumana } from '../utils/fechas';
import {
  anotarPunto,
  crearPartido,
  deshacerPunto,
  jugadoresDe,
  marcadorActual,
  marcadorDe,
  resumenSets,
  setsGanados,
  tablaAmericano,
  tablaParejas,
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

  // formulario — modo 'fijas': dos duplas · modo 'rotativas': 4 jugadores sueltos
  const [fCat, setFCat] = useState<TanteadorCategoria>('DM');
  const [fModo, setFModo] = useState<TanteadorModo>('fijas');
  const [fPa, setFPa] = useState('');
  const [fPb, setFPb] = useState('');
  const [fJug, setFJug] = useState<string[]>(['', '', '', '']);
  const [fJuez, setFJuez] = useState('');
  const [fCancha, setFCancha] = useState('1');
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
    setFPa(''); setFPb(''); setFJug(['', '', '', '']); setFJuez(''); setFTorneoId(null);
    setFModo(fCat === 'DM' ? 'fijas' : 'rotativas');
    setVista('nuevo');
    window.scrollTo(0, 0);
  };

  const partirNombres = (texto: string) =>
    texto.split(/\s*[/\-]\s*/).map((s) => s.trim().toUpperCase()).filter(Boolean);

  const empezar = () => {
    // Formato de la copa: a 15 (tope 21), al mejor de 3. reglasPara(21) queda
    // en utils para torneos futuros.
    const base = {
      id: crypto.randomUUID(),
      categoria: fCat,
      modo: fModo,
      juez: fJuez.trim(),
      cancha: fCancha,
      obj: 15 as const,
      torneoId: fTorneoId,
      creadoPor: adminEmail,
    };
    let p: TanteadorPartido;
    if (fModo === 'fijas') {
      const pa = fPa.trim().toUpperCase();
      const pb = fPb.trim().toUpperCase();
      p = crearPartido({ ...base, parejaA: pa, parejaB: pb, jugadoresA: partirNombres(pa), jugadoresB: partirNombres(pb) });
    } else {
      const [a1, a2, b1, b2] = fJug.map((j) => j.trim().toUpperCase());
      p = crearPartido({ ...base, parejaA: `${a1} / ${a2}`, parejaB: `${b1} / ${b2}`, jugadoresA: [a1, a2], jugadoresB: [b1, b2] });
    }
    persistir(p);
    setVista('juego');
    window.scrollTo(0, 0);
  };

  // Pool de nombres para armar el partido con toques: jugadores de partidos ya
  // cargados en la categoría + los de las parejas de los torneos activos.
  const nombresSugeridos = (() => {
    const pool = new Set<string>();
    for (const p of partidos || []) {
      if (p.categoria !== fCat) continue;
      for (const lado of ['A', 'B'] as const) jugadoresDe(p, lado).forEach((n) => pool.add(n));
    }
    for (const s of sugerencias) {
      if (fCat === 'DF' ? !/FEMENIN/i.test(s.torneo) : /FEMENIN/i.test(s.torneo)) continue;
      for (const pareja of s.parejas) {
        pareja.split(/\s*[/\-]\s*/).forEach((n) => {
          const t = n.trim().toUpperCase();
          if (t) pool.add(t);
        });
      }
    }
    const elegidos = fJug.map((j) => j.trim().toUpperCase());
    return [...pool].sort().filter((n) => !elegidos.includes(n));
  })();

  const ponerNombre = (nombre: string) => {
    const i = fJug.findIndex((j) => !j.trim());
    if (i === -1) return;
    setFJug(fJug.map((j, k) => (k === i ? nombre : j)));
  };

  // Duplas para el modo fijas. Las etiquetas de partidos ya cargados mandan
  // (la tabla agrupa por ese texto EXACTO); los torneos solo siembran la
  // primera vez, para no ofrecer la misma dupla escrita de dos maneras.
  const duplasSugeridas = (() => {
    const pool = new Set<string>();
    for (const p of partidos || []) {
      if (p.categoria !== fCat || p.modo !== 'fijas') continue;
      pool.add(p.parejaA);
      pool.add(p.parejaB);
    }
    if (!pool.size) {
      for (const s of sugerencias) {
        if (fCat === 'DF' ? !/FEMENIN/i.test(s.torneo) : /FEMENIN/i.test(s.torneo)) continue;
        for (const pareja of s.parejas) pool.add(partirNombres(pareja).join(' / '));
      }
    }
    const sel = [fPa.trim().toUpperCase(), fPb.trim().toUpperCase()];
    return [...pool].sort().filter((n) => !sel.includes(n));
  })();

  const ponerDupla = (nombre: string) => {
    if (!fPa.trim()) setFPa(nombre);
    else if (!fPb.trim()) setFPb(nombre);
  };

  const jugLimpios = fJug.map((j) => j.trim().toUpperCase());
  const formValido = fModo === 'fijas'
    ? !!(fPa.trim() && fPb.trim() && fPa.trim().toUpperCase() !== fPb.trim().toUpperCase())
    : jugLimpios.every(Boolean) && new Set(jugLimpios).size === 4;

  /* ───────── render ───────── */
  const vivos = (partidos || []).filter((p) => p.estado === 'en_juego');
  const puntosDe = (p: TanteadorPartido) => p.hist.reduce((n, h) => n + h.length, 0);
  const enJuego = vivos.filter((p) => puntosDe(p) > 0);
  // Los cruces precargados: en juego sin puntos = todavía no arrancaron.
  const porJugar = vivos.filter((p) => puntosDe(p) === 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const finales = (partidos || []).filter((p) => p.estado === 'final');
  const espejoPendiente = espejo && espejo.estado === 'en_juego' && !vivos.some((p) => p.id === espejo.id)
    ? espejo : null;

  return (
    <div>
      <h1 className="hidden font-display text-2xl font-bold text-navy-700 lg:block">Tanteador</h1>

      {/* ============ LISTA ============ */}
      {vista === 'lista' && (
        <div className="mt-0 lg:mt-4">
          <div className="rounded-xl border border-navy-700 bg-navy-800 p-4 text-white">
            <p className="font-display text-sm font-bold text-lime-400">Copa Badminton · Pickleball City</p>
            <p className="mt-1 text-xs text-navy-100">
              Masculino: duplas fijas, todos contra todos · Femenino: americano (rotativas, ida y vuelta) ·
              sets a 15 (desde 14-14 por 2, tope 21) · al mejor de 3 · cambio de lado a los 8 del 3er set.
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
          {porJugar.length > 0 && (
            <>
              <p className="mt-5 mb-2 text-xs font-bold uppercase tracking-widest text-navy-500">Cruces por jugar ({porJugar.length})</p>
              <div className="space-y-2">{porJugar.map((p) => <Card key={p.id} p={p} onAbrir={abrir} onBorrar={borrar} />)}</div>
            </>
          )}
          {(['DM', 'DF'] as const).flatMap((cat) => {
            const deCat = (partidos || []).filter((p) => p.categoria === cat);
            const bloques = [
              { clave: `${cat}-duplas`, titulo: 'de duplas', unidad: 'Dupla', filas: tablaParejas(deCat.filter((p) => p.modo === 'fijas'), cat) },
              { clave: `${cat}-ind`, titulo: 'individual', unidad: 'Jugador', filas: tablaAmericano(deCat.filter((p) => p.modo === 'rotativas'), cat) },
            ].filter((b) => b.filas.length > 0);
            return bloques.map(({ clave, titulo, unidad, filas: tabla }) => (
              <div key={clave}>
                <p className="mt-5 mb-2 text-xs font-bold uppercase tracking-widest text-navy-500">
                  Tabla {titulo} — {cat === 'DM' ? 'Masculino' : 'Femenino'}
                </p>
                <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
                  <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-[10px] font-bold uppercase tracking-wider text-navy-400">
                        <th className="px-3 py-2">#</th>
                        <th className="py-2">{unidad}</th>
                        <th className="px-2 py-2 text-center">PJ</th>
                        <th className="px-2 py-2 text-center">PG</th>
                        <th className="px-2 py-2 text-center">Dif</th>
                        <th className="px-2 py-2 text-center">PF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabla.map((f, i) => (
                        <tr
                          key={f.nombre}
                          className={`border-b border-gray-50 last:border-0 ${
                            i === 0 ? 'bg-lime-50 font-bold text-navy-800'
                            : i === 1 ? 'bg-gray-50 font-semibold text-navy-700'
                            : 'text-navy-600'
                          }`}
                        >
                          <td className="px-3 py-1.5">{i === 0 ? '🥇' : i === 1 ? '🥈' : i + 1}</td>
                          <td className="py-1.5">{f.nombre}</td>
                          <td className="px-2 py-1.5 text-center">{f.pj}</td>
                          <td className="px-2 py-1.5 text-center">{f.pg}</td>
                          <td className="px-2 py-1.5 text-center">{f.dif > 0 ? `+${f.dif}` : f.dif}</td>
                          <td className="px-2 py-1.5 text-center">{f.pf}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 px-1 text-[10px] text-navy-400">
                  Orden: partidos ganados → diferencia de puntos → puntos a favor. Solo partidos terminados.
                </p>
              </div>
            ));
          })}

          {finales.length > 0 && (
            <>
              <p className="mt-5 mb-2 text-xs font-bold uppercase tracking-widest text-navy-500">Finalizados</p>
              <div className="space-y-2">{finales.map((p) => <Card key={p.id} p={p} onAbrir={abrir} onBorrar={borrar} />)}</div>
            </>
          )}
          {partidos !== null && !vivos.length && !finales.length && (
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
                  onClick={() => { setFCat(c); setFModo(c === 'DM' ? 'fijas' : 'rotativas'); }}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold ${fCat === c ? 'border-lime-400 bg-lime-400 text-navy-700' : 'border-gray-200 bg-white text-navy-700 hover:border-navy-700'}`}
                >
                  {c === 'DM' ? 'Dobles Masculino' : 'Dobles Femenino'}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-xs font-bold uppercase tracking-widest text-navy-500">Formato</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {([['fijas', 'Duplas fijas'], ['rotativas', 'Rotativas (americano)']] as const).map(([m, etiqueta]) => (
                <button
                  key={m}
                  onClick={() => setFModo(m)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold ${fModo === m ? 'border-lime-400 bg-lime-400 text-navy-700' : 'border-gray-200 bg-white text-navy-700 hover:border-navy-700'}`}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-navy-400">
              Duplas fijas: la tabla suma por pareja. Rotativas: la tabla suma por jugador.
            </p>

            {fModo === 'fijas' ? (
              <>
                <label className="mt-4 block text-xs font-bold uppercase tracking-widest text-navy-500">
                  Duplas — arriba lado lima, abajo lado rosa
                </label>
                <div className="mt-1.5 space-y-2">
                  <input
                    value={fPa}
                    onChange={(e) => setFPa(e.target.value.toUpperCase())}
                    placeholder="DUPLA A (APELLIDO / APELLIDO)"
                    className="w-full rounded-lg border-2 border-lime-400/70 px-3 py-2.5 text-sm font-semibold text-navy-700 focus:border-lime-500 focus:outline-none"
                  />
                  <input
                    value={fPb}
                    onChange={(e) => setFPb(e.target.value.toUpperCase())}
                    placeholder="DUPLA B (APELLIDO / APELLIDO)"
                    className="w-full rounded-lg border-2 border-[#E91E8C]/40 px-3 py-2.5 text-sm font-semibold text-navy-700 focus:border-[#E91E8C] focus:outline-none"
                  />
                </div>
                {duplasSugeridas.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {duplasSugeridas.map((n) => (
                      <button
                        key={n}
                        onClick={() => ponerDupla(n)}
                        className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-navy-600 hover:border-navy-700"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-navy-400">Tocá una dupla y va al primer lugar libre. Usá siempre el mismo nombre de dupla para que la tabla sume bien.</p>
              </>
            ) : (
              <>
                <label className="mt-4 block text-xs font-bold uppercase tracking-widest text-navy-500">
                  Jugadores — arriba lado lima, abajo lado rosa
                </label>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {fJug.map((v, i) => (
                    <input
                      key={i}
                      value={v}
                      onChange={(e) => setFJug(fJug.map((j, k) => (k === i ? e.target.value.toUpperCase() : j)))}
                      placeholder={i < 2 ? `JUGADOR A${i + 1}` : `JUGADOR B${i - 1}`}
                      className={`w-full rounded-lg border-2 px-3 py-2.5 text-sm font-semibold text-navy-700 focus:outline-none ${
                        i < 2 ? 'border-lime-400/70 focus:border-lime-500' : 'border-[#E91E8C]/40 focus:border-[#E91E8C]'
                      }`}
                    />
                  ))}
                </div>
                {nombresSugeridos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {nombresSugeridos.map((n) => (
                      <button
                        key={n}
                        onClick={() => ponerNombre(n)}
                        className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-navy-600 hover:border-navy-700"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-navy-400">Tocá un nombre y va al primer lugar libre. Usá siempre el mismo nombre de jugador para que la tabla sume bien.</p>
              </>
            )}

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

            <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs font-semibold text-navy-500">
              Formato de la copa: sets a 15 (desde 14-14 por 2, tope 21) · al mejor de 3.
            </p>

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
