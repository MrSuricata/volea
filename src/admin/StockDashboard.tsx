import { useId, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Package, Pencil, SearchX, Tag, XCircle } from 'lucide-react';
import type { Product } from '../types';
import { urlImagen } from '../utils/imagenes';
import { FALLBACK_IMG, errorFoto } from '../lib/fotos';
import { cn } from '../lib/cn';
import { BarraFiltros, Boton, Chip, EncabezadoPagina, Estadistica, Insignia, Vacio, type TonoInsignia } from './ui';
import {
  COLOR_UNICO, UMBRAL_STOCK_BAJO, coincideBusqueda, ordenarPorUrgencia, pasaFiltro, porColor, resumirStock, totalesStock,
  type EstadoVariante, type FiltroStock, type ResumenStock, type VarianteStock,
} from './stockResumen';

// El umbral vive en stockResumen.ts (sin React); se re-exporta para quien ya importa esto.
export { UMBRAL_STOCK_BAJO } from './stockResumen';

// ─── StockDashboard ──────────────────────────────────────────────────────────
// Rediseño 24/09: pensado para el celular. Cada producto es una fila con sus variantes
// en problema a la vista (talle · color + cantidad), "Editar" como botón de verdad y el
// detalle completo como grilla color × talle (antes: una tabla de 4 columnas que a 390px
// se salía de la pantalla). Solo lectura: el stock se cambia en el editor del producto.

const TONO_VARIANTE: Record<EstadoVariante, TonoInsignia> = { sin: 'alerta', bajo: 'atencion', ok: 'neutro' };

const CELDA_VARIANTE: Record<EstadoVariante, string> = {
  sin: 'border-red-200 bg-red-50 text-red-700',
  bajo: 'border-amber-200 bg-amber-50 text-amber-800',
  ok: 'border-gray-200 bg-white text-navy-700',
};

const MAX_ALERTAS_EN_FILA = 4;

const enProductos = (n: number) => (n === 0 ? 'Todo en orden' : `Variantes, en ${n} ${n === 1 ? 'producto' : 'productos'}`);

