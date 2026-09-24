import { useMemo, useState } from 'react';
import { Plus, Trash2, Info, ArrowDown, ArrowUp, X, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { SocioMove, SocioMoveInput, SocioName } from '../types';
import { armarCuotas, esCuotaFutura, ventasBrutasSocios, impactosGasto, impactosPago, impactosVenta } from '../utils/socios';
import { cn } from '../lib/cn';
import {
  Boton, BotonIcono, Campo, Entrada, Selector, EntradaPlata, Dialogo, Confirmar, Tarjeta, Insignia,
  Segmentado, Chip, Vacio, CargandoFilas, ErrorEstado, formatoPlata, type TonoInsignia,
} from '../admin/ui';
import { Kpi } from '../admin/ui-ventas/Kpi';
import { plural } from '../admin/ui-ventas/ventas';

const NOMBRES: Record<SocioName, string> = { brian: 'Brian', paula: 'Paula', gaston: 'Gastón' };
const SOCIOS: SocioName[] = ['brian', 'paula', 'gaston'];
const OPCIONES_SOCIOS = SOCIOS.map(s => ({ valor: s, texto: NOMBRES[s] }));
const AREA_LBL: Record<SocioMove['area'], string> = {
  marca: 'Marca', showroom: 'Showroom', cafeteria: 'Cafetería',
  crp: 'Estadía CRP', argentinos: 'Bs.As. (ARS)', otros: 'Otros',
};
const TIPO_LBL: Record<SocioMove['tipo'], string> = {
  gasto: 'Gasto', pago: 'Pago', venta: 'Venta', ajuste: 'Ajuste',
};
// Un solo mapa tipo → tono (clases literales en el kit).
const TONO_TIPO: Record<SocioMove['tipo'], TonoInsignia> = {
  gasto: 'alerta',
  pago: 'info',
  venta: 'bien',
  ajuste: 'neutro',
};

/** Plata sin centavos (los saldos se leen redondos). */
const money = (n: number) => formatoPlata(Math.round(n));
/** Con centavos, para los impactos por socio y las cuotas. */
const money2 = (n: number) => formatoPlata(n, { decimales: true });

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

/** Quién pagó / cobró / le pasó plata a quién, en una línea. */
const detalleQuien = (m: SocioMove): string => {
  let txt = '';
  if (m.tipo === 'gasto') txt = m.pagador ? `Pagó ${NOMBRES[m.pagador]}` : 'Pagaron varios';
  if (m.tipo === 'pago' && m.de && m.para) txt = `${NOMBRES[m.de]} → ${NOMBRES[m.para]}`;
  if (m.tipo === 'venta' && m.para) {
    txt = m.de
      ? `Cobró ${NOMBRES[m.para]} · parte de ${NOMBRES[m.de]}`
      : `Cobró ${NOMBRES[m.para]} · repartida 50/25/25`;
  }
  return m.moneda === 'ARS' ? `${txt}${txt ? ' · ' : ''}ARS` : txt;
};

/** Impacto en el saldo de un socio: + debe más, − queda a favor. */
const textoImpacto = (v: number) =>
  Math.abs(v) < 0.005 ? '—' : v > 0 ? `+${money2(v)}` : money2(v);
const claseImpacto = (v: number) =>
  v > 0.004 ? 'text-red-700' : v < -0.004 ? 'text-emerald-700' : 'text-gray-300';

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
  // En una cuota: cuál de los dos botones se tocó (para el spinner).
  const [alcanceBorrado, setAlcanceBorrado] = useState<'una' | 'todas' | null>(null);
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
    let ok = false;
    try {
      ok = await onAddMany(inputs);
    } finally {
      setSaving(false);
    }
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
    setAlcanceBorrado('todas');
    const ok = await onDeleteGrupo(grupo);
    setDeleting(false);
    setAlcanceBorrado(null);
    setDeleteConfirm(null);
    if (!ok) { toast.error('No se pudieron borrar las cuotas'); return; }
    toast.success('Compra en cuotas borrada entera');
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    if (deleting) return;
    setDeleting(true);
    setAlcanceBorrado('una');
    const ok = await onDelete(id);
    setDeleting(false);
    setAlcanceBorrado(null);
    setDeleteConfirm(null);
    if (!ok) { toast.error('No se pudo borrar el movimiento'); return; }
    toast.success('Movimiento borrado');
    onRefresh();
  };

  const aBorrar = deleteConfirm ? (moves || []).find(m => m.id === deleteConfirm) ?? null : null;
  const cuotasDelGrupo = aBorrar?.cuotaGrupo ? (moves || []).filter(x => x.cuotaGrupo === aBorrar.cuotaGrupo) : [];
  const hayRango = desdeFecha !== '' || hastaFecha !== '';
  const setCampo = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));

  const botonBorrar = (m: SocioMove) => (
    <BotonIcono
      etiqueta={`Borrar ${TIPO_LBL[m.tipo].toLowerCase()} de ${money(m.monto)}: ${m.descripcion}`}
      icono={<Trash2 size={17} />}
      tono="peligro"
      onClick={() => setDeleteConfirm(m.id)}
      disabled={deleting}
    />
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-navy-700">
          <Users size={19} /> Cuentas entre socios
        </h2>
        <Boton variante="secundario" icono={<Plus size={17} />} onClick={() => { setForm({ ...FORM_INICIAL, fecha: hoyISO() }); setShowForm(true); }}>
          Nuevo movimiento
        </Boton>
      </div>

      {/* Cómo leer los números: plegado, que en el celular era una pared de texto */}
      <details className="group mb-4 rounded-xl border border-gray-200 bg-white">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-navy-700 [&::-webkit-details-marker]:hidden">
          <Info size={16} className="shrink-0 text-gray-400" /> Cómo se leen los saldos
          <span aria-hidden className="ml-auto text-gray-400 transition-transform group-open:rotate-45"><Plus size={16} /></span>
        </summary>
        <p className="border-t border-gray-100 px-4 py-3 text-[13px] leading-relaxed text-gray-600">
          Historial importado del Excel de gastos + lo que carguen acá. Reparto estándar:
          {' '}<b>Brian 50% · Paula 25% · Gastón 25%</b>. Saldo positivo = le debe al grupo;
          negativo = el grupo le debe. <b>Al día de hoy</b> cuenta solo las cuotas ya vencidas;
          {' '}<b>Total comprometido</b> incluye también las cuotas que faltan vencer.
          Ojo: las ventas de la Caja (bot) <b>no</b> entran solas acá: se pasan con <b>Liquidar caja</b>,
          o a mano con <b>Nuevo movimiento → Venta</b>.
        </p>
      </details>

      {moves === null && loading && <CargandoFilas filas={3} />}

      {moves === null && !loading && (
        <ErrorEstado mensaje="No se pudieron cargar las cuentas de socios. Verificá tu sesión de admin." alReintentar={onRefresh} />
      )}

      {moves !== null && (
        <>
          {/* Modo de saldo: solo vencido vs todo lo comprometido */}
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Segmentado
              etiqueta="Qué saldos mostrar"
              opciones={[{ valor: 'hoy', texto: 'Al día de hoy' }, { valor: 'total', texto: 'Total comprometido' }]}
              valor={modo}
              alCambiar={setModo}
            />
            {modo === 'hoy' && cortes.futurasN > 0 && (
              <span className="text-[13px] text-gray-500">
                Sin contar {money(cortes.futurasMonto)} en {plural(cortes.futurasN, 'cuota', 'cuotas')} que todavía no vencieron.
              </span>
            )}
          </div>

          {/* Saldos */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {SOCIOS.map(s => {
              const v = saldos[s];
              const debe = v > 0.5;
              const favor = v < -0.5;
              return (
                <Kpi
                  key={s}
                  etiqueta={NOMBRES[s]}
                  valor={money(Math.abs(v))}
                  tono={debe ? 'alerta' : favor ? 'bien' : 'neutro'}
                  detalle={(
                    <>
                      <span className="font-semibold">{debe ? 'le debe al grupo' : favor ? 'el grupo le debe' : 'al día'}</span>
                      <span className="text-gray-400"> · {modo === 'hoy' ? 'comprometido' : 'al día'}: {miniSaldo(saldosOtro[s])}</span>
                    </>
                  )}
                />
              );
            })}
          </div>

          {arsSaldos && (
            <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
              <Insignia tono="atencion">ARS</Insignia>
              <b>Aparte, en pesos argentinos (viaje Bs.As.):</b>
              {SOCIOS.map((s, i) => {
                const v = arsSaldos[s];
                return (
                  <span key={s} className="tabular-nums">
                    {i > 0 && '· '}
                    {NOMBRES[s]} {v > 0.5 ? `debe ${money2(v)}` : v < -0.5 ? `a favor ${money2(-v)}` : 'al día'}
                  </span>
                );
              })}
            </div>
          )}

          {/* Números del negocio */}
          <h3 className="mb-2 mt-6 font-display text-sm font-bold uppercase tracking-wide text-navy-700">Números del negocio</h3>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi etiqueta="Ventas" valor={money(cortes.ventas)} tono="bien" detalle="repartos + ventas de acá" />
            <Kpi
              etiqueta="En gastos"
              valor={money(modo === 'hoy' ? cortes.invertidoHoy : cortes.invertidoTotal)}
              tono="alerta"
              detalle={modo === 'hoy' ? 'solo cuotas vencidas' : 'con cuotas futuras'}
            />
            {(() => {
              const bal = cortes.ventas - (modo === 'hoy' ? cortes.invertidoHoy : cortes.invertidoTotal);
              return (
                <Kpi
                  etiqueta="Ventas − gastos"
                  valor={money(bal)}
                  tono={bal >= 0 ? 'bien' : 'alerta'}
                  detalle="no descuenta el stock sin vender"
                  className="col-span-2 sm:col-span-1"
                />
              );
            })()}
          </div>

          {/* Filtros: una fila de chips que se desliza + rango de fechas */}
          <div className="mb-4 space-y-3">
            <div className="sin-barra -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
              <Chip activo={filterArea === 'todas'} onClick={() => setFilterArea('todas')}>Todas las áreas</Chip>
              {areas.map(a => (
                <Chip key={a} activo={filterArea === a} onClick={() => setFilterArea(a)}>{AREA_LBL[a]}</Chip>
              ))}
              <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-gray-200" />
              {(['todos', 'gasto', 'venta', 'pago'] as const).map(t => (
                <Chip key={t} activo={filterTipo === t} onClick={() => setFilterTipo(t)}>
                  {t === 'todos' ? 'Todos los tipos' : TIPO_LBL[t] + 's'}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Campo etiqueta="Desde" className="w-[calc(50%-0.25rem)] sm:w-44">
                <Entrada type="date" value={desdeFecha} onChange={e => setDesdeFecha(e.target.value)} />
              </Campo>
              <Campo etiqueta="Hasta" className="w-[calc(50%-0.25rem)] sm:w-44">
                <Entrada type="date" value={hastaFecha} onChange={e => setHastaFecha(e.target.value)} />
              </Campo>
              {hayRango && (
                <Boton variante="fantasma" icono={<X size={15} />} onClick={() => { setDesdeFecha(''); setHastaFecha(''); }}>
                  Limpiar fechas
                </Boton>
              )}
            </div>
          </div>

          {/* Movimientos: lista en el celular, tabla en la compu */}
          {filtered.length === 0 ? (
            <Vacio
              titulo="Sin movimientos con estos filtros"
              descripcion="Probá con otra área, otro tipo o sin rango de fechas."
              accion={(
                <Boton variante="secundario" onClick={() => { setFilterArea('todas'); setFilterTipo('todos'); setDesdeFecha(''); setHastaFecha(''); }}>
                  Ver todos
                </Boton>
              )}
            />
          ) : (
            <Tarjeta
              sinPadding
              titulo={`Movimientos · ${filtered.length}`}
              acciones={(
                <Boton
                  variante="fantasma"
                  chico
                  icono={ordenFecha === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
                  onClick={() => setOrdenFecha(o => (o === 'desc' ? 'asc' : 'desc'))}
                  className="-mr-2"
                >
                  {ordenFecha === 'desc' ? 'Más nuevos' : 'Más viejos'}
                </Boton>
              )}
            >
              {/* Celular */}
              <ul className="divide-y divide-gray-100 md:hidden">
                {filtered.map(m => (
                  <li key={m.id} className="flex items-start gap-2 py-3 pl-4 pr-1">
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 break-words font-display text-sm font-bold text-navy-700">{m.descripcion}</p>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-navy-700">{money(m.monto)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                        <Insignia tono={TONO_TIPO[m.tipo]}>{TIPO_LBL[m.tipo]}</Insignia>
                        {esCuotaFutura(m) && <Insignia tono="atencion">cuota futura</Insignia>}
                        <span>{m.fecha ? fmtFecha(m.fecha) : m.periodo || '—'}</span>
                        <span>· {AREA_LBL[m.area]}</span>
                        {detalleQuien(m) && <span>· {detalleQuien(m)}</span>}
                      </div>
                    </div>
                    {botonBorrar(m)}
                  </li>
                ))}
              </ul>

              {/* Compu */}
              <div className="hidden max-h-[36rem] overflow-auto md:block">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-[1] border-b border-gray-200 bg-gray-50">
                    <tr className="text-left font-display text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">
                      <th className="px-4 py-2.5">Cuándo</th>
                      <th className="px-4 py-2.5">Área</th>
                      <th className="px-4 py-2.5">Tipo</th>
                      <th className="px-4 py-2.5">Detalle</th>
                      <th className="px-4 py-2.5 text-right">Monto</th>
                      <th className="hidden px-4 py-2.5 text-right lg:table-cell">Brian</th>
                      <th className="hidden px-4 py-2.5 text-right lg:table-cell">Paula</th>
                      <th className="hidden px-4 py-2.5 text-right lg:table-cell">Gastón</th>
                      <th className="w-12 px-2 py-2.5"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(m => (
                      <tr key={m.id} className="transition-colors hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">
                          {m.fecha ? fmtFecha(m.fecha) : <span className="text-xs">{m.periodo || '—'}</span>}
                          {esCuotaFutura(m) && (
                            <span className="block text-[11px] font-semibold text-amber-700">cuota futura</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{AREA_LBL[m.area]}</td>
                        <td className="px-4 py-2.5"><Insignia tono={TONO_TIPO[m.tipo]}>{TIPO_LBL[m.tipo]}</Insignia></td>
                        <td className="px-4 py-2.5">
                          <p className="font-display font-semibold text-navy-700">{m.descripcion}</p>
                          <p className="text-xs text-gray-500">{detalleQuien(m)}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-bold tabular-nums text-navy-700">{money(m.monto)}</td>
                        {([m.impBrian, m.impPaula, m.impGaston] as const).map((v, i) => (
                          <td key={i} className={cn('hidden whitespace-nowrap px-4 py-2.5 text-right text-xs tabular-nums lg:table-cell', claseImpacto(v))}>
                            {textoImpacto(v)}
                          </td>
                        ))}
                        <td className="px-2 py-1">{botonBorrar(m)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Tarjeta>
          )}
        </>
      )}

      {/* Borrar: una confirmación que dice qué y cuánto. Si es cuota, elegir alcance. */}
      {aBorrar && !aBorrar.cuotaGrupo && (
        <Confirmar
          abierto
          titulo={`Borrar ${TIPO_LBL[aBorrar.tipo].toLowerCase()} de ${money(aBorrar.monto)}`}
          mensaje={(
            <>
              <p className="font-semibold text-navy-700">{aBorrar.descripcion}</p>
              <p className="mt-1">
                {aBorrar.fecha ? fmtFecha(aBorrar.fecha) : aBorrar.periodo || 'sin fecha'} · {AREA_LBL[aBorrar.area]}.
                Se borra de las cuentas y los saldos se recalculan.
              </p>
            </>
          )}
          textoConfirmar="Borrar movimiento"
          cargando={deleting}
          alConfirmar={() => void handleDelete(aBorrar.id)}
          alCerrar={() => !deleting && setDeleteConfirm(null)}
        />
      )}
      {aBorrar && aBorrar.cuotaGrupo && (
        <Dialogo
          abierto
          titulo={`Borrar cuota de ${money2(aBorrar.monto)}`}
          alCerrar={() => setDeleteConfirm(null)}
          ocupado={deleting}
          ancho="sm"
          pie={(
            <>
              <Boton variante="secundario" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Cancelar</Boton>
              <Boton
                variante="secundario"
                onClick={() => void handleDelete(aBorrar.id)}
                disabled={deleting && alcanceBorrado !== 'una'}
                cargando={alcanceBorrado === 'una'}
                className="border-red-300 text-red-700 hover:border-red-600"
              >
                Solo esta cuota
              </Boton>
              <Boton
                variante="peligro"
                onClick={() => void handleDeleteGrupo(aBorrar.cuotaGrupo!)}
                disabled={deleting && alcanceBorrado !== 'todas'}
                cargando={alcanceBorrado === 'todas'}
              >
                Las {cuotasDelGrupo.length} cuotas
              </Boton>
            </>
          )}
        >
          <div className="text-sm leading-relaxed text-gray-600">
            <p className="font-semibold text-navy-700">{aBorrar.descripcion}</p>
            <p className="mt-1">
              Es parte de una compra en {cuotasDelGrupo.length} cuotas
              ({money2(cuotasDelGrupo.reduce((s, c) => s + c.monto, 0))} en total).
              ¿Borrás solo esta cuota o la compra entera?
            </p>
          </div>
        </Dialogo>
      )}

      {/* Modal de alta */}
      {showForm && (
        <Dialogo
          abierto
          titulo="Nuevo movimiento de socios"
          alCerrar={() => setShowForm(false)}
          ocupado={saving}
          sucio={form.monto.trim() !== '' || form.descripcion.trim() !== ''}
          pie={(
            <>
              <Boton variante="secundario" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</Boton>
              <Boton onClick={handleSave} disabled={!formValido} cargando={saving}>Guardar movimiento</Boton>
            </>
          )}
        >
          <div className="space-y-4">
            <div>
              <Segmentado
                etiqueta="Tipo de movimiento"
                opciones={[{ valor: 'gasto', texto: 'Gasto' }, { valor: 'venta', texto: 'Venta' }, { valor: 'pago', texto: 'Pago' }]}
                valor={form.tipo}
                alCambiar={t => setCampo('tipo', t)}
                anchoCompleto
              />
              <p className="mt-2 text-[13px] text-gray-500">
                {form.tipo === 'gasto' && 'Gasto compartido: el que pagó queda a favor, los otros deben su parte.'}
                {form.tipo === 'venta' && 'Venta cobrada por un socio: les debe a los otros su parte del total.'}
                {form.tipo === 'pago' && 'Plata real que un socio le pasó a otro para saldar cuentas.'}
              </p>
            </div>

            {form.tipo === 'gasto' ? (
              <>
                <Campo etiqueta="Área">
                  <Selector value={form.area} onChange={e => setCampo('area', e.target.value as SocioMove['area'])}>
                    <option value="marca">Marca</option>
                    <option value="showroom">Showroom</option>
                    <option value="cafeteria">Cafetería</option>
                    <option value="otros">Otros</option>
                  </Selector>
                </Campo>
                <Campo etiqueta="Descripción" requerido>
                  <Entrada type="text" value={form.descripcion} placeholder="Ej: Pedido Disershop"
                    onChange={e => setCampo('descripcion', e.target.value)} />
                </Campo>
                <div>
                  <span className="mb-1.5 block text-[13px] font-semibold text-navy-700">Pagó</span>
                  <Segmentado etiqueta="Quién pagó" opciones={OPCIONES_SOCIOS} valor={form.pagador} alCambiar={s => setCampo('pagador', s)} anchoCompleto />
                </div>
              </>
            ) : form.tipo === 'venta' ? (
              <>
                <Campo etiqueta="Área">
                  <Selector value={form.area} onChange={e => setCampo('area', e.target.value as SocioMove['area'])}>
                    <option value="marca">Marca</option>
                    <option value="cafeteria">Cafetería</option>
                    <option value="showroom">Showroom</option>
                    <option value="otros">Otros</option>
                  </Selector>
                </Campo>
                <Campo etiqueta="Descripción">
                  <Entrada type="text" value={form.descripcion} placeholder="Ej: ventas del bot — julio"
                    onChange={e => setCampo('descripcion', e.target.value)} />
                </Campo>
                <div>
                  <span className="mb-1.5 block text-[13px] font-semibold text-navy-700">Cobró</span>
                  <Segmentado etiqueta="Quién cobró" opciones={OPCIONES_SOCIOS} valor={form.cobrador} alCambiar={s => setCampo('cobrador', s)} anchoCompleto />
                </div>
              </>
            ) : (
              <>
                <div>
                  <span className="mb-1.5 block text-[13px] font-semibold text-navy-700">Paga</span>
                  <Segmentado etiqueta="Quién paga" opciones={OPCIONES_SOCIOS} valor={form.de} alCambiar={s => setCampo('de', s)} anchoCompleto />
                </div>
                <div>
                  <span className="mb-1.5 block text-[13px] font-semibold text-navy-700">Recibe</span>
                  <Segmentado etiqueta="Quién recibe" opciones={OPCIONES_SOCIOS} valor={form.para} alCambiar={s => setCampo('para', s)} anchoCompleto />
                  {form.de === form.para && (
                    <p className="mt-1.5 text-[13px] font-medium text-red-700">Tienen que ser dos socios distintos.</p>
                  )}
                </div>
                <Campo etiqueta="Nota (opcional)">
                  <Entrada type="text" value={form.descripcion} placeholder="Ej: transferencia BROU"
                    onChange={e => setCampo('descripcion', e.target.value)} />
                </Campo>
              </>
            )}

            <div className={form.tipo === 'gasto' ? 'grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_6rem]' : 'grid grid-cols-2 gap-3'}>
              <Campo
                etiqueta={form.tipo === 'venta' ? 'Total vendido' : form.tipo === 'gasto' ? 'Total' : 'Monto'}
                requerido
                className={form.tipo === 'gasto' ? 'col-span-2 sm:col-span-1' : undefined}
              >
                <EntradaPlata
                  valor={Number.isFinite(montoNum) ? montoNum : null}
                  alCambiar={n => setCampo('monto', n === null ? '' : String(n))}
                  placeholder="0"
                />
              </Campo>
              <Campo etiqueta="Fecha">
                <Entrada type="date" value={form.fecha} onChange={e => setCampo('fecha', e.target.value)} />
              </Campo>
              {form.tipo === 'gasto' && (
                <Campo etiqueta="Cuotas">
                  <Entrada type="number" inputMode="numeric" min={1} max={36} step={1} value={form.cuotas}
                    onChange={e => setCampo('cuotas', e.target.value)} className="tabular-nums" />
                </Campo>
              )}
            </div>

            {!cuotasOk && montoOk && (
              <p className="text-[13px] font-medium text-red-700">Cuotas: entero entre 1 y 36 (y que cada cuota no quede en cero).</p>
            )}
            {cuotasPreview && (
              <p className="text-[13px] text-gray-600">
                {cuotasNum} cuotas de <b className="tabular-nums">{money2(cuotasPreview[0].monto)}</b>
                {cuotasPreview[cuotasNum - 1].monto !== cuotasPreview[0].monto &&
                  ` (última ${money2(cuotasPreview[cuotasNum - 1].monto)})`}
                {' — '}{mesCorto(cuotasPreview[0].fecha)} a {mesCorto(cuotasPreview[cuotasNum - 1].fecha)}.
                La primera vence el mes de la fecha elegida; en «Al día de hoy» solo cuentan las vencidas.
              </p>
            )}

            {preview && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                <p className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">Cómo impacta en los saldos</p>
                {SOCIOS.map(s => {
                  const v = preview[s];
                  return (
                    <p key={s} className="flex justify-between py-0.5">
                      <span className="text-gray-600">{NOMBRES[s]}</span>
                      <span className={cn('font-semibold tabular-nums', v > 0.004 ? 'text-red-700' : v < -0.004 ? 'text-emerald-700' : 'text-gray-400')}>
                        {Math.abs(v) < 0.005 ? '—' : (v > 0 ? `debe ${money2(v)} más` : `${money2(-v)} a favor`)}
                      </span>
                    </p>
                  );
                })}
              </div>
            )}
          </div>
        </Dialogo>
      )}
    </div>
  );
}
