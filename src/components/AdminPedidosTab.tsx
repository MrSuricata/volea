/**
 * Pestaña "Pedidos" del panel: pedidos a proveedores y trabajos de sublimación.
 * Es una sola entidad (cambia `tipo`) porque el flujo es el mismo: se pide, se
 * sigue, se recibe. Lo importante de verdad es el cotejo de recepción: es el
 * único lugar donde entra stock, y lo hace la RPC (acá no se toca stock a mano).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Package, PackageCheck, RefreshCw, Plus, Loader2, Info, Pencil, Trash2, Shirt, Truck,
  AlertTriangle, CheckCheck, ImageIcon, Upload, X,
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

  const ocupado = guardando || subiendoMockup || subiendoArchivos;
  const esSubli = cab.tipo === 'sublimacion';

  const productosOrdenados = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [products],
  );
  const productoPorId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

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

  const subirMockup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSubiendoMockup(true);
    try {
      const url = await SupabaseService.uploadImage(file, 'sublimacion');
      if (!url) { toast.error('No se pudo subir el mockup. Probá de nuevo.'); return; }
      setCab(c => ({ ...c, mockupUrl: url }));
    } finally {
      setSubiendoMockup(false);
    }
  };

  const subirArchivos = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
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

  const guardar = async () => {
    if (ocupado) return;

    const proveedor = cab.proveedor.trim();
    if (proveedor === '') {
      toast.error(esSubli ? 'Poné quién hace la sublimación' : 'Poné el proveedor');
      return;
    }

    const items: CompraItem[] = [];
    for (const l of lineas) {
      const producto = l.productId ? productoPorId.get(l.productId) : undefined;
      const descripcion = l.descripcion.trim() || producto?.name || '';
      if (descripcion === '') {
        toast.error('Hay una línea sin descripción: poné qué es o elegí un producto');
        return;
      }
      const cantidad = Math.floor(Number(l.cantidad));
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        toast.error(`Revisá la cantidad de «${descripcion}»: tiene que ser un número mayor a cero`);
        return;
      }
      const costoTxt = l.costoUnitario.trim().replace(',', '.');
      const costo = costoTxt === '' ? null : Number(costoTxt);
      if (costo !== null && (!Number.isFinite(costo) || costo < 0)) {
        toast.error(`Revisá el costo de «${descripcion}»`);
        return;
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

    setGuardando(true);
    try {
      const r = await SupabaseService.saveCompra({
        ...cab,
        proveedor,
        referencia: cab.referencia.trim(),
        // Los campos de sublimación no viajan si el pedido es de proveedor: así no
        // quedan mockups colgados de un pedido que dejó de ser sublimación.
        prendaBase: esSubli ? cab.prendaBase.trim() : '',
        comentarioTaller: esSubli ? cab.comentarioTaller.trim() : '',
        mockupUrl: esSubli ? cab.mockupUrl : '',
        archivos: esSubli ? cab.archivos : [],
        items,
      });
      if (!r.ok) { toast.error(r.error || 'No se pudo guardar el pedido'); return; }
      toast.success(esNuevo ? 'Pedido creado ✓' : 'Pedido guardado ✓');
      onGuardado();
    } finally {
      setGuardando(false);
    }
  };

  const totalUnidades = lineas.reduce((s, l) => s + (Math.floor(Number(l.cantidad)) || 0), 0);
  const sinStock = lineas.filter(l => !sumaStock(l)).length;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !ocupado && onClose()} />
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h3 className="font-display text-lg font-bold text-navy-700">
            {esNuevo ? (esSubli ? 'Nuevo trabajo de sublimación' : 'Nuevo pedido') : 'Editar pedido'}
          </h3>
          <button onClick={onClose} disabled={ocupado} aria-label="Cerrar" className="text-gray-400 hover:text-navy-700 disabled:opacity-40">✕</button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* Tipo */}
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

          {/* Cabecera */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="ped-proveedor">
                {esSubli ? 'Taller / quién lo hace' : 'Proveedor'}
              </label>
              <input
                id="ped-proveedor"
                type="text"
                value={cab.proveedor}
                onChange={e => setCab(c => ({ ...c, proveedor: e.target.value }))}
                placeholder={esSubli ? 'Ej: Sublimados Rivera' : 'Ej: Textil del Este'}
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

          {/* Bloque exclusivo de sublimación */}
          {esSubli && (
            <div className="space-y-3 rounded-xl border border-lime-200 bg-lime-50/40 p-3">
              <p className="flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wide text-navy-700">
                <Shirt size={14} /> Sublimación
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="ped-prenda">Prenda base</label>
                  <input
                    id="ped-prenda"
                    type="text"
                    value={cab.prendaBase}
                    onChange={e => setCab(c => ({ ...c, prendaBase: e.target.value }))}
                    placeholder="Ej: remera dry-fit blanca"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="ped-taller">Comentario para el taller</label>
                  <input
                    id="ped-taller"
                    type="text"
                    value={cab.comentarioTaller}
                    onChange={e => setCab(c => ({ ...c, comentarioTaller: e.target.value }))}
                    placeholder="Ej: logo al pecho 8 cm, nombres atrás"
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Mockup final: el campo que más se mira, por eso va grande */}
              <div>
                <span className={labelClass}>Mockup final</span>
                <div className="flex flex-wrap items-center gap-3">
                  {cab.mockupUrl ? (
                    <a
                      href={cab.mockupUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Abrir el mockup en grande"
                      className="block h-24 w-24 overflow-hidden rounded-xl border border-gray-200 bg-white"
                    >
                      <img src={cab.mockupUrl} alt="Mockup final" className="h-full w-full object-contain" />
                    </a>
                  ) : (
                    <div className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-300 bg-white text-gray-300">
                      <ImageIcon size={22} strokeWidth={1.5} />
                      <span className="text-[10px]">sin mockup</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <label className={`inline-flex cursor-pointer items-center gap-2 ${btnSecundario} ${subiendoMockup ? 'pointer-events-none opacity-50' : ''}`}>
                      {subiendoMockup ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                      {subiendoMockup ? 'Subiendo…' : cab.mockupUrl ? 'Cambiar mockup' : 'Subir mockup'}
                      <input type="file" accept="image/*" className="hidden" onChange={e => void subirMockup(e)} disabled={subiendoMockup} />
                    </label>
                    {cab.mockupUrl && (
                      <button
                        type="button"
                        onClick={() => setCab(c => ({ ...c, mockupUrl: '' }))}
                        disabled={subiendoMockup}
                        className="text-left text-xs text-gray-400 hover:text-red-500 disabled:opacity-40"
                      >
                        Quitar mockup
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Fotos adicionales */}
              <div>
                <span className={labelClass}>Fotos adicionales</span>
                {cab.archivos.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {cab.archivos.map((a, i) => (
                      <div key={`${a.url}-${i}`} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200 bg-white">
                        <a href={a.url} target="_blank" rel="noreferrer" title={a.nombre} className="block h-full w-full">
                          <img src={a.url} alt={a.nombre} className="h-full w-full object-cover" />
                        </a>
                        <button
                          type="button"
                          onClick={() => setCab(c => ({ ...c, archivos: c.archivos.filter((_, j) => j !== i) }))}
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
                  {subiendoArchivos ? 'Subiendo…' : 'Agregar fotos'}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={e => void subirArchivos(e)} disabled={subiendoArchivos} />
                </label>
              </div>
            </div>
          )}

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

        <div className="flex gap-3 border-t border-gray-100 p-4">
          <button type="button" onClick={onClose} disabled={ocupado} className={`flex-1 ${btnSecundario}`}>
            Cancelar
          </button>
          <button type="button" onClick={() => void guardar()} disabled={ocupado} className={`flex-1 ${btnPrimario}`}>
            {guardando ? 'Guardando…' : subiendoMockup || subiendoArchivos ? 'Esperá la subida…' : esNuevo ? 'Crear pedido' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
