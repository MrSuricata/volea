import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, RefreshCw, TrendingUp, TrendingDown, Scale, Undo2, Info, MessageCircle, FileDown, Loader2, Plus, Minus, X, Search, Shirt, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerEntry, Product, SocioMove, SocioName, VentaCajaInput } from '../types';
import { NOMBRES_SOCIOS, SOCIOS } from '../utils/socios';
import { exportCajaExcel } from '../utils/cajaExcel';
import { fechaHumana } from '../utils/fechas';
import { formatVariant, stockTotal, variantesConStock, VENTAS_RAPIDAS, ventaRapidaAcumulada } from '../utils/caja';
import type { VentaRapida } from '../utils/caja';

const TZ = 'America/Montevideo';

const formatMoney = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });

/** "5/8" — para el "desde" de los deudores, sin hora. */
const formatFechaCorta = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-UY', { timeZone: TZ, day: 'numeric', month: 'numeric' });
};

/** Día calendario (YYYY-MM-DD) de un instante, visto desde Montevideo. */
const dayInMontevideo = (date: Date) =>
  date.toLocaleDateString('en-CA', { timeZone: TZ });

type PeriodFilter = 'hoy' | '7d' | '30d' | 'todo';
type KindFilter = 'todos' | 'venta' | 'gasto';

const PERIODS: { id: PeriodFilter; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'todo', label: 'Todo' },
];

const KINDS: { id: KindFilter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'venta', label: 'Ventas' },
  { id: 'gasto', label: 'Gastos' },
];

const PAYMENT_LABELS: Record<string, string> = {
  mp: 'Mercado Pago',
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
};

const METHOD_BADGE: Record<string, string> = {
  mp: 'bg-blue-50 text-blue-600',
  efectivo: 'bg-green-50 text-green-700',
  transferencia: 'bg-navy-50 text-navy-600',
};

const badgeClass = 'rounded-full px-2 py-0.5 font-semibold';
const sectionTitleClass = 'mb-2 font-display text-sm font-bold uppercase tracking-wide text-gray-500';
const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-navy-700 focus:border-navy-400 focus:outline-none';
const labelClass = 'mb-1 block font-display text-xs font-bold uppercase tracking-wide text-gray-500';

// Chips de método de pago del modal de venta (mismos colores que los badges de la lista)
const METODOS_VENTA: { id: VentaCajaInput['payment']; label: string; activo: string }[] = [
  { id: 'mp', label: 'MP', activo: 'border-blue-300 bg-blue-50 text-blue-600' },
  { id: 'efectivo', label: 'Efectivo', activo: 'border-green-300 bg-green-50 text-green-700' },
  { id: 'transferencia', label: 'Transferencia', activo: 'border-navy-300 bg-navy-50 text-navy-600' },
  { id: 'debe', label: 'Debe', activo: 'border-amber-300 bg-amber-50 text-amber-700' },
];

