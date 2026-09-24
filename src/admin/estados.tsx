import { AlertTriangle, CreditCard } from 'lucide-react';
import type { Order, PaymentStatus } from '../types';
import { Insignia, type TonoInsignia } from './ui';

// Un solo mapa estado → texto/tono por dominio (antes cada pantalla pintaba los suyos con
// colores pastel distintos y el mismo azul significaba tres cosas).

export const ESTADOS_PEDIDO: Record<Order['status'], { texto: string; tono: TonoInsignia }> = {
  pending: { texto: 'Pendiente', tono: 'atencion' },
  confirmed: { texto: 'Confirmado', tono: 'info' },
  shipped: { texto: 'Enviado', tono: 'navy' },
  delivered: { texto: 'Entregado', tono: 'bien' },
};

/** Orden del circuito: sirve para saber si un cambio de estado va "para atrás". */
export const ORDEN_PEDIDO: Order['status'][] = ['pending', 'confirmed', 'shipped', 'delivered'];

export function InsigniaPedido({ estado }: { estado: Order['status'] }) {
  const e = ESTADOS_PEDIDO[estado] ?? { texto: estado, tono: 'neutro' as const };
  return <Insignia tono={e.tono} punto>{e.texto}</Insignia>;
}

const PAGO_MP: Record<PaymentStatus, { texto: string; tono: TonoInsignia }> = {
  aprobado: { texto: 'Pagado (MP)', tono: 'bien' },
  pendiente: { texto: 'MP en proceso', tono: 'atencion' },
  iniciado: { texto: 'MP sin terminar', tono: 'neutro' },
  rechazado: { texto: 'MP rechazado', tono: 'alerta' },
  devuelto: { texto: 'MP devuelto', tono: 'atencion' },
};

/**
 * Estado del pago online de un pedido (null = pedido por WhatsApp, sin MP).
 * v24: si el webhook dejó el pago para revisar, eso gana: un "Pagado" con el monto
 * equivocado no puede verse verde.
 */
export function InsigniaPagoMP({ order }: { order: Order }) {
  if (order.requiereRevision) {
    return (
      <Insignia tono="alerta" className="font-bold">
        <AlertTriangle size={12} aria-hidden /> Revisar pago
      </Insignia>
    );
  }
  if (!order.paymentStatus) return null;
  const c = PAGO_MP[order.paymentStatus];
  if (!c) return null;
  return (
    <Insignia tono={c.tono}>
      <CreditCard size={12} aria-hidden /> {c.texto}
    </Insignia>
  );
}
