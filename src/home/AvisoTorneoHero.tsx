import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays } from 'lucide-react';
import type { EnVivoHome } from './torneosHome';

// Aviso de torneos ARRIBA de todo en la home (antes lo de torneos/"en vivo" aparecía recién
// a ~1.800px de scroll en el celular). Una píldora sola, sobre el rótulo del hero: no
// empuja la tienda ni compite con "Ver la colección".
//   · Torneo en juego (misma regla que la sección de torneos: fase abierta + actividad en
//     las últimas 6 h) → "En vivo · <nombre>", lleva al cuadro.
//   · Si no, el próximo evento de la agenda (`proximo`, sale de `events`) → "Se viene …".
//     Desde xl ese ya lo anuncia el cartel neón de la derecha: ahí la píldora no va.
// La consulta de torneos y su código bajan DESPUÉS del primer dibujado (import dinámico y
// en un momento ocioso): el hero no espera a nada.

export type ProximoHero = { etiqueta: string; nombre: string; fecha: string; to: string };

function cuandoOcioso(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 2500 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(t);
}

const PILDORA =
  'group inline-flex min-h-[44px] max-w-full items-center gap-2.5 rounded-full border py-2 pl-3.5 pr-4 font-display text-xs font-bold uppercase tracking-wider text-white transition-colors duration-200';

export function AvisoTorneoHero({ proximo }: { proximo: ProximoHero | null }) {
  const [enVivo, setEnVivo] = useState<EnVivoHome | null>(null);

  useEffect(() => {
    let vigente = true;
    const cancelar = cuandoOcioso(() => {
      void (async () => {
        try {
          const [{ torneosPublicosCompartidos }, { enVivoHome }] = await Promise.all([
            import('./torneosCompartidos'),
            import('./torneosHome'),
          ]);
          const r = await torneosPublicosCompartidos();
          if (!vigente || r.error) return;
          setEnVivo(enVivoHome(r.torneos, Date.now()));
        } catch (err) {
          // Opcional: si no se pudo saber, no se muestra (la sección de abajo lo reintenta).
          console.warn('[home] aviso en vivo omitido', err);
        }
      })();
    });
    return () => { vigente = false; cancelar(); };
  }, []);

  if (enVivo) {
    return (
      <div className="fade-in mb-6">
        <Link to={enVivo.to} className={`${PILDORA} border-red-400/60 bg-red-500/15 hover:border-red-300 hover:bg-red-500/25`}>
          <span aria-hidden className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <span className="truncate">En vivo · {enVivo.nombre}</span>
          <ArrowRight aria-hidden size={14} className="shrink-0 transition-transform duration-300 group-hover:translate-x-0.5" />
        </Link>
      </div>
    );
  }
  if (!proximo) return null;
  return (
    <div className="hero-enter hero-enter-1 mb-6 opacity-0 xl:hidden">
      <Link
        to={proximo.to}
        aria-label={`${proximo.etiqueta}: ${proximo.nombre}, ${proximo.fecha}`}
        className={`${PILDORA} border-lime-400/50 bg-navy-900/60 hover:border-lime-400`}
      >
        <CalendarDays aria-hidden size={15} className="shrink-0 text-lime-400" />
        <span className="shrink-0 text-lime-400">{proximo.etiqueta}</span>
        {/* El nombre se corta si no entra; la fecha, nunca (es el dato). */}
        <span className="min-w-0 truncate">{proximo.nombre}</span>
        <span className="shrink-0 text-white/70">{proximo.fecha}</span>
        <ArrowRight aria-hidden size={14} className="shrink-0 transition-transform duration-300 group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
