import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Inbox, RotateCw, Search, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatoPlata } from './plata';

// Piezas chicas del panel: encabezado de página, tarjeta, número grande, insignia,
// selector segmentado, barra de filtros y los estados vacío / cargando / error.
// Mismo lenguaje que la web pública (rótulo chico en mayúsculas, títulos font-black,
// bordes de 1px en vez de sombras) pero pensado para trabajar: denso y claro.

// ─── Encabezado de página ────────────────────────────────────────────────────

export function EncabezadoPagina({ rotulo, titulo, descripcion, acciones, className }: {
  /** Grupo del menú ("Tienda", "Torneos"…): ubica sin mirar la barra. */
  rotulo?: string;
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {rotulo && (
          <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500">{rotulo}</p>
        )}
        <h1 className="font-display text-2xl font-black uppercase leading-none tracking-tight text-navy-700 md:text-3xl">{titulo}</h1>
        {descripcion && <p className="mt-2 max-w-2xl text-sm text-gray-500">{descripcion}</p>}
      </div>
      {acciones && <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}

// ─── Tarjeta ─────────────────────────────────────────────────────────────────

export function Tarjeta({ children, className, sinPadding = false, titulo, acciones }: {
  children: ReactNode;
  className?: string;
  sinPadding?: boolean;
  titulo?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <section className={cn('rounded-xl border border-gray-200 bg-white', !sinPadding && !titulo && 'p-4 md:p-5', className)}>
      {titulo && (
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 md:px-5">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">{titulo}</h2>
          {acciones}
        </div>
      )}
      {titulo ? <div className={sinPadding ? '' : 'p-4 md:p-5'}>{children}</div> : children}
    </section>
  );
}

// ─── Número grande (KPI) ─────────────────────────────────────────────────────

type TonoDato = 'neutro' | 'bien' | 'atencion' | 'alerta';
const TONO_DATO: Record<TonoDato, string> = {
  neutro: 'text-navy-700',
  bien: 'text-emerald-700',
  atencion: 'text-amber-700',
  alerta: 'text-red-700',
};

/** Tarjeta con un número. Si tiene `to` u `onClick` se puede tocar (y lo muestra). */
export function Estadistica({ etiqueta, valor, detalle, tono = 'neutro', icono, to, onClick, plata = false }: {
  etiqueta: string;
  valor: number | string;
  detalle?: ReactNode;
  tono?: TonoDato;
  icono?: ReactNode;
  to?: string;
  onClick?: () => void;
  /** Formatea `valor` como plata. */
  plata?: boolean;
}) {
  const tocable = Boolean(to || onClick);
  const cuerpo = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">{etiqueta}</p>
        {icono && <span className="text-gray-400">{icono}</span>}
      </div>
      <p className={cn('mt-2 truncate font-display text-2xl font-black tabular-nums md:text-3xl', TONO_DATO[tono])}>
        {plata && typeof valor === 'number' ? formatoPlata(valor) : valor}
      </p>
      {(detalle || tocable) && (
        <p className="mt-1 flex items-center gap-1 text-[13px] text-gray-500">
          {detalle}
          {tocable && <ArrowRight size={14} className="ml-auto shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />}
        </p>
      )}
    </>
  );
  const clase = cn('group block rounded-xl border border-gray-200 bg-white p-4 text-left', tocable && 'transition-colors hover:border-navy-700');
  if (to) return <Link to={to} className={clase}>{cuerpo}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cn(clase, 'w-full')}>{cuerpo}</button>;
  return <div className={clase}>{cuerpo}</div>;
}

// ─── Plata en texto ──────────────────────────────────────────────────────────

/** Monto con números alineados (tabular-nums) y negativo en rojo. */
export function Plata({ monto, className, decimales }: { monto: number; className?: string; decimales?: boolean }) {
  return <span className={cn('tabular-nums', monto < 0 && 'text-red-700', className)}>{formatoPlata(monto, { decimales })}</span>;
}

// ─── Insignia ────────────────────────────────────────────────────────────────

export type TonoInsignia = 'neutro' | 'navy' | 'bien' | 'atencion' | 'alerta' | 'info' | 'vivo';

// Clases literales a propósito: Tailwind solo genera las que ve escritas enteras
// (lo vigila src/utils/tailwindClases.test.ts).
const TONO_INSIGNIA: Record<TonoInsignia, string> = {
  neutro: 'bg-gray-100 text-gray-700',
  navy: 'bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-100',
  bien: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  atencion: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  alerta: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  info: 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200',
  vivo: 'bg-lime-400 text-navy-900',
};

export function Insignia({ tono = 'neutro', children, punto = false, className }: {
  tono?: TonoInsignia;
  children: ReactNode;
  /** Puntito adelante (estados "en vivo", "pendiente"). */
  punto?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold', TONO_INSIGNIA[tono], className)}>
      {punto && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// ─── Selector segmentado ─────────────────────────────────────────────────────

/**
 * Opciones mutuamente excluyentes (método de pago, período, tipo). El elegido va en azul
 * marino lleno. `valor` puede ser null: nada elegido (hay pantallas que lo necesitan,
 * p.ej. quién cobró cuando la cuenta es compartida).
 */
export function Segmentado<T extends string>({ opciones, valor, alCambiar, etiqueta, className, anchoCompleto = false }: {
  opciones: { valor: T; texto: ReactNode; icono?: ReactNode }[];
  valor: T | null;
  alCambiar: (v: T) => void;
  /** Para el lector de pantalla. */
  etiqueta: string;
  className?: string;
  anchoCompleto?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className={cn('sin-barra inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1', anchoCompleto && 'flex w-full', className)}>
      {opciones.map((o) => {
        const elegido = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={elegido}
            onClick={() => alCambiar(o.valor)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold transition-colors',
              anchoCompleto && 'flex-1',
              elegido ? 'bg-navy-700 text-white shadow-sm' : 'text-gray-600 hover:bg-white hover:text-navy-700',
            )}
          >
            {o.icono}
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

// ─── Barra de filtros ────────────────────────────────────────────────────────

/** Buscador + chips que se deslizan en el celular (no 4 renglones de botones). */
export function BarraFiltros({ busqueda, alBuscar, placeholder = 'Buscar…', chips, acciones, className }: {
  busqueda?: string;
  alBuscar?: (texto: string) => void;
  placeholder?: string;
  chips?: ReactNode;
  acciones?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 space-y-3', className)}>
      {(alBuscar || acciones) && (
        <div className="flex gap-2">
          {alBuscar && (
            <div className="relative min-w-0 flex-1">
              <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={busqueda ?? ''}
                onChange={(e) => alBuscar(e.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
                className="h-11 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-10 text-base text-navy-700 placeholder:text-gray-400 focus:border-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-700/15 sm:text-sm"
              />
              {busqueda && (
                <button type="button" onClick={() => alBuscar('')} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:text-navy-700">
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          {acciones}
        </div>
      )}
      {chips && <div className="sin-barra -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">{chips}</div>}
    </div>
  );
}

/** Chip de filtro (toggle). Elegido = azul marino lleno. */
export function Chip({ activo, onClick, children, cantidad }: { activo: boolean; onClick: () => void; children: ReactNode; cantidad?: number }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition-colors',
        activo ? 'border-navy-700 bg-navy-700 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-navy-700 hover:text-navy-700',
      )}
    >
      {children}
      {cantidad !== undefined && (
        <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', activo ? 'bg-white/20' : 'bg-gray-100 text-gray-600')}>{cantidad}</span>
      )}
    </button>
  );
}

// ─── Estados: vacío, cargando, error ─────────────────────────────────────────

export function Vacio({ icono, titulo, descripcion, accion, className }: {
  icono?: ReactNode;
  titulo: string;
  descripcion?: ReactNode;
  accion?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center', className)}>
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">{icono ?? <Inbox size={22} />}</span>
      <p className="font-display text-base font-bold text-navy-700">{titulo}</p>
      {descripcion && <p className="mt-1 max-w-sm text-sm text-gray-500">{descripcion}</p>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}

/** Esqueleto de filas mientras carga (la pantalla ya tiene su forma, no un spinner suelto). */
export function CargandoFilas({ filas = 4, className }: { filas?: number; className?: string }) {
  return (
    <div role="status" aria-label="Cargando" className={cn('space-y-2', className)}>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} aria-hidden className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="h-10 w-10 shrink-0 rounded-lg bg-gray-100 motion-safe:animate-pulse" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/5 rounded bg-gray-100 motion-safe:animate-pulse" />
            <div className="h-3 w-1/4 rounded bg-gray-100 motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorEstado({ mensaje, alReintentar, className }: { mensaje: string; alReintentar?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center', className)}>
      <AlertTriangle size={22} className="mb-2 text-red-600" />
      <p className="text-sm font-semibold text-red-800">{mensaje}</p>
      {alReintentar && (
        <button type="button" onClick={alReintentar} className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg border border-red-300 bg-white px-4 text-sm font-bold text-red-700 hover:bg-red-100">
          <RotateCw size={15} /> Reintentar
        </button>
      )}
    </div>
  );
}
