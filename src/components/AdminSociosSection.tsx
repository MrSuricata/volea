import { useMemo, useState } from 'react';
import { Users, Plus, Trash2, Check, X, Info } from 'lucide-react';
import { toast } from 'sonner';
import type { SocioMove, SocioMoveInput, SocioName } from '../types';
import { esCuotaFutura } from '../utils/socios';

const NOMBRES: Record<SocioName, string> = { brian: 'Brian', paula: 'Paula', gaston: 'Gastón' };
const SOCIOS: SocioName[] = ['brian', 'paula', 'gaston'];
const AREA_LBL: Record<SocioMove['area'], string> = {
  marca: 'Marca', showroom: 'Showroom', cafeteria: 'Cafetería',
  crp: 'Estadía CRP', argentinos: 'Bs.As. (ARS)', otros: 'Otros',
};
const TIPO_LBL: Record<SocioMove['tipo'], string> = {
  gasto: 'Gasto', pago: 'Pago', venta: 'Venta', ajuste: 'Ajuste',
};
const TIPO_STYLE: Record<SocioMove['tipo'], string> = {
  gasto: 'bg-red-100 text-red-600',
  pago: 'bg-blue-100 text-blue-700',
  venta: 'bg-green-100 text-green-700',
  ajuste: 'bg-gray-100 text-gray-600',
};

const money = (n: number) => '$ ' + n.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const money2 = (n: number) => n.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-07-28" → "28/07/26" */
const fmtFecha = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return d && m && y ? `${d}/${m}/${y.slice(2)}` : ymd;
};

/**
 * Reparto estándar Brian 50% / Paula 25% / Gastón 25%. Las partes se redondean
 * a centésimos y la de Gastón absorbe el resto para que sumen exacto el monto;
 * al restarle el monto al pagador, los tres impactos cierran en cero.
 */
function impactosGasto(monto: number, pagador: SocioName) {
  const pB = Math.round(monto * 50) / 100;
  const pP = Math.round(monto * 25) / 100;
  const pG = Math.round((monto - pB - pP) * 100) / 100;
  const imp: Record<SocioName, number> = { brian: pB, paula: pP, gaston: pG };
  imp[pagador] = Math.round((imp[pagador] - monto) * 100) / 100;
  return imp;
}

function impactosPago(monto: number, de: SocioName, para: SocioName) {
  const imp: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
  imp[de] = -Math.round(monto * 100) / 100;
  imp[para] = Math.round(monto * 100) / 100;
  return imp;
}

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type FormState = {
  tipo: 'gasto' | 'pago';
  area: SocioMove['area'];
  descripcion: string;
  monto: string;
  fecha: string;
  pagador: SocioName;
  de: SocioName;
  para: SocioName;
};

const FORM_INICIAL: FormState = {
  tipo: 'gasto', area: 'marca', descripcion: '', monto: '', fecha: hoyISO(),
  pagador: 'brian', de: 'brian', para: 'gaston',
};

