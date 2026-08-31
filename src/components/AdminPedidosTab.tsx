/**
 * Pestaña "Pedidos" del panel: pedidos a proveedores y trabajos de sublimación.
 * Es una sola entidad (cambia `tipo`) porque el flujo es el mismo: se pide, se
 * sigue, se recibe. Lo importante de verdad es el cotejo de recepción: es el
 * único lugar donde entra stock, y lo hace la RPC (acá no se toca stock a mano).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Package, PackageCheck, RefreshCw, Plus, Loader2, Info, Pencil, Trash2, Shirt, Truck,
  AlertTriangle, CheckCheck, Upload, X, Search, ImagePlus,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  Compra, CompraArchivo, CompraEstado, CompraItem, CompraTipo, Product, RecepcionItem,
} from '../types';
import { SupabaseService } from '../services/supabaseService';

// ─── Constantes y helpers ────────────────────────────────────────────────────

interface EstadoInfo { id: CompraEstado; label: string; chip: string }

const ESTADOS: EstadoInfo[] = [
  { id: 'borrador', label: 'Borrador', chip: 'bg-gray-100 text-gray-500' },
  { id: 'pedido', label: 'Pedido', chip: 'bg-blue-50 text-blue-600' },
  { id: 'en_proceso', label: 'En proceso', chip: 'bg-amber-50 text-amber-700' },
  { id: 'en_camino', label: 'En camino', chip: 'bg-navy-50 text-navy-700' },
  { id: 'recibido', label: 'Recibido', chip: 'bg-green-50 text-green-700' },
  { id: 'cancelado', label: 'Cancelado', chip: 'bg-red-50 text-red-500' },
];

const ESTADO_INFO: Record<CompraEstado, EstadoInfo> = ESTADOS.reduce((acc, e) => {
  acc[e.id] = e;
  return acc;
}, {} as Record<CompraEstado, EstadoInfo>);

/** Solo desde estos estados tiene sentido cotejar mercadería. */
const RECIBIBLES: CompraEstado[] = ['pedido', 'en_proceso', 'en_camino'];

type FiltroTipo = 'todos' | CompraTipo;
type FiltroEstado = 'todos' | CompraEstado;

const TIPOS: { id: FiltroTipo; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'proveedor', label: 'Proveedores' },
  { id: 'sublimacion', label: 'Sublimación' },
];

const TIPO_LABEL: Record<CompraTipo, string> = {
  proveedor: 'proveedor',
  sublimacion: 'sublimación',
};

const badgeClass = 'rounded-full px-2 py-0.5 font-semibold';
const sectionTitleClass = 'mb-2 font-display text-sm font-bold uppercase tracking-wide text-gray-500';
const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-navy-700 focus:border-lime-400 outline-none';
const labelClass = 'mb-1 block font-display text-xs font-bold uppercase tracking-wide text-gray-500';
const btnPrimario = 'rounded-lg bg-lime-400 px-4 py-2.5 font-display text-sm font-bold text-navy-700 transition-colors hover:bg-lime-300 disabled:bg-gray-200 disabled:text-gray-400';
const btnSecundario = 'rounded-lg border border-gray-200 bg-white px-4 py-2.5 font-display text-sm font-semibold text-navy-700 transition-colors hover:bg-gray-50 disabled:opacity-50';

/**
 * "31/8/26" desde un YYYY-MM-DD partido a mano: `new Date('2026-08-31')` se lee
 * en UTC y en Montevideo (UTC-3) mostraría el día anterior.
 */
