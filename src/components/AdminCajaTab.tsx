import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, RefreshCw, TrendingUp, TrendingDown, Scale, Undo2, Info, MessageCircle, FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerEntry, SocioMove } from '../types';
import { exportCajaExcel } from '../utils/cajaExcel';
import { fechaHumana } from '../utils/fechas';

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

/** "M / Femenino|Fucsia" → "M / Femenino · Fucsia" */
const formatVariant = (key: string | null) => {
  if (!key) return '';
  const [size, color] = key.split('|');
  return [size, color].filter(Boolean).join(' · ');
};

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

export function AdminCajaTab({ loadLedger, loadLedgerFull, revertEntry, loadSocioMoves }: {
  loadLedger: () => Promise<LedgerEntry[] | null>;
  loadLedgerFull: () => Promise<LedgerEntry[] | null>;
  revertEntry: (id: string) => Promise<{ ok: boolean; stockRestored: boolean; error?: string }>;
  loadSocioMoves: () => Promise<SocioMove[] | null>;
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
  const [reverting, setReverting] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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
    const porNombre = new Map<string, { nombre: string; total: number; items: number; desde: string }>();
    for (const e of entries) {
      if (e.kind === 'venta' && e.paymentMethod === 'debe' && !e.settledAt && !e.reverted) {
        total += e.amount;
        count++;
        const nombre = e.debtorName || 'Sin nombre';
        const grupo = porNombre.get(nombre);
        if (grupo) {
          grupo.total += e.amount;
          grupo.items++;
          if (e.createdAt < grupo.desde) grupo.desde = e.createdAt;
        } else {
          porNombre.set(nombre, { nombre, total: e.amount, items: 1, desde: e.createdAt });
        }
      }
    }
    const deudores = Array.from(porNombre.values()).sort((a, b) => b.total - a.total);
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Caja</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="bg-white hover:bg-gray-50 disabled:opacity-50 text-navy-700 border border-gray-200 font-display font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2 text-sm"
          >
            <FileDown size={16} /> {exporting ? 'Generando…' : 'Descargar Excel'}
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="bg-navy-700 hover:bg-navy-800 disabled:bg-gray-400 text-white font-display font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2 text-sm"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {/* Callout informativo */}
      <div className="mb-6 flex items-start gap-2 rounded-xl bg-navy-50 px-4 py-2.5 text-xs text-navy-600">
        <MessageCircle size={14} className="mt-0.5 flex-shrink-0" />
        <p>
          Ventas y gastos registrados por el <b>bot de Telegram</b>. Al anular una venta de catálogo, el stock se repone solo.
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
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-gray-400">Se cobra desde el bot: «cobré + nombre»</p>
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
                <p className="mt-1 text-xs text-gray-400">Cuando el equipo registre ventas o gastos por Telegram, van a aparecer acá.</p>
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
            <h3 className="font-display text-lg font-bold text-navy-700 mb-2">¿Anular este movimiento?</h3>
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
    </div>
  );
}
