import { lazy, type ComponentType } from 'react';
import { almacenSesion } from '../utils/almacen';

// Un deploy nuevo borra los chunks viejos de Vercel: la pestaña abierta de ANTES del
// deploy pide un hash que ya no existe, el rewrite devuelve HTML y el import() explota
// con pantalla blanca (peor caso: volver de PAGAR en Mercado Pago a /pago/resultado).
// Si el import() falla, recargamos UNA vez para traer el index nuevo (la bandera en
// sessionStorage evita el loop); si vuelve a fallar, el throw cae en el ErrorBoundary raíz.
// almacenSesion y no sessionStorage pelado: con el almacenamiento bloqueado, el
// removeItem del .then tiraba y hacía fallar TODAS las páginas lazy. Si la bandera no
// se puede guardar tampoco se recarga (sin bandera no hay freno para el loop).
export const lazyConRecarga = <T extends ComponentType<any>>(imp: () => Promise<{ default: T }>) =>
  lazy(() =>
    imp()
      .then((m) => { almacenSesion.borrar('volea_chunk_retry'); return m; })
      .catch((err) => {
        if (!almacenSesion.leer('volea_chunk_retry') && almacenSesion.guardar('volea_chunk_retry', '1')) {
          window.location.reload();
          // Promesa que nunca resuelve: la página ya se está recargando, no hay que renderizar nada.
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      }),
  );

// Fallback compartido de las pestañas lazy del admin (mismo look que el de Torneos) y de
// la ruta /admin mientras baja el chunk del panel.
export const cargandoTab = <div className="text-navy-500 text-sm py-8 text-center">Cargando…</div>;
