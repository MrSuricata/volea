/**
 * Pestaña "Compras" del panel: compras a proveedores y trabajos de sublimación.
 * Es una sola entidad (cambia `tipo`) porque el flujo es el mismo: se pide, se
 * sigue, se recibe. Lo importante de verdad es el cotejo de recepción: es el
 * único lugar donde entra stock, y lo hace la RPC (acá no se toca stock a mano).
 * (El archivo conserva el nombre viejo "Pedidos"; los pedidos de clientes son otra pestaña.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import {
  Package, PackageCheck, RefreshCw, Plus, Loader2, Pencil, Trash2, Shirt, Truck,
  AlertTriangle, CheckCheck, Upload, X, Search, ImagePlus,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  Compra, CompraArchivo, CompraEstado, CompraItem, CompraTipo, Product, RecepcionItem,
} from '../types';
import { SupabaseService } from '../services/supabaseService';
import { cn } from '../lib/cn';
import {
  Boton, BotonIcono, Campo, Entrada, Selector, AreaTexto, EntradaPlata, Dialogo, Confirmar, EncabezadoPagina,
  Tarjeta, Plata, Insignia, Segmentado, BarraFiltros, Chip, Vacio, CargandoFilas, ErrorEstado, formatoPlata,
  type TonoInsignia,
} from '../admin/ui';
import { plural } from '../admin/ui-ventas/ventas';

// ─── Constantes y helpers ────────────────────────────────────────────────────

interface EstadoInfo { id: CompraEstado; label: string; tono: TonoInsignia }

// Un solo mapa estado → tono (clases literales en el kit, ver tailwindClases.test).
const ESTADOS: EstadoInfo[] = [
  { id: 'borrador', label: 'Borrador', tono: 'neutro' },
  { id: 'pedido', label: 'Pedido', tono: 'info' },
  { id: 'en_proceso', label: 'En proceso', tono: 'atencion' },
  { id: 'en_camino', label: 'En camino', tono: 'navy' },
  { id: 'recibido', label: 'Recibido', tono: 'bien' },
  { id: 'cancelado', label: 'Cancelado', tono: 'alerta' },
];

const ESTADO_INFO: Record<CompraEstado, EstadoInfo> = ESTADOS.reduce((acc, e) => {
  acc[e.id] = e;
  return acc;
}, {} as Record<CompraEstado, EstadoInfo>);

/**
 * Los que se eligen a mano al editar. «Recibido» NO: marcarlo a mano escondía el
 * botón «Recibir» y la mercadería nunca entraba al stock. Ese estado lo pone solo
 * la recepción (la RPC), que es la que carga el stock.
 */
const ESTADOS_MANUALES = ESTADOS.filter(e => e.id !== 'recibido');

/** Solo desde estos estados tiene sentido cotejar mercadería. */
const RECIBIBLES: CompraEstado[] = ['pedido', 'en_proceso', 'en_camino'];

type FiltroTipo = 'todos' | CompraTipo;
type FiltroEstado = 'todos' | CompraEstado;

const TIPOS: { id: FiltroTipo; label: string }[] = [
  { id: 'todos', label: 'Todas' },
  { id: 'proveedor', label: 'Proveedores' },
  { id: 'sublimacion', label: 'Sublimación' },
];

const TIPO_LABEL: Record<CompraTipo, string> = {
  proveedor: 'proveedor',
  sublimacion: 'sublimación',
};

/** Rótulo chico de un grupo de controles sin <label> propio. */
const claseRotulo = 'mb-1.5 block text-[13px] font-semibold text-navy-700';

/** Input de cantidad (entero chico, centrado). Sigue siendo type=number: no es plata. */
const claseCantidad =
  'h-11 w-20 shrink-0 rounded-lg border border-gray-300 bg-white px-2 text-center text-base font-bold tabular-nums text-navy-700 focus:border-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-700/15 disabled:bg-gray-50 sm:text-sm';

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
 * Plata guardada como texto en el formulario ("1200", "12.5": el formato de JS,
 * que es lo que después leen las cuentas de guardado). Para el EntradaPlata.
 */
