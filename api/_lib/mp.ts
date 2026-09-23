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
}

// Validación de firma según el esquema de MP: HMAC-SHA256 en hex del manifest
// `id:<data.id en minúscula>;request-id:<x-request-id>;ts:<ts>;`. No usa el
// body crudo. El ts puede venir en segundos o milisegundos según la versión.
//
// SIN ventana de tiempo sobre el ts, a propósito (antes se rechazaba un ts de
// más de 10 minutos). Motivos, verificados el 23/09/2026:
//  · MP reintenta la notificación que no recibió 200 a los 15 min, 30 min,
//    6 h, 48 h y 96 h (doc "Notificaciones de pagos" de Checkout Pro). La doc
//    no dice si el reintento se re-firma con un ts nuevo: si conserva el
//    original, la ventana de 10 min le daba 401 a TODOS los reintentos y un
//    pago aprobado durante una caída de Supabase no se acreditaba nunca.
//  · El SDK oficial de Node (mercadopago 3.6.1, WebhookSignatureValidator)
//    no mira el ts salvo que se le pase `toleranceSeconds` (opcional), y los
//    ejemplos oficiales lo llaman sin tolerancia.
//  · Un replay de una notificación legítima no escribe nada falso: el handler
//    relee el pago REAL de la API de MP y la escritura es idempotente.
// El ts igual tiene que ser un entero (como exige el SDK): va dentro del HMAC.
//
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
  if (!/^\d+$/.test(ts)) return { ok: false, motivo: 'ts no numérico' };

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
  product: { id: string; name?: unknown };
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
}

export interface ProductoCatalogo {
  id: string;
  name: string;
  price: number;
  /** false = oculto en la tienda (null/ausente cuenta como activo, igual que el front). */
  active?: boolean | null;
  /** Stock por variante: clave "talle" o "talle|color" → unidades. */
  stock_by_size?: Record<string, unknown> | null;
}

// ── Qué pedido se puede mandar a pagar ─────────────────────────────────────
// /api/mp/preferencia es público y el id del pedido lo genera el front
// (VO-<Date.now() en base36>): se adivina probando. Por eso solo se aceptan
// pedidos que tienen la forma EXACTA de un checkout de MP recién hecho, y
// cualquier otro caso responde el mismo 404 (ver el handler): así probar ids
// no revela si un pedido existe ni si está pago, y un pedido de WhatsApp no
// pasa a figurar como de Mercado Pago.
export const VENTANA_PEDIDO_MP_MS = 2 * 3600 * 1000;
// Margen para relojes corridos entre Postgres (created_at) y la función.
const DESFASAJE_RELOJ_MS = 5 * 60 * 1000;

export interface PedidoParaPreferencia {
  items: unknown;
  payment_status: string | null;
  payment_provider: string | null;
  source: string | null;
  created_at: string | null;
}

// Estados de pago que admiten una preferencia nueva. 'pendiente' NO: es un
// pago en curso (p.ej. un ticket de Abitab/RedPagos todavía sin pagar) y una
// segunda preferencia abre la puerta a cobrar dos veces. 'rechazado' SÍ: el
// cliente puede reintentar con otro medio.
const ESTADOS_QUE_ADMITEN_PAGO = new Set<string | null>([null, 'iniciado', 'rechazado']);

/** null si el pedido se puede mandar a pagar; si no, el motivo (solo para logs, nunca al cliente). */
export function motivoPedidoNoPagable(
  p: PedidoParaPreferencia | null | undefined,
  ahoraMs: number = Date.now(),
): string | null {
  if (!p) return 'no existe';
  // Así lo inserta el checkout de MP (supabaseService.addOrder): source 'web'
  // y payment_provider 'mp'. Los de WhatsApp quedan con source 'whatsapp' y
  // provider null.
  if (p.source !== 'web' || p.payment_provider !== 'mp') return `no es un pedido web de MP (source=${p.source}, provider=${p.payment_provider})`;
  const creado = p.created_at ? Date.parse(p.created_at) : NaN;
  if (!Number.isFinite(creado)) return 'sin created_at';
  // El trigger v22 fuerza created_at = now() en el alta pública: no se puede
  // inventar uno reciente. El checkout pide la preferencia apenas inserta.
  if (ahoraMs - creado > VENTANA_PEDIDO_MP_MS) return 'pedido de hace más de 2 horas';
  if (creado - ahoraMs > DESFASAJE_RELOJ_MS) return 'created_at en el futuro';
  if (!Array.isArray(p.items) || p.items.length === 0) return 'items no es un array con datos';
  if (!ESTADOS_QUE_ADMITEN_PAGO.has(p.payment_status)) return `estado de pago ${p.payment_status}`;
  return null;
}

