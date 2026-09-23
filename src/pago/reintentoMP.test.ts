import { describe, expect, it } from 'vitest';
import type { Order } from '../types';
import { firmaPedido, idPedidoWeb, pedidoReusable, registroPedidoMP, VENTANA_REUSO_MS } from './reintentoMP';

const pedido = (cantidad = 1, nombre = 'Ana'): Pick<Order, 'items' | 'customer' | 'total'> => ({
  items: [{ product: { id: 'p1' }, selectedSize: 'M', selectedColor: 'Negro', quantity: cantidad }] as Order['items'],
  customer: { name: nombre, phone: '099', email: '', address: '', city: '', department: '', notes: '' },
  total: 780 * cantidad,
});

describe('idPedidoWeb', () => {
  it('lleva una parte al azar y pasa el formato que exigen la base y el server', () => {
    const a = idPedidoWeb(1_790_000_000_000);
    const b = idPedidoWeb(1_790_000_000_000);
    expect(a).toMatch(/^VO-[0-9A-Z]+-[0-9A-F]{8}$/);
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,40}$/); // orders_validar_alta_publica y preferencia.ts
    expect(a).not.toBe(b);
  });
});

describe('pedidoReusable', () => {
  const ahora = 1_790_000_000_000;
  const firma = firmaPedido(pedido());

  it('reusa el pedido si es el mismo carrito y cliente, y es reciente', () => {
    const g = registroPedidoMP('VO-X-1', firma, ahora);
    expect(pedidoReusable(g, firma, ahora + 60_000)).toBe('VO-X-1');
  });

  it('no reusa si cambió el carrito o los datos del cliente', () => {
    const g = registroPedidoMP('VO-X-1', firma, ahora);
    expect(pedidoReusable(g, firmaPedido(pedido(2)), ahora)).toBeNull();
    expect(pedidoReusable(g, firmaPedido(pedido(1, 'Beto')), ahora)).toBeNull();
  });

  it('no reusa pasada la ventana (el server ya no lo aceptaría)', () => {
    const g = registroPedidoMP('VO-X-1', firma, ahora);
    expect(pedidoReusable(g, firma, ahora + VENTANA_REUSO_MS + 1)).toBeNull();
  });

  it('con nada guardado o basura, crea uno nuevo', () => {
    expect(pedidoReusable(null, firma, ahora)).toBeNull();
    expect(pedidoReusable('no json', firma, ahora)).toBeNull();
    expect(pedidoReusable('{"id":1}', firma, ahora)).toBeNull();
  });
});