const textoAPlata = (txt: string): number | null => {
  const t = txt.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const plataATexto = (n: number | null): string => (n === null ? '' : String(n));

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

/** Costo de la compra según las líneas (no hay columna de total en `compras`). */
const costoDeCompra = (items: CompraItem[]): { total: number; sinCosto: number } => {
  let total = 0;
  let sinCosto = 0;
  for (const it of items) {
    if (it.costoUnitario === null) sinCosto++;
    else total += it.costoUnitario * it.cantidad;
  }
  return { total: Math.round(total * 100) / 100, sinCosto };
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
  // "Sin compras" mientras carga, que es mentira.
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
      toast.error('No se pudieron cargar las compras. Verificá tu sesión de admin.');
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

  // Cuántas hay en cada estado (dentro del tipo elegido): el chip dice si vale la pena tocarlo.
  const porEstado = useMemo(() => {
    const n: Partial<Record<CompraEstado, number>> = {};
    for (const c of compras) {
      if (filtroTipo !== 'todos' && c.tipo !== filtroTipo) continue;
      n[c.estado] = (n[c.estado] ?? 0) + 1;
    }
    return n;
  }, [compras, filtroTipo]);

  const handleBorrar = async () => {
    if (!aBorrar || borrando) return;
    setBorrando(true);
    try {
      const ok = await SupabaseService.deleteCompra(aBorrar.id);
      if (!ok) { toast.error('No se pudo borrar la compra'); return; }
      toast.success('Compra borrada');
      const borrada = aBorrar.id;
      setABorrar(null);
      setEditando(e => (e && e.id === borrada ? null : e));
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
        `Quedan ${pendientes} ${pendientes === 1 ? 'línea incompleta' : 'líneas incompletas'}: la compra sigue «en camino» con el saldo.`,
        { duration: 6000 },
      );
    }
    setRecibiendo(null);
    onStockChanged();
    void refresh();
  };

  return (
    <div className="fade-in">
      <EncabezadoPagina
        rotulo="Tienda"
        titulo="Compras"
        descripcion="Compras a proveedores y encargos de sublimación. Al recibir se cotejan las cantidades y el stock de cada variante se actualiza solo."
        acciones={(
          <>
            <Boton variante="secundario" icono={<Shirt size={17} />} onClick={() => setEditando(compraVacia('sublimacion', adminEmail))}>
              Sublimación
            </Boton>
            <BotonIcono
              etiqueta="Actualizar"
              icono={<RefreshCw size={18} className={loading ? 'animate-spin' : ''} />}
              onClick={() => void refresh()}
              disabled={loading}
              className="border border-gray-300 bg-white"
            />
            <Boton icono={<Plus size={18} strokeWidth={2.5} />} onClick={() => setEditando(compraVacia('proveedor', adminEmail))} className="grow sm:grow-0">
              Nueva compra
            </Boton>
          </>
        )}
      />

      {cargandoInicial || (loadFailed && loading) ? (
        <CargandoFilas filas={4} />
      ) : loadFailed ? (
        <ErrorEstado mensaje="No se pudieron cargar las compras. Si recién entraste, puede ser la sesión: probá de nuevo." alReintentar={() => void refresh()} />
      ) : (
        <>
          {/* Filtros en una sola fila que se desliza en el celular */}
          <BarraFiltros
            chips={(
              <>
                {TIPOS.map(t => (
                  <Chip key={t.id} activo={filtroTipo === t.id} onClick={() => setFiltroTipo(t.id)}>{t.label}</Chip>
                ))}
                <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-gray-200" />
                <Chip activo={filtroEstado === 'todos'} onClick={() => setFiltroEstado('todos')}>Todo estado</Chip>
                {ESTADOS.map(e => (
                  <Chip key={e.id} activo={filtroEstado === e.id} onClick={() => setFiltroEstado(e.id)} cantidad={porEstado[e.id] ?? 0}>
                    {e.label}
                  </Chip>
                ))}
              </>
            )}
          />

          {filtrados.length === 0 ? (
            loading ? (
              <CargandoFilas filas={3} />
            ) : (
              <Vacio
                icono={<Package size={22} />}
                titulo={compras.length === 0 ? 'Todavía no hay compras' : 'Ninguna compra con estos filtros'}
                descripcion={compras.length === 0
                  ? 'Cargá la primera con «Nueva compra» o «Sublimación».'
                  : 'Probá con otro tipo o estado.'}
                accion={compras.length === 0 ? (
                  <Boton icono={<Plus size={18} />} onClick={() => setEditando(compraVacia('proveedor', adminEmail))}>Nueva compra</Boton>
                ) : (
                  <Boton variante="secundario" onClick={() => { setFiltroTipo('todos'); setFiltroEstado('todos'); }}>Ver todas</Boton>
                )}
              />
            )
          ) : (
            <Tarjeta
              sinPadding
              titulo={`Compras · ${filtrados.length === compras.length ? filtrados.length : `${filtrados.length} de ${compras.length}`}`}
              acciones={loading ? <RefreshCw size={15} className="animate-spin text-gray-400" aria-label="Actualizando" /> : undefined}
            >
              <ul className="divide-y divide-gray-100">
                {filtrados.map(c => (
                  <FilaCompra
                    key={c.id}
                    compra={c}
                    onEditar={() => setEditando(c)}
                    onRecibir={() => setRecibiendo(c)}
                    onBorrar={() => setABorrar(c)}
                  />
                ))}
              </ul>
            </Tarjeta>
          )}
        </>
      )}

      {/* Antes que los modales a propósito: si se cierran juntos (borrar desde la edición),
          React limpia en este orden y el scroll del body vuelve bien. */}
      {aBorrar && (
        <Confirmar
          abierto
          titulo={`Borrar la compra a ${aBorrar.proveedor || 'sin proveedor'}`}
          mensaje={(
            <>
              {aBorrar.referencia && <p className="font-semibold text-navy-700">#{aBorrar.referencia}</p>}
              <p className={aBorrar.referencia ? 'mt-1' : ''}>
                Se borra con todas sus líneas y no se puede deshacer.
                {resumenItems(aBorrar.items).recibidas > 0 && ' El stock que ya entró queda como está: esto no lo descuenta.'}
              </p>
            </>
          )}
          textoConfirmar="Borrar compra"
          cargando={borrando}
          alConfirmar={() => void handleBorrar()}
          alCerrar={() => !borrando && setABorrar(null)}
        />
      )}
      {editando && (
        <PedidoModal
          compra={editando}
          products={products}
          onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); void refresh(); }}
          onBorrar={editando.id ? () => setABorrar(editando) : undefined}
          bloqueado={aBorrar !== null}
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

    </div>
  );
}

