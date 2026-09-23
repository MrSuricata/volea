// Carga de las features de framer-motion para <LazyMotion> (App.tsx).
//
// POR QUÉ tanto cuidado: con LazyMotion, un m.div con `initial={{ opacity: 0 }}` se pinta
// invisible y recién se anima cuando llegan las features. Si el chunk no llega (señal
// mala, un deploy que borró el hash), PageTransition deja TODAS las páginas en blanco.
// Entonces: UNA recarga con la misma bandera anti-loop que lazyConRecarga; y si ni así,
// la clase `sin-animaciones` en <html> hace que index.html muestre todo quieto en vez de
// invisible. (Reintentar el import() en la misma página no sirve: Chrome recuerda el
// módulo fallido y ni vuelve a pedirlo — probado.)

import type { FeatureBundle } from 'framer-motion';
import { almacenSesion } from '../utils/almacen';

export async function cargarFeaturesMotion(): Promise<FeatureBundle> {
  try {
    return (await import('./motionFeatures')).default;
  } catch (err) {
    // La bandera NO se borra al andar (eso lo hace lazyConRecarga): si se borrara acá,
    // un chunk lazy roto recargaría la página una y otra vez.
    if (!almacenSesion.leer('volea_chunk_retry') && almacenSesion.guardar('volea_chunk_retry', '1')) {
      window.location.reload();
      return new Promise<FeatureBundle>(() => {});
    }
    document.documentElement.classList.add('sin-animaciones');
    console.error('[animaciones] no llegaron las features de framer-motion; sigo sin animar', err);
    return new Promise<FeatureBundle>(() => {});
  }
}
