// La promo del momento, compartida por la tienda (App.tsx) y la vitrina de las páginas
// de torneos (VitrinaTienda): si cada una la calculara a su manera, el mismo producto
// podría mostrarse con dos precios distintos en el sitio.

import { useEffect, useMemo, useState } from 'react';
import type { Promo } from '../types';
import { hoyMontevideo, promoPorVenir, promoVigente } from '../utils/promo';
import { useStore } from './store';

/**
 * `activa` descuenta AHORA (el mismo cálculo que cobra Mercado Pago en el server);
 * `proxima` es la que se anuncia antes de arrancar.
 */
export function usePromo(): { activa: Promo | null; proxima: Promo | null } {
  const { promos } = useStore();
  // `hoy` es ESTADO y se refresca al volver a la pestaña (y cada minuto): calculado
  // una sola vez quedaba congelado en la fecha de carga — una pestaña abierta el 16
  // y retomada el 18 no mostraba el descuento, y el pedido por WhatsApp salía a
  // precio de lista: sobrecobro silencioso. El caso inverso (carrito abierto
  // cruzando el fin de la promo) mostraba un descuento que MP ya no iba a hacer.
  const [hoy, setHoy] = useState(hoyMontevideo);
  useEffect(() => {
    const tick = () => setHoy(hoyMontevideo());
    document.addEventListener('visibilitychange', tick); // es evento de document, no de window
    window.addEventListener('focus', tick);
    const id = setInterval(tick, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
      clearInterval(id);
    };
  }, []);
  return useMemo(
    () => ({ activa: promoVigente(promos, hoy), proxima: promoPorVenir(promos, hoy) }),
    [promos, hoy],
  );
}
