import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'framer-motion';

// Número que cuenta de 0 al valor cuando entra en pantalla (una vez). Con "reducir
// movimiento" o sin requestAnimationFrame muestra el valor final directo. El texto
// accesible es siempre el valor final (el lector no escucha la cuenta).
export function Contador({ valor, duracionMs = 1200, className = '' }: { valor: number; duracionMs?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const visto = useInView(ref, { once: true, margin: '-40px' });
  const reducir = useReducedMotion();
  const [mostrado, setMostrado] = useState(0);

  useEffect(() => {
    if (!visto) return;
    if (reducir || typeof requestAnimationFrame !== 'function') { setMostrado(valor); return; }
    let raf = 0;
    const inicio = performance.now();
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / duracionMs);
      const suave = 1 - Math.pow(1 - t, 4); // ease-out: frena al llegar
      setMostrado(Math.round(valor * suave));
      if (t < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [visto, valor, duracionMs, reducir]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      <span className="sr-only">{valor.toLocaleString('es-UY')}</span>
      <span aria-hidden>{mostrado.toLocaleString('es-UY')}</span>
    </span>
  );
}
