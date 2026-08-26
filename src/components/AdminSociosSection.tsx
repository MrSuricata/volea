import { useMemo, useState } from 'react';
import { Users, Plus, Trash2, Check, X, Info } from 'lucide-react';
import { toast } from 'sonner';
import type { SocioMove, SocioMoveInput, SocioName } from '../types';
import { armarCuotas, esCuotaFutura, ventasBrutasSocios, impactosGasto, impactosPago, impactosVenta } from '../utils/socios';

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

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** "2026-09-15" → "sep-26" (para el preview de cuotas) */
const mesCorto = (ymd: string) => {
  const [y, m] = ymd.split('-').map(Number);
  return y && m ? `${MESES_CORTOS[m - 1]}-${String(y).slice(2)}` : ymd;
};

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type FormState = {
  tipo: 'gasto' | 'pago' | 'venta';
  area: SocioMove['area'];
  descripcion: string;
  monto: string;
  fecha: string;
  pagador: SocioName;
  de: SocioName;
  para: SocioName;
  cobrador: SocioName;
  /** Solo gastos: cantidad de cuotas mensuales (el monto es el TOTAL de la compra). */
  cuotas: string;
};

const FORM_INICIAL: FormState = {
  tipo: 'gasto', area: 'marca', descripcion: '', monto: '', fecha: hoyISO(),
  pagador: 'brian', de: 'brian', para: 'gaston', cobrador: 'gaston', cuotas: '1',
};

