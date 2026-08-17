import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, Link2, RefreshCw, Search, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import type { Inscripcion, LedgerEntry } from '../types';
import { SupabaseService } from '../services/supabaseService';
import { parsearRating } from '../utils/dupr';
import type { JugadorPadron } from '../utils/dupr';
import { historialDeJugador, nombresSinVincular } from '../utils/jugadores';
import type { NombreSinVincular } from '../utils/jugadores';
import { normalizar, sugerirDeudores } from '../utils/nombres';
import { fechaHumana } from '../utils/fechas';
import { categoriasDe } from '../utils/inscripciones';

const money = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });
const METODO: Record<string, string> = {
  mp: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia', debe: 'Fiado',
};
/** Deudores que Brian marcó como "no es un jugador" (club, familiar, etc.). */
const NO_JUGADORES = 'volea_deudores_no_jugador';

/**
 * Pestaña Jugadores: el padrón con su ficha — qué compró, qué debe, su DUPR y
 * sus inscripciones. Incluye la vinculación asistida de los nombres de deudor
 * viejos (texto libre) al padrón.
 */
export default function AdminJugadoresTab({ loadLedgerFull }: {
  loadLedgerFull: () => Promise<LedgerEntry[] | null>;
}) {
  const [padron, setPadron] = useState<JugadorPadron[] | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [elegido, setElegido] = useState<string | null>(null);
  const [vincularAbierto, setVincularAbierto] = useState(false);
  const [ignorados, setIgnorados] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(NO_JUGADORES) || '[]'); } catch { return []; }
  });

  const cargar = async () => {
    setCargando(true);
    try {
      const [p, l, eventos] = await Promise.all([
        SupabaseService.getJugadoresPadron(),
        loadLedgerFull(),
        SupabaseService.getEvents(),
      ]);
      setPadron(p);
      setLedger(l ?? []);
      // Inscripciones de todos los eventos con inscripción (para la ficha).
      const conInscripcion = eventos.filter(e => e.inscripcionesAbiertas || e.categorias);
      const listas = await Promise.all(conInscripcion.map(e => SupabaseService.getInscripciones(e.id)));
      setInscripciones(listas.flatMap((x, i) => (x ?? []).map(ins => ({ ...ins, eventId: conInscripcion[i].id }))));
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { void cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const sinVincular = useMemo(() => nombresSinVincular(ledger, ignorados), [ledger, ignorados]);

  const q = normalizar(busqueda);
  const filtrados = useMemo(() => {
    const lista = padron ?? [];
    if (q === '') return lista;
    return lista.filter(j =>
      normalizar(j.nombre).includes(q)
      || j.alias.some(a => normalizar(a).includes(q))
      || (j.duprId || '').toLowerCase().includes(q));
  }, [padron, q]);

  // Resumen por jugador (deuda y compras) para la lista.
  const resumen = useMemo(() => {
    const m = new Map<string, { deuda: number; comprado: number }>();
    for (const j of padron ?? []) {
      const h = historialDeJugador(j, ledger);
      if (h.movimientos.length > 0) m.set(j.id, { deuda: h.deudaAbierta, comprado: h.totalComprado });
    }
    return m;
  }, [padron, ledger]);

  const jugadorElegido = (padron ?? []).find(j => j.id === elegido) ?? null;

  const marcarNoJugador = (nombre: string) => {
    const nuevos = [...ignorados, nombre];
    setIgnorados(nuevos);
    localStorage.setItem(NO_JUGADORES, JSON.stringify(nuevos));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-navy-700">
          <UserRound size={22} /> Jugadores
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {sinVincular.length > 0 && (
            <button onClick={() => setVincularAbierto(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 font-display text-sm font-bold text-white hover:bg-amber-600">
              <Link2 size={14} /> Vincular deudores ({sinVincular.length})
            </button>
          )}
          <button onClick={() => void cargar()} disabled={cargando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-navy-700 hover:border-navy-700 disabled:opacity-50">
            <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar jugador por nombre o DUPR…"
          className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-lime-400 outline-none" />
      </div>

      {cargando && padron === null && <p className="py-10 text-center text-sm text-gray-400">Cargando padrón…</p>}
      {padron !== null && (
        <p className="text-xs text-gray-400">
          {filtrados.length} de {padron.length} jugadores
          {sinVincular.length > 0 && <> · {sinVincular.length} nombres de deudor sin vincular</>}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtrados.map(j => {
          const r = resumen.get(j.id);
          return (
            <button key={j.id} onClick={() => setElegido(j.id)}
              className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-left transition-colors hover:border-lime-400 hover:bg-lime-50/40">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-700/10 font-display text-xs font-bold text-navy-700">
                  {j.nombre.charAt(0).toUpperCase()}
                </span>
                <p className="truncate font-display text-sm font-bold text-navy-700">{j.nombre}</p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {j.rating != null && (
                  <span className="rounded-full bg-lime-100 px-2 py-0.5 text-[11px] font-bold text-lime-800">{j.rating.toFixed(3)}</span>
                )}
                {j.duprId && (
                  <span className="rounded-full bg-navy-700/10 px-2 py-0.5 text-[11px] font-bold text-navy-700">DUPR {j.duprId}</span>
                )}
                {r && r.deuda > 0 && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">debe {money(r.deuda)}</span>
                )}
                {r && r.comprado > 0 && (
                  <span className="text-[11px] text-gray-400">compró {money(r.comprado)}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {jugadorElegido && (
        <FichaJugador
          jugador={jugadorElegido}
          ledger={ledger}
          inscripciones={inscripciones}
          onClose={() => setElegido(null)}
          onGuardado={() => { setElegido(null); void cargar(); }}
        />
      )}

      {vincularAbierto && padron && (
        <VincularDeudoresModal
          pendientes={sinVincular}
          padron={padron}
          onIgnorar={marcarNoJugador}
          onClose={() => setVincularAbierto(false)}
          onVinculado={() => void cargar()}
        />
      )}
    </div>
  );
}

// ─── Ficha ───────────────────────────────────────────────────────────────────

function FichaJugador({ jugador, ledger, inscripciones, onClose, onGuardado }: {
  jugador: JugadorPadron;
  ledger: LedgerEntry[];
  inscripciones: Inscripcion[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const h = historialDeJugador(jugador, ledger);
  const ahoraMs = Date.now();
  const [dupr, setDupr] = useState(jugador.duprId || '');
  const [rating, setRating] = useState(jugador.rating != null ? String(jugador.rating) : '');
  const [guardando, setGuardando] = useState(false);

  const nombres = new Set([jugador.nombre, ...jugador.alias].map(normalizar));
  const susInscripciones = inscripciones.filter(i => i.estado !== 'baja' && nombres.has(normalizar(i.nombre)));

  const ratingNum = rating.trim() === '' ? null : parsearRating(rating);
  const ratingInvalido = rating.trim() !== '' && ratingNum === null;
  const hayCambios = dupr.trim() !== (jugador.duprId || '') || ratingNum !== (jugador.rating ?? null);

  const guardarDupr = async () => {
    if (guardando || !hayCambios || ratingInvalido) return;
    setGuardando(true);
    try {
      const r = await SupabaseService.setDuprIds([{ id: jugador.id, duprId: dupr.trim(), rating: ratingNum }]);
      if (!r.ok) { toast.error(r.error || 'No se pudo guardar el DUPR'); return; }
      toast.success('DUPR guardado ✓');
      onGuardado();
    } finally {
      setGuardando(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h3 className="font-display text-lg font-bold text-navy-700">{jugador.nombre}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-navy-700">✕</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-100 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Compró</p>
              <p className="font-display text-lg font-bold text-navy-700">{money(h.totalComprado)}</p>
            </div>
            <div className={`rounded-xl border px-3 py-2 ${h.deudaAbierta > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-100'}`}>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Debe</p>
              <p className={`font-display text-lg font-bold ${h.deudaAbierta > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                {money(h.deudaAbierta)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Movimientos</p>
              <p className="font-display text-lg font-bold text-navy-700">{h.movimientos.length}</p>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-xs font-display font-semibold uppercase text-gray-500">DUPR</span>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="ficha-dupr" className="mb-0.5 block text-[11px] text-gray-400">ID</label>
                <input id="ficha-dupr" type="text" value={dupr} onChange={e => setDupr(e.target.value)}
                  placeholder="7XZ4V2"
                  className="w-32 rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm focus:border-lime-400 outline-none" />
              </div>
              <div>
                <label htmlFor="ficha-rating" className="mb-0.5 block text-[11px] text-gray-400">Rating (hoy)</label>
                <input id="ficha-rating" type="text" inputMode="decimal" value={rating} onChange={e => setRating(e.target.value)}
                  placeholder="3.600"
                  className={`w-24 rounded-lg border px-3 py-2 font-mono text-sm outline-none ${
                    ratingInvalido ? 'border-red-300' : 'border-gray-200 focus:border-lime-400'
                  }`} />
              </div>
              <button onClick={() => void guardarDupr()} disabled={guardando || !hayCambios || ratingInvalido}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy-700 px-3 py-2 text-sm font-bold text-white hover:bg-navy-800 disabled:bg-gray-200 disabled:text-gray-400">
                <BadgeCheck size={14} /> Guardar
              </button>
              {jugador.ratingAt && !hayCambios && (
                <span className="pb-2 text-[11px] text-gray-400">tomado el {jugador.ratingAt.split('-').reverse().join('/')}</span>
              )}
            </div>
            {ratingInvalido && <p className="mt-1 text-xs text-red-500">El rating va de 1 a 8 (ej: 3.6 o 3.600).</p>}
          </div>

          {susInscripciones.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">Inscripciones</p>
              <div className="space-y-1">
                {susInscripciones.map(i => (
                  <p key={i.id} className="text-sm text-gray-600">
                    <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      i.estado === 'confirmada' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                    }`}>{i.estado}</span>
                    {categoriasDe(i).join(' · ')}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">Historial de compras</p>
            {h.movimientos.length === 0 && <p className="py-4 text-center text-sm text-gray-400">Todavía no compró nada.</p>}
            <div className="space-y-1">
              {h.movimientos.map(m => (
                <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
                  <span className="font-semibold text-navy-700">{m.label}</span>
                  {m.qty > 1 && <span className="text-xs text-gray-400">×{m.qty}</span>}
                  <span className="ml-auto font-bold tabular-nums text-navy-700">{money(m.amount)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    m.paymentMethod === 'debe'
                      ? m.settledAt ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {m.paymentMethod === 'debe'
                      ? (m.settledAt ? 'fiado · cobrado' : 'fiado · pendiente')
                      : METODO[m.paymentMethod || ''] || '—'}
                  </span>
                  <span className="w-full text-[11px] text-gray-400 sm:w-auto">{fechaHumana(m.createdAt, ahoraMs)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Vinculación asistida ────────────────────────────────────────────────────

function VincularDeudoresModal({ pendientes, padron, onIgnorar, onClose, onVinculado }: {
  pendientes: NombreSinVincular[];
  padron: JugadorPadron[];
  onIgnorar: (nombre: string) => void;
  onClose: () => void;
  onVinculado: () => void;
}) {
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [hechos, setHechos] = useState<Record<string, string>>({});

  // Candidatos del padrón para cada nombre suelto, con el motor de siempre.
  const nombresPadron = padron.map(j => j.nombre);
  const sugerenciasDe = (nombre: string) => {
    const sug = sugerirDeudores([], nombresPadron, nombre).slice(0, 3);
    return sug
      .map(s => padron.find(j => normalizar(j.nombre) === normalizar(s.nombre)))
      .filter((j): j is JugadorPadron => !!j);
  };

  const vincular = async (nombre: string, jugador: JugadorPadron) => {
    if (trabajando) return;
    setTrabajando(nombre);
    try {
      const r = await SupabaseService.vincularDeudor(nombre, jugador.id);
      if (!r.ok) { toast.error(r.error || 'No se pudo vincular'); return; }
      toast.success(`«${nombre}» → ${r.nombre} (${r.tocadas} movimientos)`);
      setHechos(h => ({ ...h, [nombre]: jugador.nombre }));
      onVinculado();
    } finally {
      setTrabajando(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !trabajando && onClose()} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h3 className="font-display text-lg font-bold text-navy-700">Vincular deudores al padrón</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-navy-700">✕</button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          <p className="text-sm text-gray-500">
            Al vincular, TODOS los movimientos de ese nombre pasan al jugador y el nombre queda
            escrito igual que en el padrón: las deudas partidas de la misma persona se juntan solas.
          </p>
          {pendientes.map(p => {
            const hecho = hechos[p.nombre];
            const sugeridos = sugerenciasDe(p.nombre);
            return (
              <div key={p.nombre} className={`rounded-xl border p-3 ${hecho ? 'border-green-200 bg-green-50' : 'border-gray-100'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display font-bold text-navy-700">{p.nombre}</span>
                  <span className="text-xs text-gray-400">
                    {p.movimientos} {p.movimientos === 1 ? 'movimiento' : 'movimientos'}
                    {p.saldo > 0 && <span className="font-bold text-amber-600"> · debe {money(p.saldo)}</span>}
                  </span>
                  {hecho && <span className="text-xs font-bold text-green-700">✓ vinculado a {hecho}</span>}
                </div>
                {!hecho && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {sugeridos.map(j => (
                      <button key={j.id} onClick={() => void vincular(p.nombre, j)} disabled={trabajando !== null}
                        className="rounded-lg border border-lime-400 bg-lime-50 px-2.5 py-1 text-xs font-bold text-navy-700 hover:bg-lime-100 disabled:opacity-50">
                        {trabajando === p.nombre ? '…' : `es ${j.nombre}`}
                      </button>
                    ))}
                    <select
                      defaultValue=""
                      onChange={e => {
                        const j = padron.find(x => x.id === e.target.value);
                        if (j) void vincular(p.nombre, j);
                      }}
                      disabled={trabajando !== null}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-navy-700"
                    >
                      <option value="">otro jugador…</option>
                      {[...padron].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(j => (
                        <option key={j.id} value={j.id}>{j.nombre}</option>
                      ))}
                    </select>
                    <button onClick={() => onIgnorar(p.nombre)} disabled={trabajando !== null}
                      className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500 hover:border-gray-400 disabled:opacity-50">
                      no es un jugador
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {pendientes.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">No queda ningún deudor sin vincular 🎉</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
