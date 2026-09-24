import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wallet, RefreshCw, TrendingUp, TrendingDown, Scale, Undo2, FileDown, Plus, Minus, Search, Shirt, Trash2, CalendarClock, AlertTriangle, Pencil, Check, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerEntry, Product, SocioMove, SocioName, VentaCajaInput, GastoPendiente, GastoPendienteInput } from '../types';
import { NOMBRES_SOCIOS, SOCIOS } from '../utils/socios';
import { exportCajaExcel } from '../utils/cajaExcel';
import { fechaHumana } from '../utils/fechas';
import { formatVariant, resumenCarrito, stockTotal, variantesConStock, VENTAS_RAPIDAS } from '../utils/caja';
import type { ItemCarrito, VentaRapida } from '../utils/caja';
import { normalizar, sugerirDeudores } from '../utils/nombres';
import { SupabaseService } from '../services/supabaseService';
import type { JugadorPadron } from '../utils/dupr';
import { cn } from '../lib/cn';
import {
  Boton, BotonIcono, Campo, Entrada, EntradaPlata, Dialogo, Confirmar, EncabezadoPagina, Tarjeta, Plata,
  Insignia, Segmentado, BarraFiltros, Chip, Vacio, CargandoFilas, ErrorEstado, formatoPlata, type TonoInsignia,
} from '../admin/ui';
import { Kpi } from '../admin/ui-ventas/Kpi';
import { plural, resultadoIncierto } from '../admin/ui-ventas/ventas';

const TZ = 'America/Montevideo';

/** "5/8" — para el "desde" de los deudores, sin hora. */
const formatFechaCorta = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-UY', { timeZone: TZ, day: 'numeric', month: 'numeric' });
};

/** Día calendario (YYYY-MM-DD) de un instante, visto desde Montevideo. */
const dayInMontevideo = (date: Date) =>
  date.toLocaleDateString('en-CA', { timeZone: TZ });

/**
 * "5/9" a partir de un YYYY-MM-DD. Se parte el string a mano en vez de usar
 * new Date(ymd): eso lo lee como UTC y en Montevideo (UTC-3) muestra el día
 * anterior — un vencimiento del 1 aparecería como 31.
 */
const formatDia = (ymd: string) => {
  const [, m, d] = ymd.split('-');
  return `${Number(d)}/${Number(m)}`;
};

type EstadoVenc = 'vencido' | 'hoy' | 'proximo' | 'sinFecha';

/** Compara strings YYYY-MM-DD, que ordenan igual que las fechas. */
const estadoVencimiento = (venceEl: string | null, hoy: string): EstadoVenc => {
  if (!venceEl) return 'sinFecha';
  if (venceEl < hoy) return 'vencido';
  if (venceEl === hoy) return 'hoy';
  return 'proximo';
};

const TEXTO_VENC: Record<EstadoVenc, (v: string) => string> = {
  vencido: v => `Venció el ${formatDia(v)}`,
  hoy: () => 'Vence hoy',
  proximo: v => `Vence el ${formatDia(v)}`,
  sinFecha: () => 'Sin fecha',
};

// Un solo mapa estado → tono por dominio (clases literales, ver tailwindClases.test).
const TONO_VENC: Record<EstadoVenc, TonoInsignia> = {
  vencido: 'alerta',
  hoy: 'atencion',
  proximo: 'neutro',
  sinFecha: 'neutro',
};

const ICONO_VENC: Record<EstadoVenc, string> = {
  vencido: 'bg-red-50 text-red-600',
  hoy: 'bg-amber-50 text-amber-700',
  proximo: 'bg-gray-100 text-gray-500',
  sinFecha: 'bg-gray-100 text-gray-500',
};

type PeriodFilter = 'hoy' | '7d' | '30d' | 'todo';
type KindFilter = 'todos' | 'venta' | 'gasto';