export function AdminSociosSection({ moves, loading, onRefresh, onAdd, onDelete }: {
  moves: SocioMove[] | null;
  loading: boolean;
  onRefresh: () => void;
  onAdd: (input: SocioMoveInput) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [filterArea, setFilterArea] = useState<'todas' | SocioMove['area']>('todas');
  const [filterTipo, setFilterTipo] = useState<'todos' | SocioMove['tipo']>('todos');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(FORM_INICIAL);
  const [modo, setModo] = useState<'hoy' | 'total'>('hoy');

  const cortes = useMemo(() => {
    const hoy: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
    const total: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
    let futurasMonto = 0, futurasN = 0;
    const ahora = new Date();
    for (const m of moves || []) {
      if (m.moneda !== 'UYU') continue;
      total.brian += m.impBrian; total.paula += m.impPaula; total.gaston += m.impGaston;
      if (esCuotaFutura(m, ahora)) {
        futurasMonto += m.monto; futurasN++;
      } else {
        hoy.brian += m.impBrian; hoy.paula += m.impPaula; hoy.gaston += m.impGaston;
      }
    }
    return { hoy, total, futurasMonto, futurasN };
  }, [moves]);

  const saldos = modo === 'hoy' ? cortes.hoy : cortes.total;
  const saldosOtro = modo === 'hoy' ? cortes.total : cortes.hoy;

  const miniSaldo = (v: number) =>
    v > 0.5 ? `debe ${money(v)}` : v < -0.5 ? `a favor ${money(-v)}` : 'al día';

  const arsSaldos = useMemo(() => {
    const ars = (moves || []).filter(m => m.moneda === 'ARS');
    if (ars.length === 0) return null;
    return {
      brian: ars.reduce((s, m) => s + m.impBrian, 0),
      paula: ars.reduce((s, m) => s + m.impPaula, 0),
      gaston: ars.reduce((s, m) => s + m.impGaston, 0),
    };
  }, [moves]);

  const areas = useMemo(() => {
    const presentes = new Set((moves || []).map(m => m.area));
    return (['marca', 'showroom', 'cafeteria', 'crp', 'argentinos', 'otros'] as const).filter(a => presentes.has(a));
  }, [moves]);

  const filtered = useMemo(() => (moves || []).filter(m =>
    (filterArea === 'todas' || m.area === filterArea) &&
    (filterTipo === 'todos' || m.tipo === filterTipo)
  ), [moves, filterArea, filterTipo]);

  const montoNum = parseFloat(form.monto.replace(',', '.'));
  const montoOk = !isNaN(montoNum) && montoNum > 0;
  const preview = useMemo(() => {
    if (!montoOk) return null;
    return form.tipo === 'gasto'
      ? impactosGasto(montoNum, form.pagador)
      : impactosPago(montoNum, form.de, form.para);
  }, [form.tipo, form.pagador, form.de, form.para, montoNum, montoOk]);

  const formValido = montoOk &&
    (form.tipo === 'gasto' ? form.descripcion.trim().length > 0 : form.de !== form.para);

  const handleSave = async () => {
    if (!formValido || !preview || saving) return;
    setSaving(true);
    const ok = await onAdd({
      area: form.tipo === 'pago' ? 'marca' : form.area,
      tipo: form.tipo,
      descripcion: form.tipo === 'gasto'
        ? form.descripcion.trim()
        : (form.descripcion.trim() || `Pago ${NOMBRES[form.de]} a ${NOMBRES[form.para]}`),
      monto: montoNum,
      fecha: form.fecha || null,
      pagador: form.tipo === 'gasto' ? form.pagador : null,
      de: form.tipo === 'pago' ? form.de : null,
      para: form.tipo === 'pago' ? form.para : null,
      impBrian: preview.brian,
      impPaula: preview.paula,
      impGaston: preview.gaston,
    });
    setSaving(false);
    if (!ok) { toast.error('No se pudo guardar el movimiento'); return; }
    toast.success(form.tipo === 'gasto' ? 'Gasto agregado a las cuentas' : 'Pago registrado');
    setShowForm(false);
    setForm({ ...FORM_INICIAL, fecha: hoyISO() });
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    if (deleting) return;
    setDeleting(true);
    const ok = await onDelete(id);
    setDeleting(false);
    setDeleteConfirm(null);
    if (!ok) { toast.error('No se pudo borrar el movimiento'); return; }
    toast.success('Movimiento borrado');
    onRefresh();
  };

  const selectCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-700';

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display text-xl font-bold text-navy-700 flex items-center gap-2">
          <Users size={20} /> Cuentas entre socios
        </h2>
        <button
          onClick={() => { setForm({ ...FORM_INICIAL, fecha: hoyISO() }); setShowForm(true); }}
          className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2 text-sm"
        >
          <Plus size={16} /> Nuevo movimiento
        </button>
      </div>

      <div className="mb-4 bg-blue-50 border-l-4 border-blue-500 px-4 py-3 rounded-r-lg flex items-start gap-3 text-sm text-blue-900">
        <Info size={18} className="flex-shrink-0 mt-0.5" />
        <p>
          Historial importado del Excel de gastos + lo que carguen acá. Reparto estándar:
          {' '}<b>Brian 50% · Paula 25% · Gastón 25%</b>. Saldo positivo = le debe al grupo;
          negativo = el grupo le debe. <b>Al día de hoy</b> cuenta solo las cuotas ya vencidas;
          {' '}<b>Total comprometido</b> incluye también las cuotas que faltan vencer.
        </p>
      </div>

      {moves === null && !loading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center text-gray-400">
          <p className="font-display">No se pudieron cargar las cuentas de socios</p>
          <p className="text-sm mt-1">Verificá tu sesión de admin y probá "Actualizar".</p>
        </div>
      )}

      {moves !== null && (
        <>
          {/* Modo de saldo: solo vencido vs todo lo comprometido */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex bg-white rounded-lg border border-gray-200 p-1">
              {([['hoy', 'Al día de hoy'], ['total', 'Total comprometido']] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setModo(id)}
                  className={`px-4 py-2 rounded-md text-sm font-display font-semibold transition-colors ${
                    modo === id ? 'bg-navy-700 text-white' : 'text-gray-500 hover:text-navy-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {modo === 'hoy' && cortes.futurasN > 0 && (
              <span className="text-xs text-gray-400">
                Sin contar {money(cortes.futurasMonto)} en {cortes.futurasN} cuotas que todavía no vencieron.
              </span>
            )}
          </div>

          {/* Saldos */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {SOCIOS.map(s => {
              const v = saldos[s];
              const debe = v > 0.5;
              const favor = v < -0.5;
              return (
                <div key={s} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <div className="text-xs font-display font-semibold text-gray-500 uppercase mb-1">{NOMBRES[s]}</div>
                  <p className={`font-display text-2xl font-bold ${debe ? 'text-red-500' : favor ? 'text-green-600' : 'text-navy-700'}`}>
                    {money(Math.abs(v))}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {debe ? 'le debe al grupo' : favor ? 'el grupo le debe' : 'al día'}
                  </p>
                  <p className="text-[11px] text-gray-400/80 mt-1 border-t border-gray-50 pt-1">
                    {modo === 'hoy' ? 'Comprometido' : 'Al día de hoy'}: {miniSaldo(saldosOtro[s])}
                  </p>
                </div>
              );
            })}
          </div>

          {arsSaldos && (
            <div className="mb-4 bg-amber-50 border-l-4 border-amber-500 px-4 py-3 rounded-r-lg text-sm text-amber-900">
              🇦🇷 <b>Aparte, en pesos argentinos (viaje Bs.As.):</b>{' '}
              {SOCIOS.map((s, i) => {
                const v = arsSaldos[s];
                return (
                  <span key={s}>
                    {i > 0 && ' · '}
                    {NOMBRES[s]} {v > 0.5 ? `debe ${money2(v)}` : v < -0.5 ? `a favor ${money2(-v)}` : 'al día'}
                  </span>
                );
              })}{' '}ARS
            </div>
          )}

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex bg-white rounded-lg border border-gray-200 p-1 flex-wrap">
              <button
                onClick={() => setFilterArea('todas')}
                className={`px-3 py-1.5 rounded-md text-sm font-display font-semibold transition-colors ${
                  filterArea === 'todas' ? 'bg-navy-700 text-white' : 'text-gray-500 hover:text-navy-700'
                }`}
              >
                Todas
              </button>
              {areas.map(a => (
                <button
                  key={a}
                  onClick={() => setFilterArea(a)}
                  className={`px-3 py-1.5 rounded-md text-sm font-display font-semibold transition-colors ${
                    filterArea === a ? 'bg-navy-700 text-white' : 'text-gray-500 hover:text-navy-700'
                  }`}
                >
                  {AREA_LBL[a]}
                </button>
              ))}
            </div>
            <div className="flex bg-white rounded-lg border border-gray-200 p-1">
              {(['todos', 'gasto', 'venta', 'pago'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setFilterTipo(t)}
                  className={`px-3 py-1.5 rounded-md text-sm font-display font-semibold transition-colors ${
                    filterTipo === t ? 'bg-lime-400 text-navy-700' : 'text-gray-500 hover:text-navy-700'
                  }`}
                >
                  {t === 'todos' ? 'Todos' : TIPO_LBL[t] + 's'}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">{filtered.length} movimiento{filtered.length === 1 ? '' : 's'}</span>
          </div>

          {/* Tabla */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Cuándo</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">Área</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Tipo</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Detalle</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Monto</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden lg:table-cell">Brian</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden lg:table-cell">Paula</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden lg:table-cell">Gastón</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 text-sm text-gray-500 whitespace-nowrap">
                        {m.fecha ? fmtFecha(m.fecha) : <span className="text-xs">{m.periodo || '—'}</span>}
                        {esCuotaFutura(m) && (
                          <span className="block text-[10px] font-semibold text-amber-600">cuota futura</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-500 hidden sm:table-cell">{AREA_LBL[m.area]}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-display font-bold ${TIPO_STYLE[m.tipo]}`}>
                          {TIPO_LBL[m.tipo]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-display font-semibold text-navy-700 text-sm">{m.descripcion}</p>
                        <p className="text-xs text-gray-400">
                          {m.tipo === 'gasto' && (m.pagador ? `Pagó ${NOMBRES[m.pagador]}` : 'Pagaron varios')}
                          {m.tipo === 'pago' && m.de && m.para && `${NOMBRES[m.de]} → ${NOMBRES[m.para]}`}
                          {m.tipo === 'venta' && m.de && m.para && `Cobró ${NOMBRES[m.para]} · parte de ${NOMBRES[m.de]}`}
                          {m.moneda === 'ARS' && ' · ARS'}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-sm font-bold text-navy-700 whitespace-nowrap">{money(m.monto)}</td>
                      {([m.impBrian, m.impPaula, m.impGaston] as const).map((v, i) => (
                        <td key={i} className={`px-4 py-2.5 text-xs whitespace-nowrap hidden lg:table-cell ${
                          v > 0.004 ? 'text-red-500' : v < -0.004 ? 'text-green-600' : 'text-gray-300'
                        }`}>
                          {Math.abs(v) < 0.005 ? '—' : (v > 0 ? '+' : '−') + money2(Math.abs(v))}
                        </td>
                      ))}
                      <td className="px-4 py-2.5">
                        {deleteConfirm === m.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-600 font-semibold whitespace-nowrap">¿Borrar?</span>
                            <button onClick={() => handleDelete(m.id)} disabled={deleting}
                              className="text-red-500 hover:text-red-700 disabled:text-gray-300 transition-colors" title="Confirmar">
                              <Check size={15} />
                            </button>
                            <button onClick={() => setDeleteConfirm(null)} disabled={deleting}
                              className="text-gray-400 hover:text-navy-700 transition-colors" title="Cancelar">
                              <X size={15} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirm(m.id)} disabled={deleting}
                            className="text-gray-300 hover:text-red-500 transition-colors" title="Borrar movimiento">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">
                        Sin movimientos con estos filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Modal de alta */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-bold text-navy-700">Nuevo movimiento de socios</h3>
              <button onClick={() => setShowForm(false)} disabled={saving} className="text-gray-400 hover:text-navy-700">
                <X size={20} />
              </button>
            </div>

            <div className="flex bg-gray-100 rounded-lg p-1 mb-4">
              {(['gasto', 'pago'] as const).map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, tipo: t }))}
                  className={`flex-1 py-2 rounded-md text-sm font-display font-semibold transition-colors ${
                    form.tipo === t ? 'bg-white text-navy-700 shadow-sm' : 'text-gray-500'
                  }`}>
                  {t === 'gasto' ? 'Gasto compartido' : 'Pago entre socios'}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {form.tipo === 'gasto' ? (
                <>
                  <div>
                    <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Área</label>
                    <select value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value as SocioMove['area'] }))} className={selectCls}>
                      <option value="marca">Marca</option>
                      <option value="showroom">Showroom</option>
                      <option value="cafeteria">Cafetería</option>
                      <option value="otros">Otros</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Descripción</label>
                    <input type="text" value={form.descripcion} placeholder="Ej: Pedido Disershop"
                      onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} className={selectCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Pagó</label>
                    <select value={form.pagador} onChange={e => setForm(f => ({ ...f, pagador: e.target.value as SocioName }))} className={selectCls}>
                      {SOCIOS.map(s => <option key={s} value={s}>{NOMBRES[s]}</option>)}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Paga</label>
                      <select value={form.de} onChange={e => setForm(f => ({ ...f, de: e.target.value as SocioName }))} className={selectCls}>
                        {SOCIOS.map(s => <option key={s} value={s}>{NOMBRES[s]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Recibe</label>
                      <select value={form.para} onChange={e => setForm(f => ({ ...f, para: e.target.value as SocioName }))} className={selectCls}>
                        {SOCIOS.map(s => <option key={s} value={s}>{NOMBRES[s]}</option>)}
                      </select>
                    </div>
                  </div>
                  {form.de === form.para && (
                    <p className="text-xs text-red-500">Tienen que ser dos socios distintos.</p>
                  )}
                  <div>
                    <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Nota (opcional)</label>
                    <input type="text" value={form.descripcion} placeholder="Ej: transferencia BROU"
                      onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} className={selectCls} />
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Monto ($)</label>
                  <input type="number" min="0" step="0.01" value={form.monto} placeholder="0"
                    onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} className={selectCls} />
                </div>
                <div>
                  <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Fecha</label>
                  <input type="date" value={form.fecha}
                    onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} className={selectCls} />
                </div>
              </div>

              {preview && (
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm">
                  <p className="text-xs font-display font-semibold text-gray-500 uppercase mb-1.5">Cómo impacta en los saldos</p>
                  {SOCIOS.map(s => {
                    const v = preview[s];
                    return (
                      <p key={s} className="flex justify-between">
                        <span className="text-gray-600">{NOMBRES[s]}</span>
                        <span className={`font-semibold ${v > 0.004 ? 'text-red-500' : v < -0.004 ? 'text-green-600' : 'text-gray-400'}`}>
                          {Math.abs(v) < 0.005 ? '—' : (v > 0 ? `debe ${money2(v)} más` : `${money2(-v)} a favor`)}
                        </span>
                      </p>
                    );
                  })}
                </div>
              )}

              <button onClick={handleSave} disabled={!formValido || saving}
                className="w-full bg-navy-700 hover:bg-navy-800 disabled:bg-gray-300 text-white font-display font-semibold py-2.5 rounded-lg transition-colors">
                {saving ? 'Guardando…' : 'Guardar movimiento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
