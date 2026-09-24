import type React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './movimiento';

type Props = {
  /** Rótulo chico arriba del título ("Torneos VOLEA"). */
  eyebrow: string;
  titulo: React.ReactNode;
  bajada?: React.ReactNode;
  /** Link "Ver todo" a la derecha (abajo del título en celular). */
  link?: { to: string; texto: string };
  tono?: 'claro' | 'oscuro';
  className?: string;
};

// Encabezado de sección de la home y páginas públicas. Antes cada sección repetía
// "rótulo + título centrado + rayita lime": con cinco seguidas la home parecía una
// plantilla. Ahora: alineado a la izquierda, título grande en mayúsculas y el "ver todo"
// a mano (patrón de las marcas deportivas grandes).
export function EncabezadoSeccion({ eyebrow, titulo, bajada, link, tono = 'claro', className = '' }: Props) {
  const oscuro = tono === 'oscuro';
  return (
    <Reveal className={`mb-8 flex flex-col gap-4 md:mb-12 md:flex-row md:items-end md:justify-between ${className}`}>
      <div className="max-w-2xl">
        <p className={`inline-flex items-center gap-3 font-display text-xs font-bold uppercase tracking-[0.25em] ${oscuro ? 'text-lime-400' : 'text-lime-800'}`}>
          <span aria-hidden className="h-px w-6 bg-lime-400" />
          {eyebrow}
        </p>
        <h2 className={`mt-3 font-display text-3xl font-black uppercase leading-[0.95] tracking-tight md:text-5xl ${oscuro ? 'text-white' : 'text-navy-700'}`}>
          {titulo}
        </h2>
        {bajada && (
          <p className={`mt-4 max-w-xl text-sm leading-relaxed md:text-base ${oscuro ? 'text-white/60' : 'text-gray-500'}`}>{bajada}</p>
        )}
      </div>
      {link && (
        <Link
          to={link.to}
          className={`group inline-flex shrink-0 items-center gap-2 self-start font-display text-sm font-bold uppercase tracking-wider transition-colors md:self-auto ${
            oscuro ? 'text-white hover:text-lime-400' : 'text-navy-700 hover:text-lime-800'
          }`}
        >
          {link.texto}
          <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
      )}
    </Reveal>
  );
}
