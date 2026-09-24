import {
  cloneElement, forwardRef, isValidElement, useId, useState,
  type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';
import { formatoPlata, leerPlata } from './plata';

// Formularios del panel. Antes: 4 estilos de input, foco en lima (sobre blanco casi no se
// ve), labels sin htmlFor y texto de 14px que en iPhone hace zoom al enfocar. Ahora:
// 44px de alto, 16px en celular (sin zoom), foco azul marino bien visible.

export const claseEntrada =
  'h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-navy-700 placeholder:text-gray-400 transition-[border-color,box-shadow] focus:border-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-700/15 disabled:bg-gray-50 disabled:text-gray-500 sm:text-sm';

type PropsCampo = {
  etiqueta: ReactNode;
  /** Texto de ayuda chico debajo (se oculta si hay error). */
  ayuda?: ReactNode;
  error?: string | null;
  requerido?: boolean;
  className?: string;
  /** Un único control (Entrada, Selector, AreaTexto…): recibe id y aria-* solo. */
  children: ReactElement<{ id?: string }>;
};

/** Etiqueta + control + ayuda/error, enlazados con id (el lector lee todo junto). */
export function Campo({ etiqueta, ayuda, error, requerido, className, children }: PropsCampo) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        'aria-describedby': error || ayuda ? idAyuda : undefined,
        'aria-invalid': error ? true : undefined,
      })
    : children;
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={children.props.id ?? id} className="mb-1.5 block text-[13px] font-semibold text-navy-700">
        {etiqueta}
        {requerido && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </label>
      {control}
      {error ? (
        <p id={idAyuda} className="mt-1.5 text-[13px] font-medium text-red-700">{error}</p>
      ) : ayuda ? (
        <p id={idAyuda} className="mt-1.5 text-[13px] text-gray-500">{ayuda}</p>
      ) : null}
    </div>
  );
}

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Entrada({ className, ...resto }, ref) {
  return <input ref={ref} className={cn(claseEntrada, className)} {...resto} />;
});

export const Selector = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Selector({ className, children, ...resto }, ref) {
  return (
    <select ref={ref} className={cn(claseEntrada, 'cursor-pointer pr-8', className)} {...resto}>
      {children}
    </select>
  );
});

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AreaTexto({ className, ...resto }, ref) {
  return <textarea ref={ref} className={cn(claseEntrada, 'h-auto min-h-[96px] py-2.5 leading-relaxed', className)} {...resto} />;
});

type PropsPlata = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  valor: number | null;
  alCambiar: (monto: number | null) => void;
};

/**
 * Input de plata: acepta "1.200", "1.200,50", "$ 890". Mientras se escribe se respeta lo
 * tipeado; al salir se muestra formateado. Reemplaza a los `type="number"` que leían
 * "1.200" como 1,2.
 */
export const EntradaPlata = forwardRef<HTMLInputElement, PropsPlata>(function EntradaPlata(
  { valor, alCambiar, className, onBlur, onFocus, ...resto },
  ref,
) {
  const [texto, setTexto] = useState<string | null>(null); // null = no se está editando
  const mostrado = texto ?? (valor === null || valor === undefined ? '' : formatoPlata(valor).replace('$ ', ''));
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn(claseEntrada, 'pl-7 tabular-nums', className)}
        value={mostrado}
        onFocus={(e) => { setTexto(valor === null || valor === undefined ? '' : String(valor).replace('.', ',')); onFocus?.(e); }}
        onChange={(e) => { setTexto(e.target.value); alCambiar(leerPlata(e.target.value)); }}
        onBlur={(e) => { setTexto(null); onBlur?.(e); }}
        {...resto}
      />
    </div>
  );
});

type PropsInterruptor = {
  activo: boolean;
  alCambiar: (activo: boolean) => void;
  etiqueta: ReactNode;
  descripcion?: ReactNode;
  disabled?: boolean;
};

/** Interruptor sí/no (en vez de pastillas "Activo Sí/No" o checkboxes sin estilo). */
export function Interruptor({ activo, alCambiar, etiqueta, descripcion, disabled }: PropsInterruptor) {
  return (
    <label className={cn('flex min-h-[44px] cursor-pointer items-center justify-between gap-4', disabled && 'cursor-not-allowed opacity-60')}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-navy-700">{etiqueta}</span>
        {descripcion && <span className="block text-[13px] text-gray-500">{descripcion}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        disabled={disabled}
        onClick={() => alCambiar(!activo)}
        className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', activo ? 'bg-navy-700' : 'bg-gray-300')}
      >
        <span className={cn('absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform', activo ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    </label>
  );
}
