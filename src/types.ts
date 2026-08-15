export interface ProductColor {
  name: string;
  hex: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string;
  price: number;
  originalPrice?: number;
  category: string; // id de categoría (ej: 'remeras')
  images: string[];
  sizes: string[];
  colors: ProductColor[];
  stockBySize: Record<string, number>; // clave "talle|color"
  isFeatured: boolean;
  isOffer: boolean;
  active?: boolean; // false = oculto en la tienda
  sortOrder?: number;
  createdAt: string;
  // Legacy Shopify (solo para compat con snapshots viejos)
  shopifyGid?: string;
  shopifyHandle?: string;
  variantMap?: Record<string, string>;
}

export interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverUrl: string;
  published: boolean;
  publishedAt?: string;
  createdAt: string;
}

export interface StandingEntry {
  id: string;
  position: number;
  playerName: string;
  points: number;
  category: string;
  notes: string;
}

/** Movimiento de la Caja: venta o gasto registrado por el bot de Telegram. */
export interface LedgerEntry {
  id: string;
  kind: 'venta' | 'gasto';
  productId: string | null;
  variantKey: string | null; // "talle|color" del producto vendido
  label: string;
  qty: number;
  amount: number;
  reportedBy: string;
  reverted: boolean;
  createdAt: string; // ISO timestamp
  /** Cómo pagaron la venta (null en gastos y registros viejos). */
  paymentMethod: 'mp' | 'efectivo' | 'transferencia' | 'debe' | null;
  /** Quién debe, cuando paymentMethod es 'debe'. */
  debtorName: string | null;
  /** Cuándo y cómo se cobró la deuda (null = sigue pendiente). */
  settledAt: string | null;
  settledMethod: 'mp' | 'efectivo' | 'transferencia' | null;
  /** Cuándo se liquidó a las cuentas de socios (null = pendiente de liquidar). */
  socioSettledAt: string | null;
  /**
   * Quién PUSO LA PLATA del gasto — distinto de reportedBy (quién lo cargó).
   * null en ventas, en gastos del bot y en los históricos: ahí el modal de
   * liquidación sigue adivinando a partir del nombre de quien registró.
   */
  paidBy: SocioName | null;
}

/**
 * Alta de venta desde la Caja web (RPC admin_registrar_venta). Con productId,
 * la RPC descuenta stock de la variante como el bot; sin productId es un ítem
 * suelto y el stock no se toca.
 */
export interface VentaCajaInput {
  label: string;
  amount: number;
  payment: 'mp' | 'efectivo' | 'transferencia' | 'debe';
  productId?: string | null;
  variantKey?: string | null;
  qty?: number;
  debtor?: string | null;
}

/** Fila que la liquidación de caja asienta en socio_moves (claves = columnas del RPC). */
export interface SocioLiquidacionMove {
  area: SocioMove['area'];
  tipo: 'venta' | 'gasto';
  fecha: string | null;
  descripcion: string;
  monto: number;
  pagador: SocioName | null;
  de: SocioName | null;
  para: SocioName | null;
  imp_brian: number;
  imp_paula: number;
  imp_gaston: number;
}

export type SocioName = 'brian' | 'paula' | 'gaston';

/**
 * Movimiento de cuentas entre socios (reparto Brian 50% / Paula 25% / Gastón 25%).
 * Los impactos guardan cuánto suma (+debe) o resta (−a favor) al saldo de cada
 * socio; siempre suman ~0. Positivo = le debe al grupo, negativo = a favor.
 */
export interface SocioMove {
  id: string;
  area: 'marca' | 'showroom' | 'cafeteria' | 'crp' | 'argentinos' | 'otros';
  tipo: 'gasto' | 'pago' | 'venta' | 'ajuste';
  periodo: string | null; // etiqueta del Excel histórico (mes o evento) cuando no hay fecha
  fecha: string | null; // YYYY-MM-DD
  descripcion: string;
  monto: number;
  pagador: SocioName | null; // en gastos: quién puso la plata
  de: SocioName | null; // en pagos: quién paga · en ventas: a quién le corresponde
  para: SocioName | null; // en pagos: quién recibe · en ventas: quién cobró (y debe)
  moneda: 'UYU' | 'ARS';
  impBrian: number;
  impPaula: number;
  impGaston: number;
  source: string;
  /** Cuotas de una misma compra comparten este id; null = movimiento suelto. */
  cuotaGrupo: string | null;
  createdAt: string;
}

