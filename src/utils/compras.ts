// Guardado de las líneas de un pedido (compras a proveedor y encargos al taller).
//
// POR QUÉ: al editar un pedido se BORRABAN todas sus líneas y se reinsertaban con el
// `cantidad_recibida` que tenía el formulario, que puede estar viejo. Si mientras el
// modal estaba abierto alguien tocaba "Recibir 10" (+10 al stock), al guardar la línea
// volvía a 0 recibidas y el próximo "Recibir" sumaba las mismas 10 otra vez: stock
// duplicado. Y si el insert fallaba después del delete, el pedido quedaba sin líneas.
//
// Ahora: las líneas se guardan por id (upsert) SIN mandar `cantidad_recibida` — ese
// número lo escribe solo la recepción (RPC recibir_compra) —, las nuevas nacen con el
// 0 por defecto de la base, y se borran únicamente las que el usuario quitó y no
// tienen nada recibido. Todo se decide contra lo que hay en la base al guardar, no
// contra lo que el formulario creía.

import type { CompraItem } from '../types';

/** Lo que importa de una línea tal como está hoy en la base. */
export interface LineaEnBase {
  id: string;
  cantidadRecibida: number;
  descripcion: string;
}

/** Fila para el upsert de compra_items: sin compra_id (lo pone el servicio) ni cantidad_recibida. */
export interface FilaLineaCompra {
  id: string;
  product_id: string | null;
  descripcion: string;
  variante: string | null;
  cantidad: number;
  costo_unitario: number | null;
  orden: number;
}

export interface PlanLineasCompra {
  /** Líneas del formulario, listas para upsert por id. */
  filas: FilaLineaCompra[];
  /** Ids de líneas que el usuario quitó y no tienen nada recibido: se pueden borrar. */
  borrar: string[];
  /** Líneas que el usuario quitó pero ya tienen unidades recibidas: NO se borran. */
  retenidas: LineaEnBase[];
  /** Líneas que quedarían encargando menos de lo que ya llegó (según la base). */
  bajoLoRecibido: { descripcion: string; cantidad: number; recibida: number }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿Sirve como id de compra_items (columna UUID)? */
export const esUuid = (id: string): boolean => UUID.test(id);

/** UUID v4 nuevo; crypto.randomUUID solo existe en contextos seguros (https / localhost). */
export function uuidNuevo(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // versión 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Decide qué hacer con cada línea al guardar un pedido.
 *
 * Una línea nueva conserva su id temporal si ya es un UUID (el formulario los genera
 * con crypto.randomUUID): así, si el guardado se corta por timeout después de haber
 * llegado a la base, el reintento la encuentra por id y la actualiza en vez de
 * duplicarla. Si el id no sirve como UUID, se le da uno nuevo.
 */
export function planLineasCompra(
  items: CompraItem[],
  enBase: LineaEnBase[],
  nuevoId: () => string = uuidNuevo,
): PlanLineasCompra {
  const porId = new Map(enBase.map(l => [l.id, l]));
  const quedan = new Set<string>();
  const bajoLoRecibido: PlanLineasCompra['bajoLoRecibido'] = [];

  const filas = items.map((it, i): FilaLineaCompra => {
    const existente = porId.get(it.id);
    if (existente) {
      quedan.add(it.id);
      if (it.cantidad < existente.cantidadRecibida) {
        bajoLoRecibido.push({ descripcion: it.descripcion, cantidad: it.cantidad, recibida: existente.cantidadRecibida });
      }
    }
    return {
      id: existente || esUuid(it.id) ? it.id : nuevoId(),
      product_id: it.productId,
      descripcion: it.descripcion,
      variante: it.variante,
      cantidad: it.cantidad,
      costo_unitario: it.costoUnitario,
      orden: i,
    };
  });

  const quitadas = enBase.filter(l => !quedan.has(l.id));
  return {
    filas,
    borrar: quitadas.filter(l => l.cantidadRecibida <= 0).map(l => l.id),
    retenidas: quitadas.filter(l => l.cantidadRecibida > 0),
    bajoLoRecibido,
  };
}