export function StockDashboard({ products, onEdit }: { products: Product[]; onEdit: (p: Product) => void }) {
  const [filtro, setFiltro] = useState<FiltroStock>('todos');
  const [busqueda, setBusqueda] = useState('');

  const resumenes = useMemo(() => products.map(resumirStock), [products]);
  const totales = useMemo(() => totalesStock(resumenes), [resumenes]);
  const buscados = useMemo(() => resumenes.filter(r => coincideBusqueda(r.producto, busqueda)), [resumenes, busqueda]);
  const cuenta: Record<FiltroStock, number> = {
    todos: buscados.length,
    sin: buscados.filter(r => pasaFiltro(r, 'sin')).length,
    bajo: buscados.filter(r => pasaFiltro(r, 'bajo')).length,
  };
  const productosCon = {
    sin: resumenes.filter(r => pasaFiltro(r, 'sin')).length,
    bajo: resumenes.filter(r => pasaFiltro(r, 'bajo')).length,
  };
  const visibles = useMemo(() => ordenarPorUrgencia(buscados.filter(r => pasaFiltro(r, filtro))), [buscados, filtro]);

  return (
    <div>
      <EncabezadoPagina
        rotulo="Tienda"
        titulo="Stock"
        descripcion={`Unidades por talle y color. Stock bajo = ${UMBRAL_STOCK_BAJO} o menos. Para cambiar cantidades, entrá a Editar.`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Estadistica
          etiqueta="Unidades"
          valor={totales.unidades.toLocaleString('es-UY')}
          icono={<Package size={16} />}
          detalle={`${products.length} ${products.length === 1 ? 'producto' : 'productos'}`}
        />
        <Estadistica etiqueta="Variantes" valor={totales.variantes} icono={<Tag size={16} />} detalle="Talle × color" />
        <Estadistica
          etiqueta="Stock bajo"
          valor={totales.bajo}
          tono={totales.bajo > 0 ? 'atencion' : 'neutro'}
          icono={<AlertTriangle size={16} />}
          detalle={enProductos(productosCon.bajo)}
          onClick={() => setFiltro('bajo')}
        />
        <Estadistica
          etiqueta="Sin stock"
          valor={totales.sin}
          tono={totales.sin > 0 ? 'alerta' : 'neutro'}
          icono={<XCircle size={16} />}
          detalle={enProductos(productosCon.sin)}
          onClick={() => setFiltro('sin')}
        />
      </div>

      <BarraFiltros
        busqueda={busqueda}
        alBuscar={setBusqueda}
        placeholder="Buscar por nombre o SKU"
        chips={(
          <>
            <Chip activo={filtro === 'todos'} onClick={() => setFiltro('todos')} cantidad={cuenta.todos}>Todos</Chip>
            <Chip activo={filtro === 'sin'} onClick={() => setFiltro('sin')} cantidad={cuenta.sin}>Sin stock</Chip>
            <Chip activo={filtro === 'bajo'} onClick={() => setFiltro('bajo')} cantidad={cuenta.bajo}>Stock bajo</Chip>
          </>
        )}
      />

      {visibles.length === 0 ? (
        <SinResultados
          hayProductos={products.length > 0}
          busqueda={busqueda}
          filtro={filtro}
          alLimpiar={() => setBusqueda('')}
        />
      ) : (
        <ul className="space-y-2">
          {visibles.map(r => (
            <FilaStock key={r.producto.id} resumen={r} onEdit={() => onEdit(r.producto)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SinResultados({ hayProductos, busqueda, filtro, alLimpiar }: {
  hayProductos: boolean;
  busqueda: string;
  filtro: FiltroStock;
  alLimpiar: () => void;
}) {
  if (!hayProductos) {
    return <Vacio icono={<Package size={22} />} titulo="Todavía no hay productos" descripcion="Cuando cargues productos, su stock aparece acá." />;
  }
  if (busqueda.trim()) {
    return (
      <Vacio
        icono={<SearchX size={22} />}
        titulo={`Nada coincide con “${busqueda.trim()}”`}
        descripcion={filtro === 'todos' ? 'Probá con otra parte del nombre o del SKU.' : 'Probá con otra búsqueda o mirá todos los productos.'}
        accion={<Boton variante="secundario" onClick={alLimpiar}>Limpiar búsqueda</Boton>}
      />
    );
  }
  return (
    <Vacio
      icono={<CheckCircle2 size={22} className="text-emerald-600" />}
      titulo={filtro === 'sin' ? 'Ningún producto sin stock' : 'Sin alertas de stock bajo'}
      descripcion="Todo en orden por ahora."
    />
  );
}

function ChipVariante({ v }: { v: VarianteStock }) {
  return (
    <Insignia tono={TONO_VARIANTE[v.estado]} className="gap-1 py-1">
      <span>{v.talle}{v.color !== COLOR_UNICO && <span className="font-normal"> · {v.color}</span>}</span>
      <span className="tabular-nums font-bold">{v.cantidad}</span>
    </Insignia>
  );
}

function FilaStock({ resumen, onEdit }: { resumen: ResumenStock; onEdit: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const idDetalle = useId();
  const { producto, variantes, sinStock, bajo, unidades } = resumen;

  // En la fila, lo que falta primero (0 antes que 1, 2, 3); el resto queda en el detalle.
  const alertas = [...sinStock, ...bajo].sort((a, b) => a.cantidad - b.cantidad);
  const aLaVista = alertas.slice(0, MAX_ALERTAS_EN_FILA);
  const escondidas = alertas.length - aLaVista.length;
  const hexDe = (color: string) => producto.colors?.find(c => c.name === color)?.hex;

  const resumenLector = [
    sinStock.length > 0 && `${sinStock.length} sin stock`,
    bajo.length > 0 && `${bajo.length} con stock bajo`,
  ].filter(Boolean).join(', ') || 'todo con stock';

  return (
    <li
      className={cn(
        'overflow-hidden rounded-xl border bg-white',
        sinStock.length > 0 ? 'border-red-200' : bajo.length > 0 ? 'border-amber-200' : 'border-gray-200',
      )}
    >
      <div className="flex items-start gap-3 p-3 sm:p-4">
        <img
          src={producto.images[0] ? urlImagen(producto.images[0], 160) : FALLBACK_IMG}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-14 w-14 shrink-0 rounded-lg border border-gray-100 object-cover"
          onError={errorFoto(producto.images[0])}
        />
        <div className="min-w-0 flex-1 self-center">
          <h3 className="line-clamp-2 font-display text-[15px] font-bold leading-snug text-navy-700">{producto.name}</h3>
          {/* Las unidades primero: si no entra, lo que se corta es el SKU. */}
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-gray-500">
            <span className="shrink-0 font-semibold tabular-nums text-navy-700">{unidades} u.</span>
            {producto.sku && <><span aria-hidden className="shrink-0">·</span><span className="min-w-0 truncate">{producto.sku}</span></>}
            {producto.active === false && <Insignia className="ml-1">Oculto</Insignia>}
          </p>
        </div>
        <Boton
          variante="secundario"
          icono={<Pencil size={16} />}
          onClick={onEdit}
          className="shrink-0 px-3.5"
          aria-label={`Editar ${producto.name}`}
        >
          Editar
        </Boton>
      </div>

      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={idDetalle}
        aria-label={`Variantes de ${producto.name}: ${resumenLector}`}
        onClick={() => setAbierto(a => !a)}
        className="flex min-h-[44px] w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left transition-colors hover:bg-gray-50 sm:px-4"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {alertas.length > 0 ? (
            <>
              {aLaVista.map(v => <ChipVariante key={v.clave} v={v} />)}
              {escondidas > 0 && <span className="text-[12px] font-semibold text-gray-500">+{escondidas}</span>}
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700">
              <CheckCircle2 size={15} aria-hidden /> Todo con stock
            </span>
          )}
        </span>
        <span className="shrink-0 text-[13px] font-semibold text-navy-700">
          {abierto ? 'Ocultar' : `${variantes.length} ${variantes.length === 1 ? 'variante' : 'variantes'}`}
        </span>
        <ChevronDown size={18} aria-hidden className={cn('shrink-0 text-navy-700 transition-transform', abierto && 'rotate-180')} />
      </button>

      <div id={idDetalle} hidden={!abierto} className="border-t border-gray-100 bg-gray-50/70 px-3 py-3 sm:px-4">
        {abierto && (
          variantes.length === 0 ? (
            <p className="text-[13px] text-gray-500">Este producto no tiene talles ni colores cargados.</p>
          ) : (
            <div className="space-y-3">
              {porColor(variantes).map(g => {
                const hex = hexDe(g.color);
                const total = g.variantes.reduce((s, v) => s + Math.max(0, v.cantidad), 0);
                return (
                  <div key={g.color}>
                    <p className="mb-1.5 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-gray-600">
                      {hex && <span aria-hidden className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/15" style={{ backgroundColor: hex }} />}
                      {g.color}
                      <span className="font-semibold normal-case tracking-normal text-gray-400">· {total} u.</span>
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {g.variantes.map(v => (
                        <li
                          key={v.clave}
                          className={cn('flex min-w-[52px] flex-col items-center rounded-lg border px-2 py-1', CELDA_VARIANTE[v.estado])}
                          aria-label={`Talle ${v.talle}: ${v.cantidad} ${v.cantidad === 1 ? 'unidad' : 'unidades'}`}
                        >
                          <span className="text-[11px] font-semibold opacity-75">{v.talle}</span>
                          <span className="font-display text-base font-bold leading-tight tabular-nums">{v.cantidad}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </li>
  );
}