const formatFecha = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${Number(d)}/${Number(m)}/${y.slice(2)}`;
};

/** Hoy en Montevideo como YYYY-MM-DD, listo para un <input type="date">. */
const hoyISO = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });

/** Etiqueta legible de una clave de stock_by_size ("M / Unisex|Negro" → "M / Unisex · Negro"). */
const formatVariante = (key: string | null): string =>
  key ? key.split('|').filter(Boolean).join(' · ') : '';

/** La misma clave partida en dos para la grilla de talles: "M / Unisex" + "Negro". */
const partesVariante = (key: string): { talle: string; color: string } => {
  const partes = key.split('|');
  return { talle: (partes[0] ?? '').trim() || key, color: (partes[1] ?? '').trim() };
};

/** Cantidad tipeada → entero >= 0 (vacío, negativo o basura cuentan como 0). */
const aEntero = (txt: string): number => {
  const n = Math.floor(Number(txt.trim()));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Todas las variantes del producto, incluidas las que están en 0: justamente
 * lo que más se repone es lo que no queda. (`variantesConStock` de utils/caja
 * filtra las vacías y acá serviría de poco.)
 */
const variantesDe = (p: Product | undefined): { key: string; label: string; stock: number }[] =>
  Object.entries(p?.stockBySize ?? {}).map(([key, value]) => ({
    key,
    label: formatVariante(key),
    stock: Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0,
  }));

const resumenItems = (items: CompraItem[]): { pedidas: number; recibidas: number } => {
  let pedidas = 0;
  let recibidas = 0;
  for (const it of items) {
    pedidas += it.cantidad;
    recibidas += it.cantidadRecibida;
  }
  return { pedidas, recibidas };
};

/** Una línea suma stock solo si apunta a un producto Y a una variante concreta. */
const sumaStock = (it: { productId: string | null; variante: string | null }): boolean =>
  Boolean(it.productId && it.variante);

/** Id temporal de una línea nueva: vive hasta que el guardado reasigna los reales. */
const idTemporal = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const compraVacia = (tipo: CompraTipo, creadoPor: string): Compra => ({
  id: '',
  tipo,
  proveedor: '',
  referencia: '',
  estado: 'borrador',
  fechaPedido: hoyISO(),
  fechaEstimada: null,
  recibidoAt: null,
  notas: '',
  prendaBase: '',
  mockupUrl: '',
  archivos: [],
  comentarioTaller: '',
  creadoPor,
  createdAt: '',
  updatedAt: '',
  items: [],
});

// ─── Pestaña ─────────────────────────────────────────────────────────────────

export default function AdminPedidosTab({ products, adminEmail, onStockChanged }: {
  products: Product[];
  adminEmail: string;
  /** Se llama tras una recepción: el stock cambió y hay que releer los productos. */
  onStockChanged: () => void;
}) {
  const [compras, setCompras] = useState<Compra[]>([]);
  const [loading, setLoading] = useState(true);
  // Hasta que no resuelve el primer load no se muestra el vacío: si no, aparece
  // "Sin pedidos" mientras carga, que es mentira.
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos');
  const [editando, setEditando] = useState<Compra | null>(null);
  const [recibiendo, setRecibiendo] = useState<Compra | null>(null);
  const [aBorrar, setABorrar] = useState<Compra | null>(null);
  const [borrando, setBorrando] = useState(false);

  // Secuencia de fetches: una respuesta vieja que llega tarde no pisa a la nueva.
  const fetchSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    const data = await SupabaseService.getCompras();
    if (seq !== fetchSeq.current) return;
    if (data === null) {
      setLoadFailed(true);
      toast.error('No se pudieron cargar los pedidos. Verificá tu sesión de admin.');
    } else {
      setLoadFailed(false);
      setCompras(data);
    }
    setLoading(false);
    setCargandoInicial(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const productoPorId = useMemo(
    () => new Map(products.map(p => [p.id, p])),
    [products],
  );

  const filtrados = useMemo(
    () => compras.filter(c =>
      (filtroTipo === 'todos' || c.tipo === filtroTipo) &&
      (filtroEstado === 'todos' || c.estado === filtroEstado)),
    [compras, filtroTipo, filtroEstado],
  );

  const handleBorrar = async () => {
    if (!aBorrar || borrando) return;
    setBorrando(true);
    try {
      const ok = await SupabaseService.deleteCompra(aBorrar.id);
      if (!ok) { toast.error('No se pudo borrar el pedido'); return; }
      toast.success('Pedido borrado');
      setABorrar(null);
      void refresh();
    } finally {
      setBorrando(false);
    }
  };

  const handleRecibido = (r: { estado?: string; unidades?: number; pendientes?: number }) => {
    const unidades = r.unidades ?? 0;
    const pendientes = r.pendientes ?? 0;
    toast.success(
      unidades > 0
        ? `Entraron ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'} al stock`
        : 'Recepción registrada (no hubo unidades nuevas para el stock)',
    );
    if (pendientes > 0) {
      toast(
        `Quedan ${pendientes} ${pendientes === 1 ? 'línea incompleta' : 'líneas incompletas'}: el pedido sigue «en camino» con el saldo.`,
        { duration: 6000 },
      );
    }
    setRecibiendo(null);
    onStockChanged();
    void refresh();
  };

  return (
    <div className="fade-in">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Pedidos</h1>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <button
            onClick={() => setEditando(compraVacia('proveedor', adminEmail))}
            className="order-first flex w-full items-center justify-center gap-2 rounded-lg bg-lime-400 px-6 py-3 font-display text-sm font-bold text-navy-700 transition-colors hover:bg-lime-300 sm:order-last sm:w-auto"
          >
            <Plus size={18} strokeWidth={2.5} /> Nuevo pedido
          </button>
          <button
            onClick={() => setEditando(compraVacia('sublimacion', adminEmail))}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-5 py-2.5 font-display text-sm font-semibold text-navy-700 transition-colors hover:bg-gray-50 sm:flex-none"
          >
            <Shirt size={16} /> Sublimación
          </button>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-navy-700 px-5 py-2.5 font-display text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:bg-gray-400 sm:flex-none"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      <div className="mb-6 flex items-start gap-2 rounded-xl bg-navy-50 px-4 py-2.5 text-xs text-navy-600">
        <Info size={14} className="mt-0.5 flex-shrink-0" />
        <p>
          Pedidos a proveedores y trabajos de sublimación. Al <b>recibir</b> se cotejan las cantidades
          y el stock de cada variante se actualiza solo: las líneas sin producto o sin variante no lo tocan.
        </p>
      </div>

      {cargandoInicial ? (
        <div className="rounded-2xl border border-dashed border-gray-300 py-10 text-center">
          <Loader2 size={32} strokeWidth={1.5} className="mx-auto mb-3 animate-spin text-gray-300" />
          <p className="font-display text-sm font-bold text-gray-500">Cargando los pedidos…</p>
        </div>
      ) : loadFailed ? (
        !loading && (
          <div className="rounded-2xl border border-dashed border-gray-300 py-10 text-center">
            <Info size={32} strokeWidth={1.5} className="mx-auto mb-3 text-gray-300" />
            <p className="font-display text-sm font-bold text-gray-500">No se pudieron cargar los pedidos</p>
            <p className="mt-1 text-xs text-gray-400">Asegurate de haber entrado como admin y probá «Actualizar».</p>
          </div>
        )
      ) : (
        <>
          {/* Filtros como chips: tipo (lime) y estado (navy) */}
          <div className="mb-6 flex flex-wrap items-center gap-2">
            {TIPOS.map(t => (
              <button
                key={t.id}
                onClick={() => setFiltroTipo(t.id)}
                className={`rounded-full px-3.5 py-1.5 font-display text-xs font-bold transition-colors ${
                  filtroTipo === t.id ? 'bg-lime-400 text-navy-700' : 'bg-gray-100 text-gray-500 hover:text-navy-700'
                }`}
              >
                {t.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
            <button
              onClick={() => setFiltroEstado('todos')}
              className={`rounded-full px-3.5 py-1.5 font-display text-xs font-bold transition-colors ${
                filtroEstado === 'todos' ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-500 hover:text-navy-700'
              }`}
            >
              Todo estado
            </button>
            {ESTADOS.map(e => (
              <button
                key={e.id}
                onClick={() => setFiltroEstado(e.id)}
                className={`rounded-full px-3.5 py-1.5 font-display text-xs font-bold transition-colors ${
                  filtroEstado === e.id ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-500 hover:text-navy-700'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>

          {filtrados.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 py-10 text-center">
              {loading ? (
                <>
                  <Loader2 size={32} strokeWidth={1.5} className="mx-auto mb-3 animate-spin text-gray-300" />
                  <p className="font-display text-sm font-bold text-gray-500">Cargando los pedidos…</p>
                </>
              ) : (
                <>
                  <Package size={32} strokeWidth={1.5} className="mx-auto mb-3 text-gray-300" />
                  <p className="font-display text-sm font-bold text-gray-500">
                    {compras.length === 0 ? 'Todavía no hay pedidos' : 'Ningún pedido con estos filtros'}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {compras.length === 0
                      ? 'Cargá el primero con «Nuevo pedido» o «Sublimación».'
                      : 'Probá con otro tipo o estado.'}
                  </p>
                </>
              )}
            </div>
          ) : (
            <div>
              <h2 className={sectionTitleClass}>
                Pedidos ({filtrados.length === compras.length ? filtrados.length : `${filtrados.length} de ${compras.length}`})
              </h2>
              <div className="space-y-2">
                {filtrados.map(c => (
                  <FilaPedido
                    key={c.id}
                    compra={c}
                    onEditar={() => setEditando(c)}
                    onRecibir={() => setRecibiendo(c)}
                    onBorrar={() => setABorrar(c)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {editando && (
        <PedidoModal
          compra={editando}
          products={products}
          onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); void refresh(); }}
        />
      )}

      {recibiendo && (
        <RecepcionModal
          compra={recibiendo}
          productoPorId={productoPorId}
          onClose={() => setRecibiendo(null)}
          onRecibido={handleRecibido}
        />
      )}

      {aBorrar && (
        <ConfirmarBorrado
          compra={aBorrar}
          borrando={borrando}
          onCancelar={() => !borrando && setABorrar(null)}
          onConfirmar={() => void handleBorrar()}
        />
      )}
    </div>
  );
}

// ─── Fila de la lista ────────────────────────────────────────────────────────

function FilaPedido({ compra, onEditar, onRecibir, onBorrar }: {
  compra: Compra;
  onEditar: () => void;
  onRecibir: () => void;
  onBorrar: () => void;
}) {
  const estado = ESTADO_INFO[compra.estado];
  const { pedidas, recibidas } = resumenItems(compra.items);
  const completo = pedidas > 0 && recibidas >= pedidas;
  const puedeRecibir = RECIBIBLES.includes(compra.estado) && compra.items.length > 0;
  const esSubli = compra.tipo === 'sublimacion';

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
        esSubli ? 'bg-lime-100 text-lime-700' : 'bg-navy-50 text-navy-700'
      }`}>
        {esSubli ? <Shirt size={18} /> : <Truck size={18} />}
      </div>

      {esSubli && compra.mockupUrl && (
        <a
          href={compra.mockupUrl}
          target="_blank"
          rel="noreferrer"
          title="Ver el mockup final"
          className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200"
        >
          <img src={compra.mockupUrl} alt="Mockup" className="h-full w-full object-cover" />
        </a>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold text-navy-700">
          {compra.proveedor || 'Sin proveedor'}
          {compra.referencia && (
            <span className="ml-1.5 font-body text-xs font-normal text-gray-400">#{compra.referencia}</span>
          )}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
          <span className={`${badgeClass} ${estado.chip}`}>{estado.label}</span>
          <span>{TIPO_LABEL[compra.tipo]}</span>
          <span>pedido {formatFecha(compra.fechaPedido)}</span>
          {compra.fechaEstimada && <span>llega {formatFecha(compra.fechaEstimada)}</span>}
          <span>{compra.items.length} {compra.items.length === 1 ? 'línea' : 'líneas'}</span>
          {pedidas > 0 && (
            <span className={completo ? 'font-semibold text-green-600' : recibidas > 0 ? 'font-semibold text-amber-600' : ''}>
              {recibidas} de {pedidas} recibidas
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5">
        {puedeRecibir && (
          <button
            onClick={onRecibir}
            className="flex items-center gap-1.5 rounded-lg bg-lime-400 px-3 py-1.5 font-display text-xs font-bold text-navy-700 transition-colors hover:bg-lime-500"
          >
            <PackageCheck size={14} /> Recibir
          </button>
        )}
        <button
          onClick={onEditar}
          title="Editar pedido"
          aria-label={`Editar pedido de ${compra.proveedor || 'sin proveedor'}`}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={onBorrar}
          title="Borrar pedido"
          aria-label={`Borrar pedido de ${compra.proveedor || 'sin proveedor'}`}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Alta / edición ──────────────────────────────────────────────────────────

/** Línea en edición: las cantidades viven como texto para poder borrar el campo. */
interface LineaBorrador {
  id: string;
  productId: string | null;
  variante: string | null;
  descripcion: string;
  cantidad: string;
  costoUnitario: string;
  cantidadRecibida: number;
}

const aBorrador = (it: CompraItem): LineaBorrador => ({
  id: it.id,
  productId: it.productId,
  variante: it.variante,
  descripcion: it.descripcion,
  cantidad: String(it.cantidad),
  costoUnitario: it.costoUnitario === null ? '' : String(it.costoUnitario),
  cantidadRecibida: it.cantidadRecibida,
});

const lineaNueva = (): LineaBorrador => ({
  id: idTemporal(),
  productId: null,
  variante: null,
  descripcion: '',
  cantidad: '1',
  costoUnitario: '',
  cantidadRecibida: 0,
});

/**
 * Sublimación: la prenda del encargo sale del catálogo (y entonces hay grilla de
 * talles y la recepción suma stock) o se escribe a mano cuando todavía no existe
 * como producto. Es UNA prenda por trabajo: así se le encarga a un taller.
 */
type ModoPrenda = 'catalogo' | 'libre';

const modoInicial = (c: Compra): ModoPrenda => {
  if (c.items.some(it => it.productId)) return 'catalogo';
  if (c.prendaBase.trim() !== '' || c.items.length > 0) return 'libre';
  return 'catalogo';
};

const prendaInicial = (c: Compra): string | null =>
  c.items.find(it => it.productId)?.productId ?? null;

/**
 * No hay columna de total en `compras`: el costo del trabajo se guarda repartido
 * en el costo por prenda de cada línea, así que al abrir se rearma sumando.
 */
const costoInicial = (c: Compra): string => {
  const total = c.items.reduce((s, it) => s + (it.costoUnitario ?? 0) * it.cantidad, 0);
  return total > 0 ? String(Number(total.toFixed(2))) : '';
};

function PedidoModal({ compra, products, onClose, onGuardado }: {
  compra: Compra;
  products: Product[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const esNuevo = compra.id === '';
  const [cab, setCab] = useState<Compra>(compra);
  const [lineas, setLineas] = useState<LineaBorrador[]>(() => compra.items.map(aBorrador));
  const [guardando, setGuardando] = useState(false);
  const [subiendoMockup, setSubiendoMockup] = useState(false);
  const [subiendoArchivos, setSubiendoArchivos] = useState(false);

  // Estado propio del encargo al taller (la rama de proveedor no lo mira).
  const [modoPrenda, setModoPrenda] = useState<ModoPrenda>(() => modoInicial(compra));
  const [prendaId, setPrendaId] = useState<string | null>(() => prendaInicial(compra));
  const [cambiandoPrenda, setCambiandoPrenda] = useState(false);
  const [costoTrabajo, setCostoTrabajo] = useState<string>(() => costoInicial(compra));

  const ocupado = guardando || subiendoMockup || subiendoArchivos;
  const esSubli = cab.tipo === 'sublimacion';

  const productosOrdenados = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [products],
  );
  const productoPorId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const prenda = prendaId ? productoPorId.get(prendaId) : undefined;

  const setLinea = (id: string, cambios: Partial<LineaBorrador>) =>
    setLineas(ls => ls.map(l => (l.id === id ? { ...l, ...cambios } : l)));

  /** Cambiar de producto invalida la variante elegida: las claves son de ese producto. */
  const cambiarProducto = (linea: LineaBorrador, productId: string) => {
    const producto = productId ? productoPorId.get(productId) : undefined;
    const variantes = variantesDe(producto);
    setLinea(linea.id, {
      productId: productId || null,
      // Si el producto tiene una sola variante no hace falta que la elijan a mano.
      variante: variantes.length === 1 ? variantes[0].key : null,
      descripcion: linea.descripcion.trim() === '' && producto ? producto.name : linea.descripcion,
    });
  };

  // ── Bloque 1: la prenda del encargo ──

  /** La grilla de talles es del producto elegido: si cambia la prenda, se vacía. */
  const elegirPrendaCatalogo = (p: Product) => {
    if (prendaId !== null && p.id !== prendaId) {
      const perdidas = lineas.filter(l => l.productId === prendaId).length;
      const viejo = prendaId;
      setLineas(ls => ls.filter(l => l.productId !== viejo));
      if (perdidas > 0) {
        toast(`Cambiaste la prenda: se vaciaron ${perdidas} ${perdidas === 1 ? 'talle cargado' : 'talles cargados'}.`);
      }
    }
    setPrendaId(p.id);
    setModoPrenda('catalogo');
    setCambiandoPrenda(false);
    setCab(c => ({ ...c, prendaBase: p.name }));
  };

  const usarPrendaLibre = () => {
    setModoPrenda('libre');
    setPrendaId(null);
    setCambiandoPrenda(false);
    // Las filas del catálogo eran talles de un producto que ya no es la prenda.
    setLineas(ls => ls.filter(l => !l.productId));
  };

  const volverAlCatalogo = () => {
    setModoPrenda('catalogo');
    setCambiandoPrenda(true);
  };

  // ── Bloque 3: cantidades por talle ──

  /**
   * Una fila de la grilla escribe sobre la línea de esa variante: la crea cuando
   * se carga la primera cantidad y la deja en cero (no la borra) para no perder
   * lo ya recibido si estaban editando un trabajo a medio recibir.
   */
  const setCantidadVariante = (variante: string | null, valor: string) => {
    if (!prendaId) return;
    const nombre = prenda?.name ?? '';
    setLineas(ls => {
      const i = ls.findIndex(l => l.productId === prendaId && l.variante === variante);
      if (i >= 0) {
        const copia = [...ls];
        copia[i] = { ...copia[i], cantidad: valor };
        return copia;
      }
      if (valor.trim() === '') return ls;
      return [...ls, {
        id: idTemporal(),
        productId: prendaId,
        variante,
        descripcion: nombre,
        cantidad: valor,
        costoUnitario: '',
        cantidadRecibida: 0,
      }];
    });
  };

  // ── Bloque 2: subidas ──

  const subirMockupArchivo = async (file: File) => {
    setSubiendoMockup(true);
    try {
      const url = await SupabaseService.uploadImage(file, 'sublimacion');
      if (!url) { toast.error('No se pudo subir el mockup. Probá de nuevo.'); return; }
      setCab(c => ({ ...c, mockupUrl: url }));
    } finally {
      setSubiendoMockup(false);
    }
  };

  const subirFotosReferencia = async (files: File[]) => {
    if (files.length === 0) return;
    setSubiendoArchivos(true);
    try {
      // De a una a propósito: en paralelo con datos del celular se traba la subida
      // y no se sabe cuál falló. Así se acumula lo que sí entró.
      const nuevos: CompraArchivo[] = [];
      let fallaron = 0;
      for (const file of files) {
        const url = await SupabaseService.uploadImage(file, 'sublimacion');
        if (url) nuevos.push({ nombre: file.name, url });
        else fallaron++;
      }
      if (nuevos.length > 0) setCab(c => ({ ...c, archivos: [...c.archivos, ...nuevos] }));
      if (fallaron > 0) {
        toast.error(`${fallaron} ${fallaron === 1 ? 'foto no se pudo subir' : 'fotos no se pudieron subir'}`);
      } else if (nuevos.length > 0) {
        toast.success(`${nuevos.length} ${nuevos.length === 1 ? 'foto agregada' : 'fotos agregadas'}`);
      }
    } finally {
      setSubiendoArchivos(false);
    }
  };

  // ── Guardado ──

  const totalUnidades = lineas.reduce((s, l) => s + aEntero(l.cantidad), 0);
  const sinStock = lineas.filter(l => !sumaStock(l)).length;
  const sinStockConCantidad = lineas.filter(l => aEntero(l.cantidad) > 0 && !sumaStock(l)).length;

  /** Lo que va a quedar por prenda si dejan cargado el costo del trabajo. */
  const costoPorPrendaPreview = (() => {
    const n = Number(costoTrabajo.trim().replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || totalUnidades <= 0) return null;
    return Math.round((n / totalUnidades) * 100) / 100;
  })();

  /** Encargo al taller: los talles en cero no viajan y el costo se reparte por prenda. */
  const itemsDeSublimacion = (prendaBaseFinal: string): CompraItem[] | null => {
    const armadas: { linea: LineaBorrador; descripcion: string; cantidad: number }[] = [];
    let totalPrendas = 0;

    for (const l of lineas) {
      const producto = l.productId ? productoPorId.get(l.productId) : undefined;
      const descripcion = l.descripcion.trim() || producto?.name || prendaBaseFinal;
      const comoSeLlama = l.variante ? `${descripcion} · ${formatVariante(l.variante)}` : descripcion;
      const txt = l.cantidad.trim();
      const cantidad = txt === '' ? 0 : Math.floor(Number(txt));
      if (!Number.isFinite(cantidad) || cantidad < 0) {
        toast.error(`Revisá la cantidad de «${comoSeLlama}»: tiene que ser un número entero`);
        return null;
      }
      // Bajar por debajo de lo recibido dejaría el cotejo mintiendo.
      if (cantidad < l.cantidadRecibida) {
        toast.error(`De «${comoSeLlama}» ya llegaron ${l.cantidadRecibida}: no podés encargar menos que eso`);
        return null;
      }
      if (cantidad === 0) continue;
      totalPrendas += cantidad;
      armadas.push({ linea: l, descripcion, cantidad });
    }

    const costoTxt = costoTrabajo.trim().replace(',', '.');
    let costoPorPrenda: number | null = null;
    if (costoTxt !== '') {
      const total = Number(costoTxt);
      if (!Number.isFinite(total) || total < 0) {
        toast.error('Revisá el costo del trabajo: tiene que ser un número');
        return null;
      }
      // Se reparte parejo entre las prendas del encargo (ver `costoInicial`).
      costoPorPrenda = totalPrendas > 0 ? Math.round((total / totalPrendas) * 100) / 100 : null;
    }

    return armadas.map((a, i) => ({
      id: a.linea.id,
      compraId: cab.id,
      productId: a.linea.productId,
      descripcion: a.descripcion,
      variante: a.linea.variante,
      cantidad: a.cantidad,
      cantidadRecibida: a.linea.cantidadRecibida,
      costoUnitario: costoPorPrenda,
      orden: i,
    }));
  };

  /** Pedido a proveedor: renglón por renglón, con su costo unitario. Igual que siempre. */
  const itemsDeProveedor = (): CompraItem[] | null => {
    const items: CompraItem[] = [];
    for (const l of lineas) {
      const producto = l.productId ? productoPorId.get(l.productId) : undefined;
      const descripcion = l.descripcion.trim() || producto?.name || '';
      if (descripcion === '') {
        toast.error('Hay una línea sin descripción: poné qué es o elegí un producto');
        return null;
      }
      const cantidad = Math.floor(Number(l.cantidad));
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        toast.error(`Revisá la cantidad de «${descripcion}»: tiene que ser un número mayor a cero`);
        return null;
      }
      const costoTxt = l.costoUnitario.trim().replace(',', '.');
      const costo = costoTxt === '' ? null : Number(costoTxt);
      if (costo !== null && (!Number.isFinite(costo) || costo < 0)) {
        toast.error(`Revisá el costo de «${descripcion}»`);
        return null;
      }
      items.push({
        id: l.id,
        compraId: cab.id,
        productId: l.productId,
        descripcion,
        variante: l.variante,
        cantidad,
        cantidadRecibida: l.cantidadRecibida,
        costoUnitario: costo,
        orden: items.length,
      });
    }
    return items;
  };

  const guardar = async () => {
    if (ocupado) return;

    const proveedor = cab.proveedor.trim();
    if (proveedor === '') {
      toast.error(esSubli ? 'Poné a qué taller le encargás el trabajo' : 'Poné el proveedor');
      return;
    }

    let prendaBaseFinal = '';
    if (esSubli) {
      // Si el producto se borró del catálogo queda el nombre guardado: no se pierde.
      prendaBaseFinal = (modoPrenda === 'catalogo' ? prenda?.name ?? cab.prendaBase : cab.prendaBase).trim();
      if (prendaBaseFinal === '') {
        toast.error('Elegí la prenda del catálogo o escribí cuál es');
        return;
      }
    }

    const items = esSubli ? itemsDeSublimacion(prendaBaseFinal) : itemsDeProveedor();
    if (items === null) return;

    setGuardando(true);
    try {
      const r = await SupabaseService.saveCompra({
        ...cab,
        proveedor,
        referencia: cab.referencia.trim(),
        // Los campos de sublimación no viajan si el pedido es de proveedor: así no
        // quedan mockups colgados de un pedido que dejó de ser sublimación.
        prendaBase: esSubli ? prendaBaseFinal : '',
        comentarioTaller: esSubli ? cab.comentarioTaller.trim() : '',
        mockupUrl: esSubli ? cab.mockupUrl : '',
        archivos: esSubli ? cab.archivos : [],
        items,
      });
      if (!r.ok) { toast.error(r.error || 'No se pudo guardar el pedido'); return; }
      if (esSubli) toast.success(esNuevo ? 'Encargo creado ✓' : 'Encargo guardado ✓');
      else toast.success(esNuevo ? 'Pedido creado ✓' : 'Pedido guardado ✓');
      onGuardado();
    } finally {
      setGuardando(false);
    }
  };

  // Compartido por las dos ramas; en sublimación vive dentro de la tarjeta de datos.
  const selectorTipo = (
    <div>
      <span className={labelClass}>Tipo</span>
      <div className="flex flex-wrap gap-2">
        {(['proveedor', 'sublimacion'] as CompraTipo[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setCab(c => ({ ...c, tipo: t }))}
            className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 font-display text-sm font-bold transition-colors ${
              cab.tipo === t
                ? 'border-lime-400 bg-lime-50 text-navy-700'
                : 'border-gray-200 bg-white text-gray-500 hover:text-navy-700'
            }`}
          >
            {t === 'sublimacion' ? <Shirt size={15} /> : <Truck size={15} />}
            {t === 'sublimacion' ? 'Sublimación' : 'Proveedor'}
          </button>
        ))}
      </div>
    </div>
  );

  const chipsEstado = (
    <div>
      <span className={labelClass}>Estado</span>
      <div className="flex flex-wrap gap-2">
        {ESTADOS.map(e => (
          <button
            key={e.id}
            type="button"
            onClick={() => setCab(c => ({ ...c, estado: e.id }))}
            className={`rounded-full px-3.5 py-1.5 font-display text-xs font-bold transition-colors ${
              cab.estado === e.id ? 'bg-navy-700 text-white' : `${e.chip} hover:opacity-80`
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>
      {cab.estado === 'recibido' && (
        <p className="mt-1.5 text-[11px] text-amber-600">
          Marcar «recibido» a mano no toca el stock: para que entre la mercadería usá el botón «Recibir» de la lista.
        </p>
      )}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !ocupado && onClose()} />
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4">
          <div className="min-w-0">
            <h3 className="truncate font-display text-lg font-bold text-navy-700">
              {esSubli
                ? (esNuevo ? 'Nuevo encargo al taller' : 'Editar el encargo')
                : (esNuevo ? 'Nuevo pedido' : 'Editar pedido')}
            </h3>
            {esSubli && (
              <p className="truncate text-xs text-gray-400">Qué prenda, cómo tiene que quedar y cuántas.</p>
            )}
          </div>
          <button onClick={onClose} disabled={ocupado} aria-label="Cerrar" className="flex-shrink-0 text-gray-400 hover:text-navy-700 disabled:opacity-40">✕</button>
        </div>

        {esSubli ? (
          /* ── Encargo al taller: tres pasos, no un renglonario de compra ── */
          <div className="flex-1 space-y-4 overflow-y-auto bg-gray-50 p-3 sm:p-4">
            <section className="space-y-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              {selectorTipo}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="ped-proveedor">Taller / quién lo hace</label>
                  <input
                    id="ped-proveedor"
                    type="text"
                    value={cab.proveedor}
                    onChange={e => setCab(c => ({ ...c, proveedor: e.target.value }))}
                    placeholder="Ej: Sublimados Rivera"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="ped-referencia">Nombre del trabajo</label>
                  <input
                    id="ped-referencia"
                    type="text"
                    value={cab.referencia}
                    onChange={e => setCab(c => ({ ...c, referencia: e.target.value }))}
                    placeholder="Ej: Club Carrasco · torneo de octubre"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="ped-fecha">Cuándo lo encargamos</label>
                  <input
                    id="ped-fecha"
                    type="date"
                    value={cab.fechaPedido ?? ''}
                    onChange={e => setCab(c => ({ ...c, fechaPedido: e.target.value || null }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="ped-estimada">Para cuándo lo necesitamos</label>
                  <input
                    id="ped-estimada"
                    type="date"
                    value={cab.fechaEstimada ?? ''}
                    onChange={e => setCab(c => ({ ...c, fechaEstimada: e.target.value || null }))}
                    className={inputClass}
                  />
                </div>
              </div>

              {chipsEstado}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="ped-costo">Costo del trabajo (opcional)</label>
                  <input
                    id="ped-costo"
                    type="text"
                    inputMode="decimal"
                    value={costoTrabajo}
                    onChange={e => setCostoTrabajo(e.target.value)}
                    placeholder="Total que cobra el taller"
                    className={`${inputClass} tabular-nums`}
                  />
                  {costoPorPrendaPreview !== null && (
                    <p className="mt-1 text-[11px] text-gray-400">
                      Se reparte solo: ≈ ${costoPorPrendaPreview} por prenda.
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelClass} htmlFor="ped-notas">Notas del trabajo</label>
                  <textarea
                    id="ped-notas"
                    rows={2}
                    value={cab.notas}
                    onChange={e => setCab(c => ({ ...c, notas: e.target.value }))}
                    placeholder="Lo que haga falta recordar (el taller también las ve)"
                    className={inputClass}
                  />
                </div>
              </div>
            </section>

            <PasoEncargo numero={1} titulo="¿Qué prenda?" ayuda="La prenda base sobre la que va a sublimar el taller.">
              <PasoPrenda
                productos={productosOrdenados}
                prenda={prenda}
                modo={modoPrenda}
                prendaBase={cab.prendaBase}
                eligiendo={cambiandoPrenda}
                onElegir={elegirPrendaCatalogo}
                onPrendaLibre={usarPrendaLibre}
                onVolverAlCatalogo={volverAlCatalogo}
                onCancelarCambio={() => setCambiandoPrenda(false)}
                onPrendaBase={txt => setCab(c => ({ ...c, prendaBase: txt }))}
              />
            </PasoEncargo>

            <PasoEncargo
              numero={2}
              titulo="¿Cómo tiene que quedar?"
              ayuda="El mockup, las fotos de referencia y las indicaciones que va a leer el taller."
            >
              <PasoMockup
                mockupUrl={cab.mockupUrl}
                archivos={cab.archivos}
                comentario={cab.comentarioTaller}
                subiendoMockup={subiendoMockup}
                subiendoArchivos={subiendoArchivos}
                onMockup={file => void subirMockupArchivo(file)}
                onQuitarMockup={() => setCab(c => ({ ...c, mockupUrl: '' }))}
                onFotos={files => void subirFotosReferencia(files)}
                onQuitarFoto={i => setCab(c => ({ ...c, archivos: c.archivos.filter((_, j) => j !== i) }))}
                onComentario={txt => setCab(c => ({ ...c, comentarioTaller: txt }))}
              />
            </PasoEncargo>

            <PasoEncargo
              numero={3}
              titulo="¿Cuántas y de qué talle?"
              ayuda="Cargá solo los talles que van: los que queden en cero no se le piden al taller."
            >
              <PasoCantidades
                modo={modoPrenda}
                prenda={prenda}
                prendaBase={cab.prendaBase}
                lineas={lineas}
                productoPorId={productoPorId}
                total={totalUnidades}
                sinStock={sinStockConCantidad}
                onCantidadVariante={setCantidadVariante}
                onCambiarLinea={setLinea}
                onAgregarLinea={() => setLineas(ls => [...ls, lineaNueva()])}
                onQuitarLinea={id => setLineas(ls => ls.filter(l => l.id !== id))}
              />
            </PasoEncargo>
          </div>
        ) : (
          /* ── Pedido a proveedor: igual que siempre, renglón por renglón ── */
          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {selectorTipo}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="ped-proveedor">Proveedor</label>
                <input
                  id="ped-proveedor"
                  type="text"
                  value={cab.proveedor}
                  onChange={e => setCab(c => ({ ...c, proveedor: e.target.value }))}
                  placeholder="Ej: Textil del Este"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="ped-referencia">Referencia</label>
                <input
                  id="ped-referencia"
                  type="text"
                  value={cab.referencia}
                  onChange={e => setCab(c => ({ ...c, referencia: e.target.value }))}
                  placeholder="Nº de orden, factura, nombre del equipo…"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="ped-fecha">Fecha del pedido</label>
                <input
                  id="ped-fecha"
                  type="date"
                  value={cab.fechaPedido ?? ''}
                  onChange={e => setCab(c => ({ ...c, fechaPedido: e.target.value || null }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="ped-estimada">Fecha estimada de llegada</label>
                <input
                  id="ped-estimada"
                  type="date"
                  value={cab.fechaEstimada ?? ''}
                  onChange={e => setCab(c => ({ ...c, fechaEstimada: e.target.value || null }))}
                  className={inputClass}
                />
              </div>
            </div>

            {chipsEstado}

            <div>
              <label className={labelClass} htmlFor="ped-notas">Notas</label>
              <textarea
                id="ped-notas"
                rows={2}
                value={cab.notas}
                onChange={e => setCab(c => ({ ...c, notas: e.target.value }))}
                placeholder="Lo que haga falta recordar de este pedido"
                className={inputClass}
              />
            </div>

            {/* Líneas del pedido */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-xs font-bold uppercase tracking-wide text-gray-500">
                  Líneas del pedido{lineas.length > 0 && ` · ${totalUnidades} ${totalUnidades === 1 ? 'unidad' : 'unidades'}`}
                </span>
                <button
                  type="button"
                  onClick={() => setLineas(ls => [...ls, lineaNueva()])}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 font-display text-xs font-bold text-navy-700 transition-colors hover:bg-gray-50"
                >
                  <Plus size={14} /> Agregar línea
                </button>
              </div>

              {lineas.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 py-6 text-center">
                  <p className="text-sm text-gray-400">Todavía no hay líneas. Agregá lo que estás pidiendo.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lineas.map((l, i) => {
                    const producto = l.productId ? productoPorId.get(l.productId) : undefined;
                    const variantes = variantesDe(producto);
                    return (
                      <div key={l.id} className="rounded-xl border border-gray-100 bg-white p-2.5">
                        <div className="flex items-start gap-2">
                          <span className="mt-2.5 w-4 flex-shrink-0 text-center text-[11px] font-bold text-gray-300">{i + 1}</span>
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <select
                                value={l.productId ?? ''}
                                onChange={e => cambiarProducto(l, e.target.value)}
                                aria-label={`Producto de la línea ${i + 1}`}
                                className={inputClass}
                              >
                                <option value="">Sin producto del catálogo</option>
                                {productosOrdenados.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                              <select
                                value={l.variante ?? ''}
                                onChange={e => setLinea(l.id, { variante: e.target.value || null })}
                                disabled={!producto || variantes.length === 0}
                                aria-label={`Variante de la línea ${i + 1}`}
                                className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-400`}
                              >
                                <option value="">
                                  {!producto
                                    ? 'Elegí primero un producto'
                                    : variantes.length === 0
                                      ? 'Este producto no tiene variantes'
                                      : 'Sin variante'}
                                </option>
                                {variantes.map(v => (
                                  <option key={v.key} value={v.key}>{v.label} — stock {v.stock}</option>
                                ))}
                              </select>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <input
                                type="text"
                                value={l.descripcion}
                                onChange={e => setLinea(l.id, { descripcion: e.target.value })}
                                placeholder={producto ? producto.name : 'Qué es (ej: remeras negras M)'}
                                aria-label={`Descripción de la línea ${i + 1}`}
                                className={`${inputClass} min-w-[10rem] flex-1`}
                              />
                              <input
                                type="number"
                                min={1}
                                inputMode="numeric"
                                value={l.cantidad}
                                onChange={e => setLinea(l.id, { cantidad: e.target.value })}
                                placeholder="Cant."
                                aria-label={`Cantidad de la línea ${i + 1}`}
                                className={`${inputClass} w-24 text-center tabular-nums`}
                              />
                              <input
                                type="text"
                                inputMode="decimal"
                                value={l.costoUnitario}
                                onChange={e => setLinea(l.id, { costoUnitario: e.target.value })}
                                placeholder="$ c/u"
                                aria-label={`Costo unitario de la línea ${i + 1}`}
                                className={`${inputClass} w-28 text-center tabular-nums`}
                              />
                            </div>

                            {!sumaStock(l) && (
                              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600">
                                <AlertTriangle size={12} className="flex-shrink-0" />
                                {l.productId
                                  ? 'Sin variante elegida: al recibir no va a sumar stock.'
                                  : 'Línea suelta: al recibir no va a sumar stock.'}
                              </p>
                            )}
                            {l.cantidadRecibida > 0 && (
                              <p className="text-[11px] text-gray-400">
                                Ya se recibieron {l.cantidadRecibida} de esta línea.
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setLineas(ls => ls.filter(x => x.id !== l.id))}
                            title="Quitar línea"
                            aria-label={`Quitar la línea ${i + 1}`}
                            className="mt-1 flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {sinStock > 0 && lineas.length > 0 && (
                <p className="mt-2 text-[11px] text-gray-400">
                  {sinStock} de {lineas.length} {sinStock === 1 ? 'línea no va a sumar stock' : 'líneas no van a sumar stock'}:
                  vinculá producto y variante en las que sí tengan que entrar al inventario.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-3 border-t border-gray-100 p-4">
          <button type="button" onClick={onClose} disabled={ocupado} className={`flex-1 ${btnSecundario}`}>
            Cancelar
          </button>
          <button type="button" onClick={() => void guardar()} disabled={ocupado} className={`flex-1 ${btnPrimario}`}>
            {guardando
              ? 'Guardando…'
              : subiendoMockup || subiendoArchivos
                ? 'Esperá la subida…'
                : esSubli
                  ? (esNuevo ? 'Crear el encargo' : 'Guardar el encargo')
                  : (esNuevo ? 'Crear pedido' : 'Guardar cambios')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Los tres pasos del encargo al taller ────────────────────────────────────

/** Tarjeta numerada: cada paso es una pregunta, no un grupo de campos. */
function PasoEncargo({ numero, titulo, ayuda, children }: {
  numero: number;
  titulo: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <header className="flex items-start gap-3 border-b border-gray-100 px-4 py-3">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-navy-700 font-display text-xs font-bold text-lime-400"
        >
          {numero}
        </span>
        <div className="min-w-0">
          <h4 className="font-display text-base font-bold text-navy-700">{titulo}</h4>
          {ayuda && <p className="mt-0.5 text-xs leading-snug text-gray-400">{ayuda}</p>}
        </div>
      </header>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

/**
 * Paso 1: qué prenda. Del catálogo (y entonces hay foto, talles y stock) o
 * escrita a mano cuando el taller va a trabajar sobre algo que todavía no vendemos.
 */
function PasoPrenda({
  productos, prenda, modo, prendaBase, eligiendo,
  onElegir, onPrendaLibre, onVolverAlCatalogo, onCancelarCambio, onPrendaBase,
}: {
  productos: Product[];
  prenda: Product | undefined;
  modo: ModoPrenda;
  prendaBase: string;
  /** true = mostrar el buscador aunque ya haya una prenda elegida. */
  eligiendo: boolean;
  onElegir: (p: Product) => void;
  onPrendaLibre: () => void;
  onVolverAlCatalogo: () => void;
  onCancelarCambio: () => void;
  onPrendaBase: (txt: string) => void;
}) {
  const [busca, setBusca] = useState('');

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q === '') return productos;
    return productos.filter(p =>
      p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q));
  }, [productos, busca]);

  if (modo === 'libre') {
    return (
      <div className="space-y-3">
        <div>
          <label className={labelClass} htmlFor="subli-prenda-libre">¿Qué prenda es?</label>
          <input
            id="subli-prenda-libre"
            type="text"
            value={prendaBase}
            onChange={e => onPrendaBase(e.target.value)}
            placeholder="Ej: remera dry-fit blanca, cuello redondo"
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Tal cual se la vas a nombrar al taller. Como no sale del catálogo, al recibirla no suma stock.
          </p>
        </div>
        <button
          type="button"
          onClick={onVolverAlCatalogo}
          className="flex items-center gap-1.5 font-display text-xs font-bold text-navy-700 underline underline-offset-2 hover:text-navy-500"
        >
          <Search size={13} /> Mejor buscarla en el catálogo
        </button>
      </div>
    );
  }

  if (prenda && !eligiendo) {
    const talles = variantesDe(prenda).length;
    return (
      <div className="flex items-center gap-3 rounded-xl border border-lime-300 bg-lime-50/60 p-3">
        <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {prenda.images?.[0] ? (
            <img src={prenda.images[0]} alt={prenda.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-300">
              <Shirt size={26} strokeWidth={1.5} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[10px] font-bold uppercase tracking-wide text-lime-700">Prenda del catálogo</p>
          <p className="truncate font-display text-base font-bold text-navy-700">{prenda.name}</p>
          <p className="text-xs text-gray-500">
            {talles === 0 ? 'sin talles cargados' : `${talles} ${talles === 1 ? 'talle' : 'talles'} para elegir abajo`}
          </p>
        </div>
        <button
          type="button"
          onClick={onVolverAlCatalogo}
          className="flex-shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 font-display text-xs font-bold text-navy-700 transition-colors hover:bg-gray-50"
        >
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscá la prenda por nombre…"
          aria-label="Buscar prenda en el catálogo"
          className={`${inputClass} pl-9`}
        />
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-6 text-center">
          <p className="text-sm text-gray-400">
            {productos.length === 0 ? 'Todavía no hay productos en el catálogo.' : 'Ninguna prenda con ese nombre.'}
          </p>
        </div>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {filtrados.map(p => {
            const talles = variantesDe(p).length;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onElegir(p)}
                className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                  prenda?.id === p.id
                    ? 'border-lime-400 bg-lime-50'
                    : 'border-gray-100 bg-white hover:border-lime-300 hover:bg-lime-50/50'
                }`}
              >
                <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
                  {p.images?.[0] ? (
                    <img src={p.images[0]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-gray-300">
                      <Shirt size={18} strokeWidth={1.5} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-bold text-navy-700">{p.name}</p>
                  <p className="text-[11px] text-gray-400">
                    {talles === 0 ? 'sin talles cargados' : `${talles} ${talles === 1 ? 'talle' : 'talles'}`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-3">
        <button
          type="button"
          onClick={onPrendaLibre}
          className="font-display text-xs font-bold text-navy-700 underline underline-offset-2 hover:text-navy-500"
        >
          Es una prenda que no está en el catálogo
        </button>
        {prenda && (
          <button
            type="button"
            onClick={onCancelarCambio}
            className="font-display text-xs font-semibold text-gray-400 hover:text-navy-700"
          >
            Dejar «{prenda.name}»
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Paso 2: el corazón del encargo. El mockup es lo primero que abre el taller,
 * así que va grande y con drag & drop; las fotos de referencia son el respaldo.
 */
function PasoMockup({
  mockupUrl, archivos, comentario, subiendoMockup, subiendoArchivos,
  onMockup, onQuitarMockup, onFotos, onQuitarFoto, onComentario,
}: {
  mockupUrl: string;
  archivos: CompraArchivo[];
  comentario: string;
  subiendoMockup: boolean;
  subiendoArchivos: boolean;
  onMockup: (file: File) => void;
  onQuitarMockup: () => void;
  onFotos: (files: File[]) => void;
  onQuitarFoto: (indice: number) => void;
  onComentario: (txt: string) => void;
}) {
  const [arrastrando, setArrastrando] = useState(false);

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setArrastrando(false);
    if (subiendoMockup) return;
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (!file) { toast.error('Arrastrá una imagen (JPG o PNG)'); return; }
    onMockup(file);
  };

  const elegirMockup = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onMockup(file);
  };

  const elegirFotos = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    onFotos(files);
  };

  return (
    <div className="space-y-5">
      {/* Mockup final */}
      <div>
        <span className={labelClass}>Mockup final</span>
        <div
          onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={soltar}
        >
          {mockupUrl ? (
            <div className={`overflow-hidden rounded-xl border-2 ${arrastrando ? 'border-dashed border-lime-400' : 'border-gray-200'} bg-gray-50`}>
              <a href={mockupUrl} target="_blank" rel="noreferrer" title="Abrir el mockup en grande">
                <img
                  src={mockupUrl}
                  alt="Mockup final del trabajo"
                  className="mx-auto max-h-72 w-full bg-white object-contain"
                />
              </a>
            </div>
          ) : (
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
                arrastrando ? 'border-lime-400 bg-lime-50' : 'border-gray-300 bg-gray-50 hover:border-lime-300 hover:bg-lime-50/40'
              } ${subiendoMockup ? 'pointer-events-none opacity-60' : ''}`}
            >
              {subiendoMockup
                ? <Loader2 size={30} className="animate-spin text-navy-700" />
                : <ImagePlus size={30} strokeWidth={1.5} className="text-gray-400" />}
              <span className="font-display text-sm font-bold text-navy-700">
                {subiendoMockup ? 'Subiendo el mockup…' : 'Arrastrá el mockup acá'}
              </span>
              <span className="text-xs text-gray-400">o tocá para elegirlo del dispositivo</span>
              <input type="file" accept="image/*" className="hidden" onChange={elegirMockup} disabled={subiendoMockup} />
            </label>
          )}
        </div>

        {mockupUrl && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className={`inline-flex cursor-pointer items-center gap-2 ${btnSecundario} ${subiendoMockup ? 'pointer-events-none opacity-50' : ''}`}>
              {subiendoMockup ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {subiendoMockup ? 'Subiendo…' : 'Reemplazar'}
              <input type="file" accept="image/*" className="hidden" onChange={elegirMockup} disabled={subiendoMockup} />
            </label>
            <button
              type="button"
              onClick={onQuitarMockup}
              disabled={subiendoMockup}
              className="rounded-lg px-2 py-2.5 font-display text-xs font-bold text-gray-400 transition-colors hover:text-red-500 disabled:opacity-40"
            >
              Quitar mockup
            </button>
          </div>
        )}

        {!mockupUrl && !subiendoMockup && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-700">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            Todavía no cargaste el mockup. Es lo primero que mira el taller: sin eso no sabe cómo tiene que quedar.
          </p>
        )}
      </div>

      {/* Fotos de referencia */}
      <div>
        <span className={labelClass}>Fotos de referencia (opcional)</span>
        {archivos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {archivos.map((a, i) => (
              <div key={`${a.url}-${i}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200 bg-white">
                <a href={a.url} target="_blank" rel="noreferrer" title={a.nombre} className="block h-full w-full">
                  <img src={a.url} alt={a.nombre} className="h-full w-full object-cover" />
                </a>
                <button
                  type="button"
                  onClick={() => onQuitarFoto(i)}
                  aria-label={`Quitar ${a.nombre}`}
                  className="absolute right-0.5 top-0.5 rounded-full bg-white/90 p-0.5 text-gray-500 shadow-sm hover:text-red-500"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className={`inline-flex cursor-pointer items-center gap-2 ${btnSecundario} ${subiendoArchivos ? 'pointer-events-none opacity-50' : ''}`}>
          {subiendoArchivos ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          {subiendoArchivos ? 'Subiendo…' : archivos.length > 0 ? 'Agregar más fotos' : 'Agregar fotos'}
          <input type="file" accept="image/*" multiple className="hidden" onChange={elegirFotos} disabled={subiendoArchivos} />
        </label>
        <p className="mt-1.5 text-[11px] text-gray-400">
          Detalles, colores, trabajos parecidos: todo lo que ayude a que salga como lo pensaste.
        </p>
      </div>

      {/* Instrucciones */}
      <div>
        <label className={labelClass} htmlFor="subli-instrucciones">Instrucciones para el taller</label>
        <textarea
          id="subli-instrucciones"
          rows={4}
          value={comentario}
          onChange={e => onComentario(e.target.value)}
          placeholder={'Ej: logo al pecho izquierdo, 8 cm de ancho. Verde exacto del mockup (#CCFF00). Nombres atrás en Lexend, arriba del número. Costura reforzada en las mangas.'}
          className={inputClass}
        />
      </div>
    </div>
  );
}

/**
 * Paso 3: cuántas prendas y de qué talle. Con producto del catálogo es una grilla
 * de talles (lo único que suma stock al recibir); si es prenda libre, filas sueltas.
 */
function PasoCantidades({
  modo, prenda, prendaBase, lineas, productoPorId, total, sinStock,
  onCantidadVariante, onCambiarLinea, onAgregarLinea, onQuitarLinea,
}: {
  modo: ModoPrenda;
  prenda: Product | undefined;
  prendaBase: string;
  lineas: LineaBorrador[];
  productoPorId: Map<string, Product>;
  total: number;
  /** Líneas con cantidad que no van a mover el inventario. */
  sinStock: number;
  onCantidadVariante: (variante: string | null, valor: string) => void;
  onCambiarLinea: (id: string, cambios: Partial<LineaBorrador>) => void;
  onAgregarLinea: () => void;
  onQuitarLinea: (id: string) => void;
}) {
  const enCatalogo = modo === 'catalogo' && prenda !== undefined;
  const variantes = prenda ? variantesDe(prenda) : [];

  const lineaDe = (variante: string | null): LineaBorrador | undefined =>
    lineas.find(l => l.productId === prenda?.id && l.variante === variante);

  const filasLibres = modo === 'libre' ? lineas.filter(l => !l.productId) : [];
  const idsPropios = new Set([
    ...(enCatalogo ? lineas.filter(l => l.productId === prenda?.id).map(l => l.id) : []),
    ...filasLibres.map(l => l.id),
  ]);
  // Restos de un trabajo armado con el formulario viejo (o al cambiar de tipo):
  // se muestran igual para no borrarlos sin que nadie los vea.
  const otras = lineas.filter(l => !idsPropios.has(l.id));

  const filaTalle = (clave: string | null, titulo: string, color: string, stock: number | null) => {
    const linea = lineaDe(clave);
    const valor = linea?.cantidad ?? '';
    const n = aEntero(valor);
    return (
      <div
        key={clave ?? '__unica__'}
        className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
          n > 0 ? 'border-lime-400 bg-lime-50/60' : 'border-gray-100 bg-white'
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold text-navy-700">
            {titulo}
            {color && <span className="ml-1.5 font-body text-xs font-normal text-gray-500">{color}</span>}
          </p>
          <p className="text-[11px] text-gray-400">
            {stock === null ? 'esta prenda no suma stock' : `en stock hoy: ${stock}`}
            {linea && linea.cantidadRecibida > 0 && ` · ya llegaron ${linea.cantidadRecibida}`}
          </p>
        </div>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={valor}
          onChange={e => onCantidadVariante(clave, e.target.value)}
          placeholder="0"
          aria-label={`Cantidad de ${titulo}${color ? ` ${color}` : ''}`}
          className={`w-16 flex-shrink-0 rounded-lg border px-2 py-2 text-center text-sm font-bold tabular-nums text-navy-700 outline-none focus:border-lime-400 sm:w-20 ${
            n > 0 ? 'border-lime-400 bg-white' : 'border-gray-200'
          }`}
        />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {enCatalogo ? (
        variantes.length === 0 ? (
          <>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-700">
              «{prenda?.name}» no tiene talles cargados en el catálogo. Podés encargar igual, pero al recibir
              no va a sumar stock hasta que le cargues los talles al producto.
            </p>
            {filaTalle(null, 'Cantidad total', '', null)}
          </>
        ) : (
          <div className="space-y-1.5">
            {variantes.map(v => {
              const { talle, color } = partesVariante(v.key);
              return filaTalle(v.key, talle, color, v.stock);
            })}
          </div>
        )
      ) : modo === 'libre' ? (
        <div className="space-y-2">
          {filasLibres.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 py-6 text-center">
              <p className="text-sm text-gray-400">Agregá una fila por cada talle o variante que le encargás.</p>
            </div>
          ) : (
            filasLibres.map((l, i) => (
              <div key={l.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white p-2">
                <input
                  type="text"
                  value={l.descripcion}
                  onChange={e => onCambiarLinea(l.id, { descripcion: e.target.value })}
                  placeholder={prendaBase ? `${prendaBase} — talle…` : 'Ej: remera blanca talle M'}
                  aria-label={`Qué prenda va en la fila ${i + 1}`}
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={l.cantidad}
                  onChange={e => onCambiarLinea(l.id, { cantidad: e.target.value })}
                  placeholder="0"
                  aria-label={`Cantidad de la fila ${i + 1}`}
                  className="w-16 flex-shrink-0 rounded-lg border border-gray-200 px-2 py-2.5 text-center text-sm font-bold tabular-nums text-navy-700 outline-none focus:border-lime-400 sm:w-20"
                />
                <button
                  type="button"
                  onClick={() => onQuitarLinea(l.id)}
                  title="Quitar fila"
                  aria-label={`Quitar la fila ${i + 1}`}
                  className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            onClick={onAgregarLinea}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 font-display text-xs font-bold text-navy-700 transition-colors hover:bg-gray-50"
          >
            <Plus size={14} /> Agregar fila
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 py-6 text-center">
          <Shirt size={26} strokeWidth={1.5} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-400">Elegí la prenda arriba y acá aparecen sus talles.</p>
        </div>
      )}

      {otras.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="mb-2 font-display text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Otras prendas ya cargadas en este trabajo
          </p>
          <div className="space-y-1.5">
            {otras.map(l => {
              const producto = l.productId ? productoPorId.get(l.productId) : undefined;
              const titulo = l.descripcion.trim() || producto?.name || 'Sin nombre';
              // El nombre del producto solo se repite si aporta algo distinto al título.
              const detalle: string[] = [];
              if (!l.productId) detalle.push('sin producto del catálogo');
              else if (producto && producto.name !== titulo) detalle.push(producto.name);
              if (l.variante) detalle.push(formatVariante(l.variante));
              if (l.cantidadRecibida > 0) detalle.push(`ya llegaron ${l.cantidadRecibida}`);
              return (
                <div key={l.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-bold text-navy-700">{titulo}</p>
                    {detalle.length > 0 && (
                      <p className="truncate text-[11px] text-gray-400">{detalle.join(' · ')}</p>
                    )}
                  </div>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={l.cantidad}
                    onChange={e => onCambiarLinea(l.id, { cantidad: e.target.value })}
                    aria-label={`Cantidad de ${titulo}`}
                    className="w-16 flex-shrink-0 rounded-lg border border-gray-200 px-2 py-2 text-center text-sm font-bold tabular-nums text-navy-700 outline-none focus:border-lime-400 sm:w-20"
                  />
                  <button
                    type="button"
                    onClick={() => onQuitarLinea(l.id)}
                    title="Quitar del trabajo"
                    aria-label={`Quitar ${titulo} del trabajo`}
                    className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 rounded-xl bg-navy-700 px-4 py-3">
        <span className="font-display text-xs font-bold uppercase tracking-wide text-white/70">
          Total de prendas
        </span>
        <span className="font-display text-3xl font-bold leading-none tabular-nums text-lime-400">{total}</span>
      </div>

      {total === 0 && (
        <p className="text-[11px] text-gray-400">
          Todavía no cargaste cantidades. Podés guardar el borrador igual y completarlas después.
        </p>
      )}

      {sinStock > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-600">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          {sinStock === 1
            ? 'Hay 1 fila que al recibir no va a sumar stock (no está atada a un talle del catálogo).'
            : `Hay ${sinStock} filas que al recibir no van a sumar stock (no están atadas a un talle del catálogo).`}
        </p>
      )}
    </div>
  );
}

// ─── Recepción (el cotejo que mueve el stock) ────────────────────────────────

function RecepcionModal({ compra, productoPorId, onClose, onRecibido }: {
  compra: Compra;
  productoPorId: Map<string, Product>;
  onClose: () => void;
  onRecibido: (r: { estado?: string; unidades?: number; pendientes?: number }) => void;
}) {
  // Precargado con lo pedido: el caso normal es que llegue todo y se confirme de una.
  const [cantidades, setCantidades] = useState<Record<string, string>>(() =>
    Object.fromEntries(compra.items.map(it => [it.id, String(it.cantidad)])),
  );
  const [guardando, setGuardando] = useState(false);

  const leer = (id: string): number => {
    const n = Math.floor(Number((cantidades[id] ?? '').trim()));
    return Number.isFinite(n) ? n : NaN;
  };

  const hayInvalidos = compra.items.some(it => {
    const n = leer(it.id);
    return !Number.isFinite(n) || n < 0;
  });

  /**
   * Lo que va a entrar al inventario: solo la diferencia contra lo ya recibido y
   * solo de las líneas vinculadas a una variante. Es la misma cuenta que hace la
   * RPC, mostrada antes de confirmar para que no haya sorpresas.
   */
  const aStock = compra.items.reduce((suma, it) => {
    if (!sumaStock(it)) return suma;
    const n = leer(it.id);
    if (!Number.isFinite(n)) return suma;
    return suma + Math.max(0, n - it.cantidadRecibida);
  }, 0);

  const quedanPendientes = compra.items.some(it => {
    const n = leer(it.id);
    return Number.isFinite(n) && n < it.cantidad;
  });

  const recibirTodo = () =>
    setCantidades(Object.fromEntries(compra.items.map(it => [it.id, String(it.cantidad)])));

  const confirmar = async () => {
    if (guardando || hayInvalidos) return;
    const items: RecepcionItem[] = compra.items.map(it => ({ itemId: it.id, recibida: leer(it.id) }));
    setGuardando(true);
    try {
      const r = await SupabaseService.recibirCompra(compra.id, items);
      if (!r.ok) { toast.error(r.error || 'No se pudo registrar la recepción'); return; }
      onRecibido(r);
    } finally {
      setGuardando(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !guardando && onClose()} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="min-w-0">
            <h3 className="truncate font-display text-lg font-bold text-navy-700">
              Recibir · {compra.proveedor || 'Sin proveedor'}
            </h3>
            <p className="text-xs text-gray-400">
              {TIPO_LABEL[compra.tipo]}
              {compra.referencia && ` · #${compra.referencia}`}
              {` · ${compra.items.length} ${compra.items.length === 1 ? 'línea' : 'líneas'}`}
            </p>
          </div>
          <button onClick={onClose} disabled={guardando} aria-label="Cerrar" className="text-gray-400 hover:text-navy-700 disabled:opacity-40">✕</button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-500">
              Cotejá lo que llegó de verdad. El número es el <b className="text-navy-700">total recibido</b> de cada línea.
            </p>
            <button
              type="button"
              onClick={recibirTodo}
              disabled={guardando}
              className="flex items-center gap-1.5 rounded-lg bg-navy-700 px-3 py-1.5 font-display text-xs font-bold text-white transition-colors hover:bg-navy-800 disabled:bg-gray-200 disabled:text-gray-400"
            >
              <CheckCheck size={14} /> Recibí todo
            </button>
          </div>

          <div className="space-y-2">
            {compra.items.map(it => {
              const producto = it.productId ? productoPorId.get(it.productId) : undefined;
              const n = leer(it.id);
              const invalido = !Number.isFinite(n) || n < 0;
              const deMas = Number.isFinite(n) && n > it.cantidad;
              return (
                <div key={it.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-bold text-navy-700">{it.descripcion}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
                      <span>pedidas {it.cantidad}</span>
                      {it.cantidadRecibida > 0 && <span>ya recibidas {it.cantidadRecibida}</span>}
                      {producto && <span className="text-gray-500">{producto.name}</span>}
                      {it.variante && <span className={`${badgeClass} bg-navy-50 text-navy-700`}>{formatVariante(it.variante)}</span>}
                      {!sumaStock(it) && (
                        <span className={`${badgeClass} bg-amber-50 text-amber-700`}>no suma stock</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <label htmlFor={`recep-${it.id}`} className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                      Llegó
                    </label>
                    <input
                      id={`recep-${it.id}`}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={cantidades[it.id] ?? ''}
                      onChange={e => setCantidades(c => ({ ...c, [it.id]: e.target.value }))}
                      disabled={guardando}
                      className={`w-24 rounded-lg border px-3 py-2 text-center text-sm font-bold tabular-nums text-navy-700 outline-none ${
                        invalido ? 'border-red-300' : deMas ? 'border-amber-300' : 'border-gray-200 focus:border-lime-400'
                      }`}
                    />
                  </div>
                  {deMas && (
                    <p className="w-full text-[11px] text-amber-600">Llegó más de lo pedido: se va a cargar igual.</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className={`rounded-xl border px-4 py-3 ${aStock > 0 ? 'border-lime-300 bg-lime-50' : 'border-gray-200 bg-gray-50'}`}>
            <p className="font-display text-sm font-bold text-navy-700">
              {aStock > 0
                ? `Van a entrar ${aStock} ${aStock === 1 ? 'unidad' : 'unidades'} al stock`
                : 'Esta recepción no suma stock'}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {aStock > 0
                ? 'Solo cuenta la diferencia contra lo ya recibido, y solo de las líneas con producto y variante.'
                : 'Ninguna línea tiene producto y variante, o ya estaba todo recibido.'}
            </p>
            {quedanPendientes && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                <AlertTriangle size={13} className="flex-shrink-0" />
                Falta mercadería: el pedido queda «en camino» con el saldo pendiente.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3 border-t border-gray-100 p-4">
          <button type="button" onClick={onClose} disabled={guardando} className={`flex-1 ${btnSecundario}`}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={guardando || hayInvalidos}
            className={`flex flex-1 items-center justify-center gap-2 ${btnPrimario}`}
          >
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
            {guardando ? 'Registrando…' : 'Confirmar recepción'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Confirmación de borrado ─────────────────────────────────────────────────

function ConfirmarBorrado({ compra, borrando, onCancelar, onConfirmar }: {
  compra: Compra;
  borrando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const { recibidas } = resumenItems(compra.items);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancelar} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="mb-2 font-display text-lg font-bold text-navy-700">¿Borrar este pedido?</h3>
        <p className="truncate text-sm font-semibold text-navy-700">
          {compra.proveedor || 'Sin proveedor'}{compra.referencia && ` · #${compra.referencia}`}
        </p>
        <p className="mb-6 mt-2 text-sm text-gray-500">
          Se borra el pedido con todas sus líneas y no se puede deshacer.
          {recibidas > 0 && ' El stock que ya entró queda como está: esto no lo descuenta.'}
        </p>
        <div className="flex gap-3">
          <button type="button" onClick={onCancelar} disabled={borrando} className={`flex-1 ${btnSecundario}`}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={borrando}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 font-display text-sm font-bold text-white transition-colors hover:bg-red-600 disabled:bg-gray-200 disabled:text-gray-400"
          >
            {borrando && <Loader2 size={15} className="animate-spin" />}
            {borrando ? 'Borrando…' : 'Borrar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
