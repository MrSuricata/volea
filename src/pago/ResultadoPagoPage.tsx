// Aterrizaje de la vuelta de Mercado Pago (via /api/mp/retorno → 302 acá).
// El estado que muestra es informativo (viene por query param); la fuente de
// verdad del pago la escribe el webhook en orders.
//
// clearCart llega por prop (no por useStore acá): esta página es un chunk lazy
// (ver ResultadoPagoRoute en App.tsx) y, como el resto de las páginas lazy del
// sitio (Galería, Ranking, Torneos), no importa el store directo de App.tsx —
// useStore no está exportado y el patrón establecido es que el wrapper *Route
// lea el store y pase lo necesario como prop.
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Clock, MessageCircle, XCircle } from 'lucide-react';
import { WHATSAPP_NUMBER } from '../constants';

interface ResultadoPagoPageProps {
  clearCart: () => void;
}

export default function ResultadoPagoPage({ clearCart }: ResultadoPagoPageProps) {
  const [params] = useSearchParams();
  const estado = params.get('estado') || 'desconocido';
  const pedido = params.get('pedido') || '';

  // El carrito recién se vacía cuando el pago salió bien (o quedó en proceso)
  // Y este navegador fue el que inició el pago: sin la bandera, un link
  // compartido de "pago aprobado" le vaciaría el carrito a quien lo abra.
  const pagoOk = estado === 'aprobado' || estado === 'pendiente';
  useEffect(() => {
    if (pagoOk && sessionStorage.getItem('volea_pago_en_curso')) {
      sessionStorage.removeItem('volea_pago_en_curso');
      clearCart();
    }
  }, [pagoOk, clearCart]);

  const msgWhatsApp = encodeURIComponent(
    `¡Hola! Acabo de pagar el pedido ${pedido} con Mercado Pago. ¿Coordinamos la entrega?`,
  );

  if (estado === 'aprobado') {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Check size={40} className="text-green-500" />
        </div>
        <h1 className="font-display text-3xl font-bold text-navy-700 mb-4">¡Pago recibido!</h1>
        <p className="text-gray-500 mb-2 max-w-md mx-auto">
          Tu pedido {pedido && <strong>{pedido}</strong>} quedó pago con Mercado Pago.
        </p>
        <p className="text-gray-500 mb-8 max-w-md mx-auto">
          Escribinos por WhatsApp para coordinar la entrega — o esperanos, que te escribimos nosotros.
        </p>
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}?text=${msgWhatsApp}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors"
        >
          <MessageCircle size={20} /> Coordinar entrega por WhatsApp
        </a>
      </div>
    );
  }

  if (estado === 'pendiente') {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Clock size={40} className="text-yellow-500" />
        </div>
        <h1 className="font-display text-3xl font-bold text-navy-700 mb-4">Pago en proceso</h1>
        <p className="text-gray-500 mb-8 max-w-md mx-auto">
          Mercado Pago todavía está procesando tu pago{pedido && <> del pedido <strong>{pedido}</strong></>}.
          Apenas se acredite te contactamos por WhatsApp para coordinar la entrega.
        </p>
        <Link to="/" className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors">
          Volver al inicio
        </Link>
      </div>
    );
  }

  // rechazado o desconocido
  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
      <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <XCircle size={40} className="text-red-500" />
      </div>
      <h1 className="font-display text-3xl font-bold text-navy-700 mb-4">El pago no se completó</h1>
      <p className="text-gray-500 mb-8 max-w-md mx-auto">
        No te preocupes: tu carrito sigue intacto. Podés intentar de nuevo con
        otro medio de pago o coordinar por WhatsApp como siempre.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link to="/checkout" className="inline-flex items-center justify-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors">
          Reintentar el pago
        </Link>
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 border-2 border-navy-700 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors hover:bg-navy-700 hover:text-white"
        >
          <MessageCircle size={20} /> Coordinar por WhatsApp
        </a>
      </div>
    </div>
  );
}
