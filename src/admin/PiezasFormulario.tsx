import { useId, type ReactNode } from 'react';

// Piezas chicas compartidas por los formularios del catálogo (evento, club, anuncio).
// No van en ./ui para no tocar el kit: si otra pantalla las necesita, se mudan allá.

/** Separa los bloques de un formulario con una línea fina (solo entre bloques). */
export const CLASE_FORMULARIO =
  'space-y-6 [&>section+section]:border-t [&>section+section]:border-gray-100 [&>section+section]:pt-6';

/** Bloque del formulario con su rótulo chico (mismo estilo que los rótulos del panel). */
export function GrupoFormulario({ titulo, children, acciones }: { titulo: string; children: ReactNode; acciones?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id={id} className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500">{titulo}</h3>
        {acciones}
      </div>
      {children}
    </section>
  );
}

/** Rótulo visible para controles que no son un input (Segmentado, grupo de opciones). */
export function Rotulo({ children, id }: { children: ReactNode; id?: string }) {
  return <p id={id} className="mb-1.5 text-[13px] font-semibold text-navy-700">{children}</p>;
}

/** "Descartar cambios" también desde el botón Cancelar (el Dialogo ya lo hace con la X y afuera). */
export function confirmarDescarte(sucio: boolean): boolean {
  return !sucio || window.confirm('Tenés cambios sin guardar. ¿Descartarlos?');
}
