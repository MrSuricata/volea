import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

// Botones del panel (rediseño 24/09). Antes había 3 "primarios" (lima, navy, rojo) con 8
// combinaciones de padding. Regla: primario = azul marino; lima SOLO sobre fondo oscuro
// (variante `acento`); peligro = rojo. Alto 44px (lo mínimo para tocar con el dedo en un
// torneo); `chico` (36px) solo para tablas densas de compu.

export type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro' | 'acento';

const VARIANTES: Record<VarianteBoton, string> = {
  primario: 'bg-navy-700 text-white hover:bg-navy-800 disabled:bg-gray-300 disabled:text-gray-500',
  secundario: 'border border-gray-300 bg-white text-navy-700 hover:border-navy-700 disabled:text-gray-400 disabled:hover:border-gray-300',
  fantasma: 'text-navy-700 hover:bg-navy-50 disabled:text-gray-400 disabled:hover:bg-transparent',
  peligro: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  acento: 'bg-lime-400 text-navy-900 hover:bg-lime-300 disabled:bg-lime-400/40',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBoton;
  chico?: boolean;
  /** Muestra un spinner y deshabilita (evita el doble toque que duplica ventas). */
  cargando?: boolean;
  icono?: ReactNode;
  anchoCompleto?: boolean;
};

export const Boton = forwardRef<HTMLButtonElement, Props>(function Boton(
  { variante = 'primario', chico = false, cargando = false, icono, anchoCompleto = false, className, children, disabled, type = 'button', ...resto },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-lg font-display font-bold transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100',
        chico ? 'h-9 px-3 text-[13px]' : 'h-11 px-5 text-sm',
        VARIANTES[variante],
        anchoCompleto && 'w-full',
        className,
      )}
      {...resto}
    >
      {cargando ? <Loader2 size={chico ? 15 : 17} className="animate-spin" /> : icono}
      {children}
    </button>
  );
});

type PropsIcono = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Obligatorio: es lo que dice el lector de pantalla (y el tooltip). */
  etiqueta: string;
  icono: ReactNode;
  tono?: 'neutro' | 'peligro' | 'claro';
};

/** Botón de solo ícono con área de toque de 44px aunque el ícono sea de 16-18px. */
export const BotonIcono = forwardRef<HTMLButtonElement, PropsIcono>(function BotonIcono(
  { etiqueta, icono, tono = 'neutro', className, type = 'button', ...resto },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={etiqueta}
      title={etiqueta}
      className={cn(
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        tono === 'neutro' && 'text-gray-500 hover:bg-gray-100 hover:text-navy-700',
        tono === 'peligro' && 'text-gray-500 hover:bg-red-50 hover:text-red-600',
        tono === 'claro' && 'text-white/70 hover:bg-white/10 hover:text-white',
        className,
      )}
      {...resto}
    >
      {icono}
    </button>
  );
});