const PERIODS: { valor: PeriodFilter; texto: string }[] = [
  { valor: 'hoy', texto: 'Hoy' },
  { valor: '7d', texto: '7 días' },
  { valor: '30d', texto: '30 días' },
  { valor: 'todo', texto: 'Todo' },
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

const TONO_METODO: Record<'mp' | 'efectivo' | 'transferencia' | 'debe', TonoInsignia> = {
  mp: 'info',
  efectivo: 'bien',
  transferencia: 'navy',
  debe: 'atencion',
};

// Método de pago del modal de venta. SIN valor por defecto a propósito: con un
// default, el apuro del mostrador registraba todo como efectivo.
const METODOS_VENTA: { valor: VentaCajaInput['payment']; texto: string }[] = [
  { valor: 'mp', texto: 'MP' },
  { valor: 'efectivo', texto: 'Efectivo' },
  { valor: 'transferencia', texto: 'Transferencia' },
  { valor: 'debe', texto: 'Debe' },
];

const METODOS_COBRO: { valor: 'mp' | 'efectivo' | 'transferencia'; texto: string }[] = [
  { valor: 'mp', texto: 'MP' },
  { valor: 'efectivo', texto: 'Efectivo' },
  { valor: 'transferencia', texto: 'Transferencia' },
];

const OPCIONES_SOCIOS = SOCIOS.map(s => ({ valor: s, texto: NOMBRES_SOCIOS[s] }));

/** Rótulo chico de sección (mismo que el de las tarjetas del kit). */
const claseRotulo = 'mb-1.5 block text-[13px] font-semibold text-navy-700';

export function AdminCajaTab({ loadLedger, loadLedgerFull, revertEntry, loadSocioMoves, products, registrarVenta, registrarGasto, socioSugerido, cobrarDeudor, loadGastosPendientes, saveGastoPendiente, pagarGastoPendiente, deleteGastoPendiente }: {
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
  /** Gastos que hay que pagar y todavía no salieron de la caja. */
  loadGastosPendientes: () => Promise<GastoPendiente[] | null>;
  saveGastoPendiente: (g: GastoPendienteInput) => Promise<{ ok: boolean; error?: string }>;
  pagarGastoPendiente: (id: string, paidBy: SocioName) => Promise<{ ok: boolean; error?: string }>;
  deleteGastoPendiente: (id: string) => Promise<boolean>;
}) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Hasta que no resuelve el primer load no se muestra nada de datos (antes
  // aparecía "Sin movimientos" mientras cargaba, mentira conocida).
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // Arranca en "Hoy": la Caja se abre en el torneo o en el mostrador para ver la
  // jornada; la semana queda a un toque.
  const [period, setPeriod] = useState<PeriodFilter>('hoy');
  const [kind, setKind] = useState<KindFilter>('todos');
  // Buscador de movimientos (pedido de Brian): matchea etiqueta, deudor, quién
  // lo registró y la variante, sin tildes. No toca los totales de arriba.
  const [buscarMov, setBuscarMov] = useState('');
  const [aAnular, setAAnular] = useState<LedgerEntry | null>(null);
  const [aCobrar, setACobrar] = useState<{ nombre: string; total: number } | null>(null);
  const [aBorrarDeuda, setABorrarDeuda] = useState<{ nombre: string; total: number; movs: LedgerEntry[] } | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [ventaAbierta, setVentaAbierta] = useState(false);
  const [gastoAbierto, setGastoAbierto] = useState(false);
  // Gastos pendientes. 'nuevo' abre el modal en blanco; un objeto, en edición.
  const [pendientes, setPendientes] = useState<GastoPendiente[]>([]);
  const [pendienteEdit, setPendienteEdit] = useState<GastoPendiente | 'nuevo' | null>(null);
  const [pendienteAPagar, setPendienteAPagar] = useState<GastoPendiente | null>(null);
  const [aBorrarPendiente, setABorrarPendiente] = useState<GastoPendiente | null>(null);
  const [borrandoPendiente, setBorrandoPendiente] = useState(false);

  // Padrón de jugadores: sugiere el comprador sin duplicar nombres ("Hernán" ≠
  // "Hernan") y permite VINCULAR la venta al jugador (id), que es lo que
  // alimenta su ficha. Se carga al abrir el modal y queda cacheado.
  const [padron, setPadron] = useState<JugadorPadron[] | null>(null);
  useEffect(() => {
    if (!ventaAbierta || padron !== null) return;
    let vivo = true;
    void SupabaseService.getJugadoresPadron().then(p => { if (vivo) setPadron(p); });
    return () => { vivo = false; };
  }, [ventaAbierta, padron]);

  // Secuencia de fetches: si una respuesta vieja llega después de una nueva
  // (ej: refresh disparado justo antes de confirmar una anulación), se ignora.
  const fetchSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    // Los pendientes viajan con la caja: casi todo lo que los cambia (pagar un
    // gasto) toca las dos cosas, y separar los fetches deja la pantalla incoherente.
    const [data, pend] = await Promise.all([loadLedger(), loadGastosPendientes()]);
    if (seq !== fetchSeq.current) return; // llegó tarde: ya hay un fetch más nuevo
    // null = falló la lectura: se deja la lista anterior en vez de vaciarla, que
    // sería decir "no hay nada que pagar" sin saberlo.
    if (pend !== null) setPendientes(pend);
    if (data === null) {
      setLoadFailed(true);
      toast.error('No se pudo cargar la caja. Verificá tu sesión de admin.');
    } else {
      setLoadFailed(false);
      setEntries(data);
    }
    setLoading(false);
    setCargandoInicial(false);
  }, [loadLedger, loadGastosPendientes]);

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
    const q = normalizar(buscarMov.trim());
    return entries.filter(e => {
      if (kind !== 'todos' && e.kind !== kind) return false;
      if (q !== '') {
        const texto = `${e.label} ${e.debtorName ?? ''} ${e.reportedBy ?? ''} ${e.variantKey ? formatVariant(e.variantKey) : ''}`;
        if (!normalizar(texto).includes(q)) return false;
      }
      if (period === 'todo') return true;
      const created = new Date(e.createdAt);
      if (isNaN(created.getTime())) return true;
      if (period === 'hoy') return dayInMontevideo(created) === todayMvd;
      const days = period === '7d' ? 7 : 30;
      return now.getTime() - created.getTime() <= days * 24 * 60 * 60 * 1000;
    });
  }, [entries, period, kind, buscarMov]);

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

  // Lo que falta pagar. Ordenado por vencimiento (los sin fecha al final) para
  // que lo urgente quede arriba sin tener que leer todo.
  const porPagar = useMemo(() => {
    const hoy = dayInMontevideo(new Date());
    const abiertos = pendientes.filter(g => g.pagadoAt === null);
    let total = 0, vencidos = 0;
    for (const g of abiertos) {
      total += g.amount;
      if (g.venceEl && g.venceEl < hoy) vencidos++;
    }
    abiertos.sort((a, b) => {
      if (a.venceEl && b.venceEl) return a.venceEl.localeCompare(b.venceEl);
      if (a.venceEl) return -1;
      if (b.venceEl) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
    return { abiertos, total, vencidos, hoy };
  }, [pendientes]);

  const handleBorrarPendiente = async (g: GastoPendiente) => {
    if (borrandoPendiente) return;
    setBorrandoPendiente(true);
    try {
      const ok = await deleteGastoPendiente(g.id);
      if (!ok) { toast.error('No se pudo borrar el gasto'); return; }
      toast.success('Gasto pendiente borrado');
      setABorrarPendiente(null);
      setPendienteEdit(null);
      refresh();
    } finally {
      setBorrandoPendiente(false);
    }
  };

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
  const hayBusqueda = buscarMov.trim() !== '';
  const textoPeriodo = period === 'hoy' ? 'hoy' : period === 'todo' ? 'en total' : `en ${period === '7d' ? '7' : '30'} días`;

  /** Insignia/texto de método de pago para la línea de meta (null en gastos). */
  const metodoPago = (entry: LedgerEntry) => {
    if (entry.kind !== 'venta' || !entry.paymentMethod) return null;
    if (entry.paymentMethod === 'debe') {
      if (entry.settledAt) {
        return (
          <Insignia tono="bien">
            debía {entry.debtorName || '—'} · cobrado{entry.settledMethod ? ` ${PAYMENT_LABELS[entry.settledMethod]}` : ''}
          </Insignia>
        );
      }
      return <Insignia tono={TONO_METODO.debe} punto>Debe {entry.debtorName || '—'}</Insignia>;
    }
    return <Insignia tono={TONO_METODO[entry.paymentMethod]}>{PAYMENT_LABELS[entry.paymentMethod]}</Insignia>;
  };

  return (
    // pb extra en el celular: la barra fija de "Nueva venta" no tapa el último movimiento.
    <div className="fade-in pb-24 md:pb-0">
      <EncabezadoPagina
        rotulo="Plata"
        titulo="Caja"
        descripcion="Ventas y gastos del bot de Telegram y de esta pantalla. Al anular una venta de catálogo, el stock se repone solo."
        acciones={(
          <>
            <Boton variante="secundario" icono={<TrendingDown size={17} />} onClick={() => setGastoAbierto(true)} className="hidden md:inline-flex">
              Gasto
            </Boton>
            <Boton variante="secundario" icono={<CalendarClock size={17} />} onClick={() => setPendienteEdit('nuevo')}>
              Por pagar
            </Boton>
            <BotonIcono
              etiqueta={exporting ? 'Generando el Excel…' : 'Descargar Excel'}
              icono={exporting ? <RefreshCw size={18} className="animate-spin" /> : <FileDown size={18} />}
              onClick={handleExport}
              disabled={exporting || loading}
              className="border border-gray-300 bg-white"
            />
            <BotonIcono
              etiqueta="Actualizar"
              icono={<RefreshCw size={18} className={loading ? 'animate-spin' : ''} />}
              onClick={refresh}
              disabled={loading}
              className="border border-gray-300 bg-white"
            />
            <Boton icono={<Plus size={18} strokeWidth={2.5} />} onClick={() => setVentaAbierta(true)} className="hidden md:inline-flex">
              Nueva venta
            </Boton>
          </>
        )}
      />

      {/* Barra fija del celular: vender tiene que estar siempre a un pulgar,
          aunque se haya scrolleado la lista. Portal a <body> porque .fade-in
          anima con transform y eso rompe el position: fixed mientras dura. */}
      {createPortal(
        <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-gray-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          <Boton variante="secundario" icono={<TrendingDown size={17} />} onClick={() => setGastoAbierto(true)}>
            Gasto
          </Boton>
          <Boton icono={<Plus size={18} strokeWidth={2.5} />} onClick={() => setVentaAbierta(true)} className="flex-1">
            Nueva venta
          </Boton>
        </div>,
        document.body,
      )}

      <Segmentado
        etiqueta="Período de los totales y la lista"
        opciones={PERIODS}
        valor={period}
        alCambiar={setPeriod}
        className="mb-4"
      />

      {cargandoInicial || (loadFailed && loading) ? (
        <CargandoFilas filas={5} />
      ) : loadFailed ? (
        <ErrorEstado
          mensaje="No se pudo cargar la caja. Si recién entraste, puede ser la sesión: probá de nuevo."
          alReintentar={refresh}
        />
      ) : (
        <>
          {/* Totales del período */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              etiqueta="Ventas"
              valor={totals.ventas}
              plata
              tono="bien"
              icono={<TrendingUp size={15} />}
              detalle={`${plural(totals.countVentas, 'venta', 'ventas')} ${textoPeriodo}`}
            />
            <Kpi
              etiqueta="Gastos"
              valor={totals.gastos}
              plata
              tono="alerta"
              icono={<TrendingDown size={15} />}
              detalle={`${plural(totals.countGastos, 'gasto', 'gastos')} ${textoPeriodo}`}
            />
            <Kpi
              etiqueta="Balance"
              valor={totals.balance}
              plata
              tono={totals.balance >= 0 ? 'neutro' : 'alerta'}
              icono={<Scale size={15} />}
              detalle={`sobre ${plural(totals.count, 'movimiento', 'movimientos')}`}
            />
            <Kpi
              etiqueta="Por cobrar"
              valor={porCobrar.total}
              plata
              tono="atencion"
              icono={<Wallet size={15} />}
              detalle={porCobrar.count > 0 ? `${plural(porCobrar.count, 'fiado', 'fiados')} sin cobrar` : 'nada pendiente'}
            />
          </div>

          {/* Por pagar: lo que ya sabemos que hay que pagar y todavía no salió */}
          {porPagar.abiertos.length > 0 && (
            <div className="mb-6">
              <Tarjeta
                sinPadding
                titulo="Por pagar"
                acciones={(
                  <div className="flex items-center gap-2">
                    {porPagar.vencidos > 0 && (
                      <Insignia tono="alerta" punto>{plural(porPagar.vencidos, 'vencido', 'vencidos')}</Insignia>
                    )}
                    <Plata monto={porPagar.total} className="font-display text-sm font-bold text-navy-700" />
                  </div>
                )}
              >
                <ul className="divide-y divide-gray-100">
                  {porPagar.abiertos.map(g => {
                    const est = estadoVencimiento(g.venceEl, porPagar.hoy);
                    return (
                      <li key={g.id} className="flex items-center gap-3 px-4 py-3">
                        <span className={cn('hidden h-9 w-9 shrink-0 items-center justify-center rounded-full sm:flex', ICONO_VENC[est])}>
                          {est === 'vencido' ? <AlertTriangle size={16} /> : <CalendarClock size={16} />}
                        </span>
                        {/* Tocar el texto edita: un lápiz aparte le robaba 44px al nombre en el celular. */}
                        <button
                          type="button"
                          onClick={() => setPendienteEdit(g)}
                          aria-label={`Editar ${g.label}`}
                          className="group min-w-0 flex-1 rounded-md text-left"
                        >
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-1.5 font-display text-sm font-bold text-navy-700">
                              <span className="truncate group-hover:underline">{g.label}</span>
                              <Pencil size={13} className="shrink-0 text-gray-400" aria-hidden />
                            </span>
                            <Plata monto={g.amount} className="shrink-0 text-sm font-bold text-navy-700" />
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                            <Insignia tono={TONO_VENC[est]}>{TEXTO_VENC[est](g.venceEl || '')}</Insignia>
                            {g.proveedor && <span className="truncate">{g.proveedor}</span>}
                          </span>
                        </button>
                        <Boton variante="secundario" onClick={() => setPendienteAPagar(g)} className="shrink-0 px-4">
                          Pagar
                        </Boton>
                      </li>
                    );
                  })}
                </ul>
              </Tarjeta>
              <p className="mt-2 text-xs leading-relaxed text-gray-500">
                Estos gastos <b>no</b> entran en los totales de arriba: recién impactan la caja cuando
                alguno de ustedes lo marca pagado, y ahí se registra quién puso la plata.
              </p>
            </div>
          )}

          {/* Deudores */}
          {porCobrar.deudores.length > 0 && (
            <div className="mb-6">
              <Tarjeta
                sinPadding
                titulo={`Por cobrar · ${plural(porCobrar.deudores.length, 'persona', 'personas')}`}
                acciones={<Plata monto={porCobrar.total} className="font-display text-sm font-bold text-amber-700" />}
              >
                <ul className="divide-y divide-gray-100">
                  {porCobrar.deudores.map(deudor => (
                    <li key={deudor.nombre} className="flex items-center gap-3 px-4 py-3">
                      <span aria-hidden className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 font-display text-sm font-bold text-amber-700 ring-1 ring-inset ring-amber-200 sm:flex">
                        {deudor.nombre.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate font-display text-sm font-bold text-navy-700">{deudor.nombre}</p>
                          <Plata monto={deudor.total} className="shrink-0 text-sm font-bold text-amber-700" />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-gray-500">
                          {plural(deudor.items, 'ítem', 'ítems')} · desde {formatFechaCorta(deudor.desde)}
                        </p>
                      </div>
                      <Boton variante="secundario" onClick={() => setACobrar({ nombre: deudor.nombre, total: deudor.total })} className="shrink-0 px-4">
                        Cobrar
                      </Boton>
                      <BotonIcono
                        etiqueta={`Borrar deudas de ${deudor.nombre}`}
                        icono={<Trash2 size={17} />}
                        tono="peligro"
                        onClick={() => setABorrarDeuda(deudor)}
                        className="-ml-1"
                      />
                    </li>
                  ))}
                </ul>
              </Tarjeta>
              <p className="mt-2 text-xs leading-relaxed text-gray-500">
                «Cobrar» = entró la plata. El tacho borra la deuda como si la venta nunca hubiera existido
                (para las cargadas por error). También podés cobrar desde el bot: «cobré + nombre».
              </p>
            </div>
          )}

          {/* Movimientos */}
          <BarraFiltros
            busqueda={buscarMov}
            alBuscar={setBuscarMov}
            placeholder="Buscar producto, persona…"
            chips={KINDS.map(k => (
              <Chip key={k.id} activo={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</Chip>
            ))}
          />

          {filtered.length === 0 ? (
            loading ? (
              <CargandoFilas filas={4} />
            ) : (
              <Vacio
                icono={<Wallet size={22} />}
                titulo={hayBusqueda
                  ? `Nada coincide con «${buscarMov.trim()}»`
                  : period === 'hoy' ? 'Todavía no hay movimientos hoy' : 'Sin movimientos en este período'}
                descripcion={hayBusqueda
                  ? 'Probá con otra palabra o ampliá el período.'
                  : 'Registrá una con «Nueva venta» o desde el bot de Telegram.'}
                accion={period !== 'todo' ? (
                  <Boton variante="secundario" onClick={() => setPeriod(period === 'hoy' ? '7d' : 'todo')}>
                    {period === 'hoy' ? 'Ver los últimos 7 días' : 'Ver todo'}
                  </Boton>
                ) : undefined}
              />
            )
          ) : (
            <Tarjeta
              sinPadding
              titulo={`Movimientos · ${hayBusqueda ? `${filtered.length} de ${entries.length}` : filtered.length}`}
              acciones={loading ? <RefreshCw size={15} className="animate-spin text-gray-400" aria-label="Actualizando" /> : undefined}
            >
              <ul className="divide-y divide-gray-100">
                {filtered.map(entry => {
                  const esVenta = entry.kind === 'venta';
                  return (
                    <li key={entry.id} className={cn('flex items-start gap-3 py-3 pl-4 pr-2', entry.reverted && 'opacity-50')}>
                      <span className={cn(
                        'mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:flex',
                        esVenta ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600',
                      )}>
                        {esVenta ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
                      </span>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex items-start justify-between gap-3">
                          <p className={cn('min-w-0 truncate font-display text-sm font-bold text-navy-700', entry.reverted && 'line-through')}>
                            {entry.label}{entry.qty > 1 ? ` ×${entry.qty}` : ''}
                          </p>
                          <p className={cn(
                            'shrink-0 font-display text-sm font-bold tabular-nums',
                            entry.reverted ? 'text-gray-400 line-through' : esVenta ? 'text-emerald-700' : 'text-red-700',
                          )}>
                            {esVenta ? `+${formatoPlata(entry.amount)}` : formatoPlata(-entry.amount)}
                          </p>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                          <span>{fechaHumana(entry.createdAt, ahoraMs)}</span>
                          {entry.variantKey && <span>· {formatVariant(entry.variantKey)}</span>}
                          {esVenta && !entry.productId && <span>· ítem suelto</span>}
                          {metodoPago(entry)}
                          {entry.socioSettledAt && !entry.reverted && (
                            <Insignia tono="navy"><Check size={12} /> liquidado</Insignia>
                          )}
                          {entry.reverted && <Insignia>Anulada</Insignia>}
                          {entry.kind === 'gasto' && entry.paidBy && (
                            <Insignia tono="navy">pagó {NOMBRES_SOCIOS[entry.paidBy]}</Insignia>
                          )}
                          <span>por {entry.reportedBy}</span>
                        </div>
                      </div>
                      {!entry.reverted ? (
                        <BotonIcono
                          etiqueta={`Anular ${esVenta ? 'venta' : 'gasto'} de ${formatoPlata(entry.amount)}`}
                          icono={<Undo2 size={17} />}
                          tono="peligro"
                          onClick={() => setAAnular(entry)}
                          disabled={reverting !== null}
                          className="-my-1.5"
                        />
                      ) : (
                        <span aria-hidden className="w-11 shrink-0" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </Tarjeta>
          )}
          {entries.length >= 500 && (
            <p className="mt-3 text-xs text-gray-500">
              Se muestran los últimos 500 movimientos: los totales de «Todo» pueden no incluir los más viejos.
            </p>
          )}
        </>
      )}

      {/* Anular: siempre con confirmación que dice qué y cuánto */}
      {aAnular && (
        <Confirmar
          abierto
          titulo={`Anular ${aAnular.kind === 'gasto' ? 'gasto' : 'venta'} de ${formatoPlata(aAnular.amount)}`}
          mensaje={(
            <>
              <p className="font-semibold text-navy-700">{aAnular.label}{aAnular.qty > 1 ? ` ×${aAnular.qty}` : ''}</p>
              <p className="mt-1">
                {aAnular.productId
                  ? 'Se anula y se repone el stock (igual que el deshacer del bot).'
                  : 'Se anula el movimiento (igual que el deshacer del bot).'}
              </p>
            </>
          )}
          textoConfirmar={aAnular.kind === 'gasto' ? 'Anular gasto' : 'Anular venta'}
          cargando={reverting === aAnular.id}
          alConfirmar={() => void handleRevert(aAnular)}
          alCerrar={() => reverting === null && setAAnular(null)}
        />
      )}

      {/* Modal de nueva venta */}
      {ventaAbierta && (
        <VentaModal
          products={products}
          registrar={registrarVenta}
          deudoresAbiertos={porCobrar.deudores
            .filter(d => d.nombre !== 'Sin nombre')
            .map(d => ({ nombre: d.nombre, saldo: d.total }))}
          padron={padron ?? []}
          nombresSugeridos={[
            ...entries.filter(e => e.debtorName).map(e => e.debtorName as string),
            ...(padron ?? []).map(j => j.nombre),
          ]}
          onClose={() => setVentaAbierta(false)}
          onDone={() => { setVentaAbierta(false); refresh(); }}
          onRefrescar={() => { refresh(); }}
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

      {/* Borrar un pendiente: se abre encima del modal de edición, que queda quieto atrás.
          Va ANTES en el JSX a propósito: si los dos se cierran juntos, React limpia en
          este orden y cada Dialogo devuelve el scroll del body como lo encontró; al
          revés, el body quedaba trabado con overflow hidden. */}
      {aBorrarPendiente && (
        <Confirmar
          abierto
          titulo={`Borrar «${aBorrarPendiente.label}» de ${formatoPlata(aBorrarPendiente.amount)}`}
          mensaje="Se borra de la lista de pendientes. No afecta la caja, porque todavía no se pagó."
          textoConfirmar="Borrar pendiente"
          cargando={borrandoPendiente}
          alConfirmar={() => void handleBorrarPendiente(aBorrarPendiente)}
          alCerrar={() => !borrandoPendiente && setABorrarPendiente(null)}
        />
      )}

      {/* Alta / edición de un gasto pendiente */}
      {pendienteEdit !== null && (
        <GastoPendienteModal
          gasto={pendienteEdit === 'nuevo' ? null : pendienteEdit}
          guardar={saveGastoPendiente}
          pedirBorrado={setABorrarPendiente}
          bloqueado={aBorrarPendiente !== null}
          onClose={() => setPendienteEdit(null)}
          onDone={() => { setPendienteEdit(null); refresh(); }}
        />
      )}

      {/* Marcar pagado un pendiente: pasa a ser un gasto real de la caja */}
      {pendienteAPagar && (
        <PagarPendienteModal
          gasto={pendienteAPagar}
          pagar={pagarGastoPendiente}
          socioSugerido={socioSugerido}
          onClose={() => setPendienteAPagar(null)}
          onDone={() => { setPendienteAPagar(null); refresh(); }}
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
  // Cada borrado pasa por una confirmación que dice qué y cuánto se borra.
  const [aConfirmar, setAConfirmar] = useState<{ ids: string[]; etiqueta: string; titulo: string; detalle: string } | null>(null);

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

  const confirmar = async () => {
    if (!aConfirmar) return;
    await borrar(aConfirmar.ids, aConfirmar.etiqueta);
    setAConfirmar(null);
  };

  const cerrar = () => (borrados.length ? onDone() : onClose());

  return (
    <>
      {/* Antes que el Dialogo a propósito (orden de limpieza del scroll del body, ver la Caja). */}
      {aConfirmar && (
        <Confirmar
          abierto
          titulo={aConfirmar.titulo}
          mensaje={aConfirmar.detalle}
          textoConfirmar={aConfirmar.ids.length === 1 ? 'Borrar deuda' : `Borrar ${aConfirmar.ids.length} deudas`}
          cargando={borrando !== null}
          alConfirmar={() => void confirmar()}
          alCerrar={() => borrando === null && setAConfirmar(null)}
        />
      )}

      <Dialogo
        abierto
        titulo={`Borrar deuda de ${deudor.nombre}`}
        descripcion="Se anula la venta: desaparece de la deuda y de los totales, como si nunca se hubiera cargado. Si en realidad te pagó, cerrá esto y usá «Cobrar»."
        alCerrar={cerrar}
        ocupado={borrando !== null || aConfirmar !== null}
        ancho="sm"
        pie={(
          <>
            <Boton variante="secundario" onClick={cerrar} disabled={borrando !== null}>Listo</Boton>
            {pendientes.length > 1 && (
              <Boton
                variante="peligro"
                icono={<Trash2 size={16} />}
                disabled={borrando !== null}
                onClick={() => setAConfirmar({
                  ids: pendientes.map(m => m.id),
                  etiqueta: 'todas',
                  titulo: `Borrar las ${pendientes.length} deudas de ${deudor.nombre}`,
                  detalle: `Se anulan las ${pendientes.length} ventas fiadas, por ${formatoPlata(totalPendiente)} en total.`,
                })}
              >
                Borrar las {pendientes.length} ({formatoPlata(totalPendiente)})
              </Boton>
            )}
          </>
        )}
      >
        {pendientes.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">No queda ninguna deuda de {deudor.nombre}.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {pendientes.map(m => (
              <li key={m.id} className="flex items-center gap-3 py-2 pl-3 pr-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-bold text-navy-700">
                    {m.label}{m.qty > 1 ? ` ×${m.qty}` : ''}
                  </p>
                  <p className="text-xs text-gray-500">{formatFechaCorta(m.createdAt)} · por {m.reportedBy}</p>
                </div>
                <Plata monto={m.amount} className="shrink-0 text-sm font-bold text-amber-700" />
                <BotonIcono
                  etiqueta={`Borrar ${m.label} (${formatoPlata(m.amount)})`}
                  icono={borrando === m.id ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={17} />}
                  tono="peligro"
                  disabled={borrando !== null}
                  onClick={() => setAConfirmar({
                    ids: [m.id],
                    etiqueta: m.id,
                    titulo: `Borrar deuda de ${formatoPlata(m.amount)}`,
                    detalle: `${m.label}${m.qty > 1 ? ` ×${m.qty}` : ''} (${formatFechaCorta(m.createdAt)}). Se anula la venta, no se registra un cobro.`,
                  })}
                />
              </li>
            ))}
          </ul>
        )}
      </Dialogo>
    </>
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
  const [monto, setMonto] = useState<number | null>(deudor.total);
  const [metodo, setMetodo] = useState<'mp' | 'efectivo' | 'transferencia' | null>(null);
  const [cobrando, setCobrando] = useState(false);

  const montoNum = monto ?? NaN;
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
        toast.success(`Cobrado ${formatoPlata(montoNum)} de ${deudor.nombre} — quedan ${formatoPlata(result.restante)} pendientes`);
      } else {
        toast.success(`Deuda de ${deudor.nombre} saldada`);
      }
      onDone();
    } catch (e) {
      console.error('Error cobrando deuda:', e);
      toast.error('No se pudo cobrar. Probá de nuevo.');
    } finally {
      setCobrando(false);
    }
  };

  const errorMonto = Number.isFinite(montoNum) && montoNum > deudor.total ? 'No puede pagar más de lo que debe.' : null;

  return (
    <Dialogo
      abierto
      titulo={`Cobrar a ${deudor.nombre}`}
      descripcion={<>Debe <b className="tabular-nums text-amber-700">{formatoPlata(deudor.total)}</b> en total.</>}
      alCerrar={onClose}
      ocupado={cobrando}
      ancho="sm"
      pie={(
        <>
          <Boton variante="secundario" onClick={onClose} disabled={cobrando}>Cancelar</Boton>
          <Boton onClick={handleCobrar} disabled={!listo} cargando={cobrando}>
            {!metodo ? 'Elegí cómo paga'
              : esParcial ? `Cobrar ${formatoPlata(montoNum)} (parcial)`
              : `Cobrar todo · ${formatoPlata(deudor.total)}`}
          </Boton>
        </>
      )}
    >
      <div className="space-y-4">
        <Campo
          etiqueta="¿Cuánto paga ahora?"
          error={errorMonto}
          ayuda={esParcial
            ? `Pago parcial: quedan ${formatoPlata(deudor.total - montoNum)} pendientes (se cancelan las deudas más viejas primero).`
            : undefined}
        >
          <EntradaPlata valor={monto} alCambiar={setMonto} />
        </Campo>
        <div>
          <span className={claseRotulo}>¿Cómo paga?</span>
          <Segmentado etiqueta="¿Cómo paga?" opciones={METODOS_COBRO} valor={metodo} alCambiar={setMetodo} anchoCompleto />
        </div>
      </div>
    </Dialogo>
  );
}

/** Foto chica del producto en la lista del buscador (o percha si no tiene). */
function FotoProducto({ producto }: { producto: Product }) {
  const url = producto.images?.[0];
  if (!url) {
    return (
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
        <Shirt size={18} />
      </div>
    );
  }
  return <img src={url} alt="" className="h-11 w-11 flex-shrink-0 rounded-lg bg-gray-100 object-cover" />;
}

/**
 * Nueva venta desde la web: producto del catálogo (descuenta stock, igual que
 * el bot) o ítem suelto. Si la RPC falla (ej: "sin stock: quedan N"), el modal
 * queda abierto para corregir.
 */
function VentaModal({ products, registrar, deudoresAbiertos, nombresSugeridos, padron, onClose, onDone, onRefrescar }: {
  products: Product[];
  registrar: (input: VentaCajaInput) => Promise<{ ok: boolean; error?: string }>;
  /** Deudores con deuda abierta (nombre + saldo), para elegir con un toque. */
  deudoresAbiertos: { nombre: string; saldo: number }[];
  /** Nombres conocidos (deudores históricos + padrón) para sugerir al escribir. */
  nombresSugeridos: string[];
  /** Padrón con ids: elegir uno VINCULA la venta a su ficha. */
  padron: JugadorPadron[];
  onClose: () => void;
  onDone: () => void;
  /** Relee la caja sin cerrar el modal ("Registrar y otra", resultado dudoso). */
  onRefrescar: () => void;
}) {
  const [pestana, setPestana] = useState<'catalogo' | 'suelto'>('catalogo');
  const [busqueda, setBusqueda] = useState('');
  const [producto, setProducto] = useState<Product | null>(null);
  const [variante, setVariante] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  // Precio total: arranca en precio de lista × cantidad y se recalcula al cambiar
  // la cantidad SOLO si el admin no lo tocó a mano.
  const [precio, setPrecio] = useState<number | null>(null);
  const [precioTocado, setPrecioTocado] = useState(false);
  const [nombreSuelto, setNombreSuelto] = useState('');
  const [montoSuelto, setMontoSuelto] = useState<number | null>(null);
  // Botonera de ventas rápidas como CARRITO: cada toque suma su ítem sin pisar
  // los anteriores (mismo botón otra vez = más cantidad). Editar los campos a
  // mano corta la acumulación (el carrito se vacía en los onChange).
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const tocarRapida = (v: VentaRapida) => {
    const idx = carrito.findIndex(i => i.nombre === v.nombre);
    const nuevo = idx >= 0
      ? carrito.map((i, j) => (j === idx ? { ...i, veces: i.veces + 1 } : i))
      : [...carrito, { nombre: v.nombre, precio: v.precio, veces: 1 }];
    setCarrito(nuevo);
    const r = resumenCarrito(nuevo);
    setNombreSuelto(r.nombre);
    setMontoSuelto(r.monto);
  };
  const vaciarCarrito = () => {
    setCarrito([]);
    setNombreSuelto('');
    setMontoSuelto(null);
  };
  const [metodo, setMetodo] = useState<VentaCajaInput['payment'] | null>(null);
  const [deudor, setDeudor] = useState('');
  const [registrando, setRegistrando] = useState(false);
  // La conexión se cortó a mitad de camino: la venta pudo haber entrado. Hasta
  // que alguien mire la lista, reintentar está bloqueado (duplicaría venta y stock).
  const [incierto, setIncierto] = useState(false);
  const avisoIncierto = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (incierto) avisoIncierto.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [incierto]);

  // Sugerencias de deudor: matching sin tildes y tolerante a typos, deudores
  // abiertos primero con su saldo. Si el texto ya es exactamente un nombre
  // sugerido (recién elegido con un toque), no se repite abajo.
  const sugerenciasDeudor = useMemo(() => {
    if (metodo !== 'debe') return [];
    const q = deudor.trim();
    if (q === '') return [];
    return sugerirDeudores(deudoresAbiertos, nombresSugeridos, q).filter(s => s.nombre !== q);
  }, [metodo, deudor, deudoresAbiertos, nombresSugeridos]);

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
    setPrecio(p.price);
  };

  const cambiarCantidad = (nueva: number) => {
    if (!producto) return;
    const tope = Math.max(1, stockVariante || 1);
    const clamped = Math.min(tope, Math.max(1, nueva));
    setQty(clamped);
    if (!precioTocado) setPrecio(producto.price * clamped);
  };

  const elegirVariante = (key: string, stock: number) => {
    setVariante(key);
    const clamped = Math.min(Math.max(1, qty), stock);
    setQty(clamped);
    if (producto && !precioTocado) setPrecio(producto.price * clamped);
  };

  const volverAPrecioLista = () => {
    if (!producto) return;
    setPrecioTocado(false);
    setPrecio(producto.price * qty);
  };

  // Jugador del padrón cuyo nombre coincide con lo escrito: si hay match, la
  // venta queda VINCULADA a su ficha (compre fiado o pague en el momento).
  const compradorVinculado = useMemo(() => {
    const q = normalizar(deudor);
    if (q === '') return null;
    return padron.find(j => normalizar(j.nombre) === q || j.alias.some(a => normalizar(a) === q)) ?? null;
  }, [deudor, padron]);

  const precioNum = precio ?? NaN;
  const montoNum = montoSuelto ?? NaN;
  const faltaDeudor = metodo === 'debe' && deudor.trim() === '';
  const listo = pestana === 'catalogo'
    ? !!producto && !!variante && qty >= 1 && qty <= stockVariante
      && Number.isFinite(precioNum) && precioNum > 0 && !!metodo && !faltaDeudor
    : nombreSuelto.trim() !== '' && Number.isFinite(montoNum) && montoNum > 0 && !!metodo && !faltaDeudor;

  // Precio de lista vs. lo tipeado: el descuento tiene que verse, no adivinarse.
  const precioLista = producto ? producto.price * qty : null;
  const diferenciaLista = precioLista !== null && Number.isFinite(precioNum) ? precioNum - precioLista : 0;

  /** Deja el modal listo para la próxima venta (la cola del mostrador). */
  const reiniciar = () => {
    setProducto(null);
    setVariante(null);
    setQty(1);
    setPrecio(null);
    setPrecioTocado(false);
    setBusqueda('');
    setCarrito([]);
    setNombreSuelto('');
    setMontoSuelto(null);
    // Sin método por defecto también en la siguiente: cada cliente paga como paga.
    setMetodo(null);
    setDeudor('');
  };

  const handleRegistrar = async (otra: boolean) => {
    if (!listo || registrando || !metodo || incierto) return;
    const input: VentaCajaInput = pestana === 'catalogo'
      ? {
          label: producto!.name,
          amount: precioNum,
          payment: metodo,
          productId: producto!.id,
          variantKey: variante,
          qty,
          debtor: metodo === 'debe' ? deudor.trim() : null,
          jugadorId: compradorVinculado?.id ?? null,
        }
      : {
          label: nombreSuelto.trim(),
          amount: montoNum,
          payment: metodo,
          debtor: metodo === 'debe' ? deudor.trim() : null,
          jugadorId: compradorVinculado?.id ?? null,
        };
    setRegistrando(true);
    try {
      const result = await registrar(input);
      if (!result.ok) {
        if (resultadoIncierto(result.error)) {
          setIncierto(true);
          onRefrescar();
          return;
        }
        // Rechazo claro: el modal sigue abierto para corregir (otra variante, menos cantidad).
        toast.error(result.error || 'No se pudo registrar la venta');
        return;
      }
      toast.success(`Venta registrada · ${formatoPlata(input.amount)}`);
      if (otra) {
        reiniciar();
        onRefrescar();
      } else {
        onDone();
      }
    } catch (e) {
      // Un throw a mitad de camino tampoco dice si la RPC llegó: mismo aviso que el corte.
      console.error('Error registrando venta:', e);
      setIncierto(true);
      onRefrescar();
    } finally {
      setRegistrando(false);
    }
  };

  const montoVenta = pestana === 'catalogo' ? precioNum : montoNum;
  const hayMonto = Number.isFinite(montoVenta) && montoVenta > 0;
  const textoCobrar = incierto ? 'Revisá la lista primero'
    : metodo === null ? 'Elegí cómo pagaron'
    : !hayMonto ? 'Cobrar'
    : metodo === 'debe' ? `Anotar deuda · ${formatoPlata(montoVenta)}`
    : `Cobrar ${formatoPlata(montoVenta)} · ${PAYMENT_LABELS[metodo]}`;

  const sucio = !incierto && (producto !== null || nombreSuelto.trim() !== '' || montoSuelto !== null || metodo !== null || deudor.trim() !== '');

  return (
    <Dialogo
      abierto
      titulo="Nueva venta"
      alCerrar={onClose}
      ocupado={registrando}
      sucio={sucio}
      pie={(
        <>
          <Boton variante="secundario" onClick={() => void handleRegistrar(true)} disabled={!listo || registrando || incierto}>
            Registrar y otra
          </Boton>
          <Boton onClick={() => void handleRegistrar(false)} disabled={!listo || incierto} cargando={registrando} className="sm:min-w-[15rem]">
            {registrando ? 'Registrando…' : textoCobrar}
          </Boton>
        </>
      )}
    >
      <div className="space-y-5">
        {incierto && (
          <div ref={avisoIncierto} role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="flex items-center gap-2 font-display text-sm font-bold text-amber-900">
              <AlertTriangle size={17} className="shrink-0" /> No sabemos si la venta entró
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-amber-900/80">
              La conexión se cortó antes de la respuesta. Revisá la lista de movimientos antes de
              reintentar: si entró y la cargás de nuevo, queda duplicada y el stock se descuenta dos veces.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Boton variante="secundario" onClick={onClose}>Cerrar y revisar la lista</Boton>
              <Boton variante="fantasma" onClick={() => setIncierto(false)}>No entró, reintentar</Boton>
            </div>
          </div>
        )}

        <Segmentado
          etiqueta="Tipo de venta"
          opciones={[{ valor: 'catalogo', texto: 'Catálogo' }, { valor: 'suelto', texto: 'Suelto' }]}
          valor={pestana}
          alCambiar={setPestana}
          anchoCompleto
        />

        {pestana === 'catalogo' ? (
          !producto ? (
            <div>
              <label htmlFor="venta-buscador" className={claseRotulo}>Producto</label>
              <div className="relative">
                <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Entrada
                  id="venta-buscador"
                  type="search"
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  placeholder="Buscar por nombre…"
                  className="pl-10"
                />
              </div>
              <div className="mt-2 space-y-1.5 sm:max-h-72 sm:overflow-y-auto sm:pr-1">
                {candidatos.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-500">
                    No hay productos activos con stock que coincidan.
                  </p>
                ) : (
                  candidatos.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => elegirProducto(p)}
                      className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-2 pr-3 text-left transition-colors hover:border-navy-700"
                    >
                      <FotoProducto producto={p} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-sm font-bold text-navy-700">{p.name}</p>
                        <p className="text-xs text-gray-500">
                          <span className="tabular-nums">{formatoPlata(p.price)}</span> · {stockTotal(p.stockBySize)} en stock
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Producto elegido */}
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-2 pl-2">
                <FotoProducto producto={producto} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-bold text-navy-700">{producto.name}</p>
                  <p className="text-xs text-gray-500">lista <span className="tabular-nums">{formatoPlata(producto.price)}</span> c/u</p>
                </div>
                <Boton
                  variante="fantasma"
                  chico
                  onClick={() => { setProducto(null); setVariante(null); setPrecio(null); setPrecioTocado(false); setQty(1); }}
                >
                  Cambiar
                </Boton>
              </div>

              {/* Variantes con stock */}
              <div>
                <span className={claseRotulo}>Variante</span>
                <div className="flex flex-wrap gap-2">
                  {variantes.map(v => (
                    <Chip key={v.key} activo={variante === v.key} onClick={() => elegirVariante(v.key, v.stock)} cantidad={v.stock}>
                      {v.label}
                    </Chip>
                  ))}
                </div>
              </div>

              {/* Cantidad + precio */}
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <span className={claseRotulo}>Cantidad</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => cambiarCantidad(qty - 1)}
                      disabled={qty <= 1}
                      aria-label="Una menos"
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 bg-white text-navy-700 transition-colors hover:border-navy-700 disabled:border-gray-200 disabled:text-gray-300"
                    >
                      <Minus size={17} />
                    </button>
                    <span className="w-10 text-center font-display text-lg font-bold tabular-nums text-navy-700" aria-live="polite">
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => cambiarCantidad(qty + 1)}
                      disabled={!variante || qty >= stockVariante}
                      aria-label="Una más"
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 bg-white text-navy-700 transition-colors hover:border-navy-700 disabled:border-gray-200 disabled:text-gray-300"
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                </div>
                <Campo etiqueta="Precio total" className="min-w-[9rem] flex-1">
                  <EntradaPlata
                    valor={precio}
                    alCambiar={n => { setPrecio(n); setPrecioTocado(true); }}
                  />
                </Campo>
              </div>

              {/* De dónde sale el total: lista × cantidad, y si hay descuento que se vea */}
              {precioLista !== null && (
                <div className="rounded-lg bg-gray-50 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="tabular-nums text-gray-600">
                      Lista {formatoPlata(producto.price)} × {qty} = <b className="text-navy-700">{formatoPlata(precioLista)}</b>
                    </span>
                    {diferenciaLista !== 0 && (
                      <Insignia tono="atencion">
                        {diferenciaLista < 0 ? `descuento ${formatoPlata(diferenciaLista)}` : `recargo +${formatoPlata(diferenciaLista)}`}
                      </Insignia>
                    )}
                  </div>
                  {precioTocado && (
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-gray-500">Total editado a mano: cambiar la cantidad ya no lo recalcula.</p>
                      <button
                        type="button"
                        onClick={volverAPrecioLista}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-2 text-xs font-bold text-navy-700 hover:bg-white"
                      >
                        <RotateCcw size={13} /> Volver al precio de lista
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        ) : (
          /* Ítem suelto: no toca stock */
          <div className="space-y-4">
            {/* Lo que más se vende suelto (lista real del ledger), a un toque.
                Funciona como carrito: cada botón suma su ítem sin pisar los otros. */}
            <div>
              <div className="mb-1.5 flex min-h-[28px] items-center justify-between">
                <span className="text-[13px] font-semibold text-navy-700">Lo de siempre</span>
                {carrito.length > 0 && (
                  <button type="button" onClick={vaciarCarrito}
                    className="inline-flex min-h-[32px] items-center rounded-md px-2 text-xs font-bold text-gray-500 hover:bg-red-50 hover:text-red-600">
                    Vaciar carrito
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {VENTAS_RAPIDAS.map(v => {
                  const enCarrito = carrito.find(i => i.nombre === v.nombre);
                  return (
                    <button
                      key={v.nombre}
                      type="button"
                      onClick={() => tocarRapida(v)}
                      className={cn(
                        'relative rounded-xl border px-2 py-2.5 text-center transition-colors',
                        enCarrito ? 'border-navy-700 bg-navy-50' : 'border-gray-200 bg-white hover:border-navy-700',
                      )}
                      aria-label={`${v.nombre} ${formatoPlata(v.precio)}${enCarrito ? `, ${enCarrito.veces} en el carrito` : ''}`}
                    >
                      {enCarrito && (
                        <span className="absolute right-1.5 top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-navy-700 px-1 text-[11px] font-bold tabular-nums text-white">
                          {enCarrito.veces}
                        </span>
                      )}
                      <span aria-hidden className="block text-xl leading-none">{v.emoji}</span>
                      <span className="mt-1 block truncate text-xs font-bold text-navy-700">{v.nombre}</span>
                      <span className="block text-[11px] tabular-nums text-gray-500">{formatoPlata(v.precio)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <Campo etiqueta="¿Qué se vendió?">
              <Entrada
                type="text"
                value={nombreSuelto}
                onChange={e => { setNombreSuelto(e.target.value); setCarrito([]); }}
                placeholder="Ej: alquiler de paleta"
              />
            </Campo>
            <Campo etiqueta="Monto" ayuda="Los ítems sueltos no descuentan stock del catálogo.">
              <EntradaPlata valor={montoSuelto} alCambiar={n => { setMontoSuelto(n); setCarrito([]); }} />
            </Campo>
          </div>
        )}

        {/* Método de pago: sin default, se elige siempre */}
        <div>
          <span className={claseRotulo}>¿Cómo pagaron?</span>
          <Segmentado etiqueta="¿Cómo pagaron?" opciones={METODOS_VENTA} valor={metodo} alCambiar={setMetodo} anchoCompleto />
          {/* El comprador se puede marcar SIEMPRE (con Debe es obligatorio):
              si matchea con el padrón, la venta queda en su ficha. */}
          {(metodo !== null || deudor !== '') && (
            <div className="mt-4">
              <label htmlFor="venta-deudor" className={claseRotulo}>
                {metodo === 'debe' ? '¿Quién debe?' : '¿Quién compró? (opcional)'}
              </label>
              {deudor.trim() === '' && deudoresAbiertos.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {deudoresAbiertos.slice(0, 8).map(d => (
                    <button
                      key={d.nombre}
                      type="button"
                      onClick={() => setDeudor(d.nombre)}
                      className="inline-flex h-9 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-[13px] font-semibold text-amber-800 transition-colors hover:border-amber-400"
                    >
                      {d.nombre} · <span className="ml-1 tabular-nums">{formatoPlata(d.saldo)}</span>
                    </button>
                  ))}
                </div>
              )}
              <Entrada
                id="venta-deudor"
                type="text"
                value={deudor}
                onChange={e => setDeudor(e.target.value)}
                placeholder="Nombre y apellido"
                aria-invalid={faltaDeudor || undefined}
              />
              {sugerenciasDeudor.length > 0 && (
                <div className="mt-1 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
                  {sugerenciasDeudor.map(s => (
                    <button
                      key={s.nombre}
                      type="button"
                      onClick={() => setDeudor(s.nombre)}
                      className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-gray-50"
                    >
                      <span className="font-semibold text-navy-700">{s.nombre}</span>
                      {s.saldo !== null && (
                        <span className="whitespace-nowrap text-xs font-bold text-amber-700">ya debe <span className="tabular-nums">{formatoPlata(s.saldo)}</span></span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {compradorVinculado ? (
                <p className="mt-1.5 flex items-center gap-1 text-[13px] font-semibold text-emerald-700">
                  <Check size={14} /> Queda en la ficha de {compradorVinculado.nombre}
                </p>
              ) : (
                <p className="mt-1.5 text-[13px] text-gray-500">
                  {metodo === 'debe'
                    ? 'Elegí un nombre sugerido si ya existe (así la deuda se acumula en la misma persona).'
                    : 'Si elegís un jugador del padrón, la compra queda en su historial.'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialogo>
  );
}

/**
 * Alta y edición de un gasto pendiente. Lo único obligatorio es qué es y cuánto:
 * si se exigiera vencimiento, la mitad de los gastos que no tienen fecha cierta
 * ("hay que pagarle al taller") no se cargarían nunca.
 */
function GastoPendienteModal({ gasto, guardar, pedirBorrado, bloqueado, onClose, onDone }: {
  gasto: GastoPendiente | null;
  guardar: (g: GastoPendienteInput) => Promise<{ ok: boolean; error?: string }>;
  /** Abre la confirmación de borrado (la maneja la pestaña, encima de este modal). */
  pedirBorrado: (g: GastoPendiente) => void;
  /** Hay una confirmación abierta encima: este modal no se cierra mientras tanto. */
  bloqueado: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [descripcion, setDescripcion] = useState(gasto?.label ?? '');
  const [monto, setMonto] = useState<number | null>(gasto ? gasto.amount : null);
  const [vence, setVence] = useState(gasto?.venceEl ?? '');
  const [proveedor, setProveedor] = useState(gasto?.proveedor ?? '');
  const [notas, setNotas] = useState(gasto?.notas ?? '');
  const [guardando, setGuardando] = useState(false);

  const montoNum = monto ?? NaN;
  const listo = descripcion.trim() !== '' && Number.isFinite(montoNum) && montoNum > 0;
  const sucio = descripcion !== (gasto?.label ?? '') || monto !== (gasto ? gasto.amount : null)
    || vence !== (gasto?.venceEl ?? '') || proveedor !== (gasto?.proveedor ?? '') || notas !== (gasto?.notas ?? '');

  const handleGuardar = async () => {
    if (!listo || guardando) return;
    setGuardando(true);
    try {
      const result = await guardar({
        id: gasto?.id,
        label: descripcion.trim(),
        amount: montoNum,
        venceEl: vence || null,
        proveedor: proveedor.trim() || null,
        notas: notas.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error || 'No se pudo guardar el gasto');
        return;
      }
      toast.success(gasto ? 'Gasto actualizado' : 'Gasto pendiente agregado');
      onDone();
    } catch (e) {
      console.error('Error guardando gasto pendiente:', e);
      toast.error('No se pudo guardar. Probá de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialogo
      abierto
      titulo={gasto ? 'Editar pendiente' : 'Gasto por pagar'}
      descripcion={gasto ? undefined : 'Algo que hay que pagar y todavía no salió de la caja.'}
      alCerrar={onClose}
      ocupado={guardando || bloqueado}
      sucio={sucio}
      ancho="sm"
      pie={(
        <>
          {gasto && (
            <Boton
              variante="fantasma"
              icono={<Trash2 size={16} />}
              onClick={() => pedirBorrado(gasto)}
              disabled={guardando}
              className="text-red-600 hover:bg-red-50 sm:mr-auto"
            >
              Borrar
            </Boton>
          )}
          <Boton variante="secundario" onClick={onClose} disabled={guardando}>Cancelar</Boton>
          <Boton onClick={handleGuardar} disabled={!listo} cargando={guardando}>
            {gasto ? 'Guardar cambios' : 'Agregar a por pagar'}
          </Boton>
        </>
      )}
    >
      <div className="space-y-4">
        <Campo etiqueta="¿Qué hay que pagar?" requerido>
          <Entrada
            type="text"
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Ej: sublimación de remeras, alquiler de canchas"
          />
        </Campo>
        <Campo etiqueta="Monto" requerido>
          <EntradaPlata valor={monto} alCambiar={setMonto} />
        </Campo>
        <Campo etiqueta="¿Para cuándo? (opcional)" ayuda="Si lo dejás vacío queda como pendiente sin fecha, al final de la lista.">
          <Entrada type="date" value={vence} onChange={e => setVence(e.target.value)} />
        </Campo>
        <Campo etiqueta="¿A quién? (opcional)">
          <Entrada
            type="text"
            value={proveedor}
            onChange={e => setProveedor(e.target.value)}
            placeholder="Ej: taller, club, imprenta"
          />
        </Campo>
        <Campo etiqueta="Nota (opcional)">
          <Entrada
            type="text"
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Cualquier detalle que convenga recordar"
          />
        </Campo>
      </div>
    </Dialogo>
  );
}

/**
 * Marca pagado un pendiente. Acá se pide quién puso la plata porque es el dato
 * que recién existe al pagar, y el que necesita el reparto 50/25/25. El gasto
 * entra a la caja con la fecha de hoy, no con la del vencimiento.
 */
function PagarPendienteModal({ gasto, pagar, socioSugerido, onClose, onDone }: {
  gasto: GastoPendiente;
  pagar: (id: string, paidBy: SocioName) => Promise<{ ok: boolean; error?: string }>;
  socioSugerido: SocioName | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pagador, setPagador] = useState<SocioName | null>(socioSugerido);
  const [pagando, setPagando] = useState(false);

  const handlePagar = async () => {
    if (!pagador || pagando) return;
    setPagando(true);
    try {
      const result = await pagar(gasto.id, pagador);
      if (!result.ok) {
        toast.error(result.error || 'No se pudo marcar como pagado');
        return;
      }
      toast.success('Pagado. Ya figura como gasto en la caja');
      onDone();
    } catch (e) {
      console.error('Error pagando gasto pendiente:', e);
      toast.error('No se pudo marcar como pagado. Probá de nuevo.');
    } finally {
      setPagando(false);
    }
  };

  return (
    <Dialogo
      abierto
      titulo="Marcar pagado"
      alCerrar={onClose}
      ocupado={pagando}
      ancho="sm"
      pie={(
        <>
          <Boton variante="secundario" onClick={onClose} disabled={pagando}>Cancelar</Boton>
          <Boton onClick={handlePagar} disabled={!pagador} cargando={pagando}>
            {pagador === null ? 'Elegí quién pagó' : `Confirmar pago · ${formatoPlata(gasto.amount)}`}
          </Boton>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="font-display text-sm font-bold text-navy-700">{gasto.label}</p>
          {gasto.proveedor && <p className="text-xs text-gray-500">{gasto.proveedor}</p>}
          <Plata monto={gasto.amount} className="mt-1 block font-display text-2xl font-black text-navy-700" />
        </div>
        <div>
          <span className={claseRotulo}>¿Quién puso la plata?</span>
          <Segmentado etiqueta="¿Quién puso la plata?" opciones={OPCIONES_SOCIOS} valor={pagador} alCambiar={setPagador} anchoCompleto />
          <p className="mt-1.5 text-[13px] text-gray-500">
            {pagador === null
              ? 'Elegí de quién salió la plata: define el reparto 50/25/25.'
              : `Entra a la caja como gasto de hoy, a nombre de ${NOMBRES_SOCIOS[pagador]}.`}
          </p>
        </div>
      </div>
    </Dialogo>
  );
}

/** Gasto rápido: descripción + monto + quién puso la plata (sin stock ni método de pago). */
function GastoModal({ registrar, socioSugerido, onClose, onDone }: {
  registrar: (label: string, amount: number, paidBy: SocioName) => Promise<{ ok: boolean; error?: string }>;
  /** Socio deducido del admin logueado; null con la cuenta compartida ("VOLEA Team"). */
  socioSugerido: SocioName | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState<number | null>(null);
  // Si no se puede deducir de la sesión, se elige a mano: sin esto el gasto se le
  // asentaba a Gastón por descarte y el reparto 50/25/25 salía mal.
  const [pagador, setPagador] = useState<SocioName | null>(socioSugerido);
  const [registrando, setRegistrando] = useState(false);

  const montoNum = monto ?? NaN;
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
      toast.success(`Gasto registrado · ${formatoPlata(montoNum)}`);
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
    <Dialogo
      abierto
      titulo="Registrar gasto"
      alCerrar={onClose}
      ocupado={registrando}
      sucio={descripcion.trim() !== '' || monto !== null}
      ancho="sm"
      pie={(
        <>
          <Boton variante="secundario" onClick={onClose} disabled={registrando}>Cancelar</Boton>
          <Boton onClick={handleRegistrar} disabled={!listo} cargando={registrando}>
            {pagador === null ? 'Elegí quién pagó'
              : Number.isFinite(montoNum) && montoNum > 0 ? `Registrar gasto · ${formatoPlata(montoNum)}`
              : 'Registrar gasto'}
          </Boton>
        </>
      )}
    >
      <div className="space-y-4">
        <Campo etiqueta="¿En qué se gastó?">
          <Entrada
            type="text"
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Ej: pelotas, hielo, nafta"
          />
        </Campo>
        <Campo etiqueta="Monto">
          <EntradaPlata valor={monto} alCambiar={setMonto} />
        </Campo>
        <div>
          <span className={claseRotulo}>¿Quién puso la plata?</span>
          <Segmentado etiqueta="¿Quién puso la plata?" opciones={OPCIONES_SOCIOS} valor={pagador} alCambiar={setPagador} anchoCompleto />
          <p className="mt-1.5 text-[13px] text-gray-500">
            {pagador === null
              ? 'Elegí de quién salió la plata: define el reparto 50/25/25.'
              : `El gasto se le asienta a ${NOMBRES_SOCIOS[pagador]} y se reparte 50/25/25.`}
          </p>
        </div>
      </div>
    </Dialogo>
  );
}
