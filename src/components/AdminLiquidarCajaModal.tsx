import { useEffect, useMemo, useState } from 'react';
import { X, ArrowRight, HandCoins } from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerEntry, SocioMove, SocioName, SocioLiquidacionMove } from '../types';
import { esCuotaFutura, impactosGasto, impactosVenta, SOCIOS, NOMBRES_SOCIOS } from '../utils/socios';

const money = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });
const METODO_LBL: Record<string, string> = { mp: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia' };

const TZ = 'America/Montevideo';
const diaMvd = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: TZ });
};

/** "Gasty" registró el gasto → la plata la puso Gastón (ajustable en el modal). */
const personaASocio = (nombre: string): SocioName => {
  const n = nombre.trim().toLowerCase();
  if (n.startsWith('brian')) return 'brian';
  if (n.startsWith('paul') || n.startsWith('pauli')) return 'paula';
  return 'gaston';
};

type VentaGroup = { key: string; label: string; ids: string[]; n: number; total: number; cobrador: SocioName; incluir: boolean };
type GastoRow = { id: string; label: string; fecha: string | null; monto: number; persona: string; pagador: SocioName; incluir: boolean };

export function AdminLiquidarCajaModal({ socioMoves, loadLedgerFull, liquidar, onClose, onDone }: {
  socioMoves: SocioMove[] | null;
  loadLedgerFull: () => Promise<LedgerEntry[] | null>;
  liquidar: (ids: string[], moves: SocioLiquidacionMove[]) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [ventaGroups, setVentaGroups] = useState<VentaGroup[]>([]);
  const [gastoRows, setGastoRows] = useState<GastoRow[]>([]);
  const [fiadosSinCobrar, setFiadosSinCobrar] = useState({ n: 0, total: 0 });
  const [area, setArea] = useState<SocioMove['area']>('marca');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const data = await loadLedgerFull();
      if (!vivo) return;
      if (data === null) { setFailed(true); setLoading(false); return; }
      const pendientes = data.filter(e => !e.reverted && !e.socioSettledAt);

      const grupos = new Map<string, VentaGroup>();
      let fiadosN = 0, fiadosTotal = 0;
      for (const e of pendientes) {
        if (e.kind !== 'venta') continue;
        if (e.paymentMethod === 'debe' && !e.settledAt) {
          fiadosN++; fiadosTotal += e.amount;
          continue; // plata que todavía no entró: se liquida cuando se cobre
        }
        const metodo = e.paymentMethod === 'debe'
          ? `Fiados cobrados (${e.settledMethod ? METODO_LBL[e.settledMethod] : '—'})`
          : (e.paymentMethod ? METODO_LBL[e.paymentMethod] : 'Sin método');
        const g = grupos.get(metodo) || { key: metodo, label: metodo, ids: [], n: 0, total: 0, cobrador: 'gaston' as SocioName, incluir: true };
        g.ids.push(e.id); g.n++; g.total += e.amount;
        grupos.set(metodo, g);
      }

      const gastos: GastoRow[] = pendientes
        .filter(e => e.kind === 'gasto')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(e => ({
          id: e.id, label: e.label, fecha: diaMvd(e.createdAt), monto: e.amount,
          persona: e.reportedBy || '—', pagador: personaASocio(e.reportedBy || ''), incluir: true,
        }));

      setVentaGroups(Array.from(grupos.values()).sort((a, b) => b.total - a.total));
      setGastoRows(gastos);
      setFiadosSinCobrar({ n: fiadosN, total: fiadosTotal });
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, [loadLedgerFull]);

  const saldosHoy = useMemo(() => {
    const s: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
    const ahora = new Date();
    for (const m of socioMoves || []) {
      if (m.moneda !== 'UYU' || esCuotaFutura(m, ahora)) continue;
      s.brian += m.impBrian; s.paula += m.impPaula; s.gaston += m.impGaston;
    }
    return s;
  }, [socioMoves]);

  const deltas = useMemo(() => {
    const d: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
    for (const g of ventaGroups) {
      if (!g.incluir) continue;
      const imp = impactosVenta(g.total, g.cobrador);
      for (const s of SOCIOS) d[s] += imp[s];
    }
    for (const r of gastoRows) {
      if (!r.incluir) continue;
      const imp = impactosGasto(r.monto, r.pagador);
      for (const s of SOCIOS) d[s] += imp[s];
    }
    return d;
  }, [ventaGroups, gastoRows]);

  const totVentas = ventaGroups.filter(g => g.incluir).reduce((s, g) => s + g.total, 0);
  const totGastos = gastoRows.filter(r => r.incluir).reduce((s, r) => s + r.monto, 0);
  const nMovs = ventaGroups.filter(g => g.incluir).length + gastoRows.filter(r => r.incluir).length;
  const hayAlgo = ventaGroups.length + gastoRows.length > 0;

  const handleConfirm = async () => {
    if (saving || nMovs === 0) return;
    setSaving(true);
    const hoy = diaMvd();
    const ids: string[] = [];
    const moves: SocioLiquidacionMove[] = [];
    for (const g of ventaGroups) {
      if (!g.incluir) continue;
      ids.push(...g.ids);
      const imp = impactosVenta(g.total, g.cobrador);
      moves.push({
        area, tipo: 'venta', fecha: hoy,
        descripcion: `Liquidación caja — ${g.label} (${g.n} venta${g.n === 1 ? '' : 's'})`,
        monto: Math.round(g.total * 100) / 100,
        pagador: null, de: null, para: g.cobrador,
        imp_brian: imp.brian, imp_paula: imp.paula, imp_gaston: imp.gaston,
      });
    }
    for (const r of gastoRows) {
      if (!r.incluir) continue;
      ids.push(r.id);
      const imp = impactosGasto(r.monto, r.pagador);
      moves.push({
        area, tipo: 'gasto', fecha: r.fecha,
        descripcion: `${r.label} (caja)`,
        monto: Math.round(r.monto * 100) / 100,
        pagador: r.pagador, de: null, para: null,
        imp_brian: imp.brian, imp_paula: imp.paula, imp_gaston: imp.gaston,
      });
    }
    const res = await liquidar(ids, moves);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || 'No se pudo liquidar la caja');
      return;
    }
    toast.success(`Caja liquidada: ${money(totVentas)} en ventas y ${money(totGastos)} en gastos`);
    onDone();
  };

  const selectCls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-navy-700';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display text-lg font-bold text-navy-700 flex items-center gap-2">
            <HandCoins size={20} /> Liquidar caja a socios
          </h3>
          <button onClick={onClose} disabled={saving} className="text-gray-400 hover:text-navy-700"><X size={20} /></button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Pasa las ventas y gastos del bot que faltan repartir a las cuentas de socios.
          Marcá quién tiene la plata de cada cosa y mirá abajo cómo quedan los saldos antes de confirmar.
        </p>

        {loading && <p className="text-sm text-gray-400 py-8 text-center">Cargando la caja…</p>}
        {failed && !loading && <p className="text-sm text-gray-400 py-8 text-center">No se pudo cargar la caja. Verificá tu sesión.</p>}
        {!loading && !failed && !hayAlgo && (
          <p className="text-sm text-gray-500 py-8 text-center">🎉 No hay nada pendiente de liquidar.</p>
        )}

        {!loading && !failed && hayAlgo && (
          <div className="space-y-5">
            {ventaGroups.length > 0 && (
              <div>
                <h4 className="text-xs font-display font-bold text-gray-500 uppercase mb-2">Ventas por repartir</h4>
                <div className="space-y-1.5">
                  {ventaGroups.map(g => (
                    <div key={g.key} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${g.incluir ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}>
                      <input type="checkbox" checked={g.incluir} className="accent-navy-700"
                        onChange={() => setVentaGroups(vs => vs.map(v => v.key === g.key ? { ...v, incluir: !v.incluir } : v))} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-display font-semibold text-navy-700">{g.label}</p>
                        <p className="text-xs text-gray-400">{g.n} venta{g.n === 1 ? '' : 's'}</p>
                      </div>
                      <span className="text-sm font-bold text-green-600 whitespace-nowrap">{money(g.total)}</span>
                      <label className="text-xs text-gray-400">cobró</label>
                      <select value={g.cobrador} className={selectCls} disabled={!g.incluir}
                        onChange={e => setVentaGroups(vs => vs.map(v => v.key === g.key ? { ...v, cobrador: e.target.value as SocioName } : v))}>
                        {SOCIOS.map(s => <option key={s} value={s}>{NOMBRES_SOCIOS[s]}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {fiadosSinCobrar.n > 0 && (
                  <p className="text-xs text-amber-600 mt-2">
                    Quedan afuera {money(fiadosSinCobrar.total)} en {fiadosSinCobrar.n} fiado{fiadosSinCobrar.n === 1 ? '' : 's'} sin cobrar — se liquidan cuando entre la plata.
                  </p>
                )}
              </div>
            )}

            {gastoRows.length > 0 && (
              <div>
                <h4 className="text-xs font-display font-bold text-gray-500 uppercase mb-2">Gastos por asentar</h4>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {gastoRows.map(r => (
                    <div key={r.id} className={`flex items-center gap-3 rounded-lg border px-3 py-1.5 ${r.incluir ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}>
                      <input type="checkbox" checked={r.incluir} className="accent-navy-700"
                        onChange={() => setGastoRows(rs => rs.map(x => x.id === r.id ? { ...x, incluir: !x.incluir } : x))} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-navy-700 truncate">{r.label}</p>
                        <p className="text-xs text-gray-400">{r.fecha} · registró {r.persona}</p>
                      </div>
                      <span className="text-sm font-bold text-red-500 whitespace-nowrap">{money(r.monto)}</span>
                      <label className="text-xs text-gray-400">pagó</label>
                      <select value={r.pagador} className={selectCls} disabled={!r.incluir}
                        onChange={e => setGastoRows(rs => rs.map(x => x.id === r.id ? { ...x, pagador: e.target.value as SocioName } : x))}>
                        {SOCIOS.map(s => <option key={s} value={s}>{NOMBRES_SOCIOS[s]}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  "Pagó" = quién puso la plata. Si un gasto salió del efectivo de la caja, dejalo a nombre de quien tenía esa caja.
                  Si algo ya está cargado en las cuentas, destildalo para no contarlo dos veces.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="text-xs font-display font-semibold text-gray-500 uppercase">Área</label>
              <select value={area} onChange={e => setArea(e.target.value as SocioMove['area'])} className={selectCls}>
                <option value="marca">Marca</option>
                <option value="cafeteria">Cafetería</option>
                <option value="otros">Otros</option>
              </select>
            </div>

            {/* Previsión de saldos */}
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs font-display font-semibold text-gray-500 uppercase mb-2">
                Cómo quedan los saldos (al día de hoy)
              </p>
              {SOCIOS.map(s => {
                const antes = saldosHoy[s];
                const despues = antes + deltas[s];
                const lee = (v: number) => v > 0.5 ? `debe ${money(v)}` : v < -0.5 ? `a favor ${money(-v)}` : 'al día';
                return (
                  <div key={s} className="flex items-center justify-between text-sm py-0.5">
                    <span className="text-gray-600 w-16">{NOMBRES_SOCIOS[s]}</span>
                    <span className="text-gray-400">{lee(antes)}</span>
                    <ArrowRight size={14} className="text-gray-300 mx-2 flex-shrink-0" />
                    <span className={`font-semibold text-right ${despues > 0.5 ? 'text-red-500' : despues < -0.5 ? 'text-green-600' : 'text-gray-500'}`}>
                      {lee(despues)}
                    </span>
                  </div>
                );
              })}
            </div>

            <button
              onClick={handleConfirm}
              disabled={saving || nMovs === 0}
              className="w-full bg-navy-700 hover:bg-navy-800 disabled:bg-gray-300 text-white font-display font-semibold py-2.5 rounded-lg transition-colors"
            >
              {saving ? 'Liquidando…'
                : nMovs === 0 ? 'Nada seleccionado'
                : `Liquidar ${money(totVentas)} en ventas y ${money(totGastos)} en gastos`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
