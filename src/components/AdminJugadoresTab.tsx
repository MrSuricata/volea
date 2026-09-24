import { useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, Link2, RefreshCw, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import type { Inscripcion, LedgerEntry } from '../types';
import { SupabaseService } from '../services/supabaseService';
import { parsearRating } from '../utils/dupr';
import type { JugadorPadron } from '../utils/dupr';
import { historialDeJugador, nombresSinVincular } from '../utils/jugadores';
import type { NombreSinVincular } from '../utils/jugadores';
import { normalizar, sugerirDeudores } from '../utils/nombres';
import { fechaHumana } from '../utils/fechas';
import { almacenLocal } from '../utils/almacen';
import { categoriasDe } from '../utils/inscripciones';
import {
  BarraFiltros, Boton, BotonIcono, Campo, CargandoFilas, Dialogo, EncabezadoPagina, Entrada, Estadistica, Insignia, Selector, Vacio,
} from '../admin/ui';
import { cn } from '../lib/cn';

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
    const guardados = almacenLocal.leerJSON<unknown>(NO_JUGADORES);
    return Array.isArray(guardados) ? guardados.filter((n): n is string => typeof n === 'string') : [];
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

  // Se guarda en este equipo cada vez que cambia (no al montar: ya vino de ahí).
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) { primeraVez.current = false; return; }
    almacenLocal.guardarJSON(NO_JUGADORES, ignorados);
  }, [ignorados]);
  // "No es un jugador" saca el nombre de la lista para siempre (en este equipo): con
  // Deshacer por si fue un toque de más.
  const marcarNoJugador = (nombre: string) => {
    setIgnorados(prev => (prev.includes(nombre) ? prev : [...prev, nombre]));
    toast(`«${nombre}» marcado como no jugador`, {
      duration: 8000,
      action: { label: 'Deshacer', onClick: () => setIgnorados(prev => prev.filter(n => n !== nombre)) },
    });
  };

  return (
    <div>
      <EncabezadoPagina
        rotulo="Torneos"
        titulo="Jugadores"
        descripcion="El padrón con su ficha: qué compró, qué debe, su DUPR y sus inscripciones."
        acciones={(
          <>
            <BotonIcono
              etiqueta="Actualizar el padrón"
              icono={<RefreshCw size={19} className={cargando ? 'animate-spin' : ''} />}
              onClick={() => void cargar()}
              disabled={cargando}
              className="border border-gray-300 bg-white text-navy-700"
            />
            {sinVincular.length > 0 && (
              <Boton variante="secundario" icono={<Link2 size={17} />} onClick={() => setVincularAbierto(true)}>
                Vincular deudores <Insignia tono="atencion">{sinVincular.length}</Insignia>
              </Boton>
            )}
          </>
        )}
      />

      <BarraFiltros busqueda={busqueda} alBuscar={setBusqueda} placeholder="Buscar jugador por nombre o DUPR…" />

      {cargando && padron === null && <CargandoFilas filas={6} />}
      {padron !== null && (
        <p className="mb-3 text-[13px] text-gray-600">
          {filtrados.length} de {padron.length} jugadores
          {sinVincular.length > 0 && <> · {sinVincular.length} nombres de deudor sin vincular</>}
        </p>
      )}
      {padron !== null && padron.length === 0 && (
        <Vacio icono={<UserRound size={22} />} titulo="El padrón está vacío" descripcion="Se llena con las inscripciones y los torneos vinculados." />
      )}
      {padron !== null && padron.length > 0 && filtrados.length === 0 && (
        <Vacio titulo="Nadie coincide" descripcion={`No hay jugadores con «${busqueda.trim()}».`} />
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtrados.map(j => {
          const r = resumen.get(j.id);
          return (
            <button key={j.id} type="button" onClick={() => setElegido(j.id)}
              className="min-h-[64px] rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-left transition-colors hover:border-navy-700">
              <span className="flex items-center gap-2.5">
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-50 font-display text-sm font-bold text-navy-700">
                  {j.nombre.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 truncate font-display text-[15px] font-bold text-navy-700">{j.nombre}</span>
              </span>
              {(j.rating != null || j.duprId || r) && (
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  {j.rating != null && <Insignia className="tabular-nums">{j.rating.toFixed(3)}</Insignia>}
                  {j.duprId && <Insignia tono="navy">DUPR {j.duprId}</Insignia>}
                  {r && r.deuda > 0 && <Insignia tono="atencion">debe {money(r.deuda)}</Insignia>}
                  {r && r.comprado > 0 && <span className="text-[13px] text-gray-500">compró {money(r.comprado)}</span>}
                </span>
              )}
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
      toast.success('DUPR guardado');
      onGuardado();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialogo abierto titulo={jugador.nombre} alCerrar={onClose} ocupado={guardando} sucio={hayCambios} ancho="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Estadistica etiqueta="Compró" valor={h.totalComprado} plata />
          <Estadistica etiqueta="Debe" valor={h.deudaAbierta} plata tono={h.deudaAbierta > 0 ? 'atencion' : 'neutro'} />
          <Estadistica etiqueta="Movimientos" valor={h.movimientos.length} />
        </div>

        <section>
          <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-wide text-gray-500">DUPR</h3>
          <div className="flex flex-wrap items-start gap-3">
            <Campo etiqueta="ID" className="w-36">
              <Entrada type="text" autoComplete="off" value={dupr} onChange={e => setDupr(e.target.value)} placeholder="7XZ4V2" className="font-mono" />
            </Campo>
            <Campo etiqueta="Rating (hoy)" className="w-32" error={ratingInvalido ? 'Va de 1 a 8 (ej: 3.6)' : null}>
              <Entrada type="text" inputMode="decimal" value={rating} onChange={e => setRating(e.target.value)} placeholder="3.600" className="font-mono" />
            </Campo>
            <Boton icono={<BadgeCheck size={17} />} onClick={() => void guardarDupr()} cargando={guardando} disabled={!hayCambios || ratingInvalido} className="sm:mt-[26px]">
              Guardar
            </Boton>
          </div>
          {jugador.ratingAt && !hayCambios && (
            <p className="mt-1.5 text-[13px] text-gray-500">Rating tomado el {jugador.ratingAt.split('-').reverse().join('/')}</p>
          )}
        </section>

        {susInscripciones.length > 0 && (
          <section>
            <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-wide text-gray-500">Inscripciones</h3>
            <div className="space-y-1.5">
              {susInscripciones.map(i => (
                <p key={i.id} className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                  <Insignia tono={i.estado === 'confirmada' ? 'bien' : 'atencion'}>{i.estado}</Insignia>
                  {categoriasDe(i).join(' · ')}
                </p>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 font-display text-xs font-bold uppercase tracking-wide text-gray-500">Historial de compras</h3>
          {h.movimientos.length === 0 && <p className="py-4 text-center text-sm text-gray-500">Todavía no compró nada.</p>}
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 empty:hidden">
            {h.movimientos.map(m => (
              <div key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-sm">
                <span className="font-semibold text-navy-700">{m.label}</span>
                {m.qty > 1 && <span className="text-[13px] text-gray-500">×{m.qty}</span>}
                <span className="ml-auto font-bold tabular-nums text-navy-700">{money(m.amount)}</span>
                <Insignia tono={m.paymentMethod === 'debe' ? (m.settledAt ? 'bien' : 'atencion') : 'neutro'}>
                  {m.paymentMethod === 'debe'
                    ? (m.settledAt ? 'fiado · cobrado' : 'fiado · pendiente')
                    : METODO[m.paymentMethod || ''] || '—'}
                </Insignia>
                <span className="w-full text-[13px] text-gray-500 sm:w-auto">{fechaHumana(m.createdAt, ahoraMs)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Dialogo>
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
  // Vincular mueve TODOS los movimientos del nombre y no tiene vuelta atrás desde acá:
  // el "es X" (o elegir en la lista) primero pide confirmar en la misma fila.
  const [aConfirmar, setAConfirmar] = useState<{ nombre: string; jugador: JugadorPadron } | null>(null);

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

  const ordenados = [...padron].sort((a, b) => a.nombre.localeCompare(b.nombre));

  return (
    <Dialogo
      abierto
      titulo="Vincular deudores al padrón"
      descripcion="Al vincular, TODOS los movimientos de ese nombre pasan al jugador y el nombre queda escrito igual que en el padrón: las deudas partidas de la misma persona se juntan solas."
      alCerrar={onClose}
      ocupado={trabajando !== null}
      ancho="lg"
      pie={<Boton variante="secundario" onClick={onClose} disabled={trabajando !== null}>Listo</Boton>}
    >
      <div className="space-y-2">
        {pendientes.map(p => {
          const hecho = hechos[p.nombre];
          const sugeridos = sugerenciasDe(p.nombre);
          const confirmando = aConfirmar?.nombre === p.nombre ? aConfirmar : null;
          return (
            <div key={p.nombre} className={cn('rounded-xl border p-3', hecho ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display font-bold text-navy-700">{p.nombre}</span>
                <span className="text-[13px] text-gray-600">
                  {p.movimientos} {p.movimientos === 1 ? 'movimiento' : 'movimientos'}
                  {p.saldo > 0 && <span className="font-bold text-amber-700"> · debe {money(p.saldo)}</span>}
                </span>
                {hecho && <Insignia tono="bien">vinculado a {hecho}</Insignia>}
              </div>
              {!hecho && confirmando && (
                <div className="mt-3 rounded-lg border border-navy-100 bg-navy-50 p-3">
                  <p className="text-sm text-navy-700">
                    ¿Vincular <strong>«{p.nombre}»</strong> a <strong>{confirmando.jugador.nombre}</strong>? {p.movimientos === 1 ? 'Pasa 1 movimiento' : `Pasan ${p.movimientos} movimientos`} a su ficha.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Boton
                      cargando={trabajando === p.nombre}
                      onClick={() => { void vincular(p.nombre, confirmando.jugador).then(() => setAConfirmar(null)); }}
                    >
                      Sí, vincular
                    </Boton>
                    <Boton variante="secundario" onClick={() => setAConfirmar(null)} disabled={trabajando !== null}>Cancelar</Boton>
                  </div>
                </div>
              )}
              {!hecho && !confirmando && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {sugeridos.map(j => (
                    <Boton key={j.id} variante="secundario" onClick={() => setAConfirmar({ nombre: p.nombre, jugador: j })} disabled={trabajando !== null} className="px-3">
                      es {j.nombre}
                    </Boton>
                  ))}
                  <Selector
                    value=""
                    aria-label={`Elegir otro jugador para ${p.nombre}`}
                    onChange={e => {
                      const j = padron.find(x => x.id === e.target.value);
                      if (j) setAConfirmar({ nombre: p.nombre, jugador: j });
                    }}
                    disabled={trabajando !== null}
                    className="w-auto min-w-[160px] flex-1 sm:flex-none"
                  >
                    <option value="">otro jugador…</option>
                    {ordenados.map(j => (
                      <option key={j.id} value={j.id}>{j.nombre}</option>
                    ))}
                  </Selector>
                  <Boton variante="fantasma" onClick={() => onIgnorar(p.nombre)} disabled={trabajando !== null} className="px-3 text-gray-600">
                    no es un jugador
                  </Boton>
                </div>
              )}
            </div>
          );
        })}
        {pendientes.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-600">No queda ningún deudor sin vincular.</p>
        )}
      </div>
    </Dialogo>
  );
}
