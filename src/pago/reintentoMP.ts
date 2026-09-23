// Pedidos de la web para Mercado Pago: id difícil de adivinar y reuso del pedido
// cuando el cliente reintenta "Pagar con Mercado Pago".
//
// POR QUÉ (auditoría 23/09):
// - #10: el id era `VO-<timestamp>`: probando ids se podía saber si un pedido existía
//   o estaba pago. Ahora lleva 8 caracteres hex al azar.
// - #15: cada clic en "Pagar" creaba un pedido nuevo en estado "iniciado", aunque el
//   anterior no hubiera llegado a MP (red, preferencia rechazada). El panel se llenaba
//   de pedidos huérfanos. Ahora, si el carrito y los datos del cliente son los mismos y
//   el pedido es reciente, se reintenta con ESE pedido (el server acepta "iniciado" y
//   "rechazado" hasta 2 h: api/mp/preferencia.ts).

import type { Order } from '../types';

export const CLAVE_PEDIDO_MP = 'volea_pedido_mp';
/** Menos que las 2 h que acepta el server, para no reintentar con uno que va a dar 404. */
export const VENTANA_REUSO_MS = 90 * 60 * 1000;

/**
 * `VO-<timestamp base36>-<8 hex>`. getRandomValues y no randomUUID: el build legacy
 * apunta a Chrome 60 (TVs del club) y randomUUID llegó en Chrome 92.
 */
export function idPedidoWeb(ahora: number = Date.now()): string {
  const b = new Uint8Array(4);
  try {
    crypto.getRandomValues(b);
  } catch {
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `VO-${ahora.toString(36).toUpperCase()}-${hex}`;
}

/** Lo que tiene que coincidir para que dos intentos sean "el mismo pedido". */
export function firmaPedido(o: Pick<Order, 'items' | 'customer' | 'total'>): string {
  return JSON.stringify({
    items: o.items.map((i) => [i.product.id, i.selectedSize, i.selectedColor, i.quantity]),
    cliente: o.customer,
    total: o.total,
  });
}

type Guardado = { id: string; firma: string; creado: number };

export function registroPedidoMP(id: string, firma: string, ahora: number = Date.now()): string {
  return JSON.stringify({ id, firma, creado: ahora } satisfies Guardado);
}

/** El id guardado si sirve para reintentar este mismo pedido; si no, null. */
export function pedidoReusable(guardado: string | null, firma: string, ahora: number = Date.now()): string | null {
  if (!guardado) return null;
  try {
    const g = JSON.parse(guardado) as Partial<Guardado>;
    if (typeof g.id !== 'string' || typeof g.creado !== 'number' || g.firma !== firma) return null;
    if (ahora - g.creado > VENTANA_REUSO_MS || ahora < g.creado) return null;
    return g.id;
  } catch {
    return null;
  }
}
