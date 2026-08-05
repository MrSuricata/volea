// Helpers puros de la integración con Mercado Pago (Checkout Pro).
// Sin red ni entorno: todo lo inyectan los handlers, así se testean solos.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type EstadoPago = 'aprobado' | 'pendiente' | 'rechazado' | 'devuelto';

export function mapearEstadoMP(status: string | null | undefined): EstadoPago | null {
  switch ((status || '').toLowerCase()) {
    case 'approved': return 'aprobado';
    case 'pending':
    case 'in_process':
    case 'authorized': return 'pendiente';
    case 'rejected':
    case 'cancelled': return 'rechazado';
    case 'refunded':
    case 'charged_back': return 'devuelto';
    default: return null;
  }
}

export interface FirmaInput {
  xSignature: string | undefined;  // cabecera x-signature: "ts=...,v1=..."
  xRequestId: string | undefined;  // cabecera x-request-id
  dataId: string | undefined;      // query param data.id de la notificación
  secreto: string;                 // MP_WEBHOOK_SECRET
  ahoraMs?: number;                // inyectable en tests
  toleranciaMs?: number;           // default 10 minutos
}

// Validación de firma según el esquema de MP: HMAC-SHA256 en hex del manifest
// `id:<data.id en minúscula>;request-id:<x-request-id>;ts:<ts>;`. No usa el
// body crudo. El ts puede venir en segundos o milisegundos según la versión.
export function validarFirmaWebhook(i: FirmaInput): { ok: boolean; motivo?: string } {
  if (!i.xSignature || !i.xRequestId || !i.dataId) return { ok: false, motivo: 'faltan cabeceras' };
  const partes: Record<string, string> = {};
  for (const trozo of i.xSignature.split(',')) {
    const idx = trozo.indexOf('=');
    if (idx > 0) partes[trozo.slice(0, idx).trim()] = trozo.slice(idx + 1).trim();
  }
  const ts = partes['ts'];
  const v1 = partes['v1'];
  if (!ts || !v1) return { ok: false, motivo: 'x-signature malformada' };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return { ok: false, motivo: 'ts no numérico' };
  const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
  const ahora = i.ahoraMs ?? Date.now();
  const tolerancia = i.toleranciaMs ?? 10 * 60 * 1000;
  if (Math.abs(ahora - tsMs) > tolerancia) return { ok: false, motivo: 'ts fuera de ventana' };

  const manifest = `id:${i.dataId.toLowerCase()};request-id:${i.xRequestId};ts:${ts};`;
  const esperado = createHmac('sha256', i.secreto).update(manifest).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, motivo: 'firma no coincide' };
  return { ok: true };
}

// Item de pedido tal como vive en orders.items (CartItem serializado: el
// product viene embebido del cliente y NO es confiable para precios).
export interface ItemPedidoRow {
  product: { id: string; name?: string };
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
}

export interface ProductoCatalogo { id: string; name: string; price: number; }

export interface ItemPreferencia {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
  currency_id: 'UYU';
}

// Los precios salen SIEMPRE del catálogo (tabla products), jamás del pedido:
// el pedido lo insertó el cliente anónimo y podría traer precios editados.
export function armarItemsPreferencia(
  items: ItemPedidoRow[],
  catalogo: ProductoCatalogo[],
): ItemPreferencia[] {
  if (!items.length) throw new Error('El pedido no tiene items');
  return items.map(it => {
    const prod = catalogo.find(p => p.id === it.product?.id);
    if (!prod) throw new Error(`El producto ${it.product?.id ?? '(sin id)'} ya no existe en el catálogo`);
    const cantidad = Math.floor(it.quantity);
    if (!Number.isFinite(cantidad) || cantidad < 1) {
      throw new Error(`Cantidad inválida para ${prod.name}`);
    }
    const variante = [it.selectedSize, it.selectedColor].filter(Boolean).join('/');
    return {
      id: prod.id,
      title: variante ? `${prod.name} (${variante})` : prod.name,
      quantity: cantidad,
      unit_price: prod.price,
      currency_id: 'UYU' as const,
    };
  });
}

export const totalItems = (items: ItemPreferencia[]) =>
  items.reduce((s, i) => s + i.unit_price * i.quantity, 0);

export interface ParamsRetornoMP {
  status?: string;
  collection_status?: string;
  external_reference?: string;
  payment_id?: string;
}

// La vuelta de MP no puede aterrizar directo en una ruta con `#` (los query
// params y el HashRouter se pisan — mismo drama que los magic links), así que
// el handler de retorno traduce a la URL hash final con esta función.
export function armarUrlRetorno(baseUrl: string, p: ParamsRetornoMP): string {
  const st = (p.status || p.collection_status || '').toLowerCase();
  const estado =
    st === 'approved' ? 'aprobado'
    : st === 'pending' || st === 'in_process' ? 'pendiente'
    : st === 'rejected' ? 'rechazado'
    : 'desconocido';
  const q = new URLSearchParams({ estado });
  if (p.external_reference) q.set('pedido', p.external_reference);
  if (p.payment_id) q.set('pago', p.payment_id);
  return `${baseUrl}/#/pago/resultado?${q.toString()}`;
}

export function mpConfigurado(env: Record<string, string | undefined>): boolean {
  return Boolean(env.MP_ACCESS_TOKEN && env.MP_WEBHOOK_SECRET && env.SUPABASE_SERVICE_ROLE_KEY);
}
