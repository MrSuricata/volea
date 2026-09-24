import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { formatoPlata } from '../ui';

// Número grande compacto para las pantallas de plata. Es la Estadistica del kit con
// la cifra más chica en el celular: en una grilla de 2 columnas a 390px, un
// "$ 1.234.567" en text-2xl no entraba y el truncate se comía los últimos dígitos
// (una cifra de plata cortada miente). Si algún día el kit acepta tamaño, esto se va.

type Tono = 'neutro' | 'bien' | 'atencion' | 'alerta';

const TONO: Record<Tono, string> = {
  neutro: 'text-navy-700',
  bien: 'text-emerald-700',
  atencion: 'text-amber-700',
  alerta: 'text-red-700',
};

export function Kpi({ etiqueta, valor, detalle, tono = 'neutro', icono, plata = false, className }: {
  etiqueta: string;
  valor: number | string;
  detalle?: ReactNode;
  tono?: Tono;
  icono?: ReactNode;
  /** Formatea `valor` como plata (negativo con "−" adelante). */
  plata?: boolean;
  className?: string;
}) {
  const texto = plata && typeof valor === 'number' ? formatoPlata(valor) : String(valor);
  return (
    <div className={cn('min-w-0 rounded-xl border border-gray-200 bg-white p-3.5 sm:p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">{etiqueta}</p>
        {icono && <span className="shrink-0 text-gray-400">{icono}</span>}
      </div>
      <p title={texto} className={cn('mt-1.5 truncate font-display text-xl font-black leading-tight tabular-nums sm:text-2xl lg:text-[28px]', TONO[tono])}>
        {texto}
      </p>
      {detalle && <p className="mt-0.5 truncate text-xs text-gray-500">{detalle}</p>}
    </div>
  );
}