export function AdminCajaTab({ loadLedger, loadLedgerFull, revertEntry, loadSocioMoves, products, registrarVenta, registrarGasto, socioSugerido, cobrarDeudor }: {
  loadLedger: () => Promise<LedgerEntry[] | null>;
  loadLedgerFull: () => Promise<LedgerEntry[] | null>;
  revertEntry: (id: string) => Promise<{ ok: boolean; stockRestored: boolean; error?: string }>;
  loadSocioMoves: () => Promise<SocioMove[] | null>;
  products: Product[];
  registrarVenta: (input: VentaCajaInput) => Promise<{ ok: boolean; error?: string }>;
  registrarGasto: (label: string, amount: number, paidBy: SocioName) => Promise<{ ok: boolean; error?: string }>;
  /** Socio deducido del admin logueado; null con la cuenta compartida. */
  socioSugerido: SocioName | null;
  cobrarDeudor: (debtor: string, method: 'mp' | 'efectivo' | 'transferencia', monto: number | null) => Promise<{ ok: boolean; error?: string; restante?: number }>;
}) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Hasta que no resuelve el primer load no se muestra nada de datos (antes
  // aparecía "Sin movimientos" mientras cargaba, mentira conocida).
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [period, setPeriod] = useState<PeriodFilter>('7d');
  const [kind, setKind] = useState<KindFilter>('todos');
  const [aAnular, setAAnular] = useState<LedgerEntry | null>(null);
  const [aCobrar, setACobrar] = useState<{ nombre: string; total: number } | null>(null);
  const [aBorrarDeuda, setABorrarDeuda] = useState<{ nombre: string; total: number; movs: LedgerEntry[] } | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [ventaAbierta, setVentaAbierta] = useState(false);
  const [gastoAbierto, setGastoAbierto] = useState(false);

  // Secuencia de fetches: si una respuesta vieja llega después de una nueva
  // (ej: refresh disparado justo antes de confirmar una anulación), se ignora.
  const fetchSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    const data = await loadLedger();
    if (seq !== fetchSeq.current) return; // llegó tarde: ya hay un fetch más nuevo
    if (data === null) {
      setLoadFailed(true);
      toast.error('No se pudo cargar la caja. Verificá tu sesión de admin.');
    } else {
      setLoadFailed(false);
      setEntries(data);
    }
    setLoading(false);
    setCargandoInicial(false);
  }, [loadLedger]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Se baja el ledger completo (la vista se corta en 500) + cuentas socios.
      const [full, socios] = await Promise.all([loadLedgerFull(), loadSocioMoves()]);
      if (full === null) {
        toast.error('No se pudo leer la caja. Verificá tu sesión de admin.');
        return;
      }
      await exportCajaExcel(full, socios);
      toast.success('Excel descargado');
    } catch (err) {
      console.error('Error exportando caja:', err);
      toast.error('No se pudo generar el Excel');
    } finally {
      setExporting(false);
    }
  };

  const filtered = useMemo(() => {
    const now = new Date();
    const todayMvd = dayInMontevideo(now);
    return entries.filter(e => {
      if (kind !== 'todos' && e.kind !== kind) return false;
      if (period === 'todo') return true;
      const created = new Date(e.createdAt);
      if (isNaN(created.getTime())) return true;
      if (period === 'hoy') return dayInMontevideo(created) === todayMvd;
      const days = period === '7d' ? 7 : 30;
      return now.getTime() - created.getTime() <= days * 24 * 60 * 60 * 1000;
    });
  }, [entries, period, kind]);

  // Totales del período (ignoran el filtro de tipo para que el balance siempre cierre)
  const totals = useMemo(() => {
    const now = new Date();
    const todayMvd = dayInMontevideo(now);
    let ventas = 0, gastos = 0, count = 0, countVentas = 0, countGastos = 0;
    for (const e of entries) {
      if (e.reverted) continue;
      if (period !== 'todo') {
        const created = new Date(e.createdAt);
        if (!isNaN(created.getTime())) {
          if (period === 'hoy') {
            if (dayInMontevideo(created) !== todayMvd) continue;
          } else {
            const days = period === '7d' ? 7 : 30;
            if (now.getTime() - created.getTime() > days * 24 * 60 * 60 * 1000) continue;
          }
        }
      }
      count++;
      if (e.kind === 'venta') { ventas += e.amount; countVentas++; }
      else { gastos += e.amount; countGastos++; }
    }
    return { ventas, gastos, balance: ventas - gastos, count, countVentas, countGastos };
  }, [entries, period]);

  // Deudas abiertas (sobre todo lo cargado, sin filtro de período), agrupadas por deudor
  const porCobrar = useMemo(() => {
    let total = 0, count = 0;
    // Se guardan los movimientos de cada deudor (no solo el total) para poder
    // borrar una deuda puntual desde su tarjeta, sin ir a buscarla a la lista.
    const porNombre = new Map<string, { nombre: string; total: number; items: number; desde: string; movs: LedgerEntry[] }>();
    for (const e of entries) {
      if (e.kind === 'venta' && e.paymentMethod === 'debe' && !e.settledAt && !e.reverted) {
        total += e.amount;
        count++;
        const nombre = e.debtorName || 'Sin nombre';
        const grupo = porNombre.get(nombre);
        if (grupo) {
          grupo.total += e.amount;
          grupo.items++;
          grupo.movs.push(e);
          if (e.createdAt < grupo.desde) grupo.desde = e.createdAt;
        } else {
          porNombre.set(nombre, { nombre, total: e.amount, items: 1, desde: e.createdAt, movs: [e] });
        }
      }
    }
    const deudores = Array.from(porNombre.values()).sort((a, b) => b.total - a.total);
    for (const d of deudores) d.movs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { total, count, deudores };
  }, [entries]);

  const handleRevert = async (entry: LedgerEntry) => {
    if (reverting) return; // ya hay una anulación en curso
    setReverting(entry.id);
    const result = await revertEntry(entry.id);
    setReverting(null);
    setAAnular(null);
    if (!result.ok) {
      toast.error(result.error || 'No se pudo anular el movimiento');
      // Sincronizar igual: quizás ya estaba anulado desde el bot ("deshacer").
      refresh();
      return;
    }
    toast.success(result.stockRestored ? 'Movimiento anulado y stock repuesto' : 'Movimiento anulado');
    refresh();
  };

  const ahoraMs = Date.now();

  /** Badge/texto de método de pago para la línea de meta (null en gastos). */
  const metodoPago = (entry: LedgerEntry) => {
    if (entry.kind !== 'venta' || !entry.paymentMethod) return null;
    if (entry.paymentMethod === 'debe') {
      if (entry.settledAt) {
        return (
          <span className="font-semibold text-green-600">
            debía {entry.debtorName || '—'} · cobrado{entry.settledMethod ? ` ${PAYMENT_LABELS[entry.settledMethod]}` : ''}
          </span>
        );
      }
      return (
        <span className={`${badgeClass} bg-amber-50 text-amber-700`}>Debe {entry.debtorName || '—'}</span>
      );
    }
    return (
      <span className={`${badgeClass} ${METHOD_BADGE[entry.paymentMethod]}`}>
        {PAYMENT_LABELS[entry.paymentMethod]}
      </span>
    );
  };

  return (
    <div className="fade-in">
      {/* Header: "Nueva venta" primero y a lo ancho en mobile; el resto en fila */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Caja</h1>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <button
            onClick={() => setVentaAbierta(true)}
            className="order-first w-full sm:order-last sm:w-auto bg-lime-400 hover:bg-lime-300 text-navy-700 font-display font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Plus size={18} strokeWidth={2.5} /> Nueva venta
          </button>
          <button
            onClick={() => setGastoAbierto(true)}
            className="flex-1 sm:flex-none justify-center bg-white hover:bg-gray-50 text-red-500 border border-gray-200 font-display font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2 text-sm"
          >
            <TrendingDown size={16} /> Gasto
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="flex-1 sm:flex-none justify-center bg-white hover:bg-gray-50 disabled:opacity-50 text-navy-700 border border-gray-200 font-display font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2 text-sm"
          >
            <FileDown size={16} /> {exporting ? 'Generando…' : 'Descargar Excel'}
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex-1 sm:flex-none justify-center bg-navy-700 hover:bg-navy-800 disabled:bg-gray-400 text-white font-display font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2 text-sm"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {/* Callout informativo */}
      <div className="mb-6 flex items-start gap-2 rounded-xl bg-navy-50 px-4 py-2.5 text-xs text-navy-600">
        <MessageCircle size={14} className="mt-0.5 flex-shrink-0" />
        <p>
          Ventas y gastos del <b>bot de Telegram</b> y de esta pantalla. Al anular una venta de catálogo, el stock se repone solo.
        </p>
      </div>

      {cargandoInicial ? (
        /* Loading inicial: antes acá aparecía "Sin movimientos" mientras cargaba */
        <div className="rounded-2xl border border-dashed border-gray-300 py-10 text-center">
          <Loader2 size={32} strokeWidth={1.5} className="mx-auto mb-3 animate-spin text-gray-300" />
          <p className="font-display text-sm font-bold text-gray-500">Cargando la caja…</p>
        </div>
      ) : loadFailed ? (
        !loading && (
          <div className="rounded-2xl border border-dashed border-gray-300 py-10 text-center">
            <Info size={32} strokeWidth={1.5} className="mx-auto mb-3 text-gray-300" />
            <p className="font-display text-sm font-bold text-gray-500">No se pudo cargar la caja</p>
            <p className="mt-1 text-xs text-gray-400">Asegurate de haber entrado con el link mágico y probá "Actualizar".</p>
          </div>
        )
      ) : (
        <>
          {/* Totales con contexto */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 text-xs font-display font-semibold text-gray-500 uppercase mb-1">
                <TrendingUp size={14} className="text-green-600" /> Ventas
              </div>
              <p className="font-display text-2xl font-bold text-green-600">{formatMoney(totals.ventas)}</p>
              <p className="mt-0.5 text-[11px] text-gray-400">
                {totals.countVentas} {totals.countVentas === 1 ? 'venta' : 'ventas'}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 text-xs font-display font-semibold text-gray-500 uppercase mb-1">
                <TrendingDown size={14} className="text-red-500" /> Gastos
              </div>
              <p className="font-display text-2xl font-bold text-red-500">{formatMoney(totals.gastos)}</p>
              <p className="mt-0.5 text-[11px] text-gray-400">
                {totals.countGastos} {totals.countGastos === 1 ? 'gasto' : 'gastos'}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 text-xs font-display font-semibold text-gray-500 uppercase mb-1">
                <Scale size={14} className="text-navy-700" /> Balance
              </div>
              <p className={`font-display text-2xl font-bold ${totals.balance >= 0 ? 'text-navy-700' : 'text-red-500'}`}>
                {formatMoney(totals.balance)}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-400">
                sobre {totals.count} {totals.count === 1 ? 'movimiento' : 'movimientos'}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 text-xs font-display font-semibold text-gray-500 uppercase mb-1">
                <Wallet size={14} className="text-amber-600" /> Por cobrar
              </div>
              <p className="font-display text-2xl font-bold text-amber-600">{formatMoney(porCobrar.total)}</p>
              <p className="mt-0.5 text-[11px] text-gray-400">
                {porCobrar.count > 0
                  ? `${porCobrar.count} ${porCobrar.count === 1 ? 'fiado' : 'fiados'} sin cobrar`
                  : 'nada pendiente'}
              </p>
            </div>
          </div>

          {/* Deudores */}
          {porCobrar.deudores.length > 0 && (
            <div className="mb-6">
              <h2 className={sectionTitleClass}>
                Por cobrar ({porCobrar.deudores.length} {porCobrar.deudores.length === 1 ? 'persona' : 'personas'})
              </h2>
              <div className="space-y-2">
                {porCobrar.deudores.map(deudor => (
                  <div key={deudor.nombre} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2.5">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 font-display font-bold text-amber-700">
                      {deudor.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-bold text-navy-700">{deudor.nombre}</p>
                      <p className="text-[11px] text-gray-400">
                        {deudor.items} {deudor.items === 1 ? 'ítem' : 'ítems'} · desde {formatFechaCorta(deudor.desde)}
                      </p>
                    </div>
                    <p className="text-sm font-bold tabular-nums text-amber-600 whitespace-nowrap">{formatMoney(deudor.total)}</p>
                    <button
                      onClick={() => setACobrar({ nombre: deudor.nombre, total: deudor.total })}
                      className="flex-shrink-0 rounded-lg bg-lime-400 px-3 py-1.5 font-display text-xs font-bold text-navy-700 transition-colors hover:bg-lime-500"
                    >
                      Cobrar
                    </button>
                    <button
                      onClick={() => setABorrarDeuda(deudor)}
                      title={`Borrar deudas de ${deudor.nombre}`}
                      aria-label={`Borrar deudas de ${deudor.nombre}`}
                      className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-gray-400">
                «Cobrar» = entró la plata. El tacho borra la deuda como si la venta nunca hubiera existido
                (para las cargadas por error). También podés cobrar desde el bot: «cobré + nombre»
              </p>
            </div>
          )}

          {/* Filtros como chips */}
          <div className="mb-6 flex flex-wrap items-center gap-2">
            {PERIODS.map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-display font-bold transition-colors ${
                  period === p.id ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-500 hover:text-navy-700'
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
            {KINDS.map(k => (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-display font-bold transition-colors ${
                  kind === k.id ? 'bg-lime-400 text-navy-700' : 'bg-gray-100 text-gray-500 hover:text-navy-700'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            loading ? (
              <div className="rounded-2xl border border-dashed border-gray-300 py-10 text-center">
                <Loader2 size={32} strokeWidth={1.5} className="mx-auto mb-3 animate-spin text-gray-300" />
                <p className="font-display text-sm font-bold text-gray-500">Cargando la caja…</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300 py-10 text-center">
                <Wallet size={32} strokeWidth={1.5} className="mx-auto mb-3 text-gray-300" />
                <p className="font-display text-sm font-bold text-gray-500">Sin movimientos en este período</p>
                <p className="mt-1 text-xs text-gray-400">Registrá una con «Nueva venta» o desde el bot de Telegram.</p>
              </div>
            )
          ) : (
            <div>
              <h2 className={sectionTitleClass}>Movimientos ({filtered.length})</h2>
              <div className="space-y-2">
                {filtered.map(entry => (
                  <div
                    key={entry.id}
                    className={`flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5 ${
                      entry.reverted ? 'opacity-45' : ''
                    }`}
                  >
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                      entry.kind === 'venta' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
                    }`}>
                      {entry.kind === 'venta' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-display text-sm font-bold text-navy-700 ${entry.reverted ? 'line-through' : ''}`}>
                        {entry.label}{entry.qty > 1 ? ` ×${entry.qty}` : ''}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
                        <span>{fechaHumana(entry.createdAt, ahoraMs)}</span>
                        {entry.variantKey && <span>{formatVariant(entry.variantKey)}</span>}
                        {entry.kind === 'venta' && !entry.productId && <span>ítem suelto (sin stock)</span>}
                        {metodoPago(entry)}
                        {entry.socioSettledAt && !entry.reverted && (
                          <span className={`${badgeClass} bg-teal-50 text-teal-600`}>✓ liquidado</span>
                        )}
                        {entry.reverted && (
                          <span className={`${badgeClass} bg-gray-100 text-gray-500`}>Anulada</span>
                        )}
                        {entry.kind === 'gasto' && entry.paidBy && (
                          <span className={`${badgeClass} bg-navy-50 text-navy-700`}>
                            pagó {NOMBRES_SOCIOS[entry.paidBy]}
                          </span>
                        )}
                        <span>por {entry.reportedBy}</span>
                      </div>
                    </div>
                    <p className={`text-sm font-bold tabular-nums whitespace-nowrap ${
                      entry.reverted ? 'text-gray-400 line-through' : entry.kind === 'venta' ? 'text-green-600' : 'text-red-500'
                    }`}>
                      {entry.kind === 'venta' ? '+' : '−'}{formatMoney(entry.amount)}
                    </p>
                    {!entry.reverted && (
                      <button
                        onClick={() => setAAnular(entry)}
                        disabled={reverting !== null}
                        className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500 disabled:text-gray-200"
                        title="Anular movimiento"
                      >
                        <Undo2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {entries.length >= 500 && (
                <p className="mt-3 text-[11px] text-gray-400">
                  Se muestran los últimos 500 movimientos: los totales de "Todo" pueden no incluir los más viejos.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal de anulación */}
      {aAnular && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={() => reverting === null && setAAnular(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-display text-lg font-bold text-navy-700 mb-2">
              {aAnular.kind === 'gasto' ? '¿Anular este gasto?' : '¿Anular esta venta?'}
            </h3>
            <p className="truncate text-sm font-semibold text-navy-700">
              {aAnular.label}{aAnular.qty > 1 ? ` ×${aAnular.qty}` : ''} · {formatMoney(aAnular.amount)}
            </p>
            <p className="mt-2 mb-6 text-sm text-gray-500">
              {aAnular.productId
                ? 'Se anula y se repone el stock (igual que el deshacer del bot).'
                : 'Se anula el movimiento (igual que el deshacer del bot).'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setAAnular(null)}
                disabled={reverting !== null}
                className="flex-1 border border-gray-200 hover:bg-gray-50 text-navy-700 font-display font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleRevert(aAnular)}
                disabled={reverting !== null}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-display font-semibold py-3 rounded-lg transition-colors"
              >
                {reverting === aAnular.id ? 'Anulando…' : 'Anular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de nueva venta */}
      {ventaAbierta && (
        <VentaModal
          products={products}
          registrar={registrarVenta}
          onClose={() => setVentaAbierta(false)}
          onDone={() => { setVentaAbierta(false); refresh(); }}
        />
      )}

      {/* Modal de borrar deudas de una persona */}
      {aBorrarDeuda && (
        <BorrarDeudaModal
          deudor={aBorrarDeuda}
          revertEntry={revertEntry}
          onClose={() => setABorrarDeuda(null)}
          onDone={() => { setABorrarDeuda(null); refresh(); }}
        />
      )}

      {/* Modal de gasto */}
      {gastoAbierto && (
        <GastoModal
          registrar={registrarGasto}
          socioSugerido={socioSugerido}
          onClose={() => setGastoAbierto(false)}
          onDone={() => { setGastoAbierto(false); refresh(); }}
        />
      )}

      {/* Modal de cobro de deudas (total o parcial FIFO) */}
      {aCobrar && (
        <CobroModal
          deudor={aCobrar}
          cobrar={cobrarDeudor}
          onClose={() => setACobrar(null)}
          onDone={() => { setACobrar(null); refresh(); }}
        />
      )}
    </div>
  );
}

/**
 * Borrar deudas de una persona. "Borrar" = ANULAR el movimiento: la venta sale
 * también de los totales, como si nunca hubiera existido. Es lo correcto para lo
 * cargado por error (que es el caso real: un capuchino de $10 mal anotado).
 * NO confundir con «Cobrar», que registra que entró la plata.
 * Se listan los ítems uno por uno porque una persona puede deber varias cosas y
 * casi siempre se quiere borrar UNA, no todas.
 */
function BorrarDeudaModal({ deudor, revertEntry, onClose, onDone }: {
  deudor: { nombre: string; total: number; movs: LedgerEntry[] };
  revertEntry: (id: string) => Promise<{ ok: boolean; stockRestored: boolean; error?: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [borrando, setBorrando] = useState<string | null>(null);
  const [borrados, setBorrados] = useState<string[]>([]);
  const [confirmarTodas, setConfirmarTodas] = useState(false);

  const pendientes = deudor.movs.filter(m => !borrados.includes(m.id));
  const totalPendiente = pendientes.reduce((s, m) => s + m.amount, 0);

  const borrar = async (ids: string[], etiqueta: string) => {
    if (borrando) return;
    setBorrando(etiqueta);
    try {
      const hechos: string[] = [];
      for (const id of ids) {
        const r = await revertEntry(id);
        if (!r.ok) {
          toast.error(r.error || 'No se pudo borrar la deuda');
          break;
        }
        hechos.push(id);
      }
      if (hechos.length) {
        setBorrados(prev => [...prev, ...hechos]);
        toast.success(hechos.length === 1 ? 'Deuda borrada' : `${hechos.length} deudas borradas`);
        // Si no queda ninguna, cerrar y refrescar; si quedan, seguir en el modal.
        if (hechos.length === ids.length && ids.length === pendientes.length) onDone();
      }
    } catch (e) {
      console.error('Error borrando deuda:', e);
      toast.error('No se pudo borrar la deuda. Probá de nuevo.');
    } finally {
      setBorrando(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="absolute inset-0" onClick={() => borrando === null && (borrados.length ? onDone() : onClose())} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Borrar deudas de ${deudor.nombre}`}
        className="relative flex max-h-[92dvh] w-full max-w-sm flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-navy-700">Borrar deuda de {deudor.nombre}</h3>
          <button
            onClick={() => (borrados.length ? onDone() : onClose())}
            disabled={borrando !== null}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Se anula la venta: desaparece de la deuda <strong>y de los totales</strong>, como si nunca se hubiera
          cargado. Si en realidad te pagó, cerrá esto y usá «Cobrar».
        </p>

        {pendientes.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">No queda ninguna deuda de {deudor.nombre}.</p>
        ) : (
          <div className="space-y-2">
            {pendientes.map(m => (
              <div key={m.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-bold text-navy-700">
                    {m.label}{m.qty > 1 ? ` ×${m.qty}` : ''}
                  </p>
                  <p className="text-[11px] text-gray-400">{formatFechaCorta(m.createdAt)} · por {m.reportedBy}</p>
                </div>
                <p className="text-sm font-bold tabular-nums text-amber-600 whitespace-nowrap">{formatMoney(m.amount)}</p>
                <button
                  onClick={() => void borrar([m.id], m.id)}
                  disabled={borrando !== null}
                  title="Borrar esta deuda"
                  aria-label={`Borrar ${m.label}`}
                  className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:text-gray-200"
                >
                  {borrando === m.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </button>
              </div>
            ))}
          </div>
        )}

        {pendientes.length > 1 && (
          confirmarTodas ? (
            <button
              onClick={() => void borrar(pendientes.map(m => m.id), 'todas')}
              disabled={borrando !== null}
              className="mt-4 w-full rounded-lg bg-red-500 py-3 font-display text-sm font-bold text-white transition-colors hover:bg-red-600 disabled:bg-red-300"
            >
              {borrando === 'todas'
                ? 'Borrando…'
                : `Sí, borrar las ${pendientes.length} (${formatMoney(totalPendiente)})`}
            </button>
          ) : (
            <button
              onClick={() => setConfirmarTodas(true)}
              disabled={borrando !== null}
              className="mt-4 w-full rounded-lg border border-red-200 py-2.5 font-display text-sm font-bold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              Borrar las {pendientes.length} deudas ({formatMoney(totalPendiente)})
            </button>
          )
        )}
      </div>
    </div>
  );
}

/**
 * Cobrar deudas de una persona: precarga el total, pero se puede poner menos
 * (pago parcial FIFO: cancela las deudas más viejas; un ítem a caballo se
 * parte y el resto sigue pendiente). Misma semántica que «cobré» del bot.
 */
function CobroModal({ deudor, cobrar, onClose, onDone }: {
  deudor: { nombre: string; total: number };
  cobrar: (debtor: string, method: 'mp' | 'efectivo' | 'transferencia', monto: number | null) => Promise<{ ok: boolean; error?: string; restante?: number }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [monto, setMonto] = useState(String(deudor.total));
  const [metodo, setMetodo] = useState<'mp' | 'efectivo' | 'transferencia' | null>(null);
  const [cobrando, setCobrando] = useState(false);

  const montoNum = Number(monto);
  const listo = Number.isFinite(montoNum) && montoNum > 0 && montoNum <= deudor.total && !!metodo;
  const esParcial = listo && montoNum < deudor.total;

  const handleCobrar = async () => {
    if (!listo || cobrando || !metodo) return;
    setCobrando(true);
    try {
      const result = await cobrar(deudor.nombre, metodo, esParcial ? montoNum : null);
      if (!result.ok) {
        toast.error(result.error || 'No se pudo cobrar');
        return;
      }
      if (result.restante && result.restante > 0) {
        toast.success(`Cobrado ${formatMoney(montoNum)} de ${deudor.nombre} — quedan ${formatMoney(result.restante)} pendientes`);
      } else {
        toast.success(`Deuda de ${deudor.nombre} saldada ✓`);
      }
      onDone();
    } catch (e) {
      console.error('Error cobrando deuda:', e);
      toast.error('No se pudo cobrar. Probá de nuevo.');
    } finally {
      setCobrando(false);
    }
  };

  const METODOS_COBRO: Array<{ id: 'mp' | 'efectivo' | 'transferencia'; label: string }> = [
    { id: 'mp', label: 'MP' },
    { id: 'efectivo', label: 'Efectivo' },
    { id: 'transferencia', label: 'Transferencia' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={() => !cobrando && onClose()} />
      <div role="dialog" aria-modal="true" aria-label={`Cobrar a ${deudor.nombre}`} className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-navy-700">Cobrar a {deudor.nombre}</h3>
          <button onClick={onClose} disabled={cobrando} aria-label="Cerrar" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-sm text-gray-500">Debe <strong className="text-amber-600 tabular-nums">{formatMoney(deudor.total)}</strong> en total.</p>
        <div className="space-y-3">
          <div>
            <label htmlFor="cobro-monto" className={labelClass}>¿Cuánto paga ahora?</label>
            <input
              id="cobro-monto"
              type="number"
              inputMode="numeric"
              min={1}
              max={deudor.total}
              value={monto}
              onChange={e => setMonto(e.target.value)}
              className={inputClass}
            />
            {esParcial && (
              <p className="mt-1 text-[11px] text-amber-600">
                Pago parcial: quedan {formatMoney(deudor.total - montoNum)} pendientes (se cancelan las deudas más viejas primero).
              </p>
            )}
            {Number.isFinite(montoNum) && montoNum > deudor.total && (
              <p className="mt-1 text-[11px] text-red-500">No puede pagar más de lo que debe.</p>
            )}
          </div>
          <div>
            <span className={labelClass}>¿Cómo paga?</span>
            <div className="grid grid-cols-3 gap-2">
              {METODOS_COBRO.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMetodo(m.id)}
                  aria-pressed={metodo === m.id}
                  className={`rounded-xl border px-2 py-2.5 font-display text-sm font-bold transition-colors ${
                    metodo === m.id ? 'border-lime-400 bg-lime-50 text-navy-700' : 'border-gray-200 bg-white text-gray-500 hover:border-lime-400'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleCobrar}
            disabled={!listo || cobrando}
            className="w-full rounded-xl bg-lime-400 py-3 font-display font-bold text-navy-700 transition-colors hover:bg-lime-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cobrando ? 'Cobrando…' : esParcial ? `Cobrar ${formatMoney(montoNum)} (parcial)` : 'Cobrar todo'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Foto chica del producto en la lista del buscador (o percha si no tiene). */
function FotoProducto({ producto }: { producto: Product }) {
  const url = producto.images?.[0];
  if (!url) {
    return (
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300">
        <Shirt size={18} />
      </div>
    );
  }
  return <img src={url} alt="" className="h-10 w-10 flex-shrink-0 rounded-lg bg-gray-100 object-cover" />;
}

/**
 * Nueva venta desde la web: producto del catálogo (descuenta stock, igual que
 * el bot) o ítem suelto. Si la RPC falla (ej: "sin stock: quedan N"), el modal
 * queda abierto para corregir.
 */
function VentaModal({ products, registrar, onClose, onDone }: {
  products: Product[];
  registrar: (input: VentaCajaInput) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pestana, setPestana] = useState<'catalogo' | 'suelto'>('catalogo');
  const [busqueda, setBusqueda] = useState('');
  const [producto, setProducto] = useState<Product | null>(null);
  const [variante, setVariante] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  // Precio como texto editable: arranca en precio de lista × cantidad y se
  // recalcula al cambiar la cantidad SOLO si el admin no lo tocó a mano.
  const [precio, setPrecio] = useState('');
  const [precioTocado, setPrecioTocado] = useState(false);
  const [nombreSuelto, setNombreSuelto] = useState('');
  const [montoSuelto, setMontoSuelto] = useState('');
  // Botonera de ventas rápidas: tocar un botón precarga nombre y monto; tocar el
  // MISMO botón otra vez suma cantidad ("2× Empanada", monto ×2). Editar los
  // campos a mano corta la acumulación (rapidaSel se limpia en los onChange).
  const [rapidaSel, setRapidaSel] = useState<{ nombre: string; veces: number } | null>(null);
  const tocarRapida = (v: VentaRapida) => {
    const veces = rapidaSel?.nombre === v.nombre ? rapidaSel.veces + 1 : 1;
    setRapidaSel({ nombre: v.nombre, veces });
    const r = ventaRapidaAcumulada(v, veces);
    setNombreSuelto(r.nombre);
    setMontoSuelto(String(r.monto));
  };
  const [metodo, setMetodo] = useState<VentaCajaInput['payment'] | null>(null);
  const [deudor, setDeudor] = useState('');
  const [registrando, setRegistrando] = useState(false);

  // Solo productos activos con algo para vender
  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return products
      .filter(p => p.active !== false && stockTotal(p.stockBySize) > 0)
      .filter(p => !q || p.name.toLowerCase().includes(q));
  }, [products, busqueda]);

  const variantes = useMemo(
    () => (producto ? variantesConStock(producto.stockBySize) : []),
    [producto],
  );
  const stockVariante = variantes.find(v => v.key === variante)?.stock ?? 0;

  const elegirProducto = (p: Product) => {
    const vs = variantesConStock(p.stockBySize);
    setProducto(p);
    setVariante(vs.length === 1 ? vs[0].key : null);
    setQty(1);
    setPrecioTocado(false);
    setPrecio(String(p.price));
  };

  const cambiarCantidad = (nueva: number) => {
    if (!producto) return;
    const tope = Math.max(1, stockVariante || 1);
    const clamped = Math.min(tope, Math.max(1, nueva));
    setQty(clamped);
    if (!precioTocado) setPrecio(String(producto.price * clamped));
  };

  const elegirVariante = (key: string, stock: number) => {
    setVariante(key);
    const clamped = Math.min(Math.max(1, qty), stock);
    setQty(clamped);
    if (producto && !precioTocado) setPrecio(String(producto.price * clamped));
  };

  const precioNum = Number(precio);
  const montoNum = Number(montoSuelto);
  const faltaDeudor = metodo === 'debe' && deudor.trim() === '';
  const listo = pestana === 'catalogo'
    ? !!producto && !!variante && qty >= 1 && qty <= stockVariante
      && Number.isFinite(precioNum) && precioNum > 0 && !!metodo && !faltaDeudor
    : nombreSuelto.trim() !== '' && Number.isFinite(montoNum) && montoNum > 0 && !!metodo && !faltaDeudor;

  const handleRegistrar = async () => {
    if (!listo || registrando || !metodo) return;
    const input: VentaCajaInput = pestana === 'catalogo'
      ? {
          label: producto!.name,
          amount: precioNum,
          payment: metodo,
          productId: producto!.id,
          variantKey: variante,
          qty,
          debtor: metodo === 'debe' ? deudor.trim() : null,
        }
      : {
          label: nombreSuelto.trim(),
          amount: montoNum,
          payment: metodo,
          debtor: metodo === 'debe' ? deudor.trim() : null,
        };
    setRegistrando(true);
    try {
      const result = await registrar(input);
      if (!result.ok) {
        // Modal abierto: se corrige (otra variante, menos cantidad) y se reintenta.
        toast.error(result.error || 'No se pudo registrar la venta');
        return;
      }
      toast.success('Venta registrada ✓');
      onDone();
    } catch (e) {
      // Un throw inesperado no puede dejar el botón girando para siempre.
      console.error('Error registrando venta:', e);
      toast.error('No se pudo registrar la venta. Probá de nuevo.');
    } finally {
      setRegistrando(false);
    }
  };

  const chipPestana = (id: 'catalogo' | 'suelto', label: string) => (
    <button
      onClick={() => setPestana(id)}
      aria-pressed={pestana === id}
      className={`flex-1 rounded-md py-2 font-display text-sm font-bold transition-colors ${
        pestana === id ? 'bg-white text-navy-700 shadow-sm' : 'text-gray-500 hover:text-navy-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={() => !registrando && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nueva venta"
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <h3 className="font-display text-lg font-bold text-navy-700">Nueva venta</h3>
          <button
            onClick={onClose}
            disabled={registrando}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
          {/* Pestañas Catálogo | Suelto */}
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {chipPestana('catalogo', 'Catálogo')}
            {chipPestana('suelto', 'Suelto')}
          </div>

          {pestana === 'catalogo' ? (
            !producto ? (
              <div>
                <label htmlFor="venta-buscador" className={labelClass}>Producto</label>
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    id="venta-buscador"
                    type="search"
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                    placeholder="Buscar por nombre…"
                    autoFocus
                    className={`${inputClass} pl-9`}
                  />
                </div>
                <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
                  {candidatos.length === 0 ? (
                    <p className="py-6 text-center text-xs text-gray-400">
                      No hay productos activos con stock que coincidan.
                    </p>
                  ) : (
                    candidatos.map(p => (
                      <button
                        key={p.id}
                        onClick={() => elegirProducto(p)}
                        className="flex w-full items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2 text-left transition-colors hover:border-lime-300 hover:bg-lime-50"
                      >
                        <FotoProducto producto={p} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display text-sm font-bold text-navy-700">{p.name}</p>
                          <p className="text-[11px] text-gray-400">
                            {formatMoney(p.price)} · {stockTotal(p.stockBySize)} en stock
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Producto elegido */}
                <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                  <FotoProducto producto={producto} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-bold text-navy-700">{producto.name}</p>
                    <p className="text-[11px] text-gray-400">lista: {formatMoney(producto.price)} c/u</p>
                  </div>
                  <button
                    onClick={() => { setProducto(null); setVariante(null); setPrecio(''); setPrecioTocado(false); setQty(1); }}
                    className="flex-shrink-0 font-display text-xs font-bold text-navy-500 hover:text-navy-700"
                  >
                    Cambiar
                  </button>
                </div>

                {/* Variantes con stock */}
                <div>
                  <span className={labelClass}>Variante</span>
                  <div className="flex flex-wrap gap-1.5">
                    {variantes.map(v => (
                      <button
                        key={v.key}
                        onClick={() => elegirVariante(v.key, v.stock)}
                        aria-pressed={variante === v.key}
                        className={`rounded-full px-3 py-1.5 text-xs font-display font-bold transition-colors ${
                          variante === v.key ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-600 hover:text-navy-700'
                        }`}
                      >
                        {v.label} ({v.stock})
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cantidad + precio */}
                <div className="flex gap-3">
                  <div>
                    <span className={labelClass}>Cantidad</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => cambiarCantidad(qty - 1)}
                        disabled={qty <= 1}
                        aria-label="Una menos"
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-navy-700 transition-colors hover:bg-gray-50 disabled:text-gray-300"
                      >
                        <Minus size={16} />
                      </button>
                      <span className="w-9 text-center font-display text-base font-bold tabular-nums text-navy-700" aria-live="polite">
                        {qty}
                      </span>
                      <button
                        onClick={() => cambiarCantidad(qty + 1)}
                        disabled={!variante || qty >= stockVariante}
                        aria-label="Una más"
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-navy-700 transition-colors hover:bg-gray-50 disabled:text-gray-300"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1">
                    <label htmlFor="venta-precio" className={labelClass}>Precio total ($)</label>
                    <input
                      id="venta-precio"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={precio}
                      onChange={e => { setPrecio(e.target.value); setPrecioTocado(true); }}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            )
          ) : (
            /* Ítem suelto: no toca stock */
            <div className="space-y-3">
              {/* Lo que más se vende suelto (lista real del ledger), a un toque.
                  Tocar de nuevo el mismo botón suma cantidad. */}
              <div>
                <span className={labelClass}>Lo de siempre</span>
                <div className="grid grid-cols-3 gap-2">
                  {VENTAS_RAPIDAS.map(v => {
                    const activo = rapidaSel?.nombre === v.nombre;
                    return (
                      <button
                        key={v.nombre}
                        type="button"
                        onClick={() => tocarRapida(v)}
                        className={`rounded-xl border px-2 py-2.5 text-center transition-colors ${
                          activo ? 'border-lime-400 bg-lime-50' : 'border-gray-200 bg-white hover:border-lime-400'
                        }`}
                        aria-label={`${v.nombre} $${v.precio}${activo ? `, ${rapidaSel!.veces} en el carrito` : ''}`}
                      >
                        <span className="block text-xl leading-none">{v.emoji}</span>
                        <span className="block text-xs font-bold text-navy-700 mt-1 truncate">
                          {activo && rapidaSel!.veces > 1 ? `${rapidaSel!.veces}× ` : ''}{v.nombre}
                        </span>
                        <span className="block text-[11px] text-gray-400">${v.precio}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label htmlFor="venta-suelto-nombre" className={labelClass}>¿Qué se vendió?</label>
                <input
                  id="venta-suelto-nombre"
                  type="text"
                  value={nombreSuelto}
                  onChange={e => { setNombreSuelto(e.target.value); setRapidaSel(null); }}
                  placeholder="Ej: alquiler de paleta"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="venta-suelto-monto" className={labelClass}>Monto ($)</label>
                <input
                  id="venta-suelto-monto"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={montoSuelto}
                  onChange={e => { setMontoSuelto(e.target.value); setRapidaSel(null); }}
                  className={inputClass}
                />
              </div>
              <p className="text-[11px] text-gray-400">Los ítems sueltos no descuentan stock del catálogo.</p>
            </div>
          )}

          {/* Método de pago */}
          <div>
            <span className={labelClass}>¿Cómo pagaron?</span>
            <div className="grid grid-cols-2 gap-2">
              {METODOS_VENTA.map(m => (
                <button
                  key={m.id}
                  onClick={() => setMetodo(m.id)}
                  aria-pressed={metodo === m.id}
                  className={`rounded-lg border py-2.5 font-display text-sm font-bold transition-colors ${
                    metodo === m.id ? m.activo : 'border-gray-200 bg-white text-gray-500 hover:text-navy-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {metodo === 'debe' && (
              <div className="mt-2">
                <label htmlFor="venta-deudor" className={labelClass}>¿Quién debe?</label>
                <input
                  id="venta-deudor"
                  type="text"
                  value={deudor}
                  onChange={e => setDeudor(e.target.value)}
                  placeholder="Nombre y apellido"
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-gray-400">Queda en «Por cobrar»; se cobra desde el bot con «cobré + nombre».</p>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-gray-100 p-5 pt-4">
          <button
            onClick={handleRegistrar}
            disabled={!listo || registrando}
            className="w-full rounded-lg bg-lime-400 py-3 font-display text-sm font-bold text-navy-700 transition-colors hover:bg-lime-300 disabled:bg-gray-200 disabled:text-gray-400"
          >
            {registrando ? 'Registrando…' : 'Registrar venta'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Gasto rápido: descripción + monto (sin stock ni método de pago). */
function GastoModal({ registrar, socioSugerido, onClose, onDone }: {
  registrar: (label: string, amount: number, paidBy: SocioName) => Promise<{ ok: boolean; error?: string }>;
  /** Socio deducido del admin logueado; null con la cuenta compartida ("VOLEA Team"). */
  socioSugerido: SocioName | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  // Si no se puede deducir de la sesión, se elige a mano: sin esto el gasto se le
  // asentaba a Gastón por descarte y el reparto 50/25/25 salía mal.
  const [pagador, setPagador] = useState<SocioName | null>(socioSugerido);
  const [registrando, setRegistrando] = useState(false);

  const montoNum = Number(monto);
  const listo = descripcion.trim() !== '' && Number.isFinite(montoNum) && montoNum > 0 && pagador !== null;

  const handleRegistrar = async () => {
    if (!listo || registrando || !pagador) return;
    setRegistrando(true);
    try {
      const result = await registrar(descripcion.trim(), montoNum, pagador);
      if (!result.ok) {
        toast.error(result.error || 'No se pudo registrar el gasto');
        return;
      }
      toast.success('Gasto registrado ✓');
      onDone();
    } catch (e) {
      // Un throw inesperado no puede dejar el botón girando para siempre.
      console.error('Error registrando gasto:', e);
      toast.error('No se pudo registrar el gasto. Probá de nuevo.');
    } finally {
      setRegistrando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={() => !registrando && onClose()} />
      {/* max-h + scroll como VentaModal: el modal creció con los botones de socio y en el
          celular, con el teclado abierto, el submit quedaba abajo del fold. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Registrar gasto"
        className="relative flex max-h-[92dvh] w-full max-w-sm flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-navy-700">Gasto</h3>
          <button
            onClick={onClose}
            disabled={registrando}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label htmlFor="gasto-descripcion" className={labelClass}>¿En qué se gastó?</label>
            <input
              id="gasto-descripcion"
              type="text"
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Ej: pelotas, hielo, nafta"
              autoFocus
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="gasto-monto" className={labelClass}>Monto ($)</label>
            <input
              id="gasto-monto"
              type="number"
              inputMode="numeric"
              min={1}
              value={monto}
              onChange={e => setMonto(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <span className={labelClass}>¿Quién puso la plata?</span>
            <div className="grid grid-cols-3 gap-2">
              {SOCIOS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPagador(s)}
                  aria-pressed={pagador === s}
                  className={`rounded-lg border py-2.5 font-display text-sm font-bold transition-colors ${
                    pagador === s
                      ? 'border-navy-700 bg-navy-700 text-white'
                      : 'border-gray-200 text-navy-700 hover:border-navy-700'
                  }`}
                >
                  {NOMBRES_SOCIOS[s]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">
              {pagador === null
                ? 'Elegí de quién salió la plata: define el reparto 50/25/25.'
                : `El gasto se le asienta a ${NOMBRES_SOCIOS[pagador]} y se reparte 50/25/25.`}
            </p>
          </div>
        </div>
        <button
          onClick={handleRegistrar}
          disabled={!listo || registrando}
          className="mt-5 w-full rounded-lg bg-red-500 py-3 font-display text-sm font-bold text-white transition-colors hover:bg-red-600 disabled:bg-gray-200 disabled:text-gray-400"
        >
          {registrando ? 'Registrando…' : pagador === null ? 'Elegí quién pagó' : 'Registrar gasto'}
        </button>
      </div>
    </div>
  );
}
