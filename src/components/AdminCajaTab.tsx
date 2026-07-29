import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, RefreshCw, TrendingUp, TrendingDown, Scale, Undo2, Check, X, Info, MessageCircle, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerEntry, SocioMove } from '../types';
import { exportCajaExcel } from '../utils/cajaExcel';

const TZ = 'America/Montevideo';

const formatMoney = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-UY', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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

export function AdminCajaTab({ loadLedger, loadLedgerFull, revertEntry, loadSocioMoves }: {
  loadLedger: () => Promise<LedgerEntry[] | null>;
  loadLedgerFull: () => Promise<LedgerEntry[] | null>;
  revertEntry: (id: string) => Promise<{ ok: boolean; stockRestored: boolean; error?: string }>;
  loadSocioMoves: () => Promise<SocioMove[] | null>;
}) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [period, setPeriod] = useState<PeriodFilter>('7d');
  const [kind, setKind] = useState<KindFilter>('todos');
  const [revertConfirm, setRevertConfirm] = useState<string | null>(null);
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
    let ventas = 0, gastos = 0, count = 0;
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
      if (e.kind === 'venta') ventas += e.amount;
      else gastos += e.amount;
    }
    return { ventas, gastos, balance: ventas - gastos, count };
  }, [entries, period]);

  // Deudas abiertas (sobre todo lo cargado, sin filtro de período)
  const porCobrar = useMemo(() => {
    let total = 0, count = 0;
    const nombres = new Set<string>();
    for (const e of entries) {
      if (e.kind === 'venta' && e.paymentMethod === 'debe' && !e.settledAt && !e.reverted) {
        total += e.amount;
        count++;
        if (e.debtorName) nombres.add(e.debtorName);
      }
    }
    return { total, count, nombres: Array.from(nombres) };
  }, [entries]);

  const handleRevert = async (entry: LedgerEntry) => {
    if (reverting) return; // ya hay una anulación en curso
    setReverting(entry.id);
    const result = await revertEntry(entry.id);
    setReverting(null);
    setRevertConfirm(null);
    if (!result.ok) {
      toast.error(result.error || 'No se pudo anular el movimiento');
      // Sincronizar igual: quizás ya estaba anulado desde el bot ("deshacer").
      refresh();
      return;
    }
    toast.success(result.stockRestored ? 'Movimiento anulado y stock repuesto' : 'Movimiento anulado');
    refresh();
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

      {/* Info banner */}
      <div className="mb-6 bg-blue-50 border-l-4 border-blue-500 px-4 py-3 rounded-r-lg flex items-start gap-3 text-sm text-blue-900">
        <MessageCircle size={18} className="flex-shrink-0 mt-0.5" />
        <p>
          Acá aparecen las ventas y gastos que el equipo registra por el <b>bot de Telegram</b>.
          Al anular una venta de catálogo, el stock se repone solo.
        </p>
      </div>

      {/* Summary cards */}
      {!loadFailed && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-xs font-display font-semibold text-gray-500 uppercase mb-1">
            <TrendingUp size={14} className="text-green-600" /> Ventas
          </div>
          <p className="font-display text-2xl font-bold text-green-600">{formatMoney(totals.ventas)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-xs font-display font-semibold text-gray-500 uppercase mb-1">
            <TrendingDown size={14} className="text-red-500" /> Gastos
          </div>
          <p className="font-display text-2xl font-bold text-red-500">{formatMoney(totals.gastos)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-xs font-display font-semibold text-gray-500 uppercase mb-1">
            <Scale size={14} className="text-navy-700" /> Balance
          </div>
          <p className={`font-display text-2xl font-bold ${totals.balance >= 0 ? 'text-navy-700' : 'text-red-500'}`}>
            {formatMoney(totals.balance)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-xs font-display font-semibold text-gray-500 uppercase mb-1">
            <Wallet size={14} className="text-navy-700" /> Movimientos
          </div>
          <p className="font-display text-2xl font-bold text-navy-700">{totals.count}</p>
        </div>
      </div>
      )}

      {/* Deudas abiertas */}
      {!loadFailed && porCobrar.count > 0 && (
        <div className="mb-6 bg-amber-50 border-l-4 border-amber-500 px-4 py-3 rounded-r-lg text-sm text-amber-900">
          📒 <b>Por cobrar: {formatMoney(porCobrar.total)}</b> en {porCobrar.count} venta{porCobrar.count > 1 ? 's' : ''} fiada{porCobrar.count > 1 ? 's' : ''}
          {porCobrar.nombres.length > 0 && <> — {porCobrar.nombres.join(', ')}</>}.
          {' '}Se cobran desde el bot: <i>cobré + nombre</i>.
        </div>
      )}

      {/* Filters */}
      {!loadFailed && (
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex bg-white rounded-lg border border-gray-200 p-1">
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-4 py-2 rounded-md text-sm font-display font-semibold transition-colors ${
                period === p.id ? 'bg-navy-700 text-white' : 'text-gray-500 hover:text-navy-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex bg-white rounded-lg border border-gray-200 p-1">
          {KINDS.map(k => (
            <button
              key={k.id}
              onClick={() => setKind(k.id)}
              className={`px-4 py-2 rounded-md text-sm font-display font-semibold transition-colors ${
                kind === k.id ? 'bg-lime-400 text-navy-700' : 'text-gray-500 hover:text-navy-700'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Error state */}
      {loadFailed && !loading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
          <Info size={48} strokeWidth={1} className="mx-auto mb-3" />
          <p className="font-display">No se pudo cargar la caja</p>
          <p className="text-sm mt-1">Asegurate de haber entrado con el link mágico y probá "Actualizar".</p>
        </div>
      )}

      {/* Empty state */}
      {!loadFailed && !loading && filtered.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
          <Wallet size={48} strokeWidth={1} className="mx-auto mb-3" />
          <p className="font-display">Sin movimientos en este período</p>
          <p className="text-sm mt-1">Cuando el equipo registre ventas o gastos por Telegram, van a aparecer acá.</p>
        </div>
      )}

      {/* Table */}
      {!loadFailed && filtered.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Tipo</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Detalle</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Cant.</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Monto</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Registró</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(entry => (
                  <tr
                    key={entry.id}
                    className={`border-b border-gray-100 transition-colors ${
                      entry.reverted ? 'opacity-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{formatDateTime(entry.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-display font-bold ${
                        entry.kind === 'venta' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                      }`}>
                        {entry.kind === 'venta' ? 'Venta' : 'Gasto'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className={`font-display font-semibold text-navy-700 text-sm ${entry.reverted ? 'line-through' : ''}`}>
                        {entry.label}
                      </p>
                      {entry.variantKey && (
                        <p className="text-xs text-gray-400">{formatVariant(entry.variantKey)}</p>
                      )}
                      {entry.kind === 'venta' && !entry.productId && (
                        <p className="text-xs text-gray-400">Ítem suelto (sin stock)</p>
                      )}
                      {entry.kind === 'venta' && entry.paymentMethod && entry.paymentMethod !== 'debe' && (
                        <p className="text-xs text-gray-400">{PAYMENT_LABELS[entry.paymentMethod]}</p>
                      )}
                      {entry.paymentMethod === 'debe' && (
                        entry.settledAt ? (
                          <p className="text-xs text-green-600">
                            Debía {entry.debtorName || '—'} · cobrado
                            {entry.settledMethod ? ` (${PAYMENT_LABELS[entry.settledMethod]})` : ''}
                          </p>
                        ) : (
                          <p className="text-xs font-semibold text-amber-600">Debe {entry.debtorName || '—'}</p>
                        )
                      )}
                      {entry.reverted && (
                        <p className="text-xs text-red-400 font-semibold">Anulado</p>
                      )}
                      {entry.socioSettledAt && !entry.reverted && (
                        <p className="text-[10px] text-teal-600 font-semibold">✓ liquidado a socios</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{entry.qty}</td>
                    <td className={`px-4 py-3 text-sm font-bold whitespace-nowrap ${
                      entry.reverted ? 'text-gray-400 line-through' : entry.kind === 'venta' ? 'text-green-600' : 'text-red-500'
                    }`}>
                      {entry.kind === 'venta' ? '+' : '−'}{formatMoney(entry.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{entry.reportedBy}</td>
                    <td className="px-4 py-3">
                      {entry.reverted ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : revertConfirm === entry.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-600 font-semibold whitespace-nowrap">
                            {entry.productId ? '¿Anular y reponer stock?' : '¿Anular?'}
                          </span>
                          <button
                            onClick={() => handleRevert(entry)}
                            disabled={reverting === entry.id}
                            className="text-red-500 hover:text-red-700 disabled:text-gray-300 transition-colors"
                            title="Confirmar"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={() => setRevertConfirm(null)}
                            disabled={reverting === entry.id}
                            className="text-gray-400 hover:text-navy-700 transition-colors"
                            title="Cancelar"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRevertConfirm(entry.id)}
                          disabled={reverting !== null}
                          className="text-gray-400 hover:text-red-500 disabled:text-gray-200 transition-colors flex items-center gap-1 text-xs font-semibold"
                          title="Anular movimiento"
                        >
                          <Undo2 size={16} /> Anular
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.length >= 500 && (
            <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
              Se muestran los últimos 500 movimientos: los totales de "Todo" pueden no incluir los más viejos.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