/** Alta de movimiento de socios desde el admin (los impactos se calculan antes de guardar). */
export interface SocioMoveInput {
  area: SocioMove['area'];
  tipo: 'gasto' | 'pago' | 'venta';
  descripcion: string;
  monto: number;
  fecha: string | null;
  pagador: SocioName | null;
  de: SocioName | null;
  para: SocioName | null;
  impBrian: number;
  impPaula: number;
  impGaston: number;
  cuotaGrupo?: string | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedSize: string;
  selectedColor: string;
  variantId?: string; // Shopify variant id for checkout permalink
}

export interface Event {
  id: string;
  name: string;
  date: string;
  time: string;
  location: string;
  city: string;
  description: string;
  imageUrl: string;
  mapsUrl: string;
  maxParticipants?: number;
  status: 'upcoming' | 'past';
  category: 'tournament' | 'clinic' | 'social';
  /** Teléfono de inscripciones/consultas. Alimenta el botón de la home. */
  phone?: string;
  /** Último día, en eventos de varios días. Vacío = arranca y termina en `date`. */
  endDate?: string;
  /** true = el form público de inscripción está abierto para este evento. */
  inscripcionesAbiertas?: boolean;
  /** Categorías del evento, separadas por coma ("Singles A,Doble Mixto B"). */
  categorias?: string;
}

/**
 * Inscripción online a un evento (tabla inscripciones). El público solo escribe
 * vía la RPC inscribir_evento y solo lee el contador: los datos personales son
 * visibles únicamente para admins.
 */
export interface Inscripcion {
  id: string;
  eventId: string;
  nombre: string;
  celular: string;
  email: string;
  categorias: string;
  /** Legacy: campo único de pareja de las inscripciones viejas. */
  pareja: string;
  /** Pareja por categoría de dobles: {"Doble Mixto A": "Nombre"}. */
  parejas: Record<string, string>;
  duprId: string;
  notas: string;
  estado: 'pendiente' | 'confirmada' | 'baja';
  createdAt: string;
}

export interface InscripcionInput {
  eventId: string;
  nombre: string;
  celular: string;
  categorias: string;
  email?: string;
  pareja?: string;
  parejas?: Record<string, string>;
  duprId?: string;
  notas?: string;
}

export type PaymentStatus = 'iniciado' | 'aprobado' | 'pendiente' | 'rechazado' | 'devuelto';

/**
 * Promoción de la tienda (tabla promos). Vive en la DB porque el descuento lo
 * aplican por igual el carrito (cliente) y la preferencia de Mercado Pago
 * (server): una sola fuente de verdad, se prende y apaga sola por fecha.
 */
export interface Promo {
  id: string;
  label: string;
  percent: number;
  /** YYYY-MM-DD, inclusive, en día de Uruguay. */
  startsOn: string;
  endsOn: string;
  deliveryNote: string;
  active: boolean;
}

export interface Order {
  id: string;
  items: CartItem[];
  customer: CustomerInfo;
  total: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered';
  createdAt: string;
  /** Pago online (Mercado Pago). Ausente/null = flujo WhatsApp puro. */
  paymentStatus?: PaymentStatus | null;
  paymentProvider?: 'mp' | null;
  mpPreferenceId?: string | null;
  mpPaymentId?: string | null;
  paidAt?: string | null;
  paidAmount?: number | null;
}

export interface CustomerInfo {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  department: string;
  notes: string;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Club {
  id: string;
  name: string;
  address: string;
  city: string;
  country: 'Uruguay' | 'Argentina' | 'Chile' | 'Brasil';
  lat: number;
  lng: number;
  phone?: string;
  instagram?: string;
  hasPickleball: boolean;
  description: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'promo' | 'event' | 'important';
  active: boolean;
  createdAt: string;
}