// ── Stock ───────────────────────────────────────────────────────────────────
// ⚠ PARIDAD CON EL FRONT: la clave de stock_by_size se arma igual que en el
// carrito (App.tsx: `selectedColor ? `${talle}|${color}` : talle`) y que en la
// RPC descontar_stock_pedido (supabase/migraciones_propuestas/v24_mp.sql).
export function claveStock(it: Pick<ItemPedidoRow, 'selectedSize' | 'selectedColor'>): string {
  return it.selectedColor ? `${it.selectedSize ?? ''}|${it.selectedColor}` : (it.selectedSize ?? '');
}

const unidades = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
};

const describirVariante = (it: Pick<ItemPedidoRow, 'selectedSize' | 'selectedColor'>) =>
  [it.selectedSize, it.selectedColor].filter(Boolean).join('/') || 'sin talle';

// Antes de mandar a pagar: cada producto tiene que existir, estar visible en
// la tienda, venir en esa variante y tener stock para la cantidad pedida
// (sumando renglones repetidos: el pedido lo arma el cliente y puede traer la
// misma variante dos veces). NO reserva stock: dos personas pueden pasar esta
// validación con la última unidad y pagar las dos; eso lo ataja el webhook al
// descontar (RPC descontar_stock_pedido), que marca el segundo pedido para
// revisión en vez de dejar el stock en negativo.
// Los mensajes se muestran tal cual al cliente (el checkout los pone en un toast).
export function validarDisponibilidad(items: ItemPedidoRow[], catalogo: ProductoCatalogo[]): void {
  const pedidas = new Map<string, { prod: ProductoCatalogo; it: ItemPedidoRow; clave: string; cantidad: number }>();
  for (const it of items) {
    const prod = catalogo.find(p => p.id === it?.product?.id);
    if (!prod || prod.active === false) {
      const nombre = prod?.name
        ?? (typeof it?.product?.name === 'string' && it.product.name.trim() ? it.product.name.trim().slice(0, 80) : null);
      throw new Error(nombre
        ? `«${nombre}» ya no está disponible en la tienda. Sacalo del carrito para seguir`
        : 'Uno de los productos del carrito ya no está disponible en la tienda. Sacalo del carrito para seguir');
    }
    if (!Number.isInteger(it.quantity) || it.quantity < 1) throw new Error(`Cantidad inválida para ${prod.name}`);
    const clave = claveStock(it);
    const stock = prod.stock_by_size ?? {};
    if (!Object.prototype.hasOwnProperty.call(stock, clave)) {
      throw new Error(`«${prod.name}» no viene en ${describirVariante(it)}. Elegí otra variante en el carrito`);
    }
    const k = `${prod.id}\u0000${clave}`;
    const previa = pedidas.get(k);
    pedidas.set(k, { prod, it, clave, cantidad: (previa?.cantidad ?? 0) + it.quantity });
  }
  for (const { prod, it, clave, cantidad } of pedidas.values()) {
    const hay = unidades(prod.stock_by_size?.[clave]);
    if (cantidad > hay) {
      throw new Error(hay > 0
        ? `No queda stock suficiente de «${prod.name}» (${describirVariante(it)}): quedan ${hay}. Ajustá la cantidad en el carrito`
        : `Ya no queda stock de «${prod.name}» (${describirVariante(it)}). Sacalo del carrito para seguir`);
    }
  }
}

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

// ── Webhook: qué escribir en el pedido ───────────────────────────────────
// El pago se relee de la API de MP (GET /v1/payments/:id), así que estos
// datos son auténticos; lo que se valida acá es que CORRESPONDAN al pedido.

/** Lo que usa el webhook del pago devuelto por la API de MP. */
export interface PagoMP {
  id: number | string;
  status?: string | null;
  external_reference?: string | null;
  transaction_amount?: number | null; // lo cobrado por los items (sin intereses de cuotas)
  currency_id?: string | null;
  date_approved?: string | null;
}

/** La fila de orders que lee el webhook (select '*': tolera columnas que todavía no existan). */
export interface PedidoWebhook {
  id: string;
  total?: number | string | null;
  mp_monto_esperado?: number | string | null; // v24; sin migración no viene
  payment_status?: string | null;
  mp_payment_id?: string | null;
}

export const MONEDA_MP = 'UYU';

/**
 * null si el monto y la moneda del pago coinciden con lo que se pidió cobrar;
 * si no, el motivo. Referencia: orders.mp_monto_esperado (lo guarda
 * preferencia.ts con el total que calculó desde el catálogo) y, si no está
 * (pedido anterior a la migración v24 o update fallido), orders.total, que
 * el checkout calcula con las mismas reglas de promo.
 */