export function AdminSociosSection({ moves, loading, onRefresh, onAddMany, onDelete, onDeleteGrupo }: {
  moves: SocioMove[] | null;
  loading: boolean;
  onRefresh: () => void;
  /** Alta atómica: las cuotas de una compra entran todas juntas o ninguna. */
  onAddMany: (inputs: SocioMoveInput[]) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onDeleteGrupo: (grupo: string) => Promise<boolean>;
}) {
  const [filterArea, setFilterArea] = useState<'todas' | SocioMove['area']>('todas');
  const [filterTipo, setFilterTipo] = useState<'todos' | SocioMove['tipo']>('todos');
  // Orden y rango de fechas de la tabla (pedido de Brian). Antes la tabla
  // salía en el orden crudo de la DB, con las cuotas futuras arriba.
  const [ordenFecha, setOrdenFecha] = useState<'desc' | 'asc'>('desc');
  const [desdeFecha, setDesdeFecha] = useState('');
  const [hastaFecha, setHastaFecha] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(FORM_INICIAL);
  const [modo, setModo] = useState<'hoy' | 'total'>('hoy');

  const cortes = useMemo(() => {
    const hoy: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
    const total: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
    let futurasMonto = 0, futurasN = 0, invertidoTotal = 0, invertidoHoy = 0;
    const ahora = new Date();
    for (const m of moves || []) {
      if (m.moneda !== 'UYU') continue;
      total.brian += m.impBrian; total.paula += m.impPaula; total.gaston += m.impGaston;
      const futura = esCuotaFutura(m, ahora);
      if (m.tipo === 'gasto') {
        invertidoTotal += m.monto;
        if (!futura) invertidoHoy += m.monto;
      }
      if (futura) {
        futurasMonto += m.monto; futurasN++;
      } else {
        hoy.brian += m.impBrian; hoy.paula += m.impPaula; hoy.gaston += m.impGaston;
      }
    }
    return { hoy, total, futurasMonto, futurasN, invertidoHoy, invertidoTotal, ventas: ventasBrutasSocios(moves || []) };
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

  const filtered = useMemo(() => {
    // Con rango activo, los movimientos sin fecha exacta (solo período) quedan
    // afuera: no se puede saber si caen dentro.
    const enRango = (m: SocioMove) => {
      if (desdeFecha === '' && hastaFecha === '') return true;
      if (!m.fecha) return false;
      return (desdeFecha === '' || m.fecha >= desdeFecha) && (hastaFecha === '' || m.fecha <= hastaFecha);
    };
    const clave = (m: SocioMove) => m.fecha || m.periodo || '';
    return (moves || [])
      .filter(m =>
        (filterArea === 'todas' || m.area === filterArea) &&
        (filterTipo === 'todos' || m.tipo === filterTipo) &&
        enRango(m))
      .sort((a, b) => ordenFecha === 'desc'
        ? clave(b).localeCompare(clave(a))
        : clave(a).localeCompare(clave(b)));
  }, [moves, filterArea, filterTipo, desdeFecha, hastaFecha, ordenFecha]);

  const montoNum = parseFloat(form.monto.replace(',', '.'));
  const montoOk = !isNaN(montoNum) && montoNum > 0;
  const preview = useMemo(() => {
    if (!montoOk) return null;
    if (form.tipo === 'gasto') return impactosGasto(montoNum, form.pagador);
    if (form.tipo === 'venta') return impactosVenta(montoNum, form.cobrador);
    return impactosPago(montoNum, form.de, form.para);
  }, [form.tipo, form.pagador, form.de, form.para, form.cobrador, montoNum, montoOk]);

  // Cuotas (solo gastos): el monto es el TOTAL; se divide con armarCuotas.
  const cuotasNum = Math.floor(Number(form.cuotas) || 1);
  const cuotasOk = form.tipo !== 'gasto'
    || (cuotasNum >= 1 && cuotasNum <= 36 && (!montoOk || montoNum >= cuotasNum * 0.01));
  const cuotasPreview = useMemo(
    () => (form.tipo === 'gasto' && montoOk && cuotasOk && cuotasNum > 1
      ? armarCuotas(montoNum, cuotasNum, form.fecha || hoyISO())
      : null),
    [form.tipo, form.fecha, montoNum, montoOk, cuotasNum, cuotasOk],
  );

  const formValido = montoOk && cuotasOk &&
    (form.tipo === 'gasto' ? form.descripcion.trim().length > 0
      : form.tipo === 'pago' ? form.de !== form.para
      : true);

  const handleSave = async () => {
    if (!formValido || !preview || saving) return;
    setSaving(true);
    let inputs: SocioMoveInput[];
    if (form.tipo === 'gasto' && cuotasNum > 1) {
      // Compra en cuotas: una fila por mes, mismo pagador, reparto por cuota
      // (cada fila cierra en 0 sola) y un grupo compartido para borrarlas juntas.
      const grupo = 'cuo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      const desc = form.descripcion.trim();
      inputs = armarCuotas(montoNum, cuotasNum, form.fecha || hoyISO()).map((c, i) => {
        const imp = impactosGasto(c.monto, form.pagador);
        return {
          area: form.area,
          tipo: 'gasto' as const,
          descripcion: `${desc} (cuota ${i + 1}/${cuotasNum})`,
          monto: c.monto,
          fecha: c.fecha,
          pagador: form.pagador,
          de: null,
          para: null,
          impBrian: imp.brian,
          impPaula: imp.paula,
          impGaston: imp.gaston,
          cuotaGrupo: grupo,
        };
      });
    } else {
      inputs = [{
        area: form.tipo === 'pago' ? 'marca' : form.area,
        tipo: form.tipo,
        descripcion: form.descripcion.trim()
          || (form.tipo === 'pago' ? `Pago ${NOMBRES[form.de]} a ${NOMBRES[form.para]}`
            : form.tipo === 'venta' ? 'Venta' : ''),
        monto: montoNum,
        fecha: form.fecha || null,
        pagador: form.tipo === 'gasto' ? form.pagador : null,
        de: form.tipo === 'pago' ? form.de : null,
        para: form.tipo === 'pago' ? form.para : form.tipo === 'venta' ? form.cobrador : null,
        impBrian: preview.brian,
        impPaula: preview.paula,
        impGaston: preview.gaston,
      }];
    }
    const ok = await onAddMany(inputs);
    setSaving(false);
    if (!ok) { toast.error('No se pudo guardar el movimiento'); return; }
    toast.success(form.tipo === 'gasto'
      ? (cuotasNum > 1 ? `Gasto en ${cuotasNum} cuotas agregado a las cuentas` : 'Gasto agregado a las cuentas')
      : form.tipo === 'venta' ? 'Venta repartida entre los socios' : 'Pago registrado');
    setShowForm(false);
    setForm({ ...FORM_INICIAL, fecha: hoyISO() });
    onRefresh();
  };

  const handleDeleteGrupo = async (grupo: string) => {
    if (deleting) return;
    setDeleting(true);
    const ok = await onDeleteGrupo(grupo);
    setDeleting(false);
    setDeleteConfirm(null);
    if (!ok) { toast.error('No se pudieron borrar las cuotas'); return; }
    toast.success('Compra en cuotas borrada entera');
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
    <div>
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
          Ojo: las ventas de la Caja (bot) <b>no</b> entran solas acá — cuando repartan esa plata,
          cargala con <b>Nuevo movimiento → Venta</b>.
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

          {/* Números del negocio */}
          <h3 className="font-display text-sm font-bold text-gray-500 uppercase mb-2 mt-6">Números del negocio</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="text-xs font-display font-semibold text-gray-500 uppercase mb-1">Ventas totales</div>
              <p className="font-display text-2xl font-bold text-green-600">{money(cortes.ventas)}</p>
              <p className="text-xs text-gray-400 mt-0.5">reconstruidas de los repartos + ventas cargadas acá</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="text-xs font-display font-semibold text-gray-500 uppercase mb-1">Invertido en gastos</div>
              <p className="font-display text-2xl font-bold text-red-500">
                {money(modo === 'hoy' ? cortes.invertidoHoy : cortes.invertidoTotal)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {modo === 'hoy' ? 'solo cuotas vencidas' : 'incluye cuotas futuras'}
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="text-xs font-display font-semibold text-gray-500 uppercase mb-1">Balance ventas − gastos</div>
              {(() => {
                const bal = cortes.ventas - (modo === 'hoy' ? cortes.invertidoHoy : cortes.invertidoTotal);
                return (
                  <p className={`font-display text-2xl font-bold ${bal >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {bal < 0 ? '−' : ''}{money(Math.abs(bal))}
                  </p>
                );
              })()}
              <p className="text-xs text-gray-400 mt-0.5">no descuenta el stock sin vender</p>
            </div>
          </div>

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
            <div className="flex items-center gap-1.5 bg-white rounded-lg border border-gray-200 px-2.5 py-1.5">
              <input type="date" value={desdeFecha} onChange={e => setDesdeFecha(e.target.value)}
                aria-label="Desde fecha" title="Desde"
                className="text-xs text-gray-600 outline-none bg-transparent" />
              <span className="text-xs text-gray-300">→</span>
              <input type="date" value={hastaFecha} onChange={e => setHastaFecha(e.target.value)}
                aria-label="Hasta fecha" title="Hasta"
                className="text-xs text-gray-600 outline-none bg-transparent" />
              {(desdeFecha !== '' || hastaFecha !== '') && (
                <button onClick={() => { setDesdeFecha(''); setHastaFecha(''); }} aria-label="Limpiar fechas"
                  className="text-gray-400 hover:text-red-500 text-xs font-bold">✕</button>
              )}
            </div>
            <span className="text-xs text-gray-400">{filtered.length} movimiento{filtered.length === 1 ? '' : 's'}</span>
          </div>

          {/* Tabla */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">
                      <button onClick={() => setOrdenFecha(o => (o === 'desc' ? 'asc' : 'desc'))}
                        title={ordenFecha === 'desc' ? 'Más recientes primero — tocá para invertir' : 'Más viejos primero — tocá para invertir'}
                        className="inline-flex items-center gap-1 uppercase hover:text-navy-700">
                        Cuándo <span aria-hidden="true">{ordenFecha === 'desc' ? '↓' : '↑'}</span>
                      </button>
                    </th>
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
                          {m.tipo === 'venta' && m.para && (m.de
                            ? `Cobró ${NOMBRES[m.para]} · parte de ${NOMBRES[m.de]}`
                            : `Cobró ${NOMBRES[m.para]} · repartida 50/25/25`)}
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
                            {m.cuotaGrupo ? (
                              // Fila de una compra en cuotas: elegir entre esta sola o todas.
                              <>
                                <button onClick={() => handleDelete(m.id)} disabled={deleting}
                                  className="text-xs font-bold text-red-500 hover:text-red-700 disabled:text-gray-300 transition-colors whitespace-nowrap">
                                  esta
                                </button>
                                <button onClick={() => handleDeleteGrupo(m.cuotaGrupo!)} disabled={deleting}
                                  className="text-xs font-bold text-red-500 hover:text-red-700 disabled:text-gray-300 transition-colors whitespace-nowrap"
                                  title="Borrar todas las cuotas de esta compra">
                                  las {(moves || []).filter(x => x.cuotaGrupo === m.cuotaGrupo).length}
                                </button>
                              </>
                            ) : (
                              <button onClick={() => handleDelete(m.id)} disabled={deleting}
                                className="text-red-500 hover:text-red-700 disabled:text-gray-300 transition-colors" title="Confirmar">
                                <Check size={15} />
                              </button>
                            )}
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
              {([['gasto', 'Gasto'], ['venta', 'Venta'], ['pago', 'Pago']] as const).map(([t, lbl]) => (
                <button key={t} onClick={() => setForm(f => ({ ...f, tipo: t }))}
                  className={`flex-1 py-2 rounded-md text-sm font-display font-semibold transition-colors ${
                    form.tipo === t ? 'bg-white text-navy-700 shadow-sm' : 'text-gray-500'
                  }`}>
                  {lbl}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 -mt-2 mb-3">
              {form.tipo === 'gasto' && 'Gasto compartido: el que pagó queda a favor, los otros deben su parte.'}
              {form.tipo === 'venta' && 'Venta cobrada por un socio: les debe a los otros su parte del total.'}
              {form.tipo === 'pago' && 'Plata real que un socio le pasó a otro para saldar cuentas.'}
            </p>

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
              ) : form.tipo === 'venta' ? (
                <>
                  <div>
                    <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Área</label>
                    <select value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value as SocioMove['area'] }))} className={selectCls}>
                      <option value="marca">Marca</option>
                      <option value="cafeteria">Cafetería</option>
                      <option value="showroom">Showroom</option>
                      <option value="otros">Otros</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Descripción</label>
                    <input type="text" value={form.descripcion} placeholder="Ej: ventas del bot — julio"
                      onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} className={selectCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Cobró</label>
                    <select value={form.cobrador} onChange={e => setForm(f => ({ ...f, cobrador: e.target.value as SocioName }))} className={selectCls}>
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

              <div className={form.tipo === 'gasto' ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-2 gap-3'}>
                <div>
                  <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">
                    {form.tipo === 'venta' ? 'Total vendido ($)' : form.tipo === 'gasto' ? 'Total ($)' : 'Monto ($)'}
                  </label>
                  <input type="number" min="0" step="0.01" value={form.monto} placeholder="0"
                    onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} className={selectCls} />
                </div>
                <div>
                  <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Fecha</label>
                  <input type="date" value={form.fecha}
                    onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} className={selectCls} />
                </div>
                {form.tipo === 'gasto' && (
                  <div>
                    <label className="block text-xs font-display font-semibold text-gray-500 uppercase mb-1">Cuotas</label>
                    <input type="number" min={1} max={36} step={1} value={form.cuotas}
                      onChange={e => setForm(f => ({ ...f, cuotas: e.target.value }))} className={selectCls} />
                  </div>
                )}
              </div>

              {!cuotasOk && montoOk && (
                <p className="text-xs text-red-500">Cuotas: entero entre 1 y 36 (y que cada cuota no quede en cero).</p>
              )}
              {cuotasPreview && (
                <p className="text-xs text-gray-500">
                  {cuotasNum} cuotas de <b>{money2(cuotasPreview[0].monto)}</b>
                  {cuotasPreview[cuotasNum - 1].monto !== cuotasPreview[0].monto &&
                    ` (última ${money2(cuotasPreview[cuotasNum - 1].monto)})`}
                  {' — '}{mesCorto(cuotasPreview[0].fecha)} a {mesCorto(cuotasPreview[cuotasNum - 1].fecha)}.
                  La primera vence el mes de la fecha elegida; en «Al día de hoy» solo cuentan las vencidas.
                </p>
              )}

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
