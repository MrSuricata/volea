import type { Order } from '../types';

// Cobro de un pedido de la tienda. El estado del pedido (pendiente → entregado) es la
// entrega; la plata vive en la Caja (bot_ledger), en una venta que apunta al pedido.

/** La venta de Caja que corresponde a un pedido (solo las no anuladas). */
export interface CobroPedido {
  ledgerId: string;
  orderId: string;
  metodo: 'mp' | 'efectivo' | 'transferencia' | 'debe';
  /** Cuándo se cobró la deuda (solo si metodo = 'debe'); null = sigue debiendo. */
  saldadoEl: string | null;
  saldadoCon: 'mp' | 'efectivo' | 'transferencia' | null;
}

export type EstadoCobro =
  | { tipo: 'cobrado'; metodo: 'mp' | 'efectivo' | 'transferencia'; cobro: CobroPedido }
  | { tipo: 'debe'; cobro: CobroPedido }
  | { tipo: 'pagado-mp' }
  | { tipo: 'sin-cobrar' };

export const TEXTO_METODO: Record<'mp' | 'efectivo' | 'transferencia' | 'debe', string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  debe: 'Debe',
};

export function estadoCobro(pedido: Order, cobro: CobroPedido | undefined): EstadoCobro {
  if (cobro) {
    if (cobro.metodo !== 'debe') return { tipo: 'cobrado', metodo: cobro.metodo, cobro };
    if (cobro.saldadoEl) return { tipo: 'cobrado', metodo: cobro.saldadoCon ?? 'efectivo', cobro };
    return { tipo: 'debe', cobro };
  }
  // Pagado online y acreditado: la plata ya entró aunque todavía no esté en la Caja.
  if (pedido.paymentStatus === 'aprobado' && !pedido.requiereRevision) return { tipo: 'pagado-mp' };
  return { tipo: 'sin-cobrar' };
}

/**
 * Pedidos a los que hay que perseguir la plata: confirmados en adelante (un pendiente
 * todavía puede no concretarse), sin cobrar o anotados como deuda.
 */
export function faltaCobrar(pedido: Order, cobro: CobroPedido | undefined): boolean {
  if (pedido.status === 'pending') return false;
  const e = estadoCobro(pedido, cobro);
  return e.tipo === 'sin-cobrar' || e.tipo === 'debe';
}