export function problemaImportePago(pago: PagoMP, pedido: PedidoWebhook): string | null {
  const referencia = pedido.mp_monto_esperado ?? pedido.total;
  const esperado = referencia == null ? NaN : Number(referencia);
  if (!Number.isFinite(esperado) || esperado <= 0) return 'el pedido no tiene un monto esperado válido';
  if (pago.currency_id !== MONEDA_MP) return `moneda ${pago.currency_id ?? '(vacía)'} en vez de ${MONEDA_MP}`;
  const cobrado = pago.transaction_amount == null ? NaN : Number(pago.transaction_amount);
  if (!Number.isFinite(cobrado)) return 'el pago no trae monto';
  // Pesos enteros de los dos lados; el margen solo absorbe decimales de coma flotante.
  if (Math.abs(cobrado - esperado) > 0.005) return `monto ${cobrado} ${MONEDA_MP} en vez de ${esperado}`;
  return null;
}

export interface PlanWebhook {
  /** Columnas a escribir en orders. */
  patch: Record<string, unknown>;
  /** Agregar el filtro payment_status NOT IN (aprobado, devuelto): un reintento tardío no pisa un pedido cerrado. */
  soloSiNoCerrado: boolean;
  /** Llamar a la RPC descontar_stock_pedido después de escribir. */
  descontarStock: boolean;
  /** Si el pedido queda para revisión, por qué (también va en patch.requiere_revision). */
  revision: string | null;
}

/**
 * Decide qué escribir en el pedido ante un pago de MP. null = no hay nada
 * que escribir. Nunca marca 'aprobado' si el monto o la moneda no cierran,
 * ni pisa un pedido ya pagado con OTRO pago (doble cobro: queda para revisión).
 */
export function planificarWebhook(pago: PagoMP, pedido: PedidoWebhook, ahoraIso: string): PlanWebhook | null {
  const estado = mapearEstadoMP(pago.status);
  if (!estado) return null;
  const idPago = String(pago.id);

  // El pedido ya se pagó con otro pago de MP (dos preferencias pagadas, o una
  // pagada dos veces). No se toca el estado: se avisa. Los pendientes o
  // rechazados de ese otro pago no cambian nada (como el guard de siempre).
  if (pedido.payment_status === 'aprobado' && pedido.mp_payment_id && pedido.mp_payment_id !== idPago) {
    if (estado !== 'aprobado' && estado !== 'devuelto') return null;
    const motivo = `otro pago de MP (${idPago}, ${estado}) para un pedido ya pagado con ${pedido.mp_payment_id}: posible doble cobro`;
    return { patch: { requiere_revision: motivo }, soloSiNoCerrado: false, descontarStock: false, revision: motivo };
  }

  const base = { payment_provider: 'mp', mp_payment_id: idPago };
  if (estado === 'aprobado') {
    const problema = problemaImportePago(pago, pedido);
    if (problema) {
      // La plata entró pero no es lo que se pidió: NO se marca pagado ni se
      // descuenta stock. 'pendiente' (no final) + el motivo, y el monto real
      // en paid_amount para que el admin lo vea al revisar.
      const motivo = `pago ${idPago} aprobado por MP con ${problema}`;
      return {
        patch: { ...base, payment_status: 'pendiente', paid_amount: pago.transaction_amount ?? null, requiere_revision: motivo },
        soloSiNoCerrado: true,
        descontarStock: false,
        revision: motivo,
      };
    }
    return {
      patch: { ...base, payment_status: 'aprobado', paid_at: pago.date_approved ?? ahoraIso, paid_amount: pago.transaction_amount ?? null },
      soloSiNoCerrado: false,
      // Idempotente del lado de la base (orders.stock_descontado_at): se pide
      // en cada notificación aprobada, así un reintento completa un descuento
      // que haya fallado.
      descontarStock: true,
      revision: null,
    };
  }
  return {
    patch: { ...base, payment_status: estado },
    soloSiNoCerrado: estado === 'pendiente' || estado === 'rechazado',
    descontarStock: false,
    revision: null,
  };
}

// Errores de "la migración todavía no se aplicó": el código se puede
// desplegar antes que supabase/migraciones_propuestas/v24_mp.sql y tiene que
// degradar sin romper el cobro.
interface ErrorConCodigo { code?: string | null }
/** Columna inexistente: PGRST204 (en el body de un insert/update) o 42703 (en un select/filtro). */
export const columnaInexistente = (e: ErrorConCodigo | null | undefined) =>
  e?.code === 'PGRST204' || e?.code === '42703';
/** Función inexistente: PGRST202 (no está en el schema cache de PostgREST) o 42883. */
export const funcionInexistente = (e: ErrorConCodigo | null | undefined) =>
  e?.code === 'PGRST202' || e?.code === '42883';

export function mpConfigurado(env: Record<string, string | undefined>): boolean {
  return Boolean(env.MP_ACCESS_TOKEN && env.MP_WEBHOOK_SECRET && env.SUPABASE_SERVICE_ROLE_KEY);
}
