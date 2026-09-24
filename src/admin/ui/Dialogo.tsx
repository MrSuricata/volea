import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Boton, type VarianteBoton } from './Boton';

// Modal único del panel (antes: 5 versiones copiadas, ninguna con portal, Escape ni foco).
// - Portal a <body>: los contenedores con transform (.fade-in, transiciones de página)
//   convierten `position: fixed` en relativo y el modal aparecía corrido.
// - En celular ocupa la pantalla con el pie (botones) fijo abajo: con el teclado abierto
//   los botones siguen a mano. En compu, centrado.
// - Escape / tocar afuera cierran, salvo que esté `ocupado` (guardando) — y si hay
//   cambios sin guardar (`sucio`) primero pregunta.
// - Bloquea el scroll de atrás, lleva el foco adentro y lo devuelve al cerrar.

const ANCHOS = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' } as const;

type Props = {
  abierto: boolean;
  titulo: ReactNode;
  descripcion?: ReactNode;
  alCerrar: () => void;
  children: ReactNode;
  /** Botones de abajo (quedan fijos). */
  pie?: ReactNode;
  ancho?: keyof typeof ANCHOS;
  /** Guardando: no se puede cerrar hasta que termine. */
  ocupado?: boolean;
  /** Hay cambios sin guardar: pregunta antes de descartarlos. */
  sucio?: boolean;
};

export function Dialogo({ abierto, titulo, descripcion, alCerrar, children, pie, ancho = 'md', ocupado = false, sucio = false }: Props) {
  const idTitulo = useId();
  const caja = useRef<HTMLDivElement>(null);

  const intentarCerrar = useCallback(() => {
    if (ocupado) return;
    if (sucio && !window.confirm('Tenés cambios sin guardar. ¿Descartarlos?')) return;
    alCerrar();
  }, [ocupado, sucio, alCerrar]);

  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement as HTMLElement | null;
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Foco al primer campo (o a la caja): el teclado queda adentro del modal.
    const t = setTimeout(() => {
      const primero = caja.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select, textarea, [data-autofoco]');
      (primero ?? caja.current)?.focus();
    }, 30);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = overflowPrevio;
      previo?.focus?.();
    };
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); intentarCerrar(); return; }
      if (e.key !== 'Tab' || !caja.current) return;
      // Tab no se escapa del modal.
      const focos = caja.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (focos.length === 0) return;
      const primero = focos[0];
      const ultimo = focos[focos.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [abierto, intentarCerrar]);

  if (!abierto) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden className="absolute inset-0 bg-navy-900/50 motion-safe:animate-[fadeIn_0.15s_ease-out]" onClick={intentarCerrar} />
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[100dvh] w-full flex-col bg-white shadow-2xl outline-none sm:max-h-[90dvh] sm:rounded-2xl',
          'h-[100dvh] sm:h-auto',
          ANCHOS[ancho],
        )}
      >
        <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1 pt-1.5">
            <h2 id={idTitulo} className="font-display text-lg font-bold leading-tight text-navy-700">{titulo}</h2>
            {descripcion && <p className="mt-1 text-sm text-gray-500">{descripcion}</p>}
          </div>
          <button
            type="button"
            onClick={intentarCerrar}
            disabled={ocupado}
            aria-label="Cerrar"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">{children}</div>
        {pie && (
          <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6 sm:py-4">
            {pie}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmación (borrar, anular, liquidar). El botón fuerte dice exactamente qué hace. */
export function Confirmar({ abierto, titulo, mensaje, textoConfirmar, variante = 'peligro', cargando = false, deshabilitado = false, alConfirmar, alCerrar }: {
  abierto: boolean;
  titulo: ReactNode;
  mensaje?: ReactNode;
  textoConfirmar: string;
  variante?: VarianteBoton;
  cargando?: boolean;
  /** Ej.: todavía no se sabe cuántos inscriptos tiene el evento. */
  deshabilitado?: boolean;
  alConfirmar: () => void;
  alCerrar: () => void;
}) {
  return (
    <Dialogo
      abierto={abierto}
      titulo={titulo}
      alCerrar={alCerrar}
      ancho="sm"
      ocupado={cargando}
      pie={(
        <>
          <Boton variante="secundario" onClick={alCerrar} disabled={cargando}>Cancelar</Boton>
          <Boton variante={variante} onClick={alConfirmar} cargando={cargando} disabled={deshabilitado} data-autofoco>{textoConfirmar}</Boton>
        </>
      )}
    >
      {mensaje && <div className="text-sm leading-relaxed text-gray-600">{mensaje}</div>}
    </Dialogo>
  );
}
