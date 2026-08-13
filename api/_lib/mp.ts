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
// TODO: cuando Brian tenga credenciales de sandbox, capturar una tripleta real
// x-signature/x-request-id/data.id de un webhook de prueba y fijarla como
// fixture: hoy el test arma el manifest con la misma lógica que esta función,
// así que no detectaría una plantilla equivocada (esta vez se verificó contra
// la doc oficial de MP a mano, por afuera de los tests).
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

// ── Promos ──────────────────────────────────────────────────────────────────
// ⚠ PARIDAD CON EL CLIENTE: src/utils/promo.ts tiene estas MISMAS funciones
// (precioConPromo / promoVigente / hoyMontevideo). El carrito muestra el total
// con ellas y esta capa arma lo que MP cobra: si el redondeo o la regla de
// fechas difieren, el cliente ve un precio y paga otro. Los tests de ambos
// lados fijan los mismos valores. No se importan cruzado a propósito: api/ se
// compila aparte en Vercel y src/ no está en ese build.

export interface PromoFila {
  id: string;
  percent: number;
  starts_on: string; // YYYY-MM-DD
  ends_on: string;
  active: boolean;
}

/** "YYYY-MM-DD" de hoy en día de Uruguay (la promo corre con fechas locales). */
export function hoyMontevideo(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
}

/** La promo activa cuya ventana incluye hoy, o null. */
export function promoVigenteHoy(filas: PromoFila[], hoy: string): PromoFila | null {
  // Orden por id ANTES de elegir, en espejo con el cliente (src/utils/promo.ts):
  // con dos promos solapadas, ambos lados tienen que elegir la MISMA.
  return [...filas].sort((a, b) => a.id.localeCompare(b.id)).find(p =>
    p.active && Number.isFinite(p.percent) && p.percent > 0 && p.percent < 100 &&
    p.starts_on <= hoy && hoy <= p.ends_on,
  ) ?? null;
}

/** Precio unitario con descuento, redondeado a peso entero POR UNIDAD (MP cobra unit_price × qty). */
export function precioConPromo(price: number, percent: number): number {
  return Math.round(price * (100 - percent) / 100);
}

// Los precios salen SIEMPRE del catálogo (tabla products), jamás del pedido:
// el pedido lo insertó el cliente anónimo y podría traer precios editados.
// `descuentoPorciento`: promo vigente (tabla promos) — se aplica ACÁ, sobre el
// precio del catálogo, para que el descuento que muestra el carrito sea el que
// MP realmente cobra.
export function armarItemsPreferencia(
  items: ItemPedidoRow[],
  catalogo: ProductoCatalogo[],
  descuentoPorciento = 0,
): ItemPreferencia[] {
  if (!items.length) throw new Error('El pedido no tiene items');
  return items.map(it => {
    const prod = catalogo.find(p => p.id === it.product?.id);
    if (!prod) throw new Error(`El producto ${it.product?.id ?? '(sin id)'} ya no existe en el catálogo`);
    // Un typo de admin (precio en 0 o negativo) no puede colar una preferencia
    // de $0 que MP marque como "approved".
    if (!Number.isFinite(prod.price) || prod.price <= 0) {
      throw new Error(`Precio inválido en el catálogo para ${prod.name}`);
    }
    // Cantidad tiene que ser entera: truncar (Math.floor) dejaba pasar un
    // 1.999 cobrando 1 mientras el pedido en la base queda con 1.999 — un
    // desfasaje silencioso entre lo pagado y lo entregado.
    if (!Number.isInteger(it.quantity) || it.quantity < 1) {
      throw new Error(`Cantidad inválida para ${prod.name}`);
    }
    const conDescuento = descuentoPorciento > 0 && descuentoPorciento < 100
      ? precioConPromo(prod.price, descuentoPorciento)
      : prod.price;
    // La misma guarda de arriba, sobre el precio YA descontado: un percent
    // absurdo en la tabla promos tampoco puede colar una preferencia de $0.
    if (conDescuento <= 0) throw new Error(`Precio inválido tras el descuento para ${prod.name}`);
    const variante = [it.selectedSize, it.selectedColor].filter(Boolean).join('/');
    const title = variante ? `${prod.name} (${variante})` : prod.name;
    return {
      id: prod.id,
      // MP trunca el título del item a 256 caracteres; lo topeamos acá para
      // no depender de qué hace su API con el sobrante.
      title: title.slice(0, 250),
      quantity: it.quantity,
      unit_price: conDescuento,
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
