import type React from 'react';
import { m, type Variants } from 'framer-motion';

// Lenguaje de movimiento de la web pública (rediseño 24/09). Una sola curva para todo:
// arranca rápido y frena largo, que es lo que se lee como "caro" (las marcas deportivas
// grandes usan esta familia). Duraciones: 0,2–0,3 s en hovers, 0,6–0,7 s en entradas.
// OJO: la app corre dentro de <LazyMotion strict>: usar SIEMPRE `m.*`, nunca `motion.*`
// (tira error). Y dentro de <MotionConfig reducedMotion="user">: con "reducir movimiento"
// del sistema, framer saltea los desplazamientos solo.

export const EASE_VOLEA = [0.16, 1, 0.3, 1] as const;

/** Entra desde abajo cuando aparece en pantalla (una sola vez). `delay` en ms. */
export function Reveal({ children, className = '', delay = 0, y = 32 }: { children: React.ReactNode; className?: string; delay?: number; y?: number }) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, delay: delay / 1000, ease: EASE_VOLEA }}
    >
      {children}
    </m.div>
  );
}

const STAGGER_CONTAINER: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const STAGGER_ITEM: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_VOLEA } },
};

/** Grilla cuyos hijos (StaggerItem) entran en cascada. */
export function StaggerGrid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <m.div className={className} variants={STAGGER_CONTAINER} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-80px' }}>
      {children}
    </m.div>
  );
}

export function StaggerItem({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <m.div variants={STAGGER_ITEM} className={className}>
      {children}
    </m.div>
  );
}