// ─── Fila de la lista ────────────────────────────────────────────────────────

function FilaCompra({ compra, onEditar, onRecibir, onBorrar }: {
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
  const costo = costoDeCompra(compra.items);
  const nombre = compra.proveedor || 'Sin proveedor';

  const botonRecibir = (clase: string) => (
    <Boton variante="secundario" icono={<PackageCheck size={16} />} onClick={onRecibir} className={clase}>
      Recibir
    </Boton>
  );

  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:items-center">
      {esSubli && compra.mockupUrl ? (
        <a
          href={compra.mockupUrl}
          target="_blank"
          rel="noreferrer"
          title="Ver el mockup final"
          className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-gray-200"
        >
          <img src={compra.mockupUrl} alt="Mockup" className="h-full w-full object-cover" />
        </a>
      ) : (
        <span className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
          esSubli ? 'bg-gray-100 text-navy-700' : 'bg-navy-50 text-navy-700',
        )}>
          {esSubli ? <Shirt size={19} /> : <Truck size={19} />}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {/* Tocar la compra la abre: en el celular no hay lápiz aparte (le robaba lugar al nombre). */}
        <button type="button" onClick={onEditar} className="group block w-full rounded-md text-left">
          <span className="sr-only">Editar la compra a </span>
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-display text-sm font-bold text-navy-700 group-hover:underline">
              {nombre}
              {compra.referencia && (
                <span className="ml-1.5 font-body text-xs font-normal text-gray-500">#{compra.referencia}</span>
              )}
            </span>
            {costo.total > 0 && (
              <Plata monto={costo.total} className="shrink-0 font-display text-sm font-bold text-navy-700" />
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500">
            <Insignia tono={estado.tono}>{estado.label}</Insignia>
            <span>{TIPO_LABEL[compra.tipo]}</span>
            <span>· pedida {formatFecha(compra.fechaPedido)}</span>
            {compra.fechaEstimada && <span>· llega {formatFecha(compra.fechaEstimada)}</span>}
            <span>· {plural(compra.items.length, 'línea', 'líneas')}</span>
            {pedidas > 0 && (
              <span className={completo ? 'font-semibold text-emerald-700' : recibidas > 0 ? 'font-semibold text-amber-700' : ''}>
                · {recibidas} de {pedidas} recibidas
              </span>
            )}
            {costo.total > 0 && costo.sinCosto > 0 && (
              <span>· {plural(costo.sinCosto, 'línea', 'líneas')} sin costo</span>
            )}
          </span>
        </button>
        {puedeRecibir && botonRecibir('mt-2.5 sm:hidden')}
      </div>

      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        {puedeRecibir && botonRecibir('mr-1 px-4')}
        <BotonIcono etiqueta={`Editar la compra a ${nombre}`} icono={<Pencil size={17} />} onClick={onEditar} />
        <BotonIcono etiqueta={`Borrar la compra a ${nombre}`} icono={<Trash2 size={17} />} tono="peligro" onClick={onBorrar} />
      </div>
    </li>
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

function PedidoModal({ compra, products, onClose, onGuardado, onBorrar, bloqueado }: {
  compra: Compra;
  products: Product[];
  onClose: () => void;
  onGuardado: () => void;
  /** Pide borrar la compra (la confirmación la abre la pestaña, encima de este modal). */
  onBorrar?: () => void;
  /** Hay una confirmación abierta encima: este modal no se cierra mientras tanto. */
  bloqueado: boolean;
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

  // Foto del formulario al abrir: si cambió algo, tocar afuera pregunta antes de descartar.
  const [fotoInicial] = useState(() => JSON.stringify([compra, compra.items.map(aBorrador), costoInicial(compra), prendaInicial(compra), modoInicial(compra)]));
  const sucio = JSON.stringify([cab, lineas, costoTrabajo, prendaId, modoPrenda]) !== fotoInicial;

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

  /** Solo para mostrar: suma de cantidad × costo de las líneas de proveedor con costo. */
  const costoTotalLineas = lineas.reduce((s, l) => {
    const costo = textoAPlata(l.costoUnitario);
    return costo === null ? s : s + costo * aEntero(l.cantidad);
  }, 0);

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

  /** Compra a proveedor: renglón por renglón, con su costo unitario. Igual que siempre. */
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
        // Los campos de sublimación no viajan si la compra es de proveedor: así no
        // quedan mockups colgados de una compra que dejó de ser sublimación.
        prendaBase: esSubli ? prendaBaseFinal : '',
        comentarioTaller: esSubli ? cab.comentarioTaller.trim() : '',
        mockupUrl: esSubli ? cab.mockupUrl : '',
        archivos: esSubli ? cab.archivos : [],
        items,
      });
      if (!r.ok) {
        // La cabecera de una compra nueva pudo haber quedado guardada aunque fallaran
        // las líneas: con su id, el reintento la actualiza en vez de crear otra.
        if (r.id && !cab.id) setCab(c => ({ ...c, id: r.id! }));
        toast.error(r.error || 'No se pudo guardar la compra');
        return;
      }
      if (esSubli) toast.success(esNuevo ? 'Encargo creado' : 'Encargo guardado');
      else toast.success(esNuevo ? 'Compra creada' : 'Compra guardada');
      if (r.aviso) toast.warning(r.aviso, { duration: 9000 });
      onGuardado();
    } finally {
      setGuardando(false);
    }
  };

  // Compartido por las dos ramas; en sublimación vive dentro de la tarjeta de datos.
  const selectorTipo = (
    <div>
      <span className={claseRotulo}>Tipo</span>
      <Segmentado
        etiqueta="Tipo de compra"
        opciones={[
          { valor: 'proveedor', texto: 'Proveedor', icono: <Truck size={15} /> },
          { valor: 'sublimacion', texto: 'Sublimación', icono: <Shirt size={15} /> },
        ]}
        valor={cab.tipo}
        alCambiar={t => setCab(c => ({ ...c, tipo: t }))}
      />
    </div>
  );

  // «Recibido» solo aparece si la compra YA está recibida (lo puso la recepción):
  // así se ve el estado actual, pero no se puede elegir a mano desde otro.
  const opcionesEstado = compra.estado === 'recibido' ? ESTADOS : ESTADOS_MANUALES;
  const chipsEstado = (
    <div>
      <span className={claseRotulo}>Estado</span>
      <div role="group" aria-label="Estado de la compra" className="flex flex-wrap gap-2">
        {opcionesEstado.map(e => (
          <Chip key={e.id} activo={cab.estado === e.id} onClick={() => setCab(c => ({ ...c, estado: e.id }))}>
            {e.label}
          </Chip>
        ))}
      </div>
      <p className="mt-1.5 text-[13px] text-gray-500">
        «Recibido» se marca solo con el botón <b className="text-navy-700">Recibir</b> de la lista: es el que coteja y carga el stock.
      </p>
    </div>
  );

  const titulo = esSubli
    ? (esNuevo ? 'Nuevo encargo al taller' : 'Editar el encargo')
    : (esNuevo ? 'Nueva compra' : 'Editar compra');

  return (
    <Dialogo
      abierto
      titulo={titulo}
      descripcion={esSubli ? 'Qué prenda, cómo tiene que quedar y cuántas.' : undefined}
      alCerrar={onClose}
      ocupado={ocupado || bloqueado}
      sucio={sucio}
      ancho="xl"
      pie={(
        <>
          {onBorrar && (
            <Boton
              variante="fantasma"
              icono={<Trash2 size={16} />}
              onClick={onBorrar}
              disabled={ocupado}
              className="text-red-600 hover:bg-red-50 sm:mr-auto"
            >
              {esSubli ? 'Borrar el encargo' : 'Borrar compra'}
            </Boton>
          )}
          <Boton variante="secundario" onClick={onClose} disabled={ocupado}>Cancelar</Boton>
          <Boton onClick={() => void guardar()} disabled={ocupado && !guardando} cargando={guardando}>
            {guardando
              ? 'Guardando…'
              : subiendoMockup || subiendoArchivos
                ? 'Esperá la subida…'
                : esSubli
                  ? (esNuevo ? 'Crear el encargo' : 'Guardar el encargo')
                  : (esNuevo ? 'Crear compra' : 'Guardar cambios')}
          </Boton>
        </>
      )}
    >
      {esSubli ? (
        /* ── Encargo al taller: tres pasos, no un renglonario de compra ── */
        <div className="space-y-4">
          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
            {selectorTipo}

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Taller / quién lo hace" requerido>
                <Entrada
                  type="text"
                  value={cab.proveedor}
                  onChange={e => setCab(c => ({ ...c, proveedor: e.target.value }))}
                  placeholder="Ej: Sublimados Rivera"
                />
              </Campo>
              <Campo etiqueta="Nombre del trabajo">
                <Entrada
                  type="text"
                  value={cab.referencia}
                  onChange={e => setCab(c => ({ ...c, referencia: e.target.value }))}
                  placeholder="Ej: Club Carrasco · torneo de octubre"
                />
              </Campo>
              <Campo etiqueta="Cuándo lo encargamos">
                <Entrada
                  type="date"
                  value={cab.fechaPedido ?? ''}
                  onChange={e => setCab(c => ({ ...c, fechaPedido: e.target.value || null }))}
                />
              </Campo>
              <Campo etiqueta="Para cuándo lo necesitamos">
                <Entrada
                  type="date"
                  value={cab.fechaEstimada ?? ''}
                  onChange={e => setCab(c => ({ ...c, fechaEstimada: e.target.value || null }))}
                />
              </Campo>
            </div>

            {chipsEstado}

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                etiqueta="Costo del trabajo (opcional)"
                ayuda={costoPorPrendaPreview !== null
                  ? `Total que cobra el taller. Se reparte solo: ≈ ${formatoPlata(costoPorPrendaPreview)} por prenda.`
                  : 'Total que cobra el taller.'}
              >
                <EntradaPlata
                  valor={textoAPlata(costoTrabajo)}
                  alCambiar={n => setCostoTrabajo(plataATexto(n))}
                />
              </Campo>
              <Campo etiqueta="Notas del trabajo">
                <AreaTexto
                  rows={2}
                  value={cab.notas}
                  onChange={e => setCab(c => ({ ...c, notas: e.target.value }))}
                  placeholder="Lo que haga falta recordar (el taller también las ve)"
                  className="min-h-[44px]"
                />
              </Campo>
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
        /* ── Compra a proveedor: renglón por renglón ── */
        <div className="space-y-5">
          {selectorTipo}

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Proveedor" requerido>
              <Entrada
                type="text"
                value={cab.proveedor}
                onChange={e => setCab(c => ({ ...c, proveedor: e.target.value }))}
                placeholder="Ej: Textil del Este"
              />
            </Campo>
            <Campo etiqueta="Referencia">
              <Entrada
                type="text"
                value={cab.referencia}
                onChange={e => setCab(c => ({ ...c, referencia: e.target.value }))}
                placeholder="Nº de orden, factura, nombre del equipo…"
              />
            </Campo>
            <Campo etiqueta="Fecha de la compra">
              <Entrada
                type="date"
                value={cab.fechaPedido ?? ''}
                onChange={e => setCab(c => ({ ...c, fechaPedido: e.target.value || null }))}
              />
            </Campo>
            <Campo etiqueta="Fecha estimada de llegada">
              <Entrada
                type="date"
                value={cab.fechaEstimada ?? ''}
                onChange={e => setCab(c => ({ ...c, fechaEstimada: e.target.value || null }))}
              />
            </Campo>
          </div>

          {chipsEstado}

          <Campo etiqueta="Notas">
            <AreaTexto
              rows={2}
              value={cab.notas}
              onChange={e => setCab(c => ({ ...c, notas: e.target.value }))}
              placeholder="Lo que haga falta recordar de esta compra"
              className="min-h-[44px]"
            />
          </Campo>

          {/* Líneas de la compra */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">
                Líneas{lineas.length > 0 && <span className="ml-1.5 font-body text-xs font-semibold normal-case tracking-normal text-gray-500">{plural(totalUnidades, 'unidad', 'unidades')}</span>}
              </span>
              <Boton variante="secundario" chico icono={<Plus size={15} />} onClick={() => setLineas(ls => [...ls, lineaNueva()])}>
                Agregar línea
              </Boton>
            </div>

            {lineas.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center">
                <p className="text-sm text-gray-500">Todavía no hay líneas. Agregá lo que estás comprando.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {lineas.map((l, i) => {
                  const producto = l.productId ? productoPorId.get(l.productId) : undefined;
                  const variantes = variantesDe(producto);
                  const costo = textoAPlata(l.costoUnitario);
                  const cant = aEntero(l.cantidad);
                  return (
                    <div key={l.id} className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-3 hidden w-5 shrink-0 text-center text-xs font-bold tabular-nums text-gray-400 sm:block">{i + 1}</span>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Selector
                              value={l.productId ?? ''}
                              onChange={e => cambiarProducto(l, e.target.value)}
                              aria-label={`Producto de la línea ${i + 1}`}
                            >
                              <option value="">Sin producto del catálogo</option>
                              {productosOrdenados.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </Selector>
                            <Selector
                              value={l.variante ?? ''}
                              onChange={e => setLinea(l.id, { variante: e.target.value || null })}
                              disabled={!producto || variantes.length === 0}
                              aria-label={`Variante de la línea ${i + 1}`}
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
                            </Selector>
                          </div>

                          <Entrada
                            type="text"
                            value={l.descripcion}
                            onChange={e => setLinea(l.id, { descripcion: e.target.value })}
                            placeholder={producto ? producto.name : 'Qué es (ej: remeras negras M)'}
                            aria-label={`Descripción de la línea ${i + 1}`}
                          />

                          <div className="flex flex-wrap items-end gap-2">
                            <div>
                              <label htmlFor={`linea-cant-${l.id}`} className="mb-1 block text-xs font-semibold text-gray-500">Cantidad</label>
                              <input
                                id={`linea-cant-${l.id}`}
                                type="number"
                                min={1}
                                inputMode="numeric"
                                value={l.cantidad}
                                onChange={e => setLinea(l.id, { cantidad: e.target.value })}
                                className={claseCantidad}
                              />
                            </div>
                            <div className="min-w-[8rem] flex-1">
                              <label htmlFor={`linea-costo-${l.id}`} className="mb-1 block text-xs font-semibold text-gray-500">Costo c/u</label>
                              <EntradaPlata
                                id={`linea-costo-${l.id}`}
                                valor={costo}
                                alCambiar={n => setLinea(l.id, { costoUnitario: plataATexto(n) })}
                                placeholder="opcional"
                              />
                            </div>
                            {costo !== null && cant > 0 && (
                              <p className="pb-3 text-xs text-gray-500">
                                = <Plata monto={Math.round(costo * cant * 100) / 100} className="font-semibold text-navy-700" />
                              </p>
                            )}
                          </div>

                          {!sumaStock(l) && (
                            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-700">
                              <AlertTriangle size={13} className="shrink-0" />
                              {l.productId
                                ? 'Sin variante elegida: al recibir no va a sumar stock.'
                                : 'Línea suelta: al recibir no va a sumar stock.'}
                            </p>
                          )}
                          {l.cantidadRecibida > 0 && (
                            <p className="text-[13px] text-gray-500">
                              Ya se recibieron {l.cantidadRecibida} de esta línea.
                            </p>
                          )}
                        </div>
                        <BotonIcono
                          etiqueta={`Quitar la línea ${i + 1}`}
                          icono={<Trash2 size={17} />}
                          tono="peligro"
                          onClick={() => setLineas(ls => ls.filter(x => x.id !== l.id))}
                          className="-mr-1 -mt-1"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {costoTotalLineas > 0 && (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                <span className="text-[13px] font-semibold text-gray-600">Costo total cargado</span>
                <Plata monto={Math.round(costoTotalLineas * 100) / 100} className="font-display text-base font-bold text-navy-700" />
              </div>
            )}

            {sinStock > 0 && lineas.length > 0 && (
              <p className="mt-2 text-[13px] text-gray-500">
                {sinStock} de {lineas.length} {sinStock === 1 ? 'línea no va a sumar stock' : 'líneas no van a sumar stock'}:
                vinculá producto y variante en las que sí tengan que entrar al inventario.
              </p>
            )}
          </div>
        </div>
      )}
    </Dialogo>
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
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <header className="flex items-start gap-3 border-b border-gray-100 px-4 py-3">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-navy-700 font-display text-xs font-bold text-lime-400"
        >
          {numero}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold text-navy-700">{titulo}</h3>
          {ayuda && <p className="mt-0.5 text-[13px] leading-snug text-gray-500">{ayuda}</p>}
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
        <Campo
          etiqueta="¿Qué prenda es?"
          ayuda="Tal cual se la vas a nombrar al taller. Como no sale del catálogo, al recibirla no suma stock."
        >
          <Entrada
            type="text"
            value={prendaBase}
            onChange={e => onPrendaBase(e.target.value)}
            placeholder="Ej: remera dry-fit blanca, cuello redondo"
          />
        </Campo>
        <Boton variante="fantasma" chico icono={<Search size={14} />} onClick={onVolverAlCatalogo} className="-ml-3">
          Mejor buscarla en el catálogo
        </Boton>
      </div>
    );
  }

  if (prenda && !eligiendo) {
    const talles = variantesDe(prenda).length;
    return (
      <div className="flex items-center gap-3 rounded-xl border border-navy-700 bg-navy-50/60 p-3">
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
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">Prenda del catálogo</p>
          <p className="truncate font-display text-base font-bold text-navy-700">{prenda.name}</p>
          <p className="text-xs text-gray-500">
            {talles === 0 ? 'sin talles cargados' : `${talles} ${talles === 1 ? 'talle' : 'talles'} para elegir abajo`}
          </p>
        </div>
        <Boton variante="secundario" chico onClick={onVolverAlCatalogo} className="shrink-0">
          Cambiar
        </Boton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Entrada
          type="search"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscá la prenda por nombre…"
          aria-label="Buscar prenda en el catálogo"
          className="pl-10"
        />
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-6 text-center">
          <p className="text-sm text-gray-500">
            {productos.length === 0 ? 'Todavía no hay productos en el catálogo.' : 'Ninguna prenda con ese nombre.'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5 sm:max-h-64 sm:overflow-y-auto sm:pr-1">
          {filtrados.map(p => {
            const talles = variantesDe(p).length;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onElegir(p)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors',
                  prenda?.id === p.id ? 'border-navy-700 bg-navy-50' : 'border-gray-200 bg-white hover:border-navy-700',
                )}
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
                  <p className="text-xs text-gray-500">
                    {talles === 0 ? 'sin talles cargados' : `${talles} ${talles === 1 ? 'talle' : 'talles'}`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <Boton variante="fantasma" chico onClick={onPrendaLibre} className="-ml-3">
          Es una prenda que no está en el catálogo
        </Boton>
        {prenda && (
          <Boton variante="fantasma" chico onClick={onCancelarCambio} className="text-gray-500">
            Dejar «{prenda.name}»
          </Boton>
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

  // Label con pinta de botón secundario (el input file vive adentro).
  const claseBotonArchivo = 'inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 font-display text-sm font-bold text-navy-700 transition-colors hover:border-navy-700';

  return (
    <div className="space-y-5">
      {/* Mockup final */}
      <div>
        <span className={claseRotulo}>Mockup final</span>
        <div
          onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={soltar}
        >
          {mockupUrl ? (
            <div className={cn('overflow-hidden rounded-xl border-2 bg-gray-50', arrastrando ? 'border-dashed border-navy-700' : 'border-gray-200')}>
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
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors',
                arrastrando ? 'border-navy-700 bg-navy-50' : 'border-gray-300 bg-gray-50 hover:border-navy-700 hover:bg-navy-50/40',
                subiendoMockup && 'pointer-events-none opacity-60',
              )}
            >
              {subiendoMockup
                ? <Loader2 size={30} className="animate-spin text-navy-700" />
                : <ImagePlus size={30} strokeWidth={1.5} className="text-gray-400" />}
              <span className="font-display text-sm font-bold text-navy-700">
                {subiendoMockup ? 'Subiendo el mockup…' : 'Arrastrá el mockup acá'}
              </span>
              <span className="text-xs text-gray-500">o tocá para elegirlo del dispositivo</span>
              <input type="file" accept="image/*" className="hidden" onChange={elegirMockup} disabled={subiendoMockup} />
            </label>
          )}
        </div>

        {mockupUrl && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className={cn(claseBotonArchivo, subiendoMockup && 'pointer-events-none opacity-50')}>
              {subiendoMockup ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {subiendoMockup ? 'Subiendo…' : 'Reemplazar'}
              <input type="file" accept="image/*" className="hidden" onChange={elegirMockup} disabled={subiendoMockup} />
            </label>
            <Boton variante="fantasma" onClick={onQuitarMockup} disabled={subiendoMockup} className="text-gray-500 hover:bg-red-50 hover:text-red-600">
              Quitar mockup
            </Boton>
          </div>
        )}

        {!mockupUrl && !subiendoMockup && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[13px] leading-snug text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            Todavía no cargaste el mockup. Es lo primero que mira el taller: sin eso no sabe cómo tiene que quedar.
          </p>
        )}
      </div>

      {/* Fotos de referencia */}
      <div>
        <span className={claseRotulo}>Fotos de referencia (opcional)</span>
        {archivos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {archivos.map((a, i) => (
              <div key={`${a.url}-${i}`} className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200 bg-white">
                <a href={a.url} target="_blank" rel="noreferrer" title={a.nombre} className="block h-full w-full">
                  <img src={a.url} alt={a.nombre} className="h-full w-full object-cover" />
                </a>
                <button
                  type="button"
                  onClick={() => onQuitarFoto(i)}
                  aria-label={`Quitar ${a.nombre}`}
                  className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-bl-lg bg-white/90 text-gray-600 hover:text-red-600"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className={cn(claseBotonArchivo, subiendoArchivos && 'pointer-events-none opacity-50')}>
          {subiendoArchivos ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          {subiendoArchivos ? 'Subiendo…' : archivos.length > 0 ? 'Agregar más fotos' : 'Agregar fotos'}
          <input type="file" accept="image/*" multiple className="hidden" onChange={elegirFotos} disabled={subiendoArchivos} />
        </label>
        <p className="mt-1.5 text-[13px] text-gray-500">
          Detalles, colores, trabajos parecidos: todo lo que ayude a que salga como lo pensaste.
        </p>
      </div>

      {/* Instrucciones */}
      <Campo etiqueta="Instrucciones para el taller">
        <AreaTexto
          rows={4}
          value={comentario}
          onChange={e => onComentario(e.target.value)}
          placeholder={'Ej: logo al pecho izquierdo, 8 cm de ancho. Verde exacto del mockup (#CCFF00). Nombres atrás en Lexend, arriba del número. Costura reforzada en las mangas.'}
        />
      </Campo>
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
        className={cn(
          'flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
          n > 0 ? 'border-navy-700 bg-navy-50/60' : 'border-gray-200 bg-white',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold text-navy-700">
            {titulo}
            {color && <span className="ml-1.5 font-body text-xs font-normal text-gray-500">{color}</span>}
          </p>
          <p className="text-xs text-gray-500">
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
          className={claseCantidad}
        />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {enCatalogo ? (
        variantes.length === 0 ? (
          <>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] leading-snug text-amber-800">
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
              <p className="text-sm text-gray-500">Agregá una fila por cada talle o variante que le encargás.</p>
            </div>
          ) : (
            filasLibres.map((l, i) => (
              <div key={l.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
                <Entrada
                  type="text"
                  value={l.descripcion}
                  onChange={e => onCambiarLinea(l.id, { descripcion: e.target.value })}
                  placeholder={prendaBase ? `${prendaBase} — talle…` : 'Ej: remera blanca talle M'}
                  aria-label={`Qué prenda va en la fila ${i + 1}`}
                  className="min-w-0 flex-1"
                />
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={l.cantidad}
                  onChange={e => onCambiarLinea(l.id, { cantidad: e.target.value })}
                  placeholder="0"
                  aria-label={`Cantidad de la fila ${i + 1}`}
                  className={claseCantidad}
                />
                <BotonIcono etiqueta={`Quitar la fila ${i + 1}`} icono={<Trash2 size={17} />} tono="peligro" onClick={() => onQuitarLinea(l.id)} />
              </div>
            ))
          )}
          <Boton variante="secundario" chico icono={<Plus size={15} />} onClick={onAgregarLinea}>
            Agregar fila
          </Boton>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 py-6 text-center">
          <Shirt size={26} strokeWidth={1.5} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-500">Elegí la prenda arriba y acá aparecen sus talles.</p>
        </div>
      )}

      {otras.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="mb-2 font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">
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
                <div key={l.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-bold text-navy-700">{titulo}</p>
                    {detalle.length > 0 && (
                      <p className="truncate text-xs text-gray-500">{detalle.join(' · ')}</p>
                    )}
                  </div>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={l.cantidad}
                    onChange={e => onCambiarLinea(l.id, { cantidad: e.target.value })}
                    aria-label={`Cantidad de ${titulo}`}
                    className={claseCantidad}
                  />
                  <BotonIcono etiqueta={`Quitar ${titulo} del trabajo`} icono={<Trash2 size={17} />} tono="peligro" onClick={() => onQuitarLinea(l.id)} />
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
        <p className="text-[13px] text-gray-500">
          Todavía no cargaste cantidades. Podés guardar el borrador igual y completarlas después.
        </p>
      )}

      {sinStock > 0 && (
        <p className="flex items-start gap-1.5 text-[13px] font-semibold text-amber-700">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
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

  /** Lo mismo que `aStock`, pero de una línea: para decirlo al lado de cada número. */
  const entranDeLinea = (it: CompraItem): number => {
    if (!sumaStock(it)) return 0;
    const n = leer(it.id);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, n - it.cantidadRecibida);
  };

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

  const hayRecibidasAntes = compra.items.some(it => it.cantidadRecibida > 0);

  return (
    <Dialogo
      abierto
      titulo={`Recibir · ${compra.proveedor || 'Sin proveedor'}`}
      descripcion={`${TIPO_LABEL[compra.tipo]}${compra.referencia ? ` · #${compra.referencia}` : ''} · ${plural(compra.items.length, 'línea', 'líneas')}`}
      alCerrar={onClose}
      ocupado={guardando}
      ancho="lg"
      pie={(
        <>
          <Boton variante="secundario" onClick={onClose} disabled={guardando}>Cancelar</Boton>
          <Boton onClick={() => void confirmar()} disabled={hayInvalidos} cargando={guardando} icono={<PackageCheck size={17} />}>
            {guardando ? 'Registrando…' : aStock > 0 ? `Confirmar · entran ${aStock} al stock` : 'Confirmar recepción'}
          </Boton>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-md text-sm leading-relaxed text-gray-600">
            Cotejá lo que llegó de verdad. En cada línea va el <b className="text-navy-700">total recibido hasta hoy</b>
            {hayRecibidasAntes ? ', contando lo que ya había llegado antes' : ''}: al stock entra solo la diferencia.
          </p>
          <Boton variante="secundario" chico icono={<CheckCheck size={15} />} onClick={recibirTodo} disabled={guardando}>
            Llegó todo
          </Boton>
        </div>

        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {compra.items.map(it => {
            const producto = it.productId ? productoPorId.get(it.productId) : undefined;
            const n = leer(it.id);
            const invalido = !Number.isFinite(n) || n < 0;
            const deMas = Number.isFinite(n) && n > it.cantidad;
            const entran = entranDeLinea(it);
            const idInput = `recep-${it.id}`;
            return (
              <li key={it.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-bold text-navy-700">{it.descripcion}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    <span>pedidas {it.cantidad}</span>
                    {it.cantidadRecibida > 0 && <span>· ya recibidas {it.cantidadRecibida}</span>}
                    {producto && producto.name !== it.descripcion && <span>· {producto.name}</span>}
                    {it.variante && <Insignia tono="navy">{formatVariante(it.variante)}</Insignia>}
                    {!sumaStock(it) && <Insignia tono="atencion">no suma stock</Insignia>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <label htmlFor={idInput} className="mb-1 block text-xs font-semibold text-gray-500">Total recibido</label>
                  <input
                    id={idInput}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={cantidades[it.id] ?? ''}
                    onChange={e => setCantidades(c => ({ ...c, [it.id]: e.target.value }))}
                    disabled={guardando}
                    aria-invalid={invalido || undefined}
                    aria-describedby={`${idInput}-ayuda`}
                    className={cn(
                      claseCantidad,
                      'w-24',
                      invalido ? 'border-red-400' : deMas ? 'border-amber-400' : '',
                    )}
                  />
                </div>
                <p id={`${idInput}-ayuda`} className={cn('w-full text-right text-xs', entran > 0 ? 'font-semibold text-emerald-700' : 'text-gray-500')}>
                  {invalido
                    ? 'Poné un número entero (0 o más).'
                    : !sumaStock(it)
                      ? 'Se registra, pero no toca el stock.'
                      : entran > 0
                        ? `Entran ${entran} al stock`
                        : 'No entra nada nuevo al stock'}
                  {deMas && !invalido && <span className="font-normal text-amber-700"> · llegó más de lo pedido: se carga igual</span>}
                </p>
              </li>
            );
          })}
        </ul>

        <div className={cn('rounded-xl border px-4 py-3', aStock > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50')}>
          <p className="font-display text-sm font-bold text-navy-700">
            {aStock > 0
              ? `Van a entrar ${aStock} ${aStock === 1 ? 'unidad' : 'unidades'} al stock`
              : 'Esta recepción no suma stock'}
          </p>
          <p className="mt-0.5 text-[13px] text-gray-600">
            {aStock > 0
              ? 'Solo cuenta la diferencia contra lo ya recibido, y solo de las líneas con producto y variante.'
              : 'Ninguna línea tiene producto y variante, o ya estaba todo recibido.'}
          </p>
          {quedanPendientes && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-amber-800">
              <AlertTriangle size={14} className="flex-shrink-0" />
              Falta mercadería: la compra queda «en camino» con el saldo pendiente.
            </p>
          )}
        </div>
      </div>
    </Dialogo>
  );
}
