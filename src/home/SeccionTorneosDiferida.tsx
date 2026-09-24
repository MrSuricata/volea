import { Component, Suspense, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { lazyConRecarga } from '../lib/lazyConRecarga';

// La sección de torneos baja el motor de torneos + tres consultas a Supabase: nada de eso
// hace falta para pintar la home. Se monta recién cuando el visitante se acerca (600px
// antes de que entre en pantalla) y, una vez montada, queda montada.
const SeccionTorneos = lazyConRecarga(() => import('./SeccionTorneos'));

// Reserva de lugar mientras baja el chunk, con la altura medida de la sección (esqueleto
// y contenido real con la Racket Roll: 390px ≈ 1.335px; tablet ≈ 1.500px porque las
// tarjetas van apiladas y con más aire; lg en adelante ≈ 1.130px), así el resto de la
// home no salta cuando aparece. Vive SOLO como fallback del Suspense: apenas el chunk
// renderiza manda la altura real de la sección (esqueleto → contenido), y si no hay
// datos la sección devuelve null y no queda ningún hueco.
const RESERVA = <div aria-hidden className="min-h-[1340px] bg-navy-900 md:min-h-[1510px] lg:min-h-[1130px]" />;

// Sección opcional: si el chunk no llega ni recargando o algo revienta al dibujarla, se
// omite en silencio. Sin esto el error subía al ErrorBoundary raíz y tiraba la home entera.
class SinSeccionSiFalla extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false };

  static getDerivedStateFromError() {
    return { fallo: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[home torneos] la sección falló y se omite', error, info);
  }

  render() {
    return this.state.fallo ? null : this.props.children;
  }
}

export function SeccionTorneosDiferida() {
  const ref = useRef<HTMLDivElement>(null);
  // Sin IntersectionObserver (navegadores muy viejos) se monta de una.
  const [montar, setMontar] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (montar) return;
    const el = ref.current;
    if (!el) return;
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setMontar(true);
          observador.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    observador.observe(el);
    return () => observador.disconnect();
  }, [montar]);

  return (
    <div ref={ref}>
      {montar ? (
        <SinSeccionSiFalla>
          <Suspense fallback={RESERVA}>
            <SeccionTorneos />
          </Suspense>
        </SinSeccionSiFalla>
      ) : (
        RESERVA
      )}
    </div>
  );
}
