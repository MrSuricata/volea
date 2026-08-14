import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion, useScroll, useTransform, type Variants } from 'framer-motion';
import {
  ShoppingCart, Menu, X, Search, Star, MapPin, Calendar, Phone, Mail, Instagram,
  MessageCircle, ChevronRight, ChevronLeft, Plus, Minus, Trash2, Edit, Package,
  Users, BarChart3, Tag, ArrowRight, Heart, Shield, Zap, Trophy, Eye, Filter,
  SortAsc, ExternalLink, Check, AlertCircle, Home, Store, CalendarDays, Settings,
  LogOut, ChevronDown, Upload, Image as ImageIcon, Save, XCircle, Map, Megaphone,
  Globe, Navigation, Newspaper, Wallet, Loader2, Images, CreditCard, EyeOff
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import type { Product, CartItem, Event, Order, CustomerInfo, Category, ProductColor, Club, Announcement, Post, StandingEntry, Inscripcion, PaymentStatus, Promo, SocioName, VentaCajaInput } from './types';
import { hoyMontevideo, precioConPromo, promoPorVenir, promoVigente, totalesConPromo, ventanaPromo } from './utils/promo';
import {
  WHATSAPP_NUMBER, INSTAGRAM_HANDLE,
  INITIAL_EVENTS, INITIAL_CLUBS, INITIAL_ANNOUNCEMENTS
} from './constants';
import { StorageService } from './services/storageService';
import { SupabaseService } from './services/supabaseService';
import { isSupabaseConnected, supabaseReady } from './services/supabaseClient';
import { conLimite } from './utils/arranque';
import {
  sendMagicLink,
  signInWithPassword,
  getCurrentAdmin,
  onAuthStateChange,
  sesionAdminVencida,
  signOut as authSignOut,
  type AdminUser,
} from './services/authService';
// NOTA: el snapshot legacy de Shopify (services/shopifyService + su JSON de 139 KB min)
// ya no se importa acá arriba: se pide con import() dinámico solo si el fallback de
// productos/categorías llega a correr (ver loadData). Antes viajaba en el entry y se
// parseaba en cada arranque para no usarse casi nunca.
import { BlogListPage, BlogPostPage } from './components/BlogPages';
import { StandingsPage } from './components/StandingsPage';
// NOTA sobre './torneos/cacheTorneos': no se importa arriba a proposito (ver logout, mas
// abajo, que lo importa dinamicamente). Es un modulo hoja sin imports de React/Supabase/el
// hook, pero aun un import ESTATICO de una sola constante desde aca alcanzaria para que
// quede en el chunk de entrada; con dynamic import ni siquiera eso - se pide solo al cerrar
// sesion. Importar cualquier cosa de useSyncTorneos.ts aca (no solo de cacheTorneos.ts)
// seria mucho peor: arrastra el hook entero (supabase, mergeTorneos, etc.) de vuelta al
// chunk de entrada y rompe el split lazy de AdminTorneosTab de abajo.

// Un deploy nuevo borra los chunks viejos de Vercel: la pestaña abierta de ANTES del
// deploy pide un hash que ya no existe, el rewrite devuelve HTML y el import() explota
// con pantalla blanca (peor caso: volver de PAGAR en Mercado Pago a /pago/resultado).
// Si el import() falla, recargamos UNA vez para traer el index nuevo (la bandera en
// sessionStorage evita el loop); si vuelve a fallar, el throw cae en el ErrorBoundary raíz.
const lazyConRecarga = <T extends React.ComponentType<any>>(imp: () => Promise<{ default: T }>) =>
  lazy(() =>
    imp()
      .then((m) => { sessionStorage.removeItem('volea_chunk_retry'); return m; })
      .catch((err) => {
        if (!sessionStorage.getItem('volea_chunk_retry')) {
          sessionStorage.setItem('volea_chunk_retry', '1');
          window.location.reload();
          // Promesa que nunca resuelve: la página ya se está recargando, no hay que renderizar nada.
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      }),
  );

// Gestor de torneos: ~42 KB gzip que solo usa el admin. Lazy para que la tienda publica
// (critical path) no lo cargue nunca; el chunk se pide recien al entrar a la pestaña Torneos.
const AdminTorneosTab = lazyConRecarga(() =>
  import('./components/AdminTorneosTab').then((m) => ({ default: m.AdminTorneosTab })),
);
// Resto de las pestañas del admin: mismo motivo que AdminTorneosTab — las usa solo el
// admin logueado, la tienda pública (critical path) no tiene por qué bajarlas. Cada
// chunk se pide recién al entrar a su pestaña. Socios arrastra a su chunk
// AdminSociosSection y AdminLiquidarCajaModal (solo los importa él).
const AdminCajaTab = lazyConRecarga(() =>
  import('./components/AdminCajaTab').then((m) => ({ default: m.AdminCajaTab })),
);
const AdminSociosTab = lazyConRecarga(() =>
  import('./components/AdminSociosTab').then((m) => ({ default: m.AdminSociosTab })),
);
const AdminBlogTab = lazyConRecarga(() =>
  import('./components/AdminBlogTab').then((m) => ({ default: m.AdminBlogTab })),
);
const AdminStandingsTab = lazyConRecarga(() =>
  import('./components/AdminStandingsTab').then((m) => ({ default: m.AdminStandingsTab })),
);
const AdminGaleriaTab = lazyConRecarga(() =>
  import('./components/AdminGaleriaTab').then((m) => ({ default: m.AdminGaleriaTab })),
);
// Modales del admin (editor de producto y pedido manual): también lazy, con fallback
// null en su Suspense — se renderizan condicionalmente, así que el chunk baja recién
// al abrirlos y el modal aparece apenas llega (sin placeholder que parpadee).
const ProductEditor = lazyConRecarga(() =>
  import('./components/ProductEditor').then((m) => ({ default: m.ProductEditor })),
);
const AdminOrderModal = lazyConRecarga(() =>
  import('./components/AdminOrderModal').then((m) => ({ default: m.AdminOrderModal })),
);
// Fallback compartido de las pestañas lazy del admin (mismo look que el de Torneos).
const cargandoTab = <div className="text-navy-500 text-sm py-8 text-center">Cargando…</div>;
// Paginas publicas de Torneos (Etapa 2): mismo motivo que AdminTorneosTab arriba - cargan
// el motor de torneos + torneos.css (.rk) que la tienda publica (critical path) no
// necesita. Se piden recien cuando alguien navega a /ranking, /torneos o /torneos/:id.
const RankingPageLazy = lazyConRecarga(() => import('./torneos/publico/RankingPage'));
const TorneosListaPageLazy = lazyConRecarga(() => import('./torneos/publico/TorneosListaPage'));
const TorneoDetallePageLazy = lazyConRecarga(() => import('./torneos/publico/TorneoDetallePage'));
// Galería (álbumes de fotos, cada uno un link de salida a Drive/Photos): mismo motivo que
// los lazy de arriba — la tienda pública (critical path) no la necesita hasta que alguien
// entra a /galeria. Su módulo de datos (src/galeria/datos.ts, ~12 KB) también quedó fuera
// del entry desde que AdminGaleriaTab pasó a lazy (arriba): al ser los dos únicos que lo
// importan y ser los dos lazy, Rollup lo deja en un chunk compartido entre ambos.
const GaleriaPageLazy = lazyConRecarga(() => import('./galeria/GaleriaPage'));
// Resultado del pago (aterrizaje de la vuelta de Mercado Pago, /pago/resultado): mismo
// motivo que los lazy de arriba — la tienda pública no la necesita hasta que alguien vuelve
// de MP. Vive en su propia carpeta src/pago/ porque el dominio "pago" va a crecer.
const ResultadoPagoPageLazy = lazyConRecarga(() => import('./pago/ResultadoPagoPage'));
// Callback estable (identidad fija entre renders): si fuera una arrow function inline en el
// JSX, cambiaria de identidad en cada render de AdminPage, lo que tira abajo useSyncTorneos'
// avisarLimitado -> push -> pull (todos useCallback encadenados) y dispara el effect de
// persistencia de cache de nuevo aunque `cache` no haya cambiado (JSON.stringify + write a
// localStorage en cada render del admin, no solo cuando hay algo que sincronizar).
const avisarTorneos = (mensaje: string) => toast.error(mensaje);

// ─── 1. Utility Functions ────────────────────────────────────────────────────

const formatPrice = (price: number): string => `$ ${price.toLocaleString('es-UY')}`;

const TZ_UY = 'America/Montevideo';

/** "SÁB 22 DE AGOSTO" — la fecha del torneo en el bloque de la home. */
const fechaTorneo = (iso: string): string => {
  // Se fuerza mediodía UTC: con "2026-08-22" a secas, el navegador lo toma como
  // medianoche UTC y en Uruguay (UTC-3) lo muestra como el día anterior.
  const d = new Date(`${iso}T12:00:00Z`);
  if (isNaN(d.getTime())) return '';
  // es-UY devuelve "sáb, 22 de agosto": se limpian el punto y la coma del formato.
  return d.toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric', month: 'long', timeZone: TZ_UY })
    .replace('.', '')
    .replace(',', '')
    .toUpperCase();
};

/** "22·23·24 AGO" — los días sueltos para el cartel neón del hero. */
const diasCortos = (desde: string, hasta?: string): string => {
  const d1 = new Date(`${desde}T12:00:00Z`);
  if (isNaN(d1.getTime())) return '';
  const mes = d1.toLocaleDateString('es-UY', { month: 'short', timeZone: TZ_UY }).replace('.', '').toUpperCase();
  const d2 = hasta ? new Date(`${hasta}T12:00:00Z`) : null;
  if (!d2 || isNaN(d2.getTime()) || d2 <= d1) return `${d1.getUTCDate()} ${mes}`;
  const mes2 = d2.toLocaleDateString('es-UY', { month: 'short', timeZone: TZ_UY }).replace('.', '').toUpperCase();
  // Si cruza de mes hay que nombrar los dos, o "30·31·1 AGO" miente.
  if (mes2 !== mes) return `${d1.getUTCDate()} ${mes} AL ${d2.getUTCDate()} ${mes2}`;
  // Hasta 4 días se listan uno por uno ("22·23·24"); más que eso, rango ("22 AL 28").
  const dias: number[] = [];
  for (let t = d1.getTime(); t <= d2.getTime(); t += 86400000) dias.push(new Date(t).getUTCDate());
  return dias.length <= 4 ? `${dias.join('·')} ${mes}` : `${dias[0]} AL ${dias[dias.length - 1]} ${mes}`;
};

/** "torneo" / "clínica" / "encuentro", para el chip del bloque de la home. */
const categoriaEvento = (c: Event['category']): string =>
  c === 'clinic' ? 'clínica' : c === 'social' ? 'encuentro' : 'torneo';

/** "SÁB 22 AL LUN 24 DE AGOSTO" (o un solo día si no hay fecha de cierre). */
const rangoFechas = (desde: string, hasta?: string): string => {
  const ini = fechaTorneo(desde);
  if (!hasta || hasta === desde) return ini;
  // Mismo mes: no se repite ("SÁB 22 AL LUN 24 DE AGOSTO").
  const mes = ini.slice(ini.indexOf(' DE '));
  const fin = fechaTorneo(hasta);
  return fin.endsWith(mes) ? `${ini.replace(mes, '')} AL ${fin}` : `${ini} AL ${fin}`;
};

/** "22 de agosto de 2026" — fecha larga de la ficha de un evento. */
const fechaEventoLarga = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`); // mediodía UTC: ver fechaTorneo
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ_UY });
};

/** "22 al 24 de agosto de 2026" — rango en la ficha de un evento. */
const rangoLargo = (desde: string, hasta?: string): string => {
  const ini = fechaEventoLarga(desde);
  if (!hasta || hasta === desde) return ini;
  const fin = fechaEventoLarga(hasta);
  // Mismo mes y año: se escribe solo el día de inicio ("22 al 24 de agosto de 2026").
  const resto = ini.slice(ini.indexOf(' de '));
  return fin.endsWith(resto) ? `${ini.replace(resto, '')} al ${fin}` : `${ini} al ${fin}`;
};

/**
 * Teléfono uruguayo → número para wa.me. "092 103 276" → "59892103276".
 * Devuelve null si no queda algo con pinta de celular, así el botón de WhatsApp
 * no se dibuja apuntando a la nada.
 */
const waUruguay = (tel: string | undefined): string | null => {
  const soloDigitos = (tel || '').replace(/\D/g, '').replace(/^00/, '');
  if (!soloDigitos) return null;
  const conPais = soloDigitos.startsWith('598') ? soloDigitos : `598${soloDigitos.replace(/^0+/, '')}`;
  // Largo EXACTO (598 + 8 dígitos): el campo es texto libre, y con ">= 11" un
  // "092 103 276 / 099 123 456" armaba un número pegoteado que no existe.
  return conPais.length === 11 ? conPais : null;
};

const getTotalStock = (product: Product): number =>
  Object.values(product.stockBySize).reduce((sum, qty) => sum + qty, 0);

// Los productos guardan el id de categoría (ej: 'remeras'); esto resuelve el nombre visible.
const categoryLabel = (categories: Category[], id: string): string =>
  categories.find(c => c.id === id)?.name || id;

const FALLBACK_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%23001F3F'/%3E%3Ccircle cx='200' cy='180' r='60' fill='none' stroke='%23ccff00' stroke-width='3'/%3E%3Ccircle cx='175' cy='160' r='8' fill='%23ccff00'/%3E%3Ccircle cx='210' cy='155' r='8' fill='%23ccff00'/%3E%3Ccircle cx='230' cy='180' r='8' fill='%23ccff00'/%3E%3Ccircle cx='210' cy='205' r='8' fill='%23ccff00'/%3E%3Ccircle cx='175' cy='200' r='8' fill='%23ccff00'/%3E%3Ccircle cx='160' cy='180' r='8' fill='%23ccff00'/%3E%3Ctext x='200' y='280' text-anchor='middle' fill='%23ccff00' font-family='sans-serif' font-weight='700' font-size='28'%3EVOLEA%3C/text%3E%3C/svg%3E";

const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.src = FALLBACK_IMG;
};

const URUGUAY_DEPARTMENTS = [
  'Montevideo', 'Canelones', 'Maldonado', 'Colonia', 'San José', 'Rocha',
  'Lavalleja', 'Florida', 'Flores', 'Durazno', 'Treinta y Tres', 'Cerro Largo',
  'Rivera', 'Artigas', 'Salto', 'Paysandú', 'Río Negro', 'Soriano', 'Tacuarembó'
];

// ─── 2. ScrollToTop ──────────────────────────────────────────────────────────

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// ─── 2a. usePageMeta — lightweight SEO ───────────────────────────────────────

interface PageMeta {
  title: string;
  description?: string;
  image?: string;
}

function setMetaTag(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function usePageMeta({ title, description, image }: PageMeta) {
  useEffect(() => {
    const fullTitle = title.includes('VOLEA') ? title : `${title} | VOLEA`;
    document.title = fullTitle;
    if (description) {
      setMetaTag('name', 'description', description);
      setMetaTag('property', 'og:description', description);
    }
    setMetaTag('property', 'og:title', fullTitle);
    setMetaTag('property', 'og:type', 'website');
    if (image) setMetaTag('property', 'og:image', image);
    setMetaTag('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    setMetaTag('name', 'twitter:title', fullTitle);
    if (description) setMetaTag('name', 'twitter:description', description);
    if (image) setMetaTag('name', 'twitter:image', image);
  }, [title, description, image]);
}

// ─── 2b. Reveal (framer-motion scroll reveal) ────────────────────────────────

function Reveal({ children, className = '', delay = 0, y = 40 }: { children: React.ReactNode; className?: string; delay?: number; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, delay: delay / 1000, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

// Stagger container for grids — children animate sequentially
const STAGGER_CONTAINER: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const STAGGER_ITEM: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

function StaggerGrid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={STAGGER_CONTAINER}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
    >
      {children}
    </motion.div>
  );
}

function StaggerItem({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={STAGGER_ITEM} className={className}>
      {children}
    </motion.div>
  );
}

// Page transition wrapper — fades + subtle slide
function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

// Hook for parallax effect on hero
function useParallax(distance = 80) {
  const { scrollY } = useScroll();
  return useTransform(scrollY, [0, 600], [0, distance]);
}

// ─── 3. StoreContext & StoreProvider ─────────────────────────────────────────

interface StoreContextType {
  // false mientras los datos de la nube siguen viajando. La web se muestra a los 4s
  // pase lo que pase (ver techoSplash), así que sin esta bandera una tienda todavía
  // vacía diría "no encontramos productos", que es mentira: aún no llegaron.
  datosListos: boolean;
  products: Product[];
  setProducts: (p: Product[]) => void;
  refreshProducts: () => Promise<void>;
  saveProduct: (p: Product) => void;
  removeProduct: (id: string) => void;
  events: Event[];
  setEvents: (e: Event[]) => void;
  /** Promos activas (tabla promos). La vigencia por fecha se decide al mostrar. */
  promos: Promo[];
  orders: Order[];
  setOrders: (o: Order[]) => void;
  addOrder: (o: Order) => Promise<boolean>;
  posts: Post[];
  savePost: (p: Post) => void;
  removePost: (id: string) => void;
  standings: StandingEntry[];
  saveStanding: (s: StandingEntry) => void;
  removeStanding: (id: string) => void;
  categories: Category[];
  setCategories: (c: Category[]) => void;
  clubs: Club[];
  setClubs: (c: Club[]) => void;
  announcements: Announcement[];
  setAnnouncements: (a: Announcement[]) => void;
  cart: CartItem[];
  addToCart: (item: CartItem) => void;
  removeFromCart: (productId: string, size: string, color: string) => void;
  updateCartQuantity: (productId: string, size: string, color: string, qty: number) => void;
  clearCart: () => void;
  isAdmin: boolean;
  currentAdmin: AdminUser | null;
  login: (password: string) => boolean;
  sendLoginLink: (email: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategory: string;
  setSelectedCategory: (c: string) => void;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
}

const StoreContext = createContext<StoreContextType | null>(null);

function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be inside StoreProvider');
  return ctx;
}

/**
 * La promo del momento: `activa` descuenta AHORA (el mismo cálculo que cobra
 * Mercado Pago en el server); `proxima` es la que se anuncia antes de arrancar.
 */
function usePromo(): { activa: Promo | null; proxima: Promo | null } {
  const { promos } = useStore();
  // `hoy` es ESTADO y se refresca al volver a la pestaña (y cada minuto): calculado
  // una sola vez quedaba congelado en la fecha de carga — una pestaña abierta el 16
  // y retomada el 18 no mostraba el descuento, y el pedido por WhatsApp salía a
  // precio de lista: sobrecobro silencioso. El caso inverso (carrito abierto
  // cruzando el fin de la promo) mostraba un descuento que MP ya no iba a hacer.
  const [hoy, setHoy] = useState(hoyMontevideo);
  useEffect(() => {
    const tick = () => setHoy(hoyMontevideo());
    document.addEventListener('visibilitychange', tick); // es evento de document, no de window
    window.addEventListener('focus', tick);
    const id = setInterval(tick, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
      clearInterval(id);
    };
  }, []);
  return useMemo(
    () => ({ activa: promoVigente(promos, hoy), proxima: promoPorVenir(promos, hoy) }),
    [promos, hoy],
  );
}

function StoreProvider({ children }: { children: React.ReactNode }) {
  const [products, _setProducts] = useState<Product[]>([]);
  const [events, _setEvents] = useState<Event[]>([]);
  const [promos, _setPromos] = useState<Promo[]>([]);
  const [orders, _setOrders] = useState<Order[]>([]);
  const [categories, _setCategories] = useState<Category[]>([]);
  const [clubs, _setClubs] = useState<Club[]>([]);
  const [announcements, _setAnnouncements] = useState<Announcement[]>([]);
  const [posts, _setPosts] = useState<Post[]>([]);
  const [standings, _setStandings] = useState<StandingEntry[]>([]);
  const [cart, _setCart] = useState<CartItem[]>([]);
  const [isAdmin, setIsAdmin] = useState(() => {
    return sessionStorage.getItem('volea_admin') === 'true';
  });
  const [currentAdmin, setCurrentAdmin] = useState<AdminUser | null>(null);

  // Subscribe to Supabase auth state changes (magic link return path)
  useEffect(() => {
    let mounted = true;
    // Pedidos: se piden recién acá, cuando hay admin CONFIRMADO. Para un visitante
    // anónimo getOrders() siempre devuelve [] por RLS — tenerla en el Promise.all del
    // arranque era una query desperdiciada en cada visita. La bandera evita pedirlos
    // dos veces cuando la sesión persistida dispara getCurrentAdmin Y onAuthStateChange.
    let pedidosCargados = false;
    const cargarPedidosAdmin = () => {
      if (pedidosCargados) return;
      pedidosCargados = true;
      SupabaseService.getOrders().then((o) => {
        if (!mounted) return;
        if (o.length) _setOrders(o);
      });
    };
    (async () => {
      await supabaseReady;
      const admin = await getCurrentAdmin();
      if (!mounted) return;
      if (admin) {
        setCurrentAdmin(admin);
        setIsAdmin(true);
        cargarPedidosAdmin(); // sesión persistida: el admin ya estaba logueado al cargar
      } else if (isSupabaseConnected()) {
        // Supabase sano pero sin sesión real: el flag legacy de password no vale.
        sessionStorage.removeItem('volea_admin');
        setIsAdmin(false);
      }
    })().catch((e) => {
      // Sin este catch, un rechazo acá quedaba sin atender y dejaba `isAdmin` sin
      // decidir: la pantalla no avanzaba ni al panel ni al login.
      console.error('[arranque] no se pudo resolver el admin', e);
    });
    const unsub = onAuthStateChange((admin) => {
      if (!mounted) return;
      setCurrentAdmin(admin);
      if (admin) {
        setIsAdmin(true);
        cargarPedidosAdmin(); // login recién confirmado (password o magic link)
      } else if (isSupabaseConnected()) {
        setIsAdmin(false); // sesión expirada/revocada
        pedidosCargados = false; // si vuelve a loguearse en esta misma visita, recargar
      }
    });
    return () => { mounted = false; unsub(); };
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [datosListos, setDatosListos] = useState(false);

  useEffect(() => {
    let vivo = true;
    // TECHO DURO DEL SPLASH. Antes la web entera esperaba a que terminaran el probe de
    // salud y las 8 consultas iniciales, sin timeout ni catch: un solo pedido colgado
    // (red mala, Supabase frío, refresh del token del admin reteniendo el navigator lock
    // que necesitan todas las queries) dejaba "Cargando..." para siempre y la única
    // salida era F5. Ahora a los 4s se muestra la web pase lo que pase; los datos que
    // lleguen tarde entran solos cuando llegan (cada _set* dispara su render).
    const techoSplash = setTimeout(() => {
      if (!vivo) return;
      console.warn('[arranque] los datos tardaron más de 4s: muestro la web igual y sigo esperándolos');
      setLoaded(true);
    }, 4000);

    const loadData = async () => {
      // Espera el probe de salud de Supabase: hasta ~12s (2 intentos × 6s de abort, ver
      // supabaseClient.ts), NO 2.5s como decía este comentario. Por eso existe el techo de
      // arriba: sin él, esos 12s del peor caso son 12s de splash antes de siquiera pedir datos.
      await supabaseReady;

      // Supabase es la fuente de verdad de todo. Fallback: snapshot legacy para
      // productos/categorías y localStorage para el resto.
      let loadedProducts: Product[];
      if (isSupabaseConnected()) {
        // Techo también acá, no solo en el splash. Las 7 consultas son `await` pelados
        // (las lecturas de supabaseService no tienen timeout propio), así que si UNA no responde nunca,
        // Promise.all no resuelve, el .finally() de abajo no corre y `datosListos` queda
        // en false PARA SIEMPRE: la web se muestra a los 4s pero tienda, checkout y ficha
        // se quedan girando eternamente. Con el techo, a los 10s se sigue con el respaldo
        // (snapshot para productos/categorías, INITIAL_* para el resto) y las páginas
        // pueden decir la verdad en vez de un "cargando" infinito.
        const respaldo: [Product[] | null, Category[] | null, Event[], Club[], Announcement[], Post[], StandingEntry[], Promo[]] =
          [null, null, [], [], [], [], [], []];
        const [p, c, e, cl, an, po, st, pr] = await conLimite(Promise.all([
          SupabaseService.getProducts(),
          SupabaseService.getCategories(),
          SupabaseService.getEvents(),
          SupabaseService.getClubs(),
          SupabaseService.getAnnouncements(),
          SupabaseService.getPosts(),
          SupabaseService.getStandings(),
          SupabaseService.getPromos(),
        ]), 10000, respaldo);
        _setPromos(pr);
        // null = fetch falló → snapshot legacy; [] = catálogo vacío a propósito.
        // El snapshot va con import() dinámico a propósito: son 139 KB minificados
        // (shopifyService + shopify-catalog.json) que antes viajaban en el entry y se
        // parseaban en cada arranque para no usarse casi nunca. El chunk baja solo
        // cuando el fetch realmente falló; misma data y mismo camino que antes.
        if (p === null || c === null) {
          const { getProductsAsInternal, getCategoriesAsInternal } = await import('./services/shopifyService');
          loadedProducts = p ?? getProductsAsInternal();
          _setProducts(loadedProducts);
          _setCategories(c ?? getCategoriesAsInternal());
        } else {
          loadedProducts = p;
          _setProducts(loadedProducts);
          _setCategories(c);
        }
        _setEvents(e.length ? e : INITIAL_EVENTS);
        // Pedidos: acá va solo lo que haya en este dispositivo (el comprador ve los suyos).
        // La query real a Supabase se dispara recién cuando se confirma un admin (ver el
        // useEffect de auth de arriba): para un anónimo siempre daba [] por RLS. Set
        // funcional a propósito: si la carga del admin llegó ANTES que este Promise.all
        // (una query sola vs siete), no hay que pisarle los pedidos de la nube.
        _setOrders(prev => (prev.length ? prev : StorageService.getOrders()));
        _setClubs(cl.length ? cl : INITIAL_CLUBS);
        _setAnnouncements(an.length ? an : INITIAL_ANNOUNCEMENTS);
        _setPosts(po);
        _setStandings(st);
      } else {
        // Sin Supabase configurado (dev local sin .env): catálogo desde el snapshot,
        // con import() dinámico por el mismo motivo que arriba.
        const { getProductsAsInternal, getCategoriesAsInternal } = await import('./services/shopifyService');
        loadedProducts = getProductsAsInternal();
        _setProducts(loadedProducts);
        _setCategories(getCategoriesAsInternal());
        const ver = StorageService.getVersion();
        if (ver !== StorageService.currentVersion) {
          StorageService.clearAll();
          StorageService.setVersion();
          StorageService.setEvents(INITIAL_EVENTS);
          StorageService.setClubs(INITIAL_CLUBS);
          StorageService.setAnnouncements(INITIAL_ANNOUNCEMENTS);
          _setEvents(INITIAL_EVENTS);
          _setClubs(INITIAL_CLUBS);
          _setAnnouncements(INITIAL_ANNOUNCEMENTS);
          _setOrders([]);
        } else {
          const e = StorageService.getEvents();
          const o = StorageService.getOrders();
          const cl = StorageService.getClubs();
          const an = StorageService.getAnnouncements();
          _setEvents(e.length ? e : INITIAL_EVENTS);
          _setClubs(cl.length ? cl : INITIAL_CLUBS);
          _setAnnouncements(an.length ? an : INITIAL_ANNOUNCEMENTS);
          _setOrders(o);
          if (!e.length) StorageService.setEvents(INITIAL_EVENTS);
          if (!cl.length) StorageService.setClubs(INITIAL_CLUBS);
          if (!an.length) StorageService.setAnnouncements(INITIAL_ANNOUNCEMENTS);
        }
      }

      // Cart: refresh items with current product data to avoid stale prices/stock.
      // Revalida la combinación talle|color y ajusta cantidades al stock actual.
      const savedCart = StorageService.getCart();
      const refreshedCart: CartItem[] = [];
      for (const item of savedCart) {
        const currentProduct = loadedProducts.find((p) => p.id === item.product.id);
        if (!currentProduct || currentProduct.active === false) continue;
        const key = item.selectedColor ? `${item.selectedSize}|${item.selectedColor}` : item.selectedSize;
        const available = currentProduct.stockBySize[key] || 0;
        if (available <= 0) continue;
        refreshedCart.push({
          ...item,
          product: currentProduct,
          quantity: Math.min(item.quantity, available),
          variantId: undefined, // legacy Shopify — ya no aplica
        });
      }
      _setCart(refreshedCart);
      StorageService.setCart(refreshedCart);
    };
    // `finally` (no solo el camino feliz): si loadData falla a mitad —una query que
    // rechaza, un dato con forma inesperada— la web se muestra igual. Antes el throw
    // se perdía en una promesa sin catch y el splash quedaba colgado para siempre.
    loadData()
      .catch((e) => console.error('[arranque] falló la carga inicial; muestro la web con lo que haya', e))
      .finally(() => {
        if (!vivo) return;
        clearTimeout(techoSplash);
        setLoaded(true);
        setDatosListos(true);
      });

    return () => { vivo = false; clearTimeout(techoSplash); };
  }, []);

  const setProducts = useCallback((p: Product[]) => {
    _setProducts(p);
    StorageService.setProducts(p);
    SupabaseService.setProducts(p);
  }, []);

  // Recarga de solo lectura desde Supabase (ej: tras reponer stock al anular
  // una venta en la Caja). No escribe nada de vuelta a la nube.
  const refreshProducts = useCallback(async () => {
    if (!isSupabaseConnected()) return;
    const p = await SupabaseService.getProducts();
    if (p) {
      _setProducts(p);
      StorageService.setProducts(p);
    }
  }, []);

  // Aviso cuando la nube rechaza una escritura (sin conexión, sesión vencida,
  // RLS). El cambio siempre quedó guardado en este dispositivo; el aviso evita
  // que se pierda "en silencio" sin llegar a la nube. Si la causa es la sesión
  // de admin vencida (el clásico: el token expiró y el refresh quedó colgado),
  // el aviso lo dice explícito para que quede claro que hay que relogearse.
  // IIFE async adentro: los call sites hacen .then(warnCloudFail) y la firma
  // sync se mantiene tal cual.
  const warnCloudFail = (ok: boolean) => {
    if (ok) return;
    void (async () => {
      if (await sesionAdminVencida()) {
        toast.error(
          'Tu sesión de admin venció — cerrá sesión y volvé a entrar. Los cambios NO se están guardando en la nube.',
          { duration: 9000 },
        );
      } else {
        toast.error(
          '⚠️ No se pudo subir a la nube. El cambio quedó guardado solo en este dispositivo. Revisá tu conexión / que sigas con sesión de admin, y guardá de nuevo.',
          { duration: 9000 },
        );
      }
    })();
  };

  const saveProduct = useCallback((p: Product) => {
    _setProducts(prev => {
      const idx = prev.findIndex(x => x.id === p.id);
      const next = idx >= 0 ? prev.map(x => (x.id === p.id ? p : x)) : [...prev, p];
      StorageService.setProducts(next);
      return next;
    });
    SupabaseService.upsertProduct(p).then(warnCloudFail);
  }, []);

  const removeProduct = useCallback((id: string) => {
    _setProducts(prev => {
      const next = prev.filter(x => x.id !== id);
      StorageService.setProducts(next);
      return next;
    });
    SupabaseService.deleteProduct(id).then(warnCloudFail);
  }, []);

  const savePost = useCallback((p: Post) => {
    _setPosts(prev => {
      const idx = prev.findIndex(x => x.id === p.id);
      return idx >= 0 ? prev.map(x => (x.id === p.id ? p : x)) : [p, ...prev];
    });
    SupabaseService.upsertPost(p).then(warnCloudFail);
  }, []);

  const removePost = useCallback((id: string) => {
    _setPosts(prev => prev.filter(x => x.id !== id));
    SupabaseService.deletePost(id).then(warnCloudFail);
  }, []);

  const saveStanding = useCallback((s: StandingEntry) => {
    _setStandings(prev => {
      const idx = prev.findIndex(x => x.id === s.id);
      const next = idx >= 0 ? prev.map(x => (x.id === s.id ? s : x)) : [...prev, s];
      return next.sort((a, b) => a.category.localeCompare(b.category) || a.position - b.position);
    });
    SupabaseService.upsertStanding(s).then(warnCloudFail);
  }, []);

  const removeStanding = useCallback((id: string) => {
    _setStandings(prev => prev.filter(x => x.id !== id));
    SupabaseService.deleteStanding(id).then(warnCloudFail);
  }, []);

  const setEvents = useCallback((e: Event[]) => {
    _setEvents(e);
    StorageService.setEvents(e);
    SupabaseService.setEvents(e);
  }, []);

  const setOrders = useCallback((o: Order[]) => {
    _setOrders(o);
    StorageService.setOrders(o);
    SupabaseService.setOrders(o).then(warnCloudFail);
  }, []);

  // Alta de pedido desde el checkout (anónimo): insert plano, no upsert.
  // Devuelve la promesa del insert: el flujo MP la espera, WhatsApp no.
  const addOrder = useCallback((order: Order) => {
    _setOrders(prev => {
      const next = [...prev, order];
      StorageService.setOrders(next);
      return next;
    });
    return SupabaseService.addOrder(order);
  }, []);

  const setCategories = useCallback((c: Category[]) => {
    _setCategories(c);
    StorageService.setCategories(c);
    SupabaseService.setCategories(c);
  }, []);

  const setClubs = useCallback((c: Club[]) => {
    _setClubs(c);
    StorageService.setClubs(c);
    SupabaseService.setClubs(c);
  }, []);

  const setAnnouncements = useCallback((a: Announcement[]) => {
    _setAnnouncements(a);
    StorageService.setAnnouncements(a);
    SupabaseService.setAnnouncements(a);
  }, []);

  const setCart = useCallback((c: CartItem[]) => {
    _setCart(c);
    StorageService.setCart(c);
  }, []);

  const addToCart = useCallback((item: CartItem) => {
    _setCart(prev => {
      const idx = prev.findIndex(
        ci => ci.product.id === item.product.id && ci.selectedSize === item.selectedSize && ci.selectedColor === item.selectedColor
      );
      const stockKey = item.selectedColor ? `${item.selectedSize}|${item.selectedColor}` : item.selectedSize;
      const availableStock = item.product.stockBySize[stockKey] || 0;
      const currentQty = idx >= 0 ? prev[idx].quantity : 0;
      const newQty = Math.min(currentQty + item.quantity, availableStock);
      if (newQty <= 0) {
        toast.error('No queda stock de esa combinación de talle y color');
        return prev;
      }

      let next: CartItem[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = { ...next[idx], quantity: newQty };
      } else {
        next = [...prev, { ...item, quantity: Math.min(item.quantity, availableStock) }];
      }
      StorageService.setCart(next);
      toast.success(`Agregado al carrito — ${item.product.name}`);
      return next;
    });
  }, []);

  const removeFromCart = useCallback((productId: string, size: string, color: string) => {
    _setCart(prev => {
      const next = prev.filter(ci => !(ci.product.id === productId && ci.selectedSize === size && ci.selectedColor === color));
      StorageService.setCart(next);
      return next;
    });
  }, []);

  const updateCartQuantity = useCallback((productId: string, size: string, color: string, qty: number) => {
    _setCart(prev => {
      const next = prev.map(ci => {
        if (ci.product.id === productId && ci.selectedSize === size && ci.selectedColor === color) {
          const stockKey = color ? `${size}|${color}` : size;
          const maxStock = ci.product.stockBySize[stockKey] || 0;
          return { ...ci, quantity: Math.max(1, Math.min(qty, maxStock)) };
        }
        return ci;
      });
      StorageService.setCart(next);
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    _setCart([]);
    StorageService.setCart([]);
  }, []);

  // El login real es Supabase Auth (contraseña o magic link). Antes había un fallback
  // legacy que aceptaba una contraseña hardcodeada en constants.ts cuando Supabase no
  // estaba conectado: una contraseña en el bundle público era un footgun, y encima solo
  // prendía un flag de sessionStorage sin sesión real (el panel quedaba vacío por RLS).
  // Sin Supabase no hay login, punto.
  const login = useCallback((_password: string) => false, []);

  const sendLoginLink = useCallback(async (email: string) => {
    return await sendMagicLink(email);
  }, []);

  const logout = useCallback(async () => {
    await authSignOut();
    setCurrentAdmin(null);
    setIsAdmin(false);
    sessionStorage.removeItem('volea_admin');
    // roster/resultados de torneos: no dejar que persistan en localStorage en una compu
    // compartida - PERO solo si ya se sincronizaron. El gestor promete "tus cambios quedan
    // guardados en este navegador y se reintenta solo"; si hay push pendiente (mala señal,
    // recien cerro el tab de Torneos) borrar incondicionalmente lo perdería para siempre.
    // Import dinamico a proposito (no estatico arriba): asi ni el string de la clave de
    // cache queda en el chunk de entrada - se pide solo en este momento puntual (logout no
    // es un path sensible a latencia). Si falla (offline, etc.) no bloquea el logout en si.
    try {
      const { limpiarCacheTorneosSiSincronizada } = await import('./torneos/cacheTorneos');
      limpiarCacheTorneosSiSincronizada();
    } catch (e) {
      console.error('[logout] no se pudo revisar la cache de torneos', e);
    }
  }, []);

  if (!loaded) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-navy-700 gap-6">
      <img src="/logo.png" alt="VOLEA" className="h-16 animate-pulse" />
      <div className="flex gap-2">
        <div className="w-3 h-3 rounded-full bg-lime-400 animate-bounce" style={{animationDelay: '0ms'}} />
        <div className="w-3 h-3 rounded-full bg-lime-400 animate-bounce" style={{animationDelay: '150ms'}} />
        <div className="w-3 h-3 rounded-full bg-lime-400 animate-bounce" style={{animationDelay: '300ms'}} />
      </div>
      <p className="text-white/60 font-body text-sm">Cargando...</p>
    </div>
  );

  return (
    <StoreContext.Provider value={{
      datosListos,
      products, setProducts, refreshProducts, saveProduct, removeProduct, events, setEvents, promos, orders, setOrders, addOrder,
      posts, savePost, removePost, standings, saveStanding, removeStanding,
      categories, setCategories, clubs, setClubs, announcements, setAnnouncements,
      cart, addToCart, removeFromCart,
      updateCartQuantity, clearCart, isAdmin, currentAdmin, login, sendLoginLink, logout,
      searchQuery, setSearchQuery, selectedCategory, setSelectedCategory,
      cartOpen, setCartOpen
    }}>
      {children}
    </StoreContext.Provider>
  );
}

// ─── 4. TopBar ───────────────────────────────────────────────────────────────

function TopBar() {
  return (
    <div className="bg-navy-900 text-white text-xs py-2 px-4 flex justify-between items-center">
      <span className="font-body">Envíos a todo Uruguay 🇺🇾</span>
      <a
        href={`https://instagram.com/${INSTAGRAM_HANDLE}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-lime-400 hover:text-lime-300 transition-colors"
      >
        <Instagram size={14} />
        <span>@{INSTAGRAM_HANDLE}</span>
      </a>
    </div>
  );
}

// ─── 5. Navbar ───────────────────────────────────────────────────────────────

function Navbar() {
  const { cart, setCartOpen } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const totalItems = cart.reduce((s, i) => s + i.quantity, 0);

  const navLinks = [
    { to: '/', label: 'Inicio' },
    { to: '/tienda', label: 'Tienda' },
    { to: '/blog', label: 'Blog' },
    // 'Clasificación' (Camino al Mundial) fuera del menú por pedido de Brian (2026-08-05,
    // "quitalo por ahora"): la ruta /clasificacion y la pestaña del admin siguen vivas;
    // para volverla a mostrar alcanza con re-agregar la entrada acá y MOSTRAR_CAMINO_MUNDIAL.
    { to: '/ranking', label: 'Ranking' },
    { to: '/galeria', label: 'Galería' },
    { to: '/eventos', label: 'Eventos' },
    { to: '/mapa', label: 'Mapa' },
    { to: '/contacto', label: 'Contacto' },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-navy-700 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-16">
        {/* Logo */}
        <Link to="/" className="flex-shrink-0">
          <img src="/logo-white.png" alt="VOLEA" className="h-12 md:h-14 drop-shadow-lg" onError={handleImgError} />
        </Link>

        {/* Desktop nav */}
        {/* lg (no md): con 8 links la fila necesita ~880px y desbordaba en tablet vertical
            (768-950px) — en esa franja manda la hamburguesa, que ya la cubría hasta 767. */}
        <div className="hidden lg:flex items-center gap-5 lg:gap-7">
          {navLinks.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                `font-display font-semibold text-sm uppercase tracking-wider transition-colors py-1 border-b-2 ${
                  isActive
                    ? 'text-lime-400 border-lime-400'
                    : 'text-white border-transparent hover:text-lime-400'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        {/* Right */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCartOpen(true)}
            aria-label={totalItems > 0 ? `Carrito, ${totalItems} ${totalItems === 1 ? 'producto' : 'productos'}` : 'Abrir carrito'}
            className="relative text-white hover:text-lime-400 transition-colors"
          >
            <ShoppingCart size={24} />
            {totalItems > 0 && (
              <span className="absolute -top-2 -right-2 bg-lime-400 text-navy-700 text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {totalItems}
              </span>
            )}
          </button>
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
            className="lg:hidden text-white hover:text-lime-400 transition-colors"
          >
            <Menu size={24} />
          </button>
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 lg:hidden" style={{zIndex: 9999}}>
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 bg-navy-800 slide-in-left">
            <div className="flex items-center justify-between p-4 border-b border-navy-600">
              <img src="/logo.png" alt="VOLEA" className="h-8" onError={handleImgError} />
              <button onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" className="text-white hover:text-lime-400">
                <X size={24} />
              </button>
            </div>
            <div className="flex flex-col p-4 gap-2">
              {navLinks.map(link => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `font-display font-semibold text-base py-3 px-4 rounded-lg transition-colors ${
                      isActive ? 'text-lime-400 bg-navy-700' : 'text-white hover:bg-navy-700 hover:text-lime-400'
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

// ─── 6. CartDrawer ───────────────────────────────────────────────────────────

function CartDrawer() {
  const { cart, cartOpen, setCartOpen, removeFromCart, updateCartQuantity } = useStore();
  const { activa: promo } = usePromo();
  // El MISMO cálculo que usa el checkout y que cobra MP (redondeo por unidad).
  const { subtotal, descuento, total } = totalesConPromo(cart, promo);

  if (!cartOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={() => setCartOpen(false)} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl slide-in-right flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="font-display text-xl font-bold text-navy-700">Tu carrito</h2>
          <button onClick={() => setCartOpen(false)} aria-label="Cerrar carrito" className="text-navy-700 hover:text-red-500 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <ShoppingCart size={64} strokeWidth={1} />
              <p className="mt-4 font-display text-lg">Tu carrito está vacío</p>
              <Link
                to="/tienda"
                onClick={() => setCartOpen(false)}
                className="mt-4 text-lime-800 hover:text-lime-700 font-semibold"
              >
                Ir a la tienda
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {cart.map((item, idx) => (
                <div key={`${item.product.id}-${item.selectedSize}-${item.selectedColor}-${idx}`} className="flex gap-3 bg-gray-50 rounded-lg p-3">
                  <img
                    src={item.product.images[0] || FALLBACK_IMG}
                    alt={item.product.name}
                    className="w-20 h-20 object-cover rounded-lg"
                    onError={handleImgError}
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-semibold text-sm text-navy-700 truncate">{item.product.name}</h3>
                    <p className="text-xs text-gray-500">
                      {item.selectedSize && `Talle: ${item.selectedSize}`}
                      {item.selectedColor && ` | Color: ${item.selectedColor}`}
                    </p>
                    <p className="font-display font-bold text-navy-700 mt-1">{formatPrice(item.product.price)}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => updateCartQuantity(item.product.id, item.selectedSize, item.selectedColor, item.quantity - 1)}
                        className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-200 transition-colors"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="font-semibold text-sm w-6 text-center">{item.quantity}</span>
                      {(() => {
                        // updateCartQuantity ya topea con el stock, pero el botón no lo
                        // mostraba: al llegar al tope se podía seguir clickeando sin que
                        // pasara nada y sin explicación. Mismo estado deshabilitado que ya
                        // usa el control de la ficha de producto.
                        const clave = item.selectedColor ? `${item.selectedSize}|${item.selectedColor}` : item.selectedSize;
                        const disponible = item.product.stockBySize[clave] || 0;
                        const enElTope = item.quantity >= disponible;
                        return (
                          <button
                            onClick={() => updateCartQuantity(item.product.id, item.selectedSize, item.selectedColor, item.quantity + 1)}
                            disabled={enElTope}
                            title={enElTope ? `No hay más stock (${disponible} disponible${disponible === 1 ? '' : 's'})` : undefined}
                            className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          >
                            <Plus size={14} />
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                  <button
                    onClick={() => removeFromCart(item.product.id, item.selectedSize, item.selectedColor)}
                    className="text-gray-400 hover:text-red-500 transition-colors self-start"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div className="border-t border-gray-200 p-4 space-y-2">
            {descuento > 0 && promo && (
              <>
                <div className="flex justify-between items-center text-sm text-gray-500">
                  <span>Subtotal</span>
                  <span className="line-through">{formatPrice(subtotal)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-semibold text-lime-700">
                  <span>{promo.label} (−{promo.percent}%)</span>
                  <span>−{formatPrice(descuento)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between items-center mb-2">
              <span className="font-display font-semibold text-lg">Total</span>
              <span className="font-display font-bold text-xl text-navy-700">{formatPrice(total)}</span>
            </div>
            <Link
              to="/checkout"
              onClick={() => setCartOpen(false)}
              className="w-full bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 pulse-glow"
            >
              <MessageCircle size={18} /> Finalizar pedido
            </Link>
            <p className="text-xs text-gray-400 text-center">
              El pago: online con Mercado Pago o por WhatsApp, como prefieras.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper: ProductCard ─────────────────────────────────────────────────────

function ProductCard({ product }: { product: Product }) {
  const { categories } = useStore();
  const { activa: promo } = usePromo();
  const totalStock = getTotalStock(product);
  const isNew = (Date.now() - new Date(product.createdAt).getTime()) < 30 * 24 * 60 * 60 * 1000;
  return (
    <Link to={`/producto/${product.id}`} className="product-card group block bg-white rounded-2xl overflow-hidden shadow-md border border-gray-100">
      <div className="relative aspect-square bg-gray-100 overflow-hidden">
        <img
          src={product.images[0] || FALLBACK_IMG}
          alt={product.name}
          loading="lazy"
          decoding="async"
          className="card-img w-full h-full object-cover"
          onError={handleImgError}
        />
        {/* Hover overlay */}
        <div className="card-overlay absolute inset-0 bg-navy-700/60 flex items-center justify-center z-10">
          <span className="bg-lime-400 text-navy-700 font-display font-bold text-sm px-6 py-2 rounded-full flex items-center gap-2">
            <Eye size={16} /> Ver producto
          </span>
        </div>
        {/* Badges */}
        {totalStock === 0 && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
            <span className="bg-red-600 text-white text-sm font-display font-bold px-4 py-2 rounded-full tracking-wider">AGOTADO</span>
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-col gap-1 z-10">
          {promo && (
            <span className="bg-navy-900 text-lime-400 text-xs font-black px-2 py-1 rounded-full">−{promo.percent}%</span>
          )}
          {product.isOffer && !promo && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">OFERTA</span>
          )}
          {isNew && totalStock > 0 && (
            <span className="bg-lime-400 text-navy-700 text-xs font-bold px-2 py-1 rounded-full">NUEVO</span>
          )}
        </div>
        <span className="absolute top-3 right-3 bg-navy-700/80 text-white text-xs px-2 py-1 rounded-full z-10">{categoryLabel(categories, product.category)}</span>
      </div>
      <div className="p-4">
        <h3 className="font-display font-semibold text-navy-700 group-hover:text-lime-600 transition-colors line-clamp-2">{product.name}</h3>
        <div className="mt-2 flex items-center gap-2">
          {/* Con promo vigente: precio descontado (el que se cobra de verdad) y el de
              lista tachado. La oferta previa del producto no se muestra a la vez para
              no apilar tres números. */}
          {promo ? (
            <>
              <span className="font-display font-bold text-lg text-navy-700">{formatPrice(precioConPromo(product.price, promo.percent))}</span>
              <span className="text-sm text-gray-400 line-through">{formatPrice(product.price)}</span>
            </>
          ) : (
            <>
              <span className="font-display font-bold text-lg text-navy-700">{formatPrice(product.price)}</span>
              {product.isOffer && product.originalPrice && (
                <span className="text-sm text-gray-400 line-through">{formatPrice(product.originalPrice)}</span>
              )}
            </>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          {/* lime-800, no 500/600: sobre blanco esos tonos no llegan ni a 3:1 (ilegible al sol) */}
          <span className="text-lime-800 font-semibold text-sm flex items-center gap-1 group-hover:gap-2 transition-all">
            Ver producto <ArrowRight size={14} />
          </span>
        </div>
      </div>
    </Link>
  );
}

// ─── 6b. PromoBanner ─────────────────────────────────────────────────────────

/**
 * Banner de la promoción vigente (o por venir), animado: rayas que corren,
 * destello que barre y el chip del % latiendo. Sale de la tabla promos: aparece
 * solo cuando hay algo que anunciar y desaparece solo cuando la promo vence.
 * `compacto`: versión de una línea para la tienda.
 */
function PromoBanner({ compacto = false }: { compacto?: boolean }) {
  const { activa, proxima } = usePromo();
  const promo = activa ?? proxima;
  if (!promo) return null;
  const enCurso = Boolean(activa);

  const rayas = (
    <>
      {/* Rayas diagonales en movimiento (300% de ancho para un loop perfecto) */}
      <div
        aria-hidden
        className="promo-cinta pointer-events-none absolute inset-y-0 left-0 w-[300%] opacity-[0.15]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-45deg, #ccff00 0 16px, transparent 16px 40px)',
        }}
      />
      {/* Destello que barre cada tanto */}
      <div
        aria-hidden
        className="promo-brillo pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent"
      />
    </>
  );

  if (compacto) {
    return (
      <Link
        to="/tienda"
        className="relative mb-8 flex items-center justify-center gap-3 overflow-hidden rounded-xl bg-navy-800 px-4 py-3 text-center"
      >
        {rayas}
        {/* aria-hidden: el porcentaje ya está en el label; sin esto el lector lo dice dos veces */}
        <span aria-hidden className="promo-latido relative rounded-full bg-lime-400 px-2.5 py-0.5 font-display text-sm font-black text-navy-900">
          −{promo.percent}%
        </span>
        <span className="relative font-display text-sm font-bold text-white">
          {enCurso
            // "hasta el 20 de agosto": la ventana de un solo día ya formatea "el 20 de..."
            ? `${promo.label} — hasta ${ventanaPromo({ ...promo, startsOn: promo.endsOn })}`
            // "Se viene:" adelante — sin eso parecía una promo YA vigente con la grilla sin descontar
            : `Se viene: ${promo.label} — ${ventanaPromo(promo)}`}
        </span>
      </Link>
    );
  }

  return (
    <section className="relative overflow-hidden bg-navy-800 py-10">
      {rayas}
      <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 text-center lg:flex-row lg:text-left">
        {/* El % grande, latiendo */}
        <div className="promo-latido flex-shrink-0">
          <div className="flex h-28 w-28 rotate-[-6deg] flex-col items-center justify-center rounded-2xl bg-lime-400 shadow-[0_0_35px_rgba(204,255,0,.35)]">
            <span className="font-display text-4xl font-black leading-none text-navy-900">−{promo.percent}%</span>
            <span className="font-display text-[10px] font-black uppercase tracking-widest text-navy-900/70">
              {enCurso ? 'Ahora' : 'Se viene'}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-black uppercase leading-tight text-white sm:text-3xl">
            {promo.label}
          </h2>
          <p className="mt-1 font-display text-sm font-bold uppercase tracking-wide text-lime-400">
            {enCurso
              ? `Solo hasta ${ventanaPromo({ ...promo, startsOn: promo.endsOn })} — después vuelve al precio de siempre`
              : `${ventanaPromo(promo)} — andá eligiendo`}
          </p>
          {promo.deliveryNote && (
            <p className="mt-3 inline-flex items-start gap-2 text-sm leading-snug text-gray-300">
              <Package size={16} className="mt-0.5 flex-shrink-0 text-lime-400" />
              <span>{promo.deliveryNote}</span>
            </p>
          )}
        </div>

        <Link
          to="/tienda"
          className="pulse-glow relative flex-shrink-0 rounded-lg bg-lime-400 px-8 py-3.5 font-display font-bold text-navy-900 transition-colors hover:bg-lime-300"
        >
          {enCurso ? 'Comprar con descuento' : 'Ir viendo la colección'}
        </Link>
      </div>
    </section>
  );
}

// ─── 7. HomePage ─────────────────────────────────────────────────────────────

function HomePage() {
  const { products, categories, posts, standings, announcements, events, datosListos } = useStore();
  const heroBgY = useParallax(120);
  const heroTextY = useParallax(-40);

  usePageMeta({
    title: 'VOLEA | La primera marca de pickleball de Uruguay',
    description: 'Indumentaria de pickleball diseñada en Uruguay. Remeras técnicas, polos, vestidos, shorts y gorros. Armá tu pedido y coordinamos la entrega por WhatsApp.',
    image: window.location.origin + '/logo.png',
  });

  const featured = products.filter(p => p.isFeatured && p.active !== false).slice(0, 4);

  const publishedPosts = posts
    .filter(p => p.published)
    .sort((a, b) => new Date(b.publishedAt || b.createdAt).getTime() - new Date(a.publishedAt || a.createdAt).getTime())
    .slice(0, 3);

  const topStandings = [...standings].sort((a, b) => a.position - b.position).slice(0, 3);
  // "Camino al Mundial" pausada (Brian, 2026-08-05). true = vuelve la sección de la home.
  const MOSTRAR_CAMINO_MUNDIAL = false;

  const activeAnnouncements = announcements.filter(a => a.active);

  // Torneo que se muestra pegado al hero. Se elige solo: el próximo por fecha entre
  // los que todavía no pasaron. Cuando termina, la sección desaparece sin tocar nada.
  // Se compara contra el día de HOY (no contra el instante) para que el torneo siga
  // anunciado durante su propio día en vez de esfumarse a las 00:00.
  const torneoDestacado = useMemo(() => {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: TZ_UY });
    return events
      // Se mide contra el ÚLTIMO día: un torneo de varios días tiene que seguir
      // anunciado mientras se juega, no desaparecer al arrancar el segundo día.
      .filter(e => e.status === 'upcoming' && (e.endDate || e.date) >= hoy)
      .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  }, [events]);
  const waTorneo = waUruguay(torneoDestacado?.phone);
  const torneoEnCurso = !!torneoDestacado &&
    torneoDestacado.date <= new Date().toLocaleDateString('en-CA', { timeZone: TZ_UY });

  const categoryIcons: Record<string, React.ReactNode> = {
    'Remeras': <Zap size={26} />,
    'Polos': <Star size={26} />,
    'Shorts': <Check size={26} />,
    'Vestidos': <Heart size={26} />,
    'Gorros': <Shield size={26} />,
    'Accesorios': <Package size={26} />,
  };

  const announcementColors: Record<string, string> = {
    info: 'bg-navy-500',
    promo: 'bg-lime-600',
    event: 'bg-navy-700 border border-lime-400/40',
    important: 'bg-red-500',
  };

  const announcementTypeLabels: Record<string, string> = {
    info: 'Información',
    promo: 'Promoción',
    event: 'Evento',
    important: 'Importante',
  };

  const formatPostDate = (post: Post) =>
    new Date(post.publishedAt || post.createdAt).toLocaleDateString('es-UY', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  const steps = [
    {
      icon: <ShoppingCart size={26} />,
      title: 'Elegí tus productos',
      desc: 'Recorré la colección, elegí talle y color, y agregá todo al carrito.',
    },
    {
      icon: <Package size={26} />,
      title: 'Enviá tu pedido',
      desc: 'Completá tus datos y mandanos el pedido directo desde la web.',
    },
    {
      icon: <MessageCircle size={26} />,
      title: 'Coordinamos la entrega',
      desc: 'Te escribimos para coordinar la entrega. El pago: online o por WhatsApp, como te quede cómodo.',
    },
  ];

  return (
    <div className="fade-in">
      {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        <motion.div
          aria-hidden
          className="absolute inset-0 -top-20 -bottom-20"
          style={{
            y: heroBgY,
            backgroundImage: 'url(/products/lifestyle-sunset-back.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-navy-900/95 via-navy-800/85 to-navy-700/70" />
        <div
          className="absolute inset-0 opacity-5"
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}
        />

        <motion.div style={{ y: heroTextY }} className="relative z-10 max-w-7xl mx-auto px-4 py-24 w-full">
          <div className="max-w-3xl">
            <p className="hero-enter hero-enter-1 opacity-0 text-lime-400 font-display font-bold text-sm md:text-base uppercase tracking-[0.3em] mb-6">
              La primera marca de pickleball de Uruguay
            </p>
            <h1 className="hero-enter hero-enter-2 opacity-0 font-display text-5xl md:text-6xl lg:text-7xl font-black leading-[1.05] mb-6 text-white">
              EL <span className="text-gradient">PICKLEBALL</span> URUGUAYO YA TIENE SU MARCA
            </h1>
            <p className="hero-enter hero-enter-3 opacity-0 text-lg md:text-xl text-gray-300 mb-10 font-body max-w-xl leading-relaxed">
              Indumentaria técnica pensada acá, para los que juegan acá. Evolucionamos distinto. Jugamos distinto.
            </p>
            <div className="hero-enter hero-enter-4 opacity-0 flex flex-col sm:flex-row gap-4">
              <Link
                to="/tienda"
                className="pulse-glow inline-flex items-center justify-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-4 px-10 rounded-lg text-lg transition-colors"
              >
                Ver la colección <ArrowRight size={20} />
              </Link>
              <Link
                to="/ranking"
                className="inline-flex items-center justify-center gap-2 border-2 border-white/30 hover:border-lime-400 text-white hover:text-lime-400 font-display font-bold py-4 px-10 rounded-lg text-lg transition-colors"
              >
                <Trophy size={20} /> Ranking VOLEA
              </Link>
            </div>
          </div>

          {/* Mini-stats */}
          <div className="mt-16 grid grid-cols-3 gap-6 max-w-lg">
            {[
              { num: '10+', label: 'Clubes' },
              { num: '32', label: 'Canchas' },
              { num: '100%', label: 'Uruguay' },
            ].map((stat, i) => (
              <div key={i} className="text-center">
                <p className="font-display text-3xl md:text-4xl font-black text-lime-400">{stat.num}</p>
                <p className="text-gray-400 text-sm font-body mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* ── Cartel neón del torneo ─────────────────────────────────────
              Vive DENTRO de este contenedor (y no suelto en la <section>) a
              propósito: así se centra contra el bloque de texto en vez de contra
              el alto total del hero — colgado de la sección quedaba ~140px más
              abajo, a la altura de las mini-stats — y además acompaña el parallax.
              Ocupa el aire de la derecha (el texto vive en un max-w-3xl dentro de
              este max-w-7xl).
              Sale del MISMO dato que el bloque de abajo: si no hay torneo próximo,
              no existe. Se dibuja desde xl: a 1024px rozaba la caja del <h1>. */}
          {torneoDestacado && (
            /* El contenedor POSICIONA y el <Link> de adentro ANIMA, separados a
               propósito: .hero-enter termina en transform: translateY(0), que
               pisaba el -translate-y-1/2 del centrado. Con ambas cosas en el mismo
               elemento el cartel quedaba media altura más abajo (su borde superior
               caía justo donde tenía que estar el centro). */
            <div className="absolute right-4 top-1/2 z-10 hidden -translate-y-1/2 xl:block 2xl:right-0">
            <Link
              to="/eventos"
              aria-label={`${torneoDestacado.name}, ${rangoFechas(torneoDestacado.date, torneoDestacado.endDate)}`}
              className="hero-enter hero-enter-4 group block opacity-0"
            >
            <div className="relative -rotate-[3deg] transition-transform duration-500 ease-out group-hover:rotate-0 group-hover:scale-[1.03]">
              {/* Halo detrás del cartel. Sin animate-pulse: latía todo el bloque,
                  incluido el texto, y eso era buena parte de lo que se veía raro. */}
              <div
                aria-hidden
                className="absolute -inset-5 rounded-2xl bg-fuchsia-600/20 blur-2xl"
              />
              <div
                className="relative w-[320px] rounded-2xl border border-fuchsia-400/80 bg-navy-900/90 px-8 py-9 text-center"
                style={{ boxShadow: '0 0 0 1px rgba(217,70,239,.25), 0 0 30px rgba(217,70,239,.35)' }}
              >
                {/* Scanlines bien suaves: apenas una textura, no una trama visible. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xl opacity-[0.07]"
                  style={{
                    backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,.9) 0 1px, transparent 1px 5px)',
                  }}
                />
                <p
                  className="font-display text-xs font-black uppercase tracking-[0.4em] text-cyan-300"
                  style={{ textShadow: '0 0 12px rgba(103,232,249,.7)' }}
                >
                  {torneoEnCurso ? 'Se está jugando' : 'Se viene'}
                </p>
                <p className="mt-5 font-display text-sm font-black uppercase tracking-[0.5em] text-white/50">
                  VOLEA
                </p>
                {/* La aberración cromática se hace con text-shadow sobre UN solo
                    elemento: con capas superpuestas los fantasmas caían 4-6px
                    corridos en vertical y el título se veía borroso, no glitcheado. */}
                <p
                  className="mt-1.5 font-display text-[52px] font-black uppercase leading-[0.88] text-white"
                  style={{
                    textShadow:
                      '-2px 0 0 rgba(34,211,238,.85), 2px 0 0 rgba(217,70,239,.85), 0 0 26px rgba(236,72,153,.45)',
                  }}
                >
                  Racket<br />Roll
                </p>
                <div aria-hidden className="mx-auto my-6 h-px w-24 bg-gradient-to-r from-transparent via-fuchsia-400/80 to-transparent" />
                <p
                  className="font-display text-xl font-black uppercase tracking-wide text-lime-400"
                  style={{ textShadow: '0 0 14px rgba(163,230,53,.55)' }}
                >
                  {diasCortos(torneoDestacado.date, torneoDestacado.endDate)}
                </p>
                <p className="mt-2 font-display text-xs font-bold uppercase tracking-[0.3em] text-gray-400">
                  {torneoDestacado.city?.split(',')[0] || torneoDestacado.location}
                </p>
                <p className="mt-5 font-display text-xs font-bold uppercase tracking-[0.2em] text-fuchsia-300 transition-colors group-hover:text-white">
                  Ver info →
                </p>
              </div>
            </div>
            </Link>
            </div>
          )}
        </motion.div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 text-white/50">
          <span className="text-xs font-body tracking-widest uppercase">Deslizá</span>
          <div className="w-5 h-8 border-2 border-white/30 rounded-full flex justify-center pt-1">
            <div className="w-1 h-2 bg-lime-400 rounded-full animate-bounce" />
          </div>
        </div>
      </section>

      {/* ── 1a. Promo ───────────────────────────────────────────────────────
          Pegada al hero, ANTES del torneo: es una ventana de venta con fecha de
          vencimiento. Sale de la tabla promos y desaparece sola al vencer. */}
      <PromoBanner />

      {/* ── 1b. Torneo destacado ────────────────────────────────────────────
          Va PEGADO al hero a propósito: es lo primero que se ve al bajar, que es
          para lo que existe. Se dibuja sola desde `events`: aparece cuando hay un
          torneo próximo y desaparece cuando pasa, sin tocar código. */}
      {torneoDestacado && (
        <section className="relative overflow-hidden bg-navy-900 py-14">
          {/* Guiño noventoso al flyer, sin copiarlo: grilla en fuga + halos de color */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(163,230,53,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(236,72,153,.5) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'linear-gradient(to bottom, transparent, black 40%, black 60%, transparent)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 40%, black 60%, transparent)',
            }}
          />
          <div aria-hidden className="pointer-events-none absolute -left-24 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -right-24 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-lime-400/20 blur-3xl" />

          <div className="relative mx-auto max-w-5xl px-4">
            <Reveal>
              <div className="rounded-2xl border border-lime-400/30 bg-navy-800/70 p-6 backdrop-blur-sm sm:p-8">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
                  {/* El flyer, si lo subieron. Se muestra completo (object-contain):
                      recortarlo se comería las categorías y el precio. */}
                  {torneoDestacado.imageUrl && (
                    <a
                      href="#/eventos"
                      className="mx-auto w-full max-w-[220px] flex-shrink-0 lg:mx-0"
                      aria-label={`Ver ${torneoDestacado.name}`}
                    >
                      <img
                        src={torneoDestacado.imageUrl}
                        alt={`Flyer de ${torneoDestacado.name}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full rounded-xl border border-navy-600 object-contain shadow-lg"
                        onError={handleImgError}
                      />
                    </a>
                  )}
                  <div className="min-w-0 flex-1">
                    {/* Etiqueta según lo que sea (torneo/clínica/social) y según
                        el momento: mientras se juega no puede decir "próximo". */}
                    <span className="inline-flex items-center gap-2 rounded-full bg-lime-400 px-3 py-1 font-display text-xs font-black uppercase tracking-wider text-navy-900">
                      {torneoEnCurso ? 'Se está jugando' : `Próximo ${categoriaEvento(torneoDestacado.category)}`}
                    </span>
                    <h2 className="mt-3 font-display text-3xl font-black uppercase leading-none text-white sm:text-4xl">
                      {torneoDestacado.name}
                    </h2>
                    <p className="mt-2 font-display text-sm font-bold uppercase tracking-wide text-fuchsia-400">
                      {rangoFechas(torneoDestacado.date, torneoDestacado.endDate)} · {torneoDestacado.location}
                    </p>
                    <p className="mt-4 max-w-xl text-sm leading-relaxed text-gray-300">
                      {torneoDestacado.description}
                    </p>
                  </div>

                  <div className="flex w-full flex-col gap-3 lg:w-56 lg:flex-shrink-0">
                    {/* Con inscripción online abierta, ese es el botón principal;
                        WhatsApp queda como alternativa. */}
                    {torneoDestacado.inscripcionesAbiertas && (
                      <Link
                        to={`/inscripcion/${torneoDestacado.id}`}
                        className="pulse-glow flex items-center justify-center gap-2 rounded-lg bg-lime-400 px-5 py-3 font-display font-bold text-navy-900 transition-colors hover:bg-lime-300"
                      >
                        <Check size={18} /> Inscribirme online
                      </Link>
                    )}
                    {waTorneo && (
                      <a
                        href={`https://wa.me/${waTorneo}?text=${encodeURIComponent(`Hola! Quiero inscribirme al ${torneoDestacado.name}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={
                          torneoDestacado.inscripcionesAbiertas
                            ? 'flex items-center justify-center gap-2 rounded-lg border border-white/25 px-5 py-2.5 font-display text-sm font-bold text-white transition-colors hover:border-lime-400 hover:text-lime-400'
                            : 'flex items-center justify-center gap-2 rounded-lg bg-lime-400 px-5 py-3 font-display font-bold text-navy-900 transition-colors hover:bg-lime-300'
                        }
                      >
                        <MessageCircle size={18} /> {torneoDestacado.inscripcionesAbiertas ? 'O por WhatsApp' : 'Inscribirme'}
                      </a>
                    )}
                    {/* Gateado con waTorneo, igual que el botón: si en el campo hay
                        texto que no es un teléfono, no se dibuja un tel: roto. */}
                    {waTorneo && torneoDestacado.phone && (
                      <a
                        href={`tel:${torneoDestacado.phone.replace(/\s/g, '')}`}
                        className="text-center font-display text-sm font-bold text-white transition-colors hover:text-lime-400"
                      >
                        {torneoDestacado.phone}
                      </a>
                    )}
                    <Link
                      to="/eventos"
                      className="text-center text-xs font-semibold text-gray-400 underline-offset-2 transition-colors hover:text-white hover:underline"
                    >
                      Ver todos los eventos
                    </Link>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {/* ── 2. Cómo comprar ─────────────────────────────────────────────── */}
      <section className="bg-navy-700 py-16">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-10">
              <span className="text-lime-400 font-display font-bold text-sm uppercase tracking-[0.2em]">Así de simple</span>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-white mt-2">Cómo comprar en VOLEA</h2>
            </div>
          </Reveal>
          <StaggerGrid className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {steps.map((step, i) => (
              <StaggerItem key={i}>
                <div className="relative bg-navy-800/60 border border-navy-600 rounded-2xl p-8 h-full">
                  <span className="absolute top-6 right-6 font-display font-black text-5xl text-navy-600 select-none">
                    {i + 1}
                  </span>
                  <div className="w-12 h-12 bg-lime-400 rounded-xl flex items-center justify-center text-navy-700 mb-5">
                    {step.icon}
                  </div>
                  <h3 className="font-display font-bold text-white text-lg mb-2">{step.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </StaggerItem>
            ))}
          </StaggerGrid>
          <Reveal delay={150}>
            <p className="text-center text-gray-400 text-sm mt-8">
              Pagá online con Mercado Pago o coordiná pago y entrega por WhatsApp — transferencia o efectivo, como prefieras.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── 3. Destacados ───────────────────────────────────────────────── */}
      {/* Con la web mostrándose a los 4s, esta sección podía quedar como un título con una
          grilla vacía debajo — lo primero que ve alguien que entra con mala red, y parece
          rota. Si todavía no hay nada que destacar, no se dibuja. */}
      {(featured.length > 0 || datosListos) && (
      <section className="py-20 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-lime-800 font-display font-bold text-sm uppercase tracking-[0.2em]">La selección de la casa</span>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mt-2">Destacados de la colección</h2>
              <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
            </div>
          </Reveal>
          <StaggerGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featured.map(p => (
              <StaggerItem key={p.id}>
                <ProductCard product={p} />
              </StaggerItem>
            ))}
          </StaggerGrid>
          <Reveal>
            <div className="text-center mt-10">
              <Link
                to="/tienda"
                className="inline-flex items-center gap-2 border-2 border-navy-700 text-navy-700 hover:bg-navy-700 hover:text-white font-display font-bold py-3 px-8 rounded-lg transition-colors"
              >
                Ver toda la colección <ArrowRight size={18} />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
      )}

      {/* ── 4. Categorías ───────────────────────────────────────────────── */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-lime-800 font-display font-bold text-sm uppercase tracking-[0.2em]">Encontrá lo tuyo</span>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mt-2">Explorá por categoría</h2>
              <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
            </div>
          </Reveal>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[...categories].sort((a, b) => a.sortOrder - b.sortOrder).map((cat, i) => (
              <Reveal key={cat.id} delay={i * 80}>
                <Link
                  to={`/tienda?category=${encodeURIComponent(cat.id)}`}
                  className="hover-scale flex flex-col items-center justify-center bg-white rounded-xl p-6 shadow-md border border-gray-100 hover:border-lime-400 hover:shadow-lg transition-all group"
                >
                  <div className="text-navy-700 group-hover:text-lime-500 transition-colors mb-3">
                    {categoryIcons[cat.name] || <Package size={26} />}
                  </div>
                  <span className="font-display font-semibold text-navy-700 text-sm text-center">{cat.name}</span>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-lime-500 transition-colors mt-2" />
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. Últimas del blog ─────────────────────────────────────────── */}
      {publishedPosts.length > 0 && (
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4">
            <Reveal>
              <div className="text-center mb-12">
                <span className="text-lime-800 font-display font-bold text-sm uppercase tracking-[0.2em]">Historias del deporte</span>
                <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mt-2">Últimas del blog</h2>
                <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
              </div>
            </Reveal>
            <StaggerGrid className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {publishedPosts.map(post => (
                <StaggerItem key={post.slug}>
                  <Link
                    to={`/blog/${post.slug}`}
                    className="hover-scale block bg-white rounded-2xl overflow-hidden shadow-md border border-gray-100 hover:border-lime-400 transition-all h-full"
                  >
                    <div className="img-zoom h-48">
                      {post.coverUrl ? (
                        <img
                          src={post.coverUrl}
                          alt={post.title}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                          onError={handleImgError}
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-navy-700 to-navy-900 flex items-center justify-center">
                          <Newspaper size={36} className="text-lime-400" />
                        </div>
                      )}
                    </div>
                    <div className="p-6">
                      <p className="flex items-center gap-2 text-gray-400 text-xs font-body uppercase tracking-wide mb-3">
                        <Calendar size={14} /> {formatPostDate(post)}
                      </p>
                      <h3 className="font-display font-bold text-navy-700 text-lg leading-snug mb-2">{post.title}</h3>
                      <p className="text-gray-500 text-sm leading-relaxed line-clamp-3">{post.excerpt}</p>
                      <span className="inline-flex items-center gap-1 text-lime-800 font-display font-bold text-sm mt-4">
                        Leer más <ChevronRight size={16} />
                      </span>
                    </div>
                  </Link>
                </StaggerItem>
              ))}
            </StaggerGrid>
            <Reveal>
              <div className="text-center mt-10">
                <Link
                  to="/blog"
                  className="inline-flex items-center gap-2 border-2 border-navy-700 text-navy-700 hover:bg-navy-700 hover:text-white font-display font-bold py-3 px-8 rounded-lg transition-colors"
                >
                  Ver el blog <ArrowRight size={18} />
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {/* ── 6. Camino al Mundial ────────────────────────────────────────── */}
      {/* Oculta por pedido de Brian (2026-08-05, "quitalo por ahora"). Para revivirla:
          MOSTRAR_CAMINO_MUNDIAL = true y devolver 'Clasificación' al array del nav. */}
      {MOSTRAR_CAMINO_MUNDIAL && (
      <section className="relative py-20 bg-navy-700 overflow-hidden">
        <div
          className="absolute inset-0 opacity-5"
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '32px 32px' }}
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-lime-400 font-display font-bold text-sm uppercase tracking-[0.2em]">Clasificación</span>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-white mt-2">Camino al Mundial</h2>
              <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
            </div>
          </Reveal>
          {topStandings.length > 0 ? (
            <>
              <StaggerGrid className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                {topStandings.map(entry => (
                  <StaggerItem key={`${entry.category}-${entry.position}-${entry.playerName}`}>
                    <div
                      className={`rounded-2xl p-8 text-center h-full ${
                        entry.position === 1
                          ? 'bg-lime-400 text-navy-700'
                          : 'bg-navy-800/60 border border-navy-600 text-white'
                      }`}
                    >
                      <div
                        className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center font-display font-black text-2xl mb-4 ${
                          entry.position === 1 ? 'bg-navy-700 text-lime-400' : 'bg-lime-400 text-navy-700'
                        }`}
                      >
                        {entry.position}
                      </div>
                      <h3 className="font-display font-bold text-lg">{entry.playerName}</h3>
                      <p className={`text-sm mt-1 ${entry.position === 1 ? 'text-navy-600' : 'text-gray-400'}`}>
                        {entry.category}
                      </p>
                      <p className={`font-display font-black text-3xl mt-4 ${entry.position === 1 ? 'text-navy-700' : 'text-lime-400'}`}>
                        {entry.points}
                        <span className="text-sm font-bold ml-1">pts</span>
                      </p>
                    </div>
                  </StaggerItem>
                ))}
              </StaggerGrid>
              <Reveal>
                <div className="text-center mt-10">
                  <Link
                    to="/clasificacion"
                    className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors"
                  >
                    Ver la tabla completa <ArrowRight size={18} />
                  </Link>
                </div>
              </Reveal>
            </>
          ) : (
            <Reveal>
              <div className="max-w-3xl mx-auto bg-navy-800/60 border border-navy-600 rounded-2xl p-10 text-center">
                <div className="w-16 h-16 mx-auto bg-lime-400 rounded-2xl flex items-center justify-center text-navy-700 mb-6">
                  <Trophy size={30} />
                </div>
                <h3 className="font-display font-bold text-white text-2xl mb-3">La carrera está por empezar</h3>
                <p className="text-gray-400 leading-relaxed mb-8 max-w-xl mx-auto">
                  Seguimos punto a punto a los jugadores uruguayos que sueñan con representarnos en el Mundial de pickleball. Muy pronto vas a poder ver la tabla acá.
                </p>
                <Link
                  to="/clasificacion"
                  className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors"
                >
                  Conocé la clasificación <ArrowRight size={18} />
                </Link>
              </div>
            </Reveal>
          )}
        </div>
      </section>
      )}

      {/* "VOLEA en acción" quitada 2026-08-06 a pedido de Brian: las 5 fotos eran de la misma sesión (lifestyle-sunset) y se veían repetidas. */}

      {/* ── 8. Nuestra esencia + Equipo ─────────────────────────────────── */}
      {/* Sin backgroundAttachment: 'fixed': iOS lo ignora y en desktop fuerza repaints en cada scroll. */}
      <section
        className="relative py-24 overflow-hidden"
        style={{
          backgroundImage: 'url(/products/lifestyle-sunset-2.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-navy-900/95 via-navy-700/90 to-navy-700/80" />
        <div className="relative z-10 max-w-7xl mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <Reveal>
              <div>
                <span className="text-lime-400 font-display font-bold text-sm uppercase tracking-[0.2em]">Nuestra esencia</span>
                <h2 className="font-display text-3xl md:text-4xl font-bold text-white mt-2 mb-6">
                  Hecha para el <span className="text-gradient">pickleball</span>, hecha en Uruguay
                </h2>
                <p className="text-gray-300 mb-10 leading-relaxed text-lg">
                  VOLEA nació en la cancha, entre partidos y mates. Somos la primera marca de indumentaria de pickleball de Uruguay, y cada prenda está pensada para lo que el juego exige: comodidad, rendimiento y un estilo que te acompaña también fuera de la cancha.
                </p>
                <div className="space-y-5">
                  {[
                    { icon: <Shield size={20} />, title: 'Calidad Premium', desc: 'Materiales de alto rendimiento con tecnología Dry-Fit' },
                    { icon: <Zap size={20} />, title: 'Máximo Rendimiento', desc: 'Diseñado para la comodidad y libertad de movimiento' },
                    { icon: <Users size={20} />, title: 'Comunidad', desc: 'Parte del crecimiento del pickleball en Uruguay' },
                  ].map((v, i) => (
                    <Reveal key={i} delay={i * 150}>
                      <div className="flex items-start gap-4 bg-white/10 backdrop-blur-sm rounded-xl p-4">
                        <div className="w-10 h-10 bg-lime-400 rounded-lg flex items-center justify-center text-navy-700 flex-shrink-0">
                          {v.icon}
                        </div>
                        <div>
                          <h3 className="font-display font-semibold text-white">{v.title}</h3>
                          <p className="text-gray-400 text-sm">{v.desc}</p>
                        </div>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="relative flex justify-center">
                <img
                  src="/products/7.jpg"
                  alt="Indumentaria VOLEA"
                  className="w-full max-w-md rounded-2xl shadow-2xl"
                  onError={handleImgError}
                />
                <div className="absolute -bottom-4 -right-4 bg-lime-400 text-navy-700 font-display font-bold py-3 px-6 rounded-xl shadow-lg text-sm">
                  100% Uruguayo
                </div>
              </div>
            </Reveal>
          </div>

          {/* Equipo */}
          <Reveal>
            <div className="text-center mt-24 mb-12">
              <span className="text-lime-400 font-display font-bold text-sm uppercase tracking-[0.2em]">Las caras de la marca</span>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-white mt-2">El equipo VOLEA</h2>
              <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
            </div>
          </Reveal>
          <StaggerGrid className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 max-w-4xl mx-auto">
            {[
              { src: '/products/team-brian.jpg', name: 'Brian Ridvanovich', role: 'Fundador VOLEA' },
              { src: '/products/lifestyle-sunset-front.jpg', name: 'Gastón Moirano', role: 'Fundador VOLEA' },
              { src: '/products/team-paula.jpg', name: 'Paula Segura', role: 'Fundadora VOLEA' },
            ].map((member, i) => (
              <StaggerItem key={i}>
                <div className="group relative rounded-2xl overflow-hidden aspect-[3/4] bg-navy-800">
                  <img
                    src={member.src}
                    alt={member.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    onError={handleImgError}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-navy-900/90 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <div className="w-8 h-1 bg-lime-400 mb-2" />
                    <h3 className="font-display font-bold text-white text-base md:text-lg">{member.name}</h3>
                    <p className="text-gray-300 text-sm">{member.role}</p>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </StaggerGrid>
        </div>
      </section>

      {/* ── 9. Ticker de anuncios ───────────────────────────────────────── */}
      {activeAnnouncements.length > 0 && (
        <section className="py-4 bg-navy-800 overflow-hidden border-t border-navy-600">
          <div className="relative">
            <div className="marquee flex whitespace-nowrap">
              {[...activeAnnouncements, ...activeAnnouncements].map((ann, idx) => (
                <div key={`${ann.title}-${idx}`} className="inline-flex items-center gap-3 mx-8 flex-shrink-0">
                  <span className={`${announcementColors[ann.type] || announcementColors.info} text-white text-xs font-bold px-2 py-1 rounded-full`}>
                    {announcementTypeLabels[ann.type] || 'Información'}
                  </span>
                  <span className="font-display font-bold text-white text-sm">{ann.title}</span>
                  <span className="text-gray-400 text-sm hidden md:inline">—</span>
                  <span className="text-gray-300 text-sm hidden md:inline max-w-xs truncate">{ann.content}</span>
                  <span className="text-lime-400 text-lg">•</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── 8. ShopPage ─────────────────────────────────────────────────────────────

function ShopPage() {
  const { products, categories, searchQuery, setSearchQuery, selectedCategory, setSelectedCategory, datosListos } = useStore();
  const [searchParams] = useSearchParams();
  const [sort, setSort] = useState('recent');
  usePageMeta({
    title: 'Tienda — Indumentaria de pickleball | VOLEA',
    description: 'Comprá la nueva colección VOLEA: remeras técnicas, polos, vestidos court, shorts y accesorios. Envíos a todo Uruguay.',
  });

  useEffect(() => {
    const cat = searchParams.get('category');
    if (cat) setSelectedCategory(cat);
  }, [searchParams, setSelectedCategory]);

  let filtered = products.filter(p => {
    if (p.active === false) return false; // ocultos: solo visibles en el admin
    const matchesSearch = !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (sort === 'price-asc') filtered.sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') filtered.sort((a, b) => b.price - a.price);
  else filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-12">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mb-2">Nuestra colección</h1>
      <div className="w-16 h-1 bg-lime-400 mb-8" />
      <PromoBanner compacto />

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Buscar productos..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors font-body"
          />
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 outline-none font-body bg-white"
        >
          <option value="recent">Más recientes</option>
          <option value="price-asc">Menor precio</option>
          <option value="price-desc">Mayor precio</option>
        </select>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 mb-8">
        <button
          onClick={() => setSelectedCategory('')}
          className={`px-4 py-2 rounded-full font-display text-sm font-semibold transition-colors ${
            !selectedCategory ? 'bg-navy-700 text-lime-400' : 'bg-gray-100 text-navy-700 hover:bg-gray-200'
          }`}
        >
          Todas
        </button>
        {categories.sort((a, b) => a.sortOrder - b.sortOrder).map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(selectedCategory === cat.id ? '' : cat.id)}
            className={`px-4 py-2 rounded-full font-display text-sm font-semibold transition-colors ${
              selectedCategory === cat.id ? 'bg-navy-700 text-lime-400' : 'bg-gray-100 text-navy-700 hover:bg-gray-200'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          {!datosListos && products.length === 0 ? (
            // Los datos siguen viajando (red lenta): decir "no hay" acá sería mentira.
            <>
              <Package size={64} strokeWidth={1} className="mx-auto mb-4 animate-pulse" />
              <p className="font-display text-lg">Cargando la colección…</p>
            </>
          ) : (
            <>
              <Package size={64} strokeWidth={1} className="mx-auto mb-4" />
              <p className="font-display text-lg">No encontramos productos con esa búsqueda. Probá otra categoría.</p>
            </>
          )}
        </div>
      ) : (
        <StaggerGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((p) => (
            <StaggerItem key={p.id}>
              <ProductCard product={p} />
            </StaggerItem>
          ))}
        </StaggerGrid>
      )}
    </div>
  );
}

// ─── 9. ProductDetailPage ────────────────────────────────────────────────────

function ProductDetailPage() {
  const { id } = useParams();
  const { products, categories, addToCart, setCartOpen, datosListos } = useStore();
  const { activa: promoActiva } = usePromo();
  const navigate = useNavigate();
  const product = products.find(p => p.id === id);
  usePageMeta({
    title: product ? `${product.name} — ${formatPrice(product.price)}` : 'Producto',
    description: product ? product.description.slice(0, 160) : 'Producto VOLEA',
    image: product?.images[0],
  });
  const [mainImg, setMainImg] = useState(0);
  const [selectedSize, setSelectedSize] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (product) {
      // Preseleccionar una combinación QUE SE PUEDA COMPRAR. Antes se tomaba siempre
      // colors[0]/sizes[0]: si ese color estaba agotado en todos los talles, el producto
      // abría en un callejón sin salida — los botones de talle se veían disponibles y
      // recién al tocarlos decía "Sin stock". Si ningún color tiene stock, se cae al
      // comportamiento viejo (el primero) y la ficha muestra "Agotado", que es honesto.
      const stockDe = (talle: string, color: string) =>
        product.stockBySize[color ? `${talle}|${color}` : talle] || 0;
      const colorComprable = product.colors.find((c) => product.sizes.some((s) => stockDe(s, c.name) > 0));
      const color = colorComprable?.name ?? product.colors[0]?.name ?? '';
      const talleComprable = product.sizes.find((s) => stockDe(s, color) > 0);
      if (product.colors.length > 0) setSelectedColor(color);
      if (product.sizes.length > 0) setSelectedSize(talleComprable ?? product.sizes[0]);
      setMainImg(0);
      setQty(1);
      setAdded(false);
    }
  }, [product]);

  // Link compartido (Instagram) + red lenta: los productos todavía no llegaron, así que
  // buscarlo da undefined. Decir "no existe" ahí es mentira y espanta justo a quien vino
  // por el link. Recién cuando la carga terminó se puede afirmar que no está.
  if (!product && !datosListos) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <Package size={64} strokeWidth={1} className="mx-auto text-gray-300 mb-4 animate-pulse" />
        <h1 className="font-display text-2xl font-bold text-navy-700">Cargando el producto…</h1>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <AlertCircle size={64} className="mx-auto text-gray-300 mb-4" />
        <h1 className="font-display text-2xl font-bold text-navy-700 mb-4">Producto no encontrado</h1>
        <Link to="/tienda" className="text-lime-800 hover:text-lime-700 font-semibold">Volver a la tienda</Link>
      </div>
    );
  }

  const getStock = (size: string, color?: string): number => {
    if (color) return product.stockBySize[`${size}|${color}`] || 0;
    if (product.colors.length === 0) return product.stockBySize[size] || 0;
    return product.colors.reduce((sum, c) => sum + (product.stockBySize[`${size}|${c.name}`] || 0), 0);
  };

  const currentStock = selectedSize ? getStock(selectedSize, selectedColor || undefined) : 0;

  const images = product.images.length > 0 ? product.images : [FALLBACK_IMG];
  const related = products.filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);

  const handleAdd = () => {
    const stockKey = selectedColor ? `${selectedSize}|${selectedColor}` : selectedSize;
    const availableStock = product.stockBySize[stockKey] || 0;
    if (qty > availableStock) {
      alert(`Solo hay ${availableStock} unidades disponibles en talle ${selectedSize}${selectedColor ? ` color ${selectedColor}` : ''}`);
      return;
    }
    addToCart({ product, quantity: qty, selectedSize, selectedColor });
    setAdded(true);
    setTimeout(() => {
      setAdded(false);
      setCartOpen(true);
    }, 800);
  };

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-8">
        <Link to="/" className="hover:text-navy-700 transition-colors">Inicio</Link>
        <ChevronRight size={14} />
        <Link to="/tienda" className="hover:text-navy-700 transition-colors">Tienda</Link>
        <ChevronRight size={14} />
        <span className="text-navy-700 font-semibold truncate">{product.name}</span>
      </nav>

      <div className="grid md:grid-cols-2 gap-12">
        {/* Images */}
        <div>
          <div className="aspect-square rounded-2xl overflow-hidden bg-gray-100 mb-4 relative group">
            <img
              src={images[mainImg]}
              alt={product.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              onError={handleImgError}
            />
            {images.length > 1 && (
              <>
                <button
                  onClick={() => setMainImg(mainImg > 0 ? mainImg - 1 : images.length - 1)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ChevronLeft size={20} className="text-navy-700" />
                </button>
                <button
                  onClick={() => setMainImg(mainImg < images.length - 1 ? mainImg + 1 : 0)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ChevronRight size={20} className="text-navy-700" />
                </button>
              </>
            )}
            {/* Image counter */}
            {images.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-navy-700/70 text-white text-xs font-display font-bold px-3 py-1 rounded-full">
                {mainImg + 1} / {images.length}
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setMainImg(i)}
                  className={`w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 border-2 transition-all ${
                    mainImg === i ? 'border-lime-400 ring-2 ring-lime-400/30 scale-105' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <img src={img} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" onError={handleImgError} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-block bg-navy-700/10 text-navy-700 text-xs font-bold px-3 py-1 rounded-full">{categoryLabel(categories, product.category)}</span>
            <span className="text-xs text-gray-400 font-mono">SKU: {product.sku}</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-navy-700 mb-3">{product.name}</h1>
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            {/* Con promo vigente manda la promo: precio descontado + lista tachado.
                (La oferta propia del producto no se apila, para no mostrar 3 números.) */}
            {promoActiva ? (
              <>
                <span className="font-display text-3xl font-bold text-navy-700">{formatPrice(precioConPromo(product.price, promoActiva.percent))}</span>
                <span className="text-lg text-gray-400 line-through">{formatPrice(product.price)}</span>
                <span className="bg-navy-900 text-lime-400 text-xs font-black px-2 py-1 rounded-full">
                  −{promoActiva.percent}% hasta {ventanaPromo({ ...promoActiva, startsOn: promoActiva.endsOn })}
                </span>
              </>
            ) : (
              <>
                <span className="font-display text-3xl font-bold text-navy-700">{formatPrice(product.price)}</span>
                {product.isOffer && product.originalPrice && (
                  <>
                    <span className="text-lg text-gray-400 line-through">{formatPrice(product.originalPrice)}</span>
                    <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                      -{Math.round((1 - product.price / product.originalPrice) * 100)}%
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          <p className="text-gray-600 mb-8 leading-relaxed">{product.description}</p>

          {/* Sizes */}
          {product.sizes.length > 0 && (
            <div className="mb-6">
              <label className="block font-display font-semibold text-navy-700 mb-2">
                Talle
                {selectedSize && (
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({currentStock} disponibles{selectedColor ? ` en ${selectedColor}` : ''})
                  </span>
                )}
              </label>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map(size => {
                  const sizeStock = getStock(size);
                  return (
                    <button
                      key={size}
                      onClick={() => setSelectedSize(size)}
                      className={`px-4 py-2 rounded-lg font-display text-sm font-semibold border-2 transition-colors relative ${
                        sizeStock === 0
                          ? 'border-gray-200 text-gray-300 line-through cursor-not-allowed'
                          : selectedSize === size
                            ? 'border-lime-400 bg-lime-400 text-navy-700'
                            : 'border-gray-200 text-navy-700 hover:border-navy-700'
                      }`}
                      disabled={sizeStock === 0}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Colors */}
          {product.colors.length > 0 && (
            <div className="mb-6">
              <label className="block font-display font-semibold text-navy-700 mb-2">Color: {selectedColor}</label>
              <div className="flex gap-3">
                {product.colors.map(color => (
                  <button
                    key={color.name}
                    onClick={() => setSelectedColor(color.name)}
                    title={color.name}
                    className={`w-10 h-10 rounded-full border-2 transition-all ${
                      selectedColor === color.name ? 'border-lime-400 scale-110' : 'border-gray-300 hover:scale-105'
                    }`}
                    style={{ backgroundColor: color.hex }}
                  >
                    {selectedColor === color.name && (
                      <Check size={16} className={`mx-auto ${color.hex === '#FFFFFF' || color.hex === '#ffffff' ? 'text-navy-700' : 'text-white'}`} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div className="mb-6">
            <label className="block font-display font-semibold text-navy-700 mb-2">Cantidad</label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQty(Math.max(1, qty - 1))}
                disabled={qty <= 1}
                className={`w-10 h-10 rounded-lg border border-gray-200 flex items-center justify-center transition-colors ${qty <= 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
              >
                <Minus size={18} />
              </button>
              <span className="font-display font-bold text-lg w-10 text-center">{qty}</span>
              <button
                onClick={() => setQty(Math.min(qty + 1, currentStock))}
                disabled={qty >= currentStock}
                className={`w-10 h-10 rounded-lg border border-gray-200 flex items-center justify-center transition-colors ${qty >= currentStock ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
              >
                <Plus size={18} />
              </button>
            </div>
          </div>

          {/* Stock */}
          <div className="mb-6">
            {selectedSize && currentStock > 0 ? (
              <span className="flex items-center gap-2 text-green-600 text-sm font-semibold">
                <Check size={16} /> En stock ({currentStock} disponibles en talle {selectedSize}{selectedColor ? ` / ${selectedColor}` : ''})
              </span>
            ) : getTotalStock(product) === 0 ? (
              <span className="flex items-center gap-2 text-red-500 text-sm font-semibold">
                <XCircle size={16} /> Sin stock
              </span>
            ) : (
              <span className="flex items-center gap-2 text-red-500 text-sm font-semibold">
                <XCircle size={16} /> Sin stock en talle {selectedSize}{selectedColor ? ` / ${selectedColor}` : ''}
              </span>
            )}
          </div>

          {/* Add to Cart */}
          <button
            onClick={handleAdd}
            disabled={!selectedSize || currentStock === 0}
            className={`w-full font-display font-bold py-4 rounded-lg text-lg transition-all flex items-center justify-center gap-2 ${
              added
                ? 'bg-green-500 text-white'
                : !selectedSize || currentStock === 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-lime-400 hover:bg-lime-500 text-navy-700'
            }`}
          >
            {added ? <><Check size={20} /> Agregado</> : <><ShoppingCart size={20} /> Agregar al carrito</>}
          </button>
        </div>
      </div>

      {/* Related */}
      {related.length > 0 && (
        <section className="mt-20">
          <h2 className="font-display text-2xl font-bold text-navy-700 mb-6">También te puede interesar</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {related.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── 10. EventsPage ──────────────────────────────────────────────────────────

function EventsPage() {
  const { events, datosListos } = useStore();
  const [filter, setFilter] = useState<string>('all');
  usePageMeta({
    title: 'Eventos y torneos de pickleball',
    description: 'Torneos, clínicas y encuentros de pickleball en Uruguay. Mirá el calendario y sumate al próximo evento VOLEA.',
  });

  // Un evento es pasado recién cuando terminó su ÚLTIMO día, comparando por día en
  // Uruguay. Antes usaba new Date(event.date) < new Date(): "2026-08-22" se parsea
  // como medianoche UTC (21:00 del 21 acá), así que un torneo de varios días
  // aparecía en gris como "Finalizado" desde la noche anterior y durante todo el
  // campeonato — justo cuando más se lo busca.
  const isEventPast = (event: Event) => {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: TZ_UY });
    return (event.endDate || event.date) < hoy;
  };

  const filtered = filter === 'all' ? events : events.filter(e => e.category === filter);
  const upcoming = filtered.filter(e => !isEventPast(e)).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const past = filtered.filter(e => isEventPast(e)).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const categoryLabel = (cat: string) => {
    if (cat === 'tournament') return 'Torneo';
    if (cat === 'clinic') return 'Clínica';
    return 'Social';
  };

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-12">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mb-2">Eventos y torneos</h1>
      <div className="w-16 h-1 bg-lime-400 mb-8" />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-10">
        {[
          { key: 'all', label: 'Todos' },
          { key: 'tournament', label: 'Torneos' },
          { key: 'clinic', label: 'Clínicas' },
          { key: 'social', label: 'Social' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-full font-display text-sm font-semibold transition-colors ${
              filter === f.key ? 'bg-navy-700 text-lime-400' : 'bg-gray-100 text-navy-700 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="mb-12">
          <h2 className="font-display text-2xl font-bold text-navy-700 mb-6 flex items-center gap-2">
            <CalendarDays size={24} /> Próximos Eventos
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {upcoming.map(evt => (
              <div key={evt.id} className="hover-scale bg-white rounded-xl overflow-hidden shadow-md border border-gray-100">
                <div className="relative">
                  <img
                    src={evt.imageUrl || FALLBACK_IMG}
                    alt={evt.name}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-48 object-cover"
                    onError={handleImgError}
                  />
                  <div className="absolute top-3 left-3 flex gap-2">
                    <span className="bg-lime-400 text-navy-700 text-xs font-bold px-2 py-1 rounded-full uppercase shadow">
                      {categoryLabel(evt.category)}
                    </span>
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full">Próximo</span>
                  </div>
                  <h3 className="font-display text-lg font-bold text-navy-700 mb-2">{evt.name}</h3>
                  <div className="space-y-1 text-sm text-gray-500 mb-3">
                    {/* Rango completo en eventos de varios días, y sin "- hs" colgado
                        cuando no hay hora cargada (un torneo de 3 días no tiene una). */}
                    <p className="flex items-center gap-2"><Calendar size={14} /> {rangoLargo(evt.date, evt.endDate)}{evt.time ? ` - ${evt.time}hs` : ''}</p>
                    <p className="flex items-center gap-2"><MapPin size={14} /> {evt.location}, {evt.city}</p>
                    {evt.maxParticipants && (
                      <p className="flex items-center gap-2"><Users size={14} /> Máx. {evt.maxParticipants} participantes</p>
                    )}
                  </div>
                  {/* line-clamp-2 cortaba la descripción en la segunda línea y se
                      comía el precio, las categorías y el teléfono — justo lo que
                      alguien viene a buscar acá. */}
                  <p className="text-gray-500 text-sm whitespace-pre-line">{evt.description}</p>
                  {waUruguay(evt.phone) && (
                    <>
                      {/* Con el form online abierto, ese es el camino principal y
                          WhatsApp queda como alternativa. */}
                      {evt.inscripcionesAbiertas && (
                        <Link
                          to={`/inscripcion/${evt.id}`}
                          className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-lime-400 px-4 py-2.5 font-display text-sm font-bold text-navy-700 transition-colors hover:bg-lime-500"
                        >
                          <Check size={16} /> Inscribirme online
                        </Link>
                      )}
                      <a
                        href={`https://wa.me/${waUruguay(evt.phone)}?text=${encodeURIComponent(`Hola! Quiero inscribirme al ${evt.name}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-display text-sm font-bold transition-colors ${
                          evt.inscripcionesAbiertas
                            ? 'mt-2 border border-gray-200 text-navy-700 hover:bg-gray-50'
                            : 'mt-4 bg-lime-400 text-navy-700 hover:bg-lime-500'
                        }`}
                      >
                        <MessageCircle size={16} /> {evt.inscripcionesAbiertas ? 'O por WhatsApp' : 'Inscribirme por WhatsApp'}
                      </a>
                    </>
                  )}
                  {evt.phone && (
                    <p className="mt-2 text-center text-sm text-gray-500">
                      Consultas al <a href={`tel:${evt.phone.replace(/\s/g, '')}`} className="font-semibold text-navy-700 hover:text-lime-700">{evt.phone}</a>
                    </p>
                  )}
                  {evt.mapsUrl && (
                    <a
                      href={evt.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-lime-800 font-semibold text-sm mt-3 hover:text-lime-700"
                    >
                      Ver en mapa <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Past */}
      {past.length > 0 && (
        <div>
          <h2 className="font-display text-2xl font-bold text-gray-400 mb-6 flex items-center gap-2">
            <CalendarDays size={24} /> Eventos Pasados
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-70">
            {past.map(evt => (
              <div key={evt.id} className="bg-white rounded-xl overflow-hidden shadow-md border border-gray-100">
                <img
                  src={evt.imageUrl || FALLBACK_IMG}
                  alt={evt.name}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-48 object-cover grayscale"
                  onError={handleImgError}
                />
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="bg-gray-200 text-gray-600 text-xs font-bold px-2 py-1 rounded-full uppercase">
                      {categoryLabel(evt.category)}
                    </span>
                    <span className="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-1 rounded-full">Finalizado</span>
                  </div>
                  <h3 className="font-display text-lg font-bold text-navy-700 mb-2">{evt.name}</h3>
                  <div className="space-y-1 text-sm text-gray-500">
                    {/* fechaEventoLarga y no new Date(iso): "2026-05-10" se parsea como
                        medianoche UTC y en Uruguay se mostraba el día ANTERIOR. */}
                    <p className="flex items-center gap-2"><Calendar size={14} /> {fechaEventoLarga(evt.date)}</p>
                    <p className="flex items-center gap-2"><MapPin size={14} /> {evt.location}, {evt.city}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && !datosListos && events.length === 0 && (
        <SeccionCargando texto="Cargando los eventos…" />
      )}

      {filtered.length === 0 && (datosListos || events.length > 0) && (
        <div className="text-center py-20 text-gray-400">
          <CalendarDays size={64} strokeWidth={1} className="mx-auto mb-4" />
          <p className="font-display text-lg">Por ahora no hay eventos agendados</p>
        </div>
      )}
    </div>
  );
}

// ─── 10b. MapPage (Clubes y Canchas) ─────────────────────────────────────────

declare const L: any;

function MapPage() {
  const { clubs, datosListos } = useStore();
  usePageMeta({
    title: 'Clubes y canchas de pickleball',
    description: 'Encontrá dónde jugar pickleball en Uruguay, Argentina, Chile y Brasil. Mapa de clubes y canchas actualizado.',
  });
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [countryFilter, setCountryFilter] = useState<string>('all');

  const filteredClubs = countryFilter === 'all'
    ? clubs
    : clubs.filter(c => c.country === countryFilter);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Initialize Leaflet map
    try {
      const map = L.map(mapRef.current).setView([-30, -55], 4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      mapInstanceRef.current = map;
    } catch (e) {
      console.error('Leaflet not loaded:', e);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update markers when clubs or filter change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove existing markers
    map.eachLayer((layer: any) => {
      if (layer instanceof L.Marker) {
        map.removeLayer(layer);
      }
    });

    // Add markers for filtered clubs
    filteredClubs.forEach(club => {
      const marker = L.marker([club.lat, club.lng]).addTo(map);
      marker.bindPopup(`
        <div style="font-family: 'Montserrat', sans-serif; min-width: 200px;">
          <h3 style="font-weight: 700; color: #001F3F; margin: 0 0 4px 0; font-size: 14px;">${club.name}</h3>
          <p style="color: #666; font-size: 12px; margin: 0 0 2px 0;">${club.address}</p>
          <p style="color: #666; font-size: 12px; margin: 0 0 4px 0;">${club.city}, ${club.country}</p>
          <p style="color: #888; font-size: 11px; margin: 0 0 8px 0;">${club.description}</p>
          <a href="https://www.google.com/maps?q=${club.lat},${club.lng}" target="_blank" rel="noopener noreferrer"
             style="color: #7aa300; font-size: 12px; font-weight: 600; text-decoration: none;">
            Ver en Google Maps &rarr;
          </a>
        </div>
      `);
    });
  }, [filteredClubs]);

  const countryFlag = (country: string) => {
    switch(country) {
      case 'Uruguay': return '🇺🇾';
      case 'Argentina': return '🇦🇷';
      case 'Chile': return '🇨🇱';
      case 'Brasil': return '🇧🇷';
      default: return '🌎';
    }
  };

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-12">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mb-2">Clubes y canchas</h1>
      <p className="text-gray-500 mb-2">Encontrá dónde jugar pickleball en Uruguay, Argentina, Chile y Brasil</p>
      <div className="w-16 h-1 bg-lime-400 mb-8" />

      {/* Country filter */}
      <div className="flex flex-wrap gap-2 mb-8">
        {[
          { key: 'all', label: 'Todos' },
          { key: 'Uruguay', label: '🇺🇾 Uruguay' },
          { key: 'Argentina', label: '🇦🇷 Argentina' },
          { key: 'Chile', label: '🇨🇱 Chile' },
          { key: 'Brasil', label: '🇧🇷 Brasil' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setCountryFilter(f.key)}
            className={`px-4 py-2 rounded-full font-display text-sm font-semibold transition-colors ${
              countryFilter === f.key ? 'bg-navy-700 text-lime-400' : 'bg-gray-100 text-navy-700 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Map */}
      <div className="rounded-2xl overflow-hidden shadow-lg border border-gray-200 mb-10">
        <div ref={mapRef} style={{ height: '400px', width: '100%' }} />
      </div>

      {/* Club Cards */}
      <h2 className="font-display text-2xl font-bold text-navy-700 mb-6">
        {filteredClubs.length} {filteredClubs.length === 1 ? 'club encontrado' : 'clubes encontrados'}
      </h2>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredClubs.map(club => (
          <div key={club.id} className="hover-scale bg-white rounded-xl shadow-md border border-gray-100 p-6">
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-display text-lg font-bold text-navy-700">{club.name}</h3>
              <span className="text-2xl flex-shrink-0 ml-2">{countryFlag(club.country)}</span>
            </div>
            <div className="space-y-2 text-sm text-gray-500 mb-4">
              <p className="flex items-center gap-2"><MapPin size={14} className="flex-shrink-0" /> {club.address}</p>
              <p className="flex items-center gap-2"><Globe size={14} className="flex-shrink-0" /> {club.city}, {club.country}</p>
              {club.phone && (
                <p className="flex items-center gap-2"><Phone size={14} className="flex-shrink-0" /> {club.phone}</p>
              )}
              {club.instagram && (
                // El dato puede venir con o sin "@" (los clubes de constants.ts lo traen;
                // los que se carguen a mano quizá no). Se saca el que venga y lo pone la
                // vista: si no, quedaba "@@pickleballcity.uy" en casi todas las tarjetas.
                <p className="flex items-center gap-2"><Instagram size={14} className="flex-shrink-0" /> @{club.instagram.replace(/^@+/, '')}</p>
              )}
            </div>
            <p className="text-gray-500 text-sm line-clamp-3 mb-4">{club.description}</p>
            <div className="flex items-center gap-3">
              {club.hasPickleball && (
                <span className="bg-lime-100 text-lime-700 text-xs font-bold px-2 py-1 rounded-full">Pickleball</span>
              )}
              <a
                href={`https://www.google.com/maps?q=${club.lat},${club.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-lime-800 font-semibold text-sm hover:text-lime-700 ml-auto"
              >
                Google Maps <ExternalLink size={14} />
              </a>
            </div>
          </div>
        ))}
      </div>

      {filteredClubs.length === 0 && !datosListos && clubs.length === 0 && (
        <SeccionCargando texto="Cargando los clubes…" />
      )}

      {filteredClubs.length === 0 && (datosListos || clubs.length > 0) && (
        <div className="text-center py-20 text-gray-400">
          <MapPin size={64} strokeWidth={1} className="mx-auto mb-4" />
          <p className="font-display text-lg">No se encontraron clubes</p>
        </div>
      )}
    </div>
  );
}

// ─── 11. ContactPage ─────────────────────────────────────────────────────────

function ContactPage() {
  usePageMeta({
    title: 'Contacto',
    description: 'Escribinos por WhatsApp, Instagram o email. VOLEA, indumentaria de pickleball desde Montevideo, Uruguay.',
  });
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = `Hola! Soy ${form.name}.\n\n${form.message}\n\nEmail: ${form.email}\nTel: ${form.phone}`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
    setSent(true);
    setTimeout(() => setSent(false), 3000);
    setForm({ name: '', email: '', phone: '', message: '' });
  };

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-12">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mb-2">Contacto</h1>
      <div className="w-16 h-1 bg-lime-400 mb-8" />

      <div className="grid md:grid-cols-2 gap-12">
        {/* Contact Info */}
        <div className="space-y-6">
          <p className="text-gray-600 text-lg mb-8">
            ¿Tenés alguna consulta? Escribinos por el medio que te quede más cómodo.
          </p>
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 bg-green-50 border border-green-200 rounded-xl p-5 hover:shadow-md transition-shadow group"
          >
            <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white">
              <MessageCircle size={24} />
            </div>
            <div>
              <h3 className="font-display font-semibold text-navy-700">WhatsApp</h3>
              <p className="text-gray-500 text-sm group-hover:text-green-600 transition-colors">+598 99 511 196</p>
            </div>
          </a>
          <a
            href={`https://instagram.com/${INSTAGRAM_HANDLE}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 bg-purple-50 border border-purple-200 rounded-xl p-5 hover:shadow-md transition-shadow group"
          >
            <div className="w-12 h-12 bg-gradient-to-tr from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white">
              <Instagram size={24} />
            </div>
            <div>
              <h3 className="font-display font-semibold text-navy-700">Instagram</h3>
              <p className="text-gray-500 text-sm group-hover:text-purple-600 transition-colors">@{INSTAGRAM_HANDLE}</p>
            </div>
          </a>
          <div className="flex items-center gap-4 bg-blue-50 border border-blue-200 rounded-xl p-5">
            <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white">
              <Mail size={24} />
            </div>
            <div>
              <h3 className="font-display font-semibold text-navy-700">Email</h3>
              <p className="text-gray-500 text-sm">info@volea.uy</p>
            </div>
          </div>
          <div className="flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-xl p-5">
            <div className="w-12 h-12 bg-navy-700 rounded-full flex items-center justify-center text-lime-400">
              <MapPin size={24} />
            </div>
            <div>
              <h3 className="font-display font-semibold text-navy-700">Ubicación</h3>
              <p className="text-gray-500 text-sm">Montevideo, Uruguay</p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          <h2 className="font-display text-xl font-bold text-navy-700 mb-6">Enviar mensaje</h2>
          {sent && (
            <div className="bg-green-50 text-green-700 border border-green-200 rounded-lg p-3 mb-4 flex items-center gap-2">
              <Check size={18} /> Abrimos WhatsApp con tu mensaje listo para enviar
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Nombre</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Teléfono</label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Mensaje</label>
              <textarea
                required
                rows={4}
                value={form.message}
                onChange={e => setForm({ ...form, message: e.target.value })}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors resize-none"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <MessageCircle size={18} /> Enviar por WhatsApp
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── 11b. InscripcionPage ────────────────────────────────────────────────────

/**
 * Inscripción online a un evento. Público: escribe vía la RPC inscribir_evento
 * (los datos personales nunca son legibles por anon) y muestra el contador en
 * vivo de inscriptos. El DUPR ID se pide opcional: es el único dato que falta
 * para que los partidos del torneo suban a DUPR.
 */
function InscripcionPage() {
  const { eventId } = useParams();
  const { events, datosListos } = useStore();
  const evt = events.find(e => e.id === eventId);

  const [form, setForm] = useState({ nombre: '', celular: '', email: '', duprId: '', notas: '' });
  const [cats, setCats] = useState<string[]>([]);
  const [catLibre, setCatLibre] = useState('');
  // Pareja POR categoría de dobles: {"Doble Mixto A": "Nombre"}. Quien juega
  // mixto y su categoría de género carga un compañero para cada una.
  const [parejas, setParejas] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<null | { actualizada: boolean }>(null);
  const [inscriptos, setInscriptos] = useState<number | null>(null);
  // Nombres del padrón como sugerencias (datalist): induce la grafía canónica
  // sin bloquear texto libre. rk_jugadores es de lectura pública (los muestra el ranking).
  const [nombresPadron, setNombresPadron] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    SupabaseService.getJugadoresNombres().then(ns => { if (vivo) setNombresPadron(ns); });
    return () => { vivo = false; };
  }, []);

  usePageMeta({
    title: evt ? `Inscripción — ${evt.name} | VOLEA` : 'Inscripción | VOLEA',
    description: evt ? `Inscribite online al ${evt.name} en ${evt.location}.` : 'Inscripción a eventos VOLEA.',
  });

  // Contador en vivo: al entrar y después de inscribirse.
  useEffect(() => {
    if (!eventId) return;
    let vivo = true;
    SupabaseService.contarInscriptos(eventId).then(n => { if (vivo && n !== null) setInscriptos(n); });
    return () => { vivo = false; };
  }, [eventId, listo]);

  const opcionesCategorias = (evt?.categorias || '').split(',').map(c => c.trim()).filter(Boolean);
  const categoriasElegidas = opcionesCategorias.length > 0 ? cats.join(', ') : catLibre.trim();
  // Un campo de pareja por cada categoría de dobles elegida (dobles = contiene "doble").
  const catsDobles = (opcionesCategorias.length > 0 ? cats : [catLibre.trim()])
    .filter(c => c.toLowerCase().includes('doble'));
  const puedeEnviar = form.nombre.trim() !== '' && form.celular.trim() !== '' && categoriasElegidas !== '' && !enviando;

  const toggleCat = (c: string) => {
    // Al destildar una categoría se descarta su pareja (si vuelve, la escribe de nuevo).
    if (cats.includes(c)) setParejas(p => { const { [c]: _, ...resto } = p; return resto; });
    setCats(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]));
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!puedeEnviar || !evt) return;
    setEnviando(true);
    try {
      const r = await SupabaseService.inscribirEvento({
        eventId: evt.id,
        nombre: form.nombre.trim(),
        celular: form.celular.trim(),
        categorias: categoriasElegidas,
        email: form.email.trim(),
        parejas: Object.fromEntries(
          Object.entries(parejas)
            .filter(([c, v]) => catsDobles.includes(c) && v.trim() !== '')
            .map(([c, v]) => [c, v.trim()]),
        ),
        duprId: form.duprId.trim(),
        notas: form.notas.trim(),
      });
      if (!r.ok) {
        toast.error(r.error || 'No pudimos enviar tu inscripción. Probá de nuevo.');
        return;
      }
      setListo({ actualizada: r.actualizada === true });
    } catch (err) {
      console.error('Error inscribiendo:', err);
      toast.error('No pudimos enviar tu inscripción. Probá de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (!evt && !datosListos) {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <CalendarDays size={64} strokeWidth={1} className="mx-auto text-gray-300 mb-4 animate-pulse" />
        <h1 className="font-display text-2xl font-bold text-navy-700">Cargando el evento…</h1>
      </div>
    );
  }
  if (!evt) {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-navy-700 mb-4">No encontramos ese evento</h1>
        <Link to="/eventos" className="text-lime-800 hover:text-lime-700 font-semibold inline-flex items-center gap-1">
          Ver todos los eventos <ArrowRight size={16} />
        </Link>
      </div>
    );
  }
  if (!evt.inscripcionesAbiertas) {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-navy-700 mb-2">{evt.name}</h1>
        <p className="text-gray-500 mb-6">Las inscripciones online de este evento están cerradas.</p>
        {waUruguay(evt.phone) && (
          <a
            href={`https://wa.me/${waUruguay(evt.phone)}?text=${encodeURIComponent(`Hola! Consulta por el ${evt.name}`)}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-lime-400 px-6 py-3 font-display font-bold text-navy-700 hover:bg-lime-500 transition-colors"
          >
            <MessageCircle size={18} /> Consultar por WhatsApp
          </a>
        )}
      </div>
    );
  }

  if (listo) {
    const wa = waUruguay(evt.phone);
    return (
      <div className="fade-in max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Check size={40} className="text-green-500" />
        </div>
        <h1 className="font-display text-3xl font-bold text-navy-700 mb-3">
          {listo.actualizada ? '¡Inscripción actualizada!' : '¡Ya estás anotado!'}
        </h1>
        <p className="text-gray-500 mb-2">
          {listo.actualizada
            ? 'Ya tenías una inscripción con este celular: la actualizamos con estos datos.'
            : `Te esperamos en el ${evt.name}.`}
        </p>
        <p className="text-gray-500 mb-8">La organización te va a contactar para coordinar el pago.</p>
        {wa && (
          <a
            href={`https://wa.me/${wa}?text=${encodeURIComponent(`Hola! Me inscribí online al ${evt.name} (soy ${form.nombre.trim()}). Quiero coordinar el pago.`)}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-lime-400 px-8 py-3 font-display font-bold text-navy-700 hover:bg-lime-500 transition-colors"
          >
            <MessageCircle size={18} /> Coordinar el pago por WhatsApp
          </a>
        )}
        <div className="mt-8">
          <Link to="/eventos" className="text-sm text-gray-400 hover:text-navy-700 underline-offset-2 hover:underline">
            Volver a eventos
          </Link>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors';
  const labelCls = 'block text-sm font-semibold text-navy-700 mb-1';

  return (
    <div className="fade-in max-w-3xl mx-auto px-4 py-12">
      <Link to="/eventos" className="text-sm text-gray-400 hover:text-navy-700">← Eventos</Link>
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mt-2 mb-1">Inscripción — {evt.name}</h1>
      <p className="text-gray-500 mb-1">
        {rangoLargo(evt.date, evt.endDate)} · {evt.location}{evt.city ? `, ${evt.city}` : ''}
      </p>
      {inscriptos !== null && inscriptos > 0 && (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-lime-50 px-3 py-1 text-sm font-semibold text-lime-800">
          <Users size={14} /> Ya hay {inscriptos} {inscriptos === 1 ? 'inscripto' : 'inscriptos'}
        </p>
      )}
      <div className="w-16 h-1 bg-lime-400 mb-8 mt-2" />

      <form onSubmit={enviar} className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="insc-nombre" className={labelCls}>Nombre y apellido *</label>
            <input id="insc-nombre" type="text" required value={form.nombre} list="padron-nombres"
              onChange={e => setForm({ ...form, nombre: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="insc-celular" className={labelCls}>Celular (WhatsApp) *</label>
            <input id="insc-celular" type="tel" required placeholder="099 123 456" value={form.celular}
              onChange={e => setForm({ ...form, celular: e.target.value })} className={inputCls} />
          </div>
        </div>

        <div>
          <span className={labelCls}>Categorías *</span>
          {opcionesCategorias.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {opcionesCategorias.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCat(c)}
                    aria-pressed={cats.includes(c)}
                    className={`rounded-lg border px-2 py-2 font-display text-xs font-bold transition-colors ${
                      cats.includes(c)
                        ? 'border-navy-700 bg-navy-700 text-white'
                        : 'border-gray-200 text-navy-700 hover:border-navy-700'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-400">Tocá todas las categorías en las que jugás.</p>
            </>
          ) : (
            <input type="text" placeholder="Ej: Doble Masculino B" value={catLibre}
              onChange={e => setCatLibre(e.target.value)} className={inputCls} />
          )}
        </div>

        {catsDobles.length > 0 && (
          <div className="space-y-3">
            {catsDobles.map(c => (
              <div key={c}>
                <label htmlFor={`insc-pareja-${c}`} className={labelCls}>Tu pareja para {c}</label>
                <input id={`insc-pareja-${c}`} type="text" list="padron-nombres"
                  placeholder="Nombre de tu compañero/a (si ya lo tenés)"
                  value={parejas[c] ?? ''}
                  onChange={e => setParejas(p => ({ ...p, [c]: e.target.value }))}
                  className={inputCls} />
              </div>
            ))}
            <p className="text-xs text-gray-400">Dejá vacío el que todavía no tenés confirmado.</p>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="insc-email" className={labelCls}>Email</label>
            <input id="insc-email" type="email" value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="insc-dupr" className={labelCls}>Tu DUPR ID <span className="font-normal text-gray-400">(opcional)</span></label>
            <input id="insc-dupr" type="text" placeholder="Ej: 7XZ4V2" value={form.duprId}
              onChange={e => setForm({ ...form, duprId: e.target.value })} className={inputCls} />
            <p className="mt-1 text-xs text-gray-400">
              ¿No tenés? Creá tu cuenta gratis en{' '}
              <a href="https://mydupr.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-lime-800 hover:underline">mydupr.com</a>{' '}
              y tus partidos contarán para tu rating mundial.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="insc-notas" className={labelCls}>Notas</label>
          <textarea id="insc-notas" rows={3} placeholder="Lo que quieras aclarar: parejas por categoría, horarios, etc."
            value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })}
            className={`${inputCls} resize-none`} />
        </div>

        <button
          type="submit"
          disabled={!puedeEnviar}
          className="pulse-glow w-full rounded-lg bg-lime-400 py-4 font-display text-lg font-bold text-navy-700 transition-colors hover:bg-lime-500 disabled:bg-gray-200 disabled:text-gray-400"
        >
          {enviando ? 'Enviando…' : 'Enviar inscripción'}
        </button>
        <p className="text-center text-xs text-gray-400">
          El pago se coordina después con la organización{evt.phone ? ` (${evt.phone})` : ''}.
        </p>
        {nombresPadron.length > 0 && (
          <datalist id="padron-nombres">
            {[...new Set(nombresPadron)].map(n => <option key={n} value={n} />)}
          </datalist>
        )}
      </form>
    </div>
  );
}

// ─── 12. CheckoutPage ────────────────────────────────────────────────────────

function CheckoutPage() {
  const { cart, clearCart, addOrder, datosListos } = useStore();
  const { activa: promo } = usePromo();
  usePageMeta({
    title: 'Finalizar pedido',
    description: 'Completá tus datos y enviá tu pedido: te contactamos por WhatsApp para coordinar la entrega y el pago.',
  });
  const [customer, setCustomer] = useState<CustomerInfo>({
    name: '', phone: '', email: '', address: '', city: '', department: 'Montevideo', notes: ''
  });
  const [success, setSuccess] = useState(false);

  // El botón de MP aparece solo si el server dice que hay credenciales
  // cargadas. En dev local (Vite, sin /api) la respuesta es el index.html y
  // el json() falla → queda oculto.
  const [mpDisponible, setMpDisponible] = useState(false);
  const [pagandoMP, setPagandoMP] = useState(false);
  useEffect(() => {
    fetch('/api/mp/disponible')
      .then(r => r.json())
      .then(d => setMpDisponible(Boolean(d?.disponible)))
      .catch(() => setMpDisponible(false));
  }, []);
  // Si el cliente vuelve con "Atrás" desde la pantalla de MP, el navegador
  // restaura esta página desde la bfcache con el estado congelado: sin esto,
  // los botones quedaban deshabilitados para siempre.
  useEffect(() => {
    const h = (e: PageTransitionEvent) => { if (e.persisted) setPagandoMP(false); };
    window.addEventListener('pageshow', h);
    return () => window.removeEventListener('pageshow', h);
  }, []);
  const formRef = useRef<HTMLFormElement>(null);

  // Con promo vigente el total del pedido es el DESCONTADO — el mismo número que
  // muestra el carrito y que Mercado Pago recalcula del catálogo en el server.
  const { subtotal, descuento, total } = totalesConPromo(cart, promo);

  // El carrito se rehidrata al final de la carga inicial, y la web ahora se muestra a los
  // 4s aunque los datos no hayan llegado. Sin esta guarda, quien vuelve al checkout
  // después de coordinar por WhatsApp (el flujo normal de esta tienda) con la red mala se
  // encontraba con "Tu carrito está vacío" y un link para IRSE. Mentira y en el peor lugar.
  if (cart.length === 0 && !success && !datosListos) {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <ShoppingCart size={64} strokeWidth={1} className="mx-auto text-gray-300 mb-4 animate-pulse" />
        <h1 className="font-display text-2xl font-bold text-navy-700">Cargando tu carrito…</h1>
      </div>
    );
  }

  if (cart.length === 0 && !success) {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <ShoppingCart size={64} strokeWidth={1} className="mx-auto text-gray-300 mb-4" />
        <h1 className="font-display text-2xl font-bold text-navy-700 mb-4">Tu carrito está vacío</h1>
        <Link to="/tienda" className="text-lime-800 hover:text-lime-700 font-semibold inline-flex items-center gap-1">
          Descubrí la colección <ArrowRight size={16} />
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Check size={40} className="text-green-500" />
        </div>
        <h1 className="font-display text-3xl font-bold text-navy-700 mb-4">¡Pedido enviado!</h1>
        <p className="text-gray-500 mb-8 max-w-md mx-auto">
          Recibimos tu pedido y te vamos a escribir por WhatsApp para coordinar
          la entrega y el pago. ¡Gracias por elegir VOLEA!
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors"
        >
          Volver al inicio
        </Link>
      </div>
    );
  }

  // Chequeo de stock + armado del pedido, compartido por ambos caminos de pago.
  const construirPedido = (): Order | null => {
    const shortItem = cart.find(i => {
      const key = i.selectedColor ? `${i.selectedSize}|${i.selectedColor}` : i.selectedSize;
      return (i.product.stockBySize[key] || 0) < i.quantity;
    });
    if (shortItem) {
      toast.error(`No queda stock suficiente de ${shortItem.product.name} — ajustá la cantidad en el carrito.`);
      return null;
    }
    return {
      id: `VO-${Date.now().toString(36).toUpperCase()}`,
      items: cart,
      customer,
      total,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  };

  const handleSubmitWhatsApp = (e: React.FormEvent) => {
    e.preventDefault();
    const order = construirPedido();
    if (!order) return;
    addOrder(order);

    // Build WhatsApp message
    const lines = [
      `🏓 *Nuevo pedido VOLEA*`,
      `📌 Ref: ${order.id}`,
      ``,
      `👤 *Cliente:* ${customer.name}`,
      `📱 *Tel:* ${customer.phone}`,
      `📧 *Email:* ${customer.email}`,
      `📦 *Dirección:* ${customer.address}, ${customer.city}, ${customer.department}`,
      customer.notes ? `📝 *Notas:* ${customer.notes}` : '',
      ``,
      `🛍 *Productos:*`,
      ...cart.map(i => `  • ${i.product.name} (${[i.selectedSize, i.selectedColor].filter(Boolean).join('/') || 'Único'}) x${i.quantity} - ${formatPrice(i.product.price * i.quantity)}`),
      ``,
      // Con promo, el desglose va explícito en el mensaje: Gastón/Pauli cobran
      // leyendo esto, y un total menor que la suma de los renglones sin
      // explicación parece un error.
      ...(descuento > 0 && promo
        ? [`Subtotal: ${formatPrice(subtotal)}`, `🏷 *${promo.label} (−${promo.percent}%): −${formatPrice(descuento)}*`]
        : []),
      `💰 *Total: ${formatPrice(total)}*`,
      ...(promo?.deliveryNote ? [``, `🚚 ${promo.deliveryNote}`] : []),
      ``,
      `_¡Hola! Quiero coordinar la entrega y el pago de este pedido._`,
    ].filter(Boolean).join('\n');

    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines)}`;
    window.open(whatsappUrl, '_blank');
    clearCart();
    setSuccess(true);
  };

  const pagarConMP = async () => {
    if (pagandoMP) return;
    const order = construirPedido();
    if (!order) return;
    order.paymentStatus = 'iniciado';
    order.paymentProvider = 'mp';
    setPagandoMP(true);
    try {
      // Sin el pedido en la DB no hay preferencia: la función lo relee de ahí.
      const inserto = await addOrder(order);
      if (!inserto) throw new Error('No pudimos registrar el pedido (¿problemas de conexión?)');
      const resp = await fetch('/api/mp/preferencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.initPoint) throw new Error(data.error || 'No se pudo iniciar el pago');
      // OJO: el carrito NO se vacía acá. Se vacía en /pago/resultado si el
      // pago salió aprobado/pendiente; si el cliente abandona o MP rechaza,
      // el carrito lo espera intacto.
      // Bandera para que /pago/resultado sepa que este navegador realmente
      // inició un pago (un link compartido no debe vaciarle el carrito a nadie).
      sessionStorage.setItem('volea_pago_en_curso', '1');
      window.location.href = data.initPoint;
    } catch (err) {
      toast.error(`${err instanceof Error ? err.message : 'Error al iniciar el pago'} — también podés coordinar por WhatsApp.`);
      setPagandoMP(false);
    }
  };

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-12">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mb-2">Finalizar pedido</h1>
      <div className="w-16 h-1 bg-lime-400 mb-8" />

      <div className="grid lg:grid-cols-2 gap-12">
        {/* Order Summary */}
        <div className="order-2 lg:order-1">
          <h2 className="font-display text-xl font-bold text-navy-700 mb-4">Resumen del pedido</h2>
          <div className="bg-gray-50 rounded-xl p-6 space-y-4">
            {cart.map((item, idx) => (
              <div key={idx} className="flex gap-3">
                <img
                  src={item.product.images[0] || FALLBACK_IMG}
                  alt={item.product.name}
                  className="w-16 h-16 object-cover rounded-lg"
                  onError={handleImgError}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-semibold text-sm text-navy-700 truncate">{item.product.name}</h3>
                  <p className="text-xs text-gray-500">{[item.selectedSize, item.selectedColor, `x${item.quantity}`].filter(Boolean).join(' | ')}</p>
                </div>
                <span className="font-display font-bold text-navy-700 text-sm whitespace-nowrap">
                  {formatPrice(item.product.price * item.quantity)}
                </span>
              </div>
            ))}
            <div className="border-t border-gray-200 pt-4 space-y-1">
              {descuento > 0 && promo && (
                <>
                  <div className="flex justify-between items-center text-sm text-gray-500">
                    <span>Subtotal</span>
                    <span className="line-through">{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-semibold text-lime-700">
                    <span>{promo.label} (−{promo.percent}%)</span>
                    <span>−{formatPrice(descuento)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between items-center">
                <span className="font-display text-lg font-semibold">Total</span>
                <span className="font-display text-2xl font-bold text-navy-700">{formatPrice(total)}</span>
              </div>
            </div>
          </div>

          {/* Entrega en Carmelo durante el torneo (nota de la promo) */}
          {promo?.deliveryNote && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-lime-300 bg-lime-50 p-4">
              <Package size={20} className="mt-0.5 flex-shrink-0 text-lime-700" />
              <p className="text-sm text-navy-700">
                <span className="font-display font-bold">Entrega sin costo:</span> {promo.deliveryNote}{' '}
                Si te sirve, anotalo en las notas del pedido.
              </p>
            </div>
          )}

          {/* Cómo funciona */}
          <div className="mt-6 bg-gradient-to-br from-navy-700 to-navy-900 rounded-xl p-6 text-white">
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle size={18} className="text-lime-400" />
              <h3 className="font-display font-bold text-lg">
                {mpDisponible ? 'Pagá online o coordiná por WhatsApp' : 'Compra coordinada por WhatsApp'}
              </h3>
            </div>
            <p className="text-sm text-gray-300">
              {mpDisponible ? (
                <>
                  Podés pagar ahora con Mercado Pago (tarjeta, débito o dinero en cuenta) o
                  mandarnos el pedido por WhatsApp y coordinar transferencia o efectivo.
                  Como prefieras.
                </>
              ) : (
                <>
                  Completá tus datos y tu pedido nos llega al instante. Te escribimos
                  por WhatsApp para coordinar la entrega y el pago (transferencia,
                  efectivo o el medio que te quede más cómodo).
                </>
              )}
            </p>
          </div>
        </div>

        {/* Customer Form for WhatsApp */}
        <div className="order-1 lg:order-2">
          <h2 className="font-display text-xl font-bold text-navy-700 mb-2">Completá tus datos</h2>
          <p className="text-sm text-gray-500 mb-4">Con esto armamos tu pedido y te contactamos por WhatsApp.</p>
          <form ref={formRef} onSubmit={handleSubmitWhatsApp} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Nombre completo *</label>
              <input
                type="text"
                required
                value={customer.name}
                onChange={e => setCustomer({ ...customer, name: e.target.value })}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-navy-700 mb-1">Teléfono *</label>
                <input
                  type="tel"
                  required
                  value={customer.phone}
                  onChange={e => setCustomer({ ...customer, phone: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-navy-700 mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={customer.email}
                  onChange={e => setCustomer({ ...customer, email: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Dirección *</label>
              <input
                type="text"
                required
                value={customer.address}
                onChange={e => setCustomer({ ...customer, address: e.target.value })}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-navy-700 mb-1">Ciudad *</label>
                <input
                  type="text"
                  required
                  value={customer.city}
                  onChange={e => setCustomer({ ...customer, city: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-navy-700 mb-1">Departamento *</label>
                <select
                  required
                  value={customer.department}
                  onChange={e => setCustomer({ ...customer, department: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors bg-white"
                >
                  {URUGUAY_DEPARTMENTS.map(dep => (
                    <option key={dep} value={dep}>{dep}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Notas (opcional)</label>
              <textarea
                rows={3}
                value={customer.notes}
                onChange={e => setCustomer({ ...customer, notes: e.target.value })}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors resize-none"
                placeholder="Horario de entrega, punto de encuentro u otra aclaración"
              />
            </div>
            {mpDisponible && (
              <button
                type="button"
                onClick={() => {
                  if (formRef.current && !formRef.current.reportValidity()) return; // valida los required
                  pagarConMP();
                }}
                disabled={pagandoMP}
                className="w-full bg-[#009EE3] hover:bg-[#0088c9] disabled:opacity-60 text-white font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <CreditCard size={20} /> {pagandoMP ? 'Conectando con Mercado Pago…' : 'Pagar online con Mercado Pago'}
              </button>
            )}
            <button
              type="submit"
              disabled={pagandoMP}
              className="pulse-glow w-full bg-lime-400 hover:bg-lime-500 disabled:opacity-60 text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <MessageCircle size={20} /> {mpDisponible ? 'O coordinar por WhatsApp' : 'Enviar pedido por WhatsApp'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── 12b. StockDashboard ─────────────────────────────────────────────────────

type StockFilter = 'all' | 'low' | 'out';

function StockDashboard({ products, onEdit }: { products: Product[]; onEdit: (p: Product) => void }) {
  const [filter, setFilter] = useState<StockFilter>('all');
  const [search, setSearch] = useState('');
  const threshold = 3;

  // Per-product variant breakdown
  const enriched = products.map((p) => {
    const variants = Object.entries(p.stockBySize).map(([key, qty]) => {
      const [size, color] = key.split('|');
      return { key, size, color: color || 'Único', qty };
    });
    const lowVariants = variants.filter((v) => v.qty > 0 && v.qty <= threshold);
    const outVariants = variants.filter((v) => v.qty <= 0);
    const totalUnits = variants.reduce((s, v) => s + Math.max(0, v.qty), 0);
    return { product: p, variants, lowVariants, outVariants, totalUnits };
  });

  const totalUnits = enriched.reduce((s, e) => s + e.totalUnits, 0);
  const totalVariants = enriched.reduce((s, e) => s + e.variants.length, 0);
  const totalLow = enriched.reduce((s, e) => s + e.lowVariants.length, 0);
  const totalOut = enriched.reduce((s, e) => s + e.outVariants.length, 0);

  const filteredProducts = enriched
    .filter((e) => {
      if (search && !e.product.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === 'low') return e.lowVariants.length > 0;
      if (filter === 'out') return e.outVariants.length > 0;
      return true;
    })
    .sort((a, b) => {
      // Sort by urgency: out > low > healthy
      const score = (e: typeof a) => e.outVariants.length * 10 + e.lowVariants.length;
      return score(b) - score(a);
    });

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Stock &amp; Alertas</h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Unidades Totales" value={totalUnits} color="bg-green-50 text-green-700" icon={<Package size={20} />} />
        <StatCard label="Variantes" value={totalVariants} color="bg-blue-50 text-blue-700" icon={<Tag size={20} />} />
        <StatCard label="Bajo Stock (≤3)" value={totalLow} color="bg-yellow-50 text-yellow-700" icon={<AlertCircle size={20} />} />
        <StatCard label="Sin Stock" value={totalOut} color="bg-red-50 text-red-700" icon={<XCircle size={20} />} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none text-sm"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'low', 'out'] as StockFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg font-display text-sm font-semibold transition-colors ${
                filter === f ? 'bg-navy-700 text-lime-400' : 'bg-gray-100 text-navy-700 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'Todos' : f === 'low' ? 'Bajo stock' : 'Sin stock'}
            </button>
          ))}
        </div>
      </div>

      {/* Product list */}
      {filteredProducts.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center text-gray-400">
          <Check size={48} className="mx-auto mb-3 text-green-400" />
          <p className="font-display">
            {filter === 'out'
              ? '¡Ningún producto sin stock!'
              : filter === 'low'
              ? '¡Sin alertas de bajo stock!'
              : 'No se encontraron productos'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProducts.map(({ product, variants, lowVariants, outVariants, totalUnits }) => (
            <StockProductRow
              key={product.id}
              product={product}
              variants={variants}
              lowVariants={lowVariants}
              outVariants={outVariants}
              totalUnits={totalUnits}
              threshold={threshold}
              onEdit={() => onEdit(product)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${color}`}>{icon}</div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="font-display text-2xl font-bold text-navy-700">{value}</p>
    </div>
  );
}

interface StockVariantInfo {
  key: string;
  size: string;
  color: string;
  qty: number;
}

function StockProductRow({
  product,
  variants,
  lowVariants,
  outVariants,
  totalUnits,
  threshold,
  onEdit,
}: {
  product: Product;
  variants: StockVariantInfo[];
  lowVariants: StockVariantInfo[];
  outVariants: StockVariantInfo[];
  totalUnits: number;
  threshold: number;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasAlert = lowVariants.length > 0 || outVariants.length > 0;

  return (
    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden ${hasAlert ? 'border-yellow-200' : 'border-gray-100'}`}>
      <div className="p-4 flex items-center gap-4">
        <img
          src={product.images[0] || FALLBACK_IMG}
          alt={product.name}
          className="w-16 h-16 object-cover rounded-lg flex-shrink-0"
          onError={handleImgError}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold text-navy-700">{product.name}</h3>
            {outVariants.length > 0 && (
              <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {outVariants.length} sin stock
              </span>
            )}
            {lowVariants.length > 0 && (
              <span className="bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                {lowVariants.length} bajo stock
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {variants.length} variantes · {totalUnits} unidades · {formatPrice(product.price)}
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-navy-700 hover:text-lime-500 p-2 transition-colors"
        >
          <ChevronDown size={20} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={onEdit}
          className="text-xs text-navy-700 hover:text-lime-500 font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          title="Editar producto y stock"
        >
          Editar <Edit size={12} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 font-display text-xs font-semibold text-gray-500 uppercase">Variante</th>
                <th className="text-left px-4 py-2 font-display text-xs font-semibold text-gray-500 uppercase">Color</th>
                <th className="text-right px-4 py-2 font-display text-xs font-semibold text-gray-500 uppercase">Cantidad</th>
                <th className="text-left px-4 py-2 font-display text-xs font-semibold text-gray-500 uppercase">Estado</th>
              </tr>
            </thead>
            <tbody>
              {variants
                .slice()
                .sort((a, b) => a.qty - b.qty)
                .map((v) => {
                  const isOut = v.qty <= 0;
                  const isLow = v.qty > 0 && v.qty <= threshold;
                  return (
                    <tr key={v.key} className={`border-t border-gray-100 ${isOut ? 'bg-red-50/50' : isLow ? 'bg-yellow-50/50' : ''}`}>
                      <td className="px-4 py-2 font-semibold text-navy-700">{v.size}</td>
                      <td className="px-4 py-2 text-gray-600">{v.color}</td>
                      <td className="px-4 py-2 text-right font-display font-bold tabular-nums">{v.qty}</td>
                      <td className="px-4 py-2">
                        {isOut ? (
                          <span className="inline-flex items-center gap-1 text-red-700 text-xs font-semibold">
                            <XCircle size={14} /> Sin stock
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 text-yellow-700 text-xs font-semibold">
                            <AlertCircle size={14} /> Bajo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-green-700 text-xs font-semibold">
                            <Check size={14} /> OK
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 13. AdminPage ───────────────────────────────────────────────────────────

// Badge del estado de pago online de un pedido (null = flujo WhatsApp puro).
function BadgePagoMP({ order }: { order: Order }) {
  if (!order.paymentStatus) return null;
  const cfg: Record<PaymentStatus, { texto: string; clases: string }> = {
    aprobado:  { texto: '💳 Pagado (MP)',  clases: 'bg-green-100 text-green-700' },
    pendiente: { texto: 'MP en proceso',   clases: 'bg-yellow-100 text-yellow-700' },
    iniciado:  { texto: 'MP sin terminar', clases: 'bg-gray-100 text-gray-500' },
    rechazado: { texto: 'MP rechazado',    clases: 'bg-red-100 text-red-600' },
    devuelto:  { texto: 'MP devuelto',     clases: 'bg-orange-100 text-orange-600' },
  };
  const c = cfg[order.paymentStatus];
  if (!c) return null;
  return (
    <span className={`text-xs font-semibold rounded-full px-2 py-1 whitespace-nowrap ${c.clases}`}>
      {c.texto}
    </span>
  );
}

function AdminPage() {
  const store = useStore();
  const {
    isAdmin, currentAdmin, login, sendLoginLink, logout, products, refreshProducts, saveProduct, removeProduct, events, setEvents,
    orders, setOrders, addOrder, categories, setCategories, clubs, setClubs,
    announcements, setAnnouncements, posts, savePost, removePost,
    standings, saveStanding, removeStanding
  } = store;

  // Caja: callbacks con identidad estable para no re-disparar el fetch del
  // ledger en cada re-render de AdminPage (sidebar, auth refresh, etc.).
  const loadLedger = useCallback(() => SupabaseService.getLedger(), []);
  const loadLedgerFull = useCallback(() => SupabaseService.getLedger(5000), []);
  const revertLedgerEntry = useCallback(async (id: string) => {
    const result = await SupabaseService.revertLedgerEntry(id);
    // Si se repuso stock, las otras pestañas (Stock, Productos) deben verlo.
    if (result.ok && result.stockRestored) refreshProducts();
    return result;
  }, [refreshProducts]);
  // Nueva venta / gasto desde la Caja web: mismas RPCs-semántica que el bot.
  // Quién registró: nombre del admin logueado (fallback al email o "Web").
  const cajaReportedBy = currentAdmin?.name || currentAdmin?.email || 'Web';
  const registrarVenta = useCallback(async (input: VentaCajaInput) => {
    const result = await SupabaseService.registrarVentaCaja(input, cajaReportedBy);
    // Venta de catálogo: el stock bajó y las otras pestañas (Stock, Productos)
    // deben verlo — mismo patrón de refresh que la anulación.
    if (result.ok && input.productId) refreshProducts();
    return result;
  }, [cajaReportedBy, refreshProducts]);
  const registrarGasto = useCallback(
    (label: string, amount: number, paidBy: SocioName) =>
      SupabaseService.registrarGastoCaja(label, amount, cajaReportedBy, paidBy),
    [cajaReportedBy],
  );
  // De qué socio salió la plata NO se puede deducir de la cuenta compartida
  // ("VOLEA Team", somosvolea@gmail.com): ahí devolvemos null y la Caja obliga a
  // elegirlo a mano. Antes se adivinaba al liquidar y todo lo no reconocido se le
  // asentaba a Gastón, torciendo el reparto 50/25/25.
  // Los prefijos son deliberadamente específicos: con "gast" a secas, una cuenta
  // gastos@volea.uy o un nombre "Gastos VOLEA" quedaría mapeado a Gastón EN SILENCIO
  // y encima marcado como confirmado en la liquidación. Ante la duda, null: que lo
  // elija una persona.
  const socioSugerido = useMemo<SocioName | null>(() => {
    const campos = [(currentAdmin?.name || ''), (currentAdmin?.email || '')]
      .map(v => v.trim().toLowerCase()).filter(Boolean);
    const empieza = (...prefijos: string[]) => campos.some(c => prefijos.some(p => c.startsWith(p)));
    if (empieza('brian', 'bridvanovich')) return 'brian';
    if (empieza('paula', 'pauli')) return 'paula';
    if (empieza('gaston', 'gastón', 'gasty')) return 'gaston';
    return null;
  }, [currentAdmin?.name, currentAdmin?.email]);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [loginError, setLoginError] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  // 'password' es el modo principal; el magic link queda como alternativa
  // (el SMTP built-in de Supabase tiene límite de ~2 mails/hora).
  const [authMode, setAuthMode] = useState<'password' | 'magiclink'>('password');
  const [signingIn, setSigningIn] = useState(false);
  // Arranca en la pestaña que haya dejado la barra de admin flotante (atajo desde la
  // web pública) y consume el hint para que una visita manual a /admin siga cayendo
  // en el dashboard como siempre.
  const [activeTab, setActiveTab] = useState(() => {
    const atajo = sessionStorage.getItem(ATAJO_TAB_ADMIN);
    if (atajo) {
      sessionStorage.removeItem(ATAJO_TAB_ADMIN);
      return atajo;
    }
    return 'dashboard';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Modo transmisión: esconde la columna del admin en desktop (streaming en vivo).
  const [panelOculto, setPanelOculto] = useState(false);
  const useSupabaseAuth = isSupabaseConnected();

  // Product modal state
  const [productModal, setProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Event modal state
  const [eventModal, setEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [deleteEventConfirm, setDeleteEventConfirm] = useState<string | null>(null);
  const [inscriptosEvent, setInscriptosEvent] = useState<Event | null>(null);

  // Club modal state
  const [clubModal, setClubModal] = useState(false);
  const [editingClub, setEditingClub] = useState<Club | null>(null);
  const [deleteClubConfirm, setDeleteClubConfirm] = useState<string | null>(null);

  // Announcement modal state
  const [announcementModal, setAnnouncementModal] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [deleteAnnouncementConfirm, setDeleteAnnouncementConfirm] = useState<string | null>(null);

  // Expanded order + alta manual
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [orderModal, setOrderModal] = useState(false);

  // New category
  const [newCategory, setNewCategory] = useState('');

  // Login form
  if (!isAdmin) {
    return (
      <div className="fade-in min-h-[60vh] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-navy-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield size={32} className="text-lime-400" />
            </div>
            <h1 className="font-display text-2xl font-bold text-navy-700">Panel de Administración</h1>
            <p className="text-gray-500 text-sm mt-1">
              {!useSupabaseAuth
                ? 'Ingresá la contraseña para acceder'
                : authMode === 'password'
                  ? 'Ingresá tu email y contraseña'
                  : 'Ingresá tu email y te mandamos un link de acceso'}
            </p>
          </div>

          {loginError && (
            <div className="bg-red-50 text-red-600 border border-red-200 rounded-lg p-3 mb-4 flex items-center gap-2 text-sm">
              <AlertCircle size={16} /> {loginError}
            </div>
          )}

          {magicLinkSent ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail size={28} className="text-green-600" />
              </div>
              <p className="text-navy-700 font-display font-semibold mb-2">¡Email enviado!</p>
              <p className="text-sm text-gray-500 mb-4">
                Revisá <strong>{email}</strong> y hacé clic en el link para entrar.
              </p>
              <button
                onClick={() => { setMagicLinkSent(false); setEmail(''); }}
                className="text-lime-800 text-sm font-semibold hover:underline"
              >
                Usar otro email
              </button>
            </div>
          ) : useSupabaseAuth && authMode === 'password' ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setLoginError('');
                setSigningIn(true);
                const result = await signInWithPassword(email, password);
                if (!result.success) {
                  setSigningIn(false);
                  setLoginError(result.error || 'No se pudo iniciar sesión');
                }
                // Éxito: onAuthStateChange activa isAdmin y este form desaparece.
              }}
            >
              <input
                type="email"
                placeholder="tu@email.com"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors mb-4"
              />
              <input
                type="password"
                placeholder="Contraseña"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors mb-4"
              />
              <button
                type="submit"
                disabled={signingIn}
                className="w-full bg-navy-700 hover:bg-navy-800 disabled:bg-gray-400 text-white font-display font-bold py-3 rounded-lg transition-colors"
              >
                {signingIn ? 'Entrando...' : 'Ingresar'}
              </button>
              <button
                type="button"
                onClick={() => { setLoginError(''); setAuthMode('magiclink'); }}
                className="w-full mt-3 text-lime-800 text-sm font-semibold hover:underline"
              >
                ¿Preferís recibir un link por email?
              </button>
            </form>
          ) : useSupabaseAuth ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setLoginError('');
                setSendingMagicLink(true);
                const result = await sendLoginLink(email);
                setSendingMagicLink(false);
                if (result.success) {
                  setMagicLinkSent(true);
                } else {
                  setLoginError(result.error || 'Error al enviar el link');
                }
              }}
            >
              <input
                type="email"
                placeholder="tu@email.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors mb-4"
              />
              <button
                type="submit"
                disabled={sendingMagicLink}
                className="w-full bg-navy-700 hover:bg-navy-800 disabled:bg-gray-400 text-white font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {sendingMagicLink ? 'Enviando...' : (<><Mail size={18} /> Recibir link de acceso</>)}
              </button>
              <button
                type="button"
                onClick={() => { setLoginError(''); setAuthMode('password'); }}
                className="w-full mt-3 text-lime-800 text-sm font-semibold hover:underline"
              >
                Entrar con contraseña
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!login(password)) {
                  setLoginError('Contraseña incorrecta');
                  setTimeout(() => setLoginError(''), 3000);
                }
              }}
            >
              <input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors mb-4"
              />
              <button
                type="submit"
                className="w-full bg-navy-700 hover:bg-navy-800 text-white font-display font-bold py-3 rounded-lg transition-colors"
              >
                Ingresar
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Stats
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  const totalRevenue = orders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.total, 0);
  const outOfStock = products.filter(p => getTotalStock(p) === 0).length;

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={18} /> },
    { id: 'stock', label: 'Stock & Alertas', icon: <AlertCircle size={18} /> },
    { id: 'products', label: 'Productos', icon: <Package size={18} /> },
    { id: 'orders', label: 'Pedidos', icon: <Store size={18} /> },
    { id: 'caja', label: 'Caja', icon: <Wallet size={18} /> },
    { id: 'socios', label: 'Socios', icon: <Users size={18} /> },
    { id: 'blog', label: 'Blog', icon: <Newspaper size={18} /> },
    { id: 'galeria', label: 'Galería', icon: <Images size={18} /> },
    { id: 'standings', label: 'Clasificación', icon: <Trophy size={18} /> },
    { id: 'events', label: 'Eventos', icon: <CalendarDays size={18} /> },
    { id: 'categories', label: 'Categorías', icon: <Tag size={18} /> },
    { id: 'clubs', label: 'Clubes', icon: <Map size={18} /> },
    { id: 'announcements', label: 'Anuncios', icon: <Megaphone size={18} /> },
    { id: 'torneos', label: 'Torneos', icon: <Trophy size={18} /> },
  ];

  // Stock metrics (nativo: calculado desde los productos de Supabase)
  const stockMetrics = (() => {
    let totalUnits = 0, variantCount = 0, outOfStockVariants = 0, lowStockVariants = 0;
    for (const p of products) {
      for (const qty of Object.values(p.stockBySize)) {
        variantCount++;
        totalUnits += Math.max(0, qty);
        if (qty <= 0) outOfStockVariants++;
        else if (qty <= 3) lowStockVariants++;
      }
    }
    return { totalUnits, variantCount, outOfStockVariants, lowStockVariants };
  })();

  return (
    <div className="flex min-h-[calc(100vh-120px)]">
      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      {/* En desktop la columna es sticky DEBAJO del nav público (h-16): antes era
          static y al scrollear se deslizaba por abajo del nav sticky y quedaba tapada.
          panelOculto = modo transmisión (pedido de Brian 2026-08-09): esconde la
          columna entera en desktop para streamear la pantalla limpia; se vuelve
          con el botón flotante de abajo a la izquierda. En mobile no aplica. */}
      <aside className={`fixed lg:sticky top-0 lg:top-16 left-0 h-full lg:h-[calc(100vh-4rem)] lg:self-start z-50 lg:z-30 w-64 bg-navy-800 text-white flex-col transition-transform lg:translate-x-0 ${panelOculto ? 'flex lg:hidden' : 'flex'} ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-navy-600 flex items-center justify-between">
          <span className="font-display text-xl font-bold text-lime-400">Admin</span>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-white hover:text-lime-400">
            <X size={24} />
          </button>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-display text-sm font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'text-lime-400 bg-navy-700 border-l-4 border-lime-400'
                  : 'text-gray-300 hover:text-white hover:bg-navy-700'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-navy-600 space-y-1">
          <button
            onClick={() => setPanelOculto(true)}
            className="hidden lg:flex w-full items-center gap-3 px-4 py-3 rounded-lg font-display text-sm font-semibold text-gray-300 hover:text-lime-400 hover:bg-navy-700 transition-colors"
            title="Esconde esta columna para transmitir la pantalla limpia"
          >
            <EyeOff size={18} /> Ocultar panel
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-display text-sm font-semibold text-gray-300 hover:text-red-400 hover:bg-navy-700 transition-colors"
          >
            <LogOut size={18} /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Botón flotante para volver del modo transmisión (discreto, abajo a la izquierda) */}
      {panelOculto && (
        <button
          onClick={() => setPanelOculto(false)}
          className="hidden lg:flex fixed bottom-4 left-4 z-40 items-center gap-2 bg-navy-800/80 hover:bg-navy-700 text-gray-300 hover:text-lime-400 text-xs font-display font-semibold px-3 py-2 rounded-full shadow-lg transition-colors"
          title="Mostrar el panel del admin"
        >
          <Eye size={14} /> Panel
        </button>
      )}

      {/* Main content */}
      <div className="flex-1 bg-gray-50 p-4 md:p-8">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center gap-4 mb-6">
          <button onClick={() => setSidebarOpen(true)} className="text-navy-700 hover:text-lime-500">
            <Menu size={24} />
          </button>
          <h1 className="font-display text-xl font-bold text-navy-700">{tabs.find(t => t.id === activeTab)?.label}</h1>
        </div>

        {/* Dashboard */}
        {activeTab === 'dashboard' && (
          <div className="fade-in">
            <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700 mb-6">Dashboard</h1>

            {/* Stock alert banners */}
            {stockMetrics.outOfStockVariants > 0 && (
              <button
                onClick={() => setActiveTab('stock')}
                className="w-full mb-3 flex items-center gap-3 bg-red-50 hover:bg-red-100 border-l-4 border-red-500 text-red-800 px-4 py-3 rounded-r-lg transition-colors text-left"
              >
                <AlertCircle size={20} className="flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong>{stockMetrics.outOfStockVariants} variantes sin stock.</strong> Ver detalle.
                </div>
                <ArrowRight size={18} />
              </button>
            )}
            {stockMetrics.lowStockVariants > 0 && (
              <button
                onClick={() => setActiveTab('stock')}
                className="w-full mb-6 flex items-center gap-3 bg-yellow-50 hover:bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 px-4 py-3 rounded-r-lg transition-colors text-left"
              >
                <AlertCircle size={20} className="flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong>{stockMetrics.lowStockVariants} variantes con stock bajo</strong> (≤ 3 unidades). Reponé pronto.
                </div>
                <ArrowRight size={18} />
              </button>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Productos', value: products.length, icon: <Package size={24} />, color: 'bg-blue-50 text-blue-600' },
                { label: 'Unidades en Stock', value: stockMetrics.totalUnits, icon: <BarChart3 size={24} />, color: 'bg-green-50 text-green-600' },
                { label: 'Pedidos Pendientes', value: pendingOrders, icon: <Store size={24} />, color: 'bg-yellow-50 text-yellow-600' },
                { label: 'Variantes sin Stock', value: stockMetrics.outOfStockVariants, icon: <AlertCircle size={24} />, color: 'bg-red-50 text-red-600' },
              ].map((stat, i) => (
                <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${stat.color}`}>
                    {stat.icon}
                  </div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="font-display text-2xl font-bold text-navy-700">{stat.value}</p>
                </div>
              ))}
            </div>
            {/* Recent orders */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="font-display text-lg font-bold text-navy-700 mb-4">Últimos Pedidos</h2>
              {orders.length === 0 ? (
                <p className="text-gray-400 text-sm">No hay pedidos aún</p>
              ) : (
                <div className="space-y-3">
                  {orders.slice(-5).reverse().map(o => (
                    <div key={o.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <span className="font-display font-semibold text-navy-700 text-sm">{o.id}</span>
                        <span className="text-gray-500 text-xs ml-2">{o.customer.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-display font-bold text-navy-700 text-sm">{formatPrice(o.total)}</span>
                        <StatusBadge status={o.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stock & Alertas Tab */}
        {activeTab === 'stock' && (
          <StockDashboard products={products} onEdit={(p) => { setEditingProduct(p); setProductModal(true); }} />
        )}

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Productos</h1>
              <button
                onClick={() => { setEditingProduct(null); setProductModal(true); }}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Nuevo producto
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Imagen</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">SKU</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Nombre</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Categoría</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Precio</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">Stock</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden lg:table-cell">Dest.</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden lg:table-cell">Estado</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        {/* Foto y nombre abren el editor (pedido de Brian 2026-08-06):
                            el lápiz de Acciones quedaba lejos en pantallas anchas. */}
                        <td className="px-4 py-3 cursor-pointer" onClick={() => { setEditingProduct(p); setProductModal(true); }} title="Editar producto">
                          <img src={p.images[0] || FALLBACK_IMG} alt={p.name} className="w-12 h-12 object-cover rounded-lg" onError={handleImgError} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono hidden sm:table-cell">{p.sku}</td>
                        <td className="px-4 py-3 font-display font-semibold text-navy-700 text-sm cursor-pointer hover:text-lime-800 transition-colors" onClick={() => { setEditingProduct(p); setProductModal(true); }} title="Editar producto">{p.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{categoryLabel(categories, p.category)}</td>
                        <td className="px-4 py-3 font-display font-bold text-navy-700 text-sm">{formatPrice(p.price)}</td>
                        <td className="px-4 py-3 text-sm hidden sm:table-cell">
                          <span className={`font-semibold ${getTotalStock(p) === 0 ? 'text-red-500' : 'text-green-600'}`}>{getTotalStock(p)}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {p.isFeatured && <Star size={16} className="text-yellow-500 fill-yellow-500" />}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <div className="flex items-center gap-1">
                            {p.isOffer && <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1 rounded-full">OFERTA</span>}
                            {p.active === false && <span className="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-1 rounded-full">OCULTO</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { setEditingProduct(p); setProductModal(true); }}
                              className="text-navy-700 hover:text-lime-500 transition-colors"
                              title="Editar"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(p.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* Events Tab */}
        {activeTab === 'events' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Eventos</h1>
              <button
                onClick={() => { setEditingEvent(null); setEventModal(true); }}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Agregar Evento
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Nombre</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">Lugar</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Categoría</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Estado</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map(evt => (
                      <tr key={evt.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-display font-semibold text-navy-700 text-sm">{evt.name}</td>
                        {/* rangoLargo y no new Date(): mostraba un día menos por UTC */}
                        <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{rangoLargo(evt.date, evt.endDate)}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">{evt.location}, {evt.city}</td>
                        <td className="px-4 py-3">
                          <span className="bg-navy-700/10 text-navy-700 text-xs font-bold px-2 py-1 rounded-full capitalize">
                            {evt.category === 'tournament' ? 'Torneo' : evt.category === 'clinic' ? 'Clínica' : 'Social'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${evt.status === 'upcoming' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {evt.status === 'upcoming' ? 'Próximo' : 'Pasado'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {evt.inscripcionesAbiertas && (
                              <button
                                onClick={() => setInscriptosEvent(evt)}
                                title="Ver inscriptos"
                                className="text-lime-700 hover:text-lime-500 transition-colors"
                              >
                                <Users size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => { setEditingEvent(evt); setEventModal(true); }}
                              className="text-navy-700 hover:text-lime-500 transition-colors"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteEventConfirm(evt.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Event Modal */}
            {eventModal && (
              <EventModal
                event={editingEvent}
                uploadImage={(f) => SupabaseService.uploadImage(f, 'events')}
                onClose={() => { setEventModal(false); setEditingEvent(null); }}
                onSave={(evt) => {
                  if (editingEvent) {
                    setEvents(events.map(e => e.id === evt.id ? evt : e));
                  } else {
                    setEvents([...events, evt]);
                  }
                  setEventModal(false);
                  setEditingEvent(null);
                }}
              />
            )}

            {/* Inscriptos del evento */}
            {inscriptosEvent && (
              <InscriptosModal event={inscriptosEvent} onClose={() => setInscriptosEvent(null)} />
            )}

            {/* Delete Event Confirm */}
            {deleteEventConfirm && (
              <ConfirmDialog
                title="¿Eliminar evento?"
                message="Esta acción no se puede deshacer."
                onCancel={() => setDeleteEventConfirm(null)}
                onConfirm={() => {
                  SupabaseService.deleteEvent(deleteEventConfirm);
                  setEvents(events.filter(e => e.id !== deleteEventConfirm));
                  setDeleteEventConfirm(null);
                }}
              />
            )}
          </div>
        )}

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Pedidos</h1>
              <button
                onClick={() => setOrderModal(true)}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Nuevo pedido
              </button>
            </div>
            {orderModal && (
              <Suspense fallback={null}>
                <AdminOrderModal
                  products={products}
                  onClose={() => setOrderModal(false)}
                  onSave={async (o) => {
                    // Pre-check: sesión vencida → avisar ANTES del toast optimista
                    // (mismo criterio que el guardado en ProductEditor).
                    if (await sesionAdminVencida()) {
                      toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar. El pedido NO se guardó.');
                      return;
                    }
                    addOrder(o);
                    setOrderModal(false);
                    setExpandedOrder(o.id);
                    toast.success(`Pedido ${o.id} creado`);
                  }}
                />
              </Suspense>
            )}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {orders.length === 0 ? (
                <div className="p-12 text-center text-gray-400">
                  <Store size={48} strokeWidth={1} className="mx-auto mb-3" />
                  <p className="font-display">No hay pedidos aún</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {orders.slice().reverse().map(order => (
                    <div key={order.id}>
                      <div
                        className="flex items-center justify-between px-4 md:px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                      >
                        <div className="flex items-center gap-4">
                          <ChevronDown size={16} className={`text-gray-400 transition-transform ${expandedOrder === order.id ? 'rotate-180' : ''}`} />
                          <div>
                            <span className="font-display font-bold text-navy-700 text-sm">{order.id}</span>
                            <p className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 md:gap-6">
                          <span className="text-sm text-gray-500 hidden sm:inline">{order.customer.name}</span>
                          <span className="text-sm text-gray-500 hidden md:inline">{order.items.length} items</span>
                          <span className="font-display font-bold text-navy-700 text-sm">{formatPrice(order.total)}</span>
                          {/* en móvil el badge no entra (recortaba el select de estado); el detalle expandido muestra el pago igual */}
                          <span className="hidden sm:inline"><BadgePagoMP order={order} /></span>
                          <select
                            value={order.status}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newStatus = e.target.value as Order['status'];
                              setOrders(orders.map(o => o.id === order.id ? { ...o, status: newStatus } : o));
                            }}
                            className="text-xs rounded-full px-2 py-1 border border-gray-200 focus:outline-none bg-white"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="pending">Pendiente</option>
                            <option value="confirmed">Confirmado</option>
                            <option value="shipped">Enviado</option>
                            <option value="delivered">Entregado</option>
                          </select>
                        </div>
                      </div>
                      {expandedOrder === order.id && (
                        <div className="px-4 md:px-6 pb-6 bg-gray-50">
                          <div className="grid md:grid-cols-2 gap-6 pt-4">
                            <div>
                              <h4 className="font-display font-semibold text-navy-700 mb-2">Cliente</h4>
                              <div className="space-y-1 text-sm text-gray-600">
                                <p><strong>Nombre:</strong> {order.customer.name}</p>
                                <p><strong>Tel:</strong> {order.customer.phone}</p>
                                <p><strong>Email:</strong> {order.customer.email}</p>
                                <p><strong>Dirección:</strong> {order.customer.address}, {order.customer.city}, {order.customer.department}</p>
                                {order.customer.notes && <p><strong>Notas:</strong> {order.customer.notes}</p>}
                              </div>
                            </div>
                            <div>
                              <h4 className="font-display font-semibold text-navy-700 mb-2">Productos</h4>
                              <div className="space-y-2">
                                {order.items.map((item, idx) => (
                                  <div key={idx} className="flex items-center gap-3">
                                    <img
                                      src={item.product.images[0] || FALLBACK_IMG}
                                      alt={item.product.name}
                                      className="w-10 h-10 object-cover rounded"
                                      onError={handleImgError}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-semibold truncate">{item.product.name}</p>
                                      <p className="text-xs text-gray-500">{item.selectedSize} / {item.selectedColor} x{item.quantity}</p>
                                    </div>
                                    <span className="text-sm font-bold">{formatPrice(item.product.price * item.quantity)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {order.paymentStatus && (
                              <div>
                                <h4 className="font-display font-semibold text-navy-700 mb-2">Pago online</h4>
                                <div className="space-y-1 text-sm text-gray-600">
                                  <p><strong>Estado:</strong> <BadgePagoMP order={order} /></p>
                                  {order.mpPaymentId && <p><strong>ID de pago MP:</strong> {order.mpPaymentId}</p>}
                                  {order.paidAt && <p><strong>Pagado:</strong> {new Date(order.paidAt).toLocaleString('es-UY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
                                  {order.paidAmount != null && <p><strong>Monto acreditado:</strong> {formatPrice(order.paidAmount)}</p>}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Categories Tab */}
        {activeTab === 'categories' && (
          <div className="fade-in">
            <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700 mb-6">Categorías</h1>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 max-w-lg">
              <div className="flex gap-2 mb-6">
                <input
                  type="text"
                  placeholder="Nueva categoría..."
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newCategory.trim()) {
                      const id = newCategory.trim().toLowerCase().replace(/\s+/g, '-');
                      if (!categories.find(c => c.id === id)) {
                        setCategories([...categories, { id, name: newCategory.trim(), sortOrder: categories.length + 1 }]);
                        setNewCategory('');
                      }
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (newCategory.trim()) {
                      const id = newCategory.trim().toLowerCase().replace(/\s+/g, '-');
                      if (!categories.find(c => c.id === id)) {
                        setCategories([...categories, { id, name: newCategory.trim(), sortOrder: categories.length + 1 }]);
                        setNewCategory('');
                      }
                    }
                  }}
                  className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold px-4 py-2 rounded-lg transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="space-y-2">
                {categories.sort((a, b) => a.sortOrder - b.sortOrder).map(cat => (
                  <div key={cat.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                    <span className="font-display font-semibold text-navy-700">{cat.name}</span>
                    <button
                      onClick={() => {
                        SupabaseService.deleteCategory(cat.id);
                        setCategories(categories.filter(c => c.id !== cat.id));
                      }}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Clubs Tab */}
        {activeTab === 'clubs' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Clubes</h1>
              <button
                onClick={() => { setEditingClub(null); setClubModal(true); }}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Agregar Club
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Nombre</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Ciudad</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">País</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">Pickleball</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clubs.map(club => (
                      <tr key={club.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-display font-semibold text-navy-700 text-sm">{club.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{club.city}</td>
                        <td className="px-4 py-3 text-sm">{club.country === 'Uruguay' ? '🇺🇾' : club.country === 'Argentina' ? '🇦🇷' : club.country === 'Chile' ? '🇨🇱' : club.country === 'Brasil' ? '🇧🇷' : '🌎'} {club.country}</td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {club.hasPickleball && <Check size={16} className="text-green-600" />}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { setEditingClub(club); setClubModal(true); }}
                              className="text-navy-700 hover:text-lime-500 transition-colors"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteClubConfirm(club.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {clubModal && (
              <ClubModal
                club={editingClub}
                onClose={() => { setClubModal(false); setEditingClub(null); }}
                onSave={(c) => {
                  if (editingClub) {
                    setClubs(clubs.map(cl => cl.id === c.id ? c : cl));
                  } else {
                    setClubs([...clubs, c]);
                  }
                  setClubModal(false);
                  setEditingClub(null);
                }}
              />
            )}

            {deleteClubConfirm && (
              <ConfirmDialog
                title="¿Eliminar club?"
                message="Esta acción no se puede deshacer."
                onCancel={() => setDeleteClubConfirm(null)}
                onConfirm={() => {
                  SupabaseService.deleteClub(deleteClubConfirm);
                  setClubs(clubs.filter(c => c.id !== deleteClubConfirm));
                  setDeleteClubConfirm(null);
                }}
              />
            )}
          </div>
        )}

        {/* Announcements Tab */}
        {activeTab === 'announcements' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Anuncios</h1>
              <button
                onClick={() => { setEditingAnnouncement(null); setAnnouncementModal(true); }}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Agregar Anuncio
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Título</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Tipo</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Activo</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {announcements.map(ann => (
                      <tr key={ann.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-display font-semibold text-navy-700 text-sm">{ann.title}</td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                            ann.type === 'info' ? 'bg-blue-100 text-blue-700' :
                            ann.type === 'promo' ? 'bg-lime-100 text-lime-700' :
                            ann.type === 'event' ? 'bg-navy-100 text-navy-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {ann.type === 'info' ? 'Información' : ann.type === 'promo' ? 'Promoción' : ann.type === 'event' ? 'Evento' : 'Importante'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${ann.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {ann.active ? 'Sí' : 'No'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">
                          {new Date(ann.createdAt).toLocaleDateString('es-UY')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { setEditingAnnouncement(ann); setAnnouncementModal(true); }}
                              className="text-navy-700 hover:text-lime-500 transition-colors"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteAnnouncementConfirm(ann.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {announcementModal && (
              <AnnouncementModal
                announcement={editingAnnouncement}
                onClose={() => { setAnnouncementModal(false); setEditingAnnouncement(null); }}
                onSave={(a) => {
                  if (editingAnnouncement) {
                    setAnnouncements(announcements.map(an => an.id === a.id ? a : an));
                  } else {
                    setAnnouncements([...announcements, a]);
                  }
                  setAnnouncementModal(false);
                  setEditingAnnouncement(null);
                }}
              />
            )}

            {deleteAnnouncementConfirm && (
              <ConfirmDialog
                title="¿Eliminar anuncio?"
                message="Esta acción no se puede deshacer."
                onCancel={() => setDeleteAnnouncementConfirm(null)}
                onConfirm={() => {
                  SupabaseService.deleteAnnouncement(deleteAnnouncementConfirm);
                  setAnnouncements(announcements.filter(a => a.id !== deleteAnnouncementConfirm));
                  setDeleteAnnouncementConfirm(null);
                }}
              />
            )}
          </div>
        )}

        {/* Caja Tab (ventas/gastos del bot de Telegram) */}
        {activeTab === 'caja' && (
          <div className="fade-in">
            <Suspense fallback={cargandoTab}>
              <AdminCajaTab
                loadLedger={loadLedger}
                loadLedgerFull={loadLedgerFull}
                revertEntry={revertLedgerEntry}
                loadSocioMoves={SupabaseService.getSocioMoves}
                products={products}
                registrarVenta={registrarVenta}
                registrarGasto={registrarGasto}
                socioSugerido={socioSugerido}
                cobrarDeudor={SupabaseService.cobrarDeudorCaja}
              />
            </Suspense>
          </div>
        )}

        {/* Socios Tab (cuentas entre socios + números del negocio) */}
        {activeTab === 'socios' && (
          <Suspense fallback={cargandoTab}>
            <AdminSociosTab
              loadLedgerFull={loadLedgerFull}
              loadSocioMoves={SupabaseService.getSocioMoves}
              addSocioMove={SupabaseService.addSocioMove}
              deleteSocioMove={SupabaseService.deleteSocioMove}
              liquidarCaja={SupabaseService.liquidarCaja}
            />
          </Suspense>
        )}

        {/* Blog Tab */}
        {activeTab === 'blog' && (
          <div className="fade-in">
            <Suspense fallback={cargandoTab}>
              <AdminBlogTab
                posts={posts}
                onSave={savePost}
                onDelete={removePost}
                uploadImage={(f) => SupabaseService.uploadImage(f, 'blog')}
              />
            </Suspense>
          </div>
        )}

        {/* Galería Tab (álbumes de fotos, cada uno un link de salida a Drive/Photos) */}
        {activeTab === 'galeria' && (
          <div className="fade-in">
            <Suspense fallback={cargandoTab}>
              <AdminGaleriaTab
                uploadImage={(f) => SupabaseService.uploadImage(f, 'gallery')}
              />
            </Suspense>
          </div>
        )}

        {/* Standings Tab */}
        {activeTab === 'standings' && (
          <div className="fade-in">
            <Suspense fallback={cargandoTab}>
              <AdminStandingsTab
                standings={standings}
                onSave={saveStanding}
                onDelete={removeStanding}
              />
            </Suspense>
          </div>
        )}

        {/* Torneos Tab (gestor de torneos con sync local-first a Supabase; lazy, ver import) */}
        {activeTab === 'torneos' && (
          <div className="fade-in">
            <Suspense fallback={<div className="text-navy-500 text-sm py-8 text-center">Cargando gestor de torneos…</div>}>
              <AdminTorneosTab avisar={avisarTorneos} />
            </Suspense>
          </div>
        )}

        {/* Product editor global: se abre desde Productos y desde Stock & Alertas */}
        {productModal && (
          <Suspense fallback={null}>
            <ProductEditor
              product={editingProduct}
              categories={categories}
              uploadImage={(f) => SupabaseService.uploadImage(f, 'products')}
              onClose={() => { setProductModal(false); setEditingProduct(null); }}
              onSave={(p) => {
                saveProduct(p);
                setProductModal(false);
                setEditingProduct(null);
              }}
            />
          </Suspense>
        )}

        {deleteConfirm && (
          <ConfirmDialog
            title="¿Eliminar producto?"
            message="Se borra de la tienda y del catálogo. Esta acción no se puede deshacer."
            onCancel={() => setDeleteConfirm(null)}
            onConfirm={async () => {
              // Pre-check: sesión vencida → no borrar ni local ni nube, avisar claro
              // (mismo criterio que el guardado en ProductEditor).
              if (await sesionAdminVencida()) {
                setDeleteConfirm(null);
                toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar. El producto NO se eliminó.');
                return;
              }
              removeProduct(deleteConfirm);
              setDeleteConfirm(null);
              toast.success('Producto eliminado');
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── StatusBadge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Order['status'] }) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    confirmed: 'bg-blue-100 text-blue-700',
    shipped: 'bg-purple-100 text-purple-700',
    delivered: 'bg-green-100 text-green-700',
  };
  const labels: Record<string, string> = {
    pending: 'Pendiente',
    confirmed: 'Confirmado',
    shipped: 'Enviado',
    delivered: 'Entregado',
  };
  return (
    <span className={`text-xs font-bold px-2 py-1 rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ─── ConfirmDialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ title, message, onCancel, onConfirm }: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="font-display text-lg font-bold text-navy-700 mb-2">{title}</h3>
        <p className="text-gray-500 text-sm mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-navy-700 font-display font-semibold py-2 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white font-display font-semibold py-2 rounded-lg transition-colors"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── InscriptosModal ─────────────────────────────────────────────────────────

/** Lista de inscriptos de un evento, con cambio de estado y WhatsApp directo. */
function InscriptosModal({ event, onClose }: { event: Event; onClose: () => void }) {
  const [filas, setFilas] = useState<Inscripcion[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [cambiando, setCambiando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const data = await SupabaseService.getInscripciones(event.id);
    if (data === null) setFallo(true);
    else { setFallo(false); setFilas(data); }
  }, [event.id]);

  useEffect(() => { void cargar(); }, [cargar]);

  const cambiarEstado = async (id: string, estado: Inscripcion['estado']) => {
    if (cambiando) return;
    setCambiando(id);
    try {
      const ok = await SupabaseService.setEstadoInscripcion(id, estado);
      if (!ok) { toast.error('No se pudo actualizar. Verificá tu sesión.'); return; }
      await cargar();
    } finally {
      setCambiando(null);
    }
  };

  const activos = (filas ?? []).filter(f => f.estado !== 'baja');
  const bajas = (filas ?? []).filter(f => f.estado === 'baja');
  const ESTADO_CHIP: Record<Inscripcion['estado'], string> = {
    pendiente: 'bg-amber-50 text-amber-700',
    confirmada: 'bg-green-50 text-green-700',
    baja: 'bg-gray-100 text-gray-500',
  };

  const fila = (i: Inscripcion) => (
    <div key={i.id} className={`rounded-xl border border-gray-100 p-3 ${i.estado === 'baja' ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display font-bold text-navy-700">{i.nombre}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO_CHIP[i.estado]}`}>{i.estado}</span>
        {i.duprId && <span className="rounded-full bg-navy-700/10 px-2 py-0.5 text-[11px] font-bold text-navy-700">DUPR {i.duprId}</span>}
      </div>
      <p className="mt-1 text-sm text-gray-600">{i.categorias}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-gray-400">
        {waUruguay(i.celular) ? (
          <a href={`https://wa.me/${waUruguay(i.celular)}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-lime-800 hover:underline">
            {i.celular}
          </a>
        ) : <span>{i.celular}</span>}
        {i.email && <span>{i.email}</span>}
        {i.pareja && <span>pareja: {i.pareja}</span>}
        <span>{new Date(i.createdAt).toLocaleString('es-UY', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Montevideo' })}</span>
      </div>
      {i.notas && <p className="mt-1 text-xs italic text-gray-500">"{i.notas}"</p>}
      <div className="mt-2 flex gap-2">
        {i.estado !== 'confirmada' && (
          <button onClick={() => void cambiarEstado(i.id, 'confirmada')} disabled={cambiando !== null}
            className="rounded-lg bg-green-50 px-3 py-1 text-xs font-bold text-green-700 hover:bg-green-100 disabled:opacity-50">
            {cambiando === i.id ? '…' : 'Confirmar'}
          </button>
        )}
        {i.estado !== 'pendiente' && (
          <button onClick={() => void cambiarEstado(i.id, 'pendiente')} disabled={cambiando !== null}
            className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
            A pendiente
          </button>
        )}
        {i.estado !== 'baja' && (
          <button onClick={() => void cambiarEstado(i.id, 'baja')} disabled={cambiando !== null}
            className="rounded-lg bg-gray-100 px-3 py-1 text-xs font-bold text-gray-500 hover:bg-gray-200 disabled:opacity-50">
            Dar de baja
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h2 className="font-display text-lg font-bold text-navy-700">
            Inscriptos — {event.name}{filas ? ` (${activos.length})` : ''}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-navy-700"><X size={20} /></button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {fallo && <p className="py-8 text-center text-sm text-gray-400">No se pudieron cargar. Verificá tu sesión de admin.</p>}
          {!fallo && filas === null && <p className="py-8 text-center text-sm text-gray-400">Cargando…</p>}
          {filas !== null && filas.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">Todavía no hay inscriptos. Compartí el link: volea.vercel.app/#/inscripcion/{event.id}</p>
          )}
          {activos.map(fila)}
          {bajas.length > 0 && (
            <>
              <p className="pt-2 text-xs font-bold uppercase tracking-wide text-gray-400">Bajas ({bajas.length})</p>
              {bajas.map(fila)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── EventModal ──────────────────────────────────────────────────────────────

function EventModal({
  event, uploadImage, onClose, onSave
}: {
  event: Event | null;
  uploadImage: (f: File) => Promise<string | null>;
  onClose: () => void;
  onSave: (e: Event) => void;
}) {
  const [form, setForm] = useState<Event>(
    event || {
      id: `evt-${Date.now()}`,
      name: '',
      date: '',
      time: '',
      location: '',
      city: '',
      description: '',
      imageUrl: '',
      mapsUrl: '',
      maxParticipants: undefined,
      status: 'upcoming',
      category: 'tournament',
      phone: '',
      inscripcionesAbiertas: false,
      categorias: '',
    }
  );
  const [subiendo, setSubiendo] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  // Subir el flyer desde el celular: antes solo se podía pegar una URL, que en la
  // práctica significaba no poder poner la imagen.
  const handleArchivo = async (file: File | undefined) => {
    if (!file || subiendo) return;
    setSubiendo(true);
    try {
      const url = await uploadImage(file);
      if (!url) {
        toast.error('No se pudo subir la imagen. Verificá tu sesión de admin.');
        return;
      }
      setForm(f => ({ ...f, imageUrl: url }));
      toast.success('Imagen subida ✓');
    } catch (err) {
      console.error('Error subiendo imagen del evento:', err);
      toast.error('No se pudo subir la imagen. Probá de nuevo.');
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {event ? 'Editar Evento' : 'Nuevo Evento'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy-700 transition-colors">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Nombre *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Fecha *</label>
              <input
                type="date"
                required
                value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Último día</label>
              <input
                type="date"
                min={form.date || undefined}
                value={form.endDate || ''}
                onChange={e => setForm({ ...form, endDate: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
              <p className="mt-1 text-[11px] text-gray-400">Solo si dura varios días.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Hora</label>
              <input
                type="time"
                value={form.time}
                onChange={e => setForm({ ...form, time: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Lugar *</label>
              <input
                type="text"
                required
                value={form.location}
                onChange={e => setForm({ ...form, location: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Ciudad *</label>
              <input
                type="text"
                required
                value={form.city}
                onChange={e => setForm({ ...form, city: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Descripción</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Imagen / flyer</label>
            <div className="flex items-center gap-3">
              {form.imageUrl && (
                <img src={form.imageUrl} alt="" className="h-20 w-20 flex-shrink-0 rounded-lg border border-gray-200 object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-navy-700 transition-colors hover:border-lime-400">
                  {subiendo ? 'Subiendo…' : form.imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={subiendo}
                    onChange={e => { void handleArchivo(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
                <input
                  type="text"
                  placeholder="…o pegá una URL"
                  value={form.imageUrl}
                  onChange={e => setForm({ ...form, imageUrl: e.target.value })}
                  className="mt-2 w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors text-sm"
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Teléfono de inscripciones</label>
              <input
                type="text"
                placeholder="092 103 276"
                value={form.phone || ''}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
              <p className="mt-1 text-[11px] text-gray-400">Arma el botón de WhatsApp en la home.</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">URL Maps</label>
              <input
                type="text"
                value={form.mapsUrl}
                onChange={e => setForm({ ...form, mapsUrl: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Máx. Participantes</label>
              <input
                type="number"
                min={0}
                value={form.maxParticipants || ''}
                onChange={e => setForm({ ...form, maxParticipants: e.target.value ? Number(e.target.value) : undefined })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Estado</label>
              <select
                value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value as Event['status'] })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors bg-white"
              >
                <option value="upcoming">Próximo</option>
                <option value="past">Pasado</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Categoría</label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value as Event['category'] })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors bg-white"
              >
                <option value="tournament">Torneo</option>
                <option value="clinic">Clínica</option>
                <option value="social">Social</option>
              </select>
            </div>
          </div>

          {/* Inscripción online */}
          <div className="rounded-xl border border-gray-200 p-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.inscripcionesAbiertas === true}
                onChange={e => setForm({ ...form, inscripcionesAbiertas: e.target.checked })}
                className="accent-lime-500 w-4 h-4"
              />
              <span className="text-sm font-semibold text-navy-700">Inscripción online abierta</span>
            </label>
            {form.inscripcionesAbiertas && (
              <div>
                <label className="block text-sm font-semibold text-navy-700 mb-1">Categorías (separadas por coma)</label>
                <textarea
                  rows={2}
                  placeholder="Singles A,Singles B,Doble Mixto A,…"
                  value={form.categorias || ''}
                  onChange={e => setForm({ ...form, categorias: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors resize-none text-sm"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  Se muestran como botones en el formulario. Vacío = campo de texto libre.
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-navy-700 font-display font-semibold py-3 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Save size={18} /> Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── ClubModal ───────────────────────────────────────────────────────────────

function ClubModal({
  club, onClose, onSave
}: {
  club: Club | null;
  onClose: () => void;
  onSave: (c: Club) => void;
}) {
  const [form, setForm] = useState<Club>(
    club || {
      id: `club-${Date.now()}`,
      name: '',
      address: '',
      city: '',
      country: 'Uruguay',
      lat: -34.9,
      lng: -56.2,
      phone: '',
      instagram: '',
      hasPickleball: true,
      description: '',
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {club ? 'Editar Club' : 'Nuevo Club'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy-700 transition-colors">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Nombre *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Dirección *</label>
            <input
              type="text"
              required
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Ciudad *</label>
              <input
                type="text"
                required
                value={form.city}
                onChange={e => setForm({ ...form, city: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">País *</label>
              <select
                value={form.country}
                onChange={e => setForm({ ...form, country: e.target.value as 'Uruguay' | 'Argentina' | 'Chile' | 'Brasil' })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors bg-white"
              >
                <option value="Uruguay">🇺🇾 Uruguay</option>
                <option value="Argentina">🇦🇷 Argentina</option>
                <option value="Chile">🇨🇱 Chile</option>
                <option value="Brasil">🇧🇷 Brasil</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Latitud *</label>
              <input
                type="number"
                step="any"
                required
                value={form.lat}
                onChange={e => setForm({ ...form, lat: Number(e.target.value) })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Longitud *</label>
              <input
                type="number"
                step="any"
                required
                value={form.lng}
                onChange={e => setForm({ ...form, lng: Number(e.target.value) })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Teléfono</label>
              <input
                type="text"
                value={form.phone || ''}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Instagram</label>
              <input
                type="text"
                value={form.instagram || ''}
                onChange={e => setForm({ ...form, instagram: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
                placeholder="sin @"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Descripción</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors resize-none"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.hasPickleball}
              onChange={e => setForm({ ...form, hasPickleball: e.target.checked })}
              className="w-4 h-4 text-lime-400 border-gray-300 rounded focus:ring-lime-400"
            />
            <span className="text-sm font-semibold text-navy-700">Tiene canchas de pickleball</span>
          </label>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-navy-700 font-display font-semibold py-3 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Save size={18} /> Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── AnnouncementModal ───────────────────────────────────────────────────────

function AnnouncementModal({
  announcement, onClose, onSave
}: {
  announcement: Announcement | null;
  onClose: () => void;
  onSave: (a: Announcement) => void;
}) {
  const [form, setForm] = useState<Announcement>(
    announcement || {
      id: `ann-${Date.now()}`,
      title: '',
      content: '',
      type: 'info',
      active: true,
      createdAt: new Date().toISOString().split('T')[0],
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {announcement ? 'Editar Anuncio' : 'Nuevo Anuncio'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy-700 transition-colors">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Título *</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Contenido *</label>
            <textarea
              rows={4}
              required
              value={form.content}
              onChange={e => setForm({ ...form, content: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Tipo</label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value as Announcement['type'] })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors bg-white"
              >
                <option value="info">Información</option>
                <option value="promo">Promoción</option>
                <option value="event">Evento</option>
                <option value="important">Importante</option>
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={e => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4 text-lime-400 border-gray-300 rounded focus:ring-lime-400"
                />
                <span className="text-sm font-semibold text-navy-700">Activo</span>
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-navy-700 font-display font-semibold py-3 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Save size={18} /> Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── 14. NotFoundPage ────────────────────────────────────────────────────────

function NotFoundPage() {
  usePageMeta({
    title: 'Página no encontrada',
    description: 'La página que buscás no existe. Volvé al inicio para seguir navegando la tienda VOLEA.',
  });
  return (
    <div className="fade-in min-h-[60vh] flex flex-col items-center justify-center px-4">
      <h1 className="font-display text-8xl font-black text-navy-700 mb-4">404</h1>
      <p className="font-display text-xl text-gray-500 mb-8">Esta página se fue afuera de la cancha</p>
      <Link
        to="/"
        className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors"
      >
        <Home size={18} /> Volver al inicio
      </Link>
    </div>
  );
}

// ─── 15. FloatingWhatsApp ────────────────────────────────────────────────────

function FloatingWhatsApp() {
  return (
    <a
      href={`https://wa.me/${WHATSAPP_NUMBER}`}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-green-500 hover:bg-green-600 rounded-full shadow-lg flex items-center justify-center text-white transition-all hover:scale-110"
      aria-label="WhatsApp"
    >
      <MessageCircle size={28} />
    </a>
  );
}

// ─── 15b. Barra de admin persistente ─────────────────────────────────────────
// Pedido de Brian (2026-08-05): seguir viendo el menú de admin mientras navega la
// web pública. Con sesión de admin y FUERA de /admin, aparece una píldora fija
// abajo a la IZQUIERDA (la derecha es del botón de WhatsApp) que expande accesos
// directos a las pestañas más usadas. Cada acceso deja la pestaña destino en
// sessionStorage y navega a /admin, que la lee al montar (ver activeTab).
const ATAJO_TAB_ADMIN = 'volea_admin_tab';

function BarraAdmin() {
  const { isAdmin } = useStore();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [abierta, setAbierta] = useState(false);

  // cerrar el menú al navegar (si quedó abierto en la página anterior)
  useEffect(() => { setAbierta(false); }, [pathname]);

  if (!isAdmin || pathname.startsWith('/admin')) return null;

  const irA = (tab: string) => {
    sessionStorage.setItem(ATAJO_TAB_ADMIN, tab);
    setAbierta(false);
    navigate('/admin');
  };

  const atajos: { tab: string; label: string; icon: React.ReactNode }[] = [
    { tab: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={16} /> },
    { tab: 'products', label: 'Productos', icon: <Package size={16} /> },
    { tab: 'orders', label: 'Pedidos', icon: <ShoppingCart size={16} /> },
    { tab: 'torneos', label: 'Torneos', icon: <Trophy size={16} /> },
    { tab: 'galeria', label: 'Galería', icon: <Images size={16} /> },
    { tab: 'blog', label: 'Blog', icon: <Newspaper size={16} /> },
  ];

  return (
    <div className="fixed bottom-6 left-4 z-40 flex flex-col-reverse items-start gap-2">
      <button
        onClick={() => setAbierta(a => !a)}
        aria-expanded={abierta}
        className="flex items-center gap-2 bg-navy-700 hover:bg-navy-800 text-white border-2 border-lime-400 font-display font-bold text-sm py-2.5 px-4 rounded-full shadow-lg transition-all hover:scale-105"
      >
        <Settings size={16} className="text-lime-400" /> Admin
        <ChevronDown size={14} className={`transition-transform ${abierta ? '' : 'rotate-180'}`} />
      </button>
      {abierta && (
        <div className="bg-navy-700 border border-navy-600 rounded-2xl shadow-2xl p-2 flex flex-col gap-1 min-w-[180px]">
          {atajos.map(a => (
            <button
              key={a.tab}
              onClick={() => irA(a.tab)}
              className="flex items-center gap-3 text-white hover:bg-navy-800 hover:text-lime-400 font-display font-semibold text-sm py-2 px-3 rounded-lg transition-colors text-left"
            >
              <span className="text-lime-400">{a.icon}</span> {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 16. Footer ──────────────────────────────────────────────────────────────

function Footer() {
  const { categories } = useStore();

  return (
    <footer className="relative text-white">
      {/* Franja de fondo (sin backgroundAttachment: 'fixed': iOS lo ignora y en desktop fuerza repaints). */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(/products/lifestyle-sunset-back.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="absolute inset-0 bg-navy-900/95" />
      <div className="relative z-10 max-w-7xl mx-auto px-4 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Logo */}
          <div>
            <img src="/logo-white.png" alt="VOLEA" className="h-10 mb-4" onError={(e) => {
              e.currentTarget.style.display = 'none';
              const span = document.createElement('span');
              span.className = 'font-display text-3xl font-black text-lime-400';
              span.textContent = 'VOLEA';
              e.currentTarget.parentElement?.appendChild(span);
            }} />
            {/* gray-300, no gray-600: este párrafo va sobre el overlay navy-900/95 del footer
                (fondo azul casi negro, no blanco) — gray-600 era gris oscuro sobre oscuro,
                ilegible; gray-300 da ~13:1 sobre navy-900, sobrado para AA. */}
            <p className="text-gray-300 text-sm mt-4 leading-relaxed">
              La primera marca de indumentaria de pickleball de Uruguay. Evolucionamos distinto. Jugamos distinto.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-display font-bold text-lg mb-4">Links</h3>
            <ul className="space-y-2">
              {[
                { to: '/', label: 'Inicio' },
                { to: '/tienda', label: 'Tienda' },
                { to: '/eventos', label: 'Eventos' },
                { to: '/mapa', label: 'Mapa' },
                { to: '/contacto', label: 'Contacto' },
              ].map(link => (
                <li key={link.to}>
                  <Link to={link.to} className="text-gray-400 hover:text-lime-400 transition-colors text-sm">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h3 className="font-display font-bold text-lg mb-4">Categorías</h3>
            <ul className="space-y-2">
              {categories.sort((a, b) => a.sortOrder - b.sortOrder).map(cat => (
                <li key={cat.id}>
                  <Link
                    to={`/tienda?category=${encodeURIComponent(cat.id)}`}
                    className="text-gray-400 hover:text-lime-400 transition-colors text-sm"
                  >
                    {cat.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-display font-bold text-lg mb-4">Contacto</h3>
            <ul className="space-y-3">
              <li>
                <a
                  href={`https://wa.me/${WHATSAPP_NUMBER}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-gray-400 hover:text-lime-400 transition-colors text-sm"
                >
                  <Phone size={16} /> +598 99 511 196
                </a>
              </li>
              <li>
                <a
                  href={`https://instagram.com/${INSTAGRAM_HANDLE}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-gray-400 hover:text-lime-400 transition-colors text-sm"
                >
                  <Instagram size={16} /> @{INSTAGRAM_HANDLE}
                </a>
              </li>
              <li className="flex items-center gap-2 text-gray-400 text-sm">
                <Mail size={16} /> info@volea.uy
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-navy-600 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-gray-500 text-sm">
            &copy; 2026 VOLEA. La primera marca de pickleball de Uruguay.
          </p>
          <div className="flex items-center gap-4">
            <a
              href={`https://instagram.com/${INSTAGRAM_HANDLE}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram de VOLEA"
              className="text-gray-400 hover:text-lime-400 transition-colors"
            >
              <Instagram size={20} />
            </a>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp de VOLEA"
              className="text-gray-400 hover:text-lime-400 transition-colors"
            >
              <MessageCircle size={20} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── 17. Main App Component ──────────────────────────────────────────────────

// Wrappers: conectan las páginas nuevas (componentes puros) con el store.
// Placeholder para el hueco entre que la web se muestra (techo de 4s) y que llegan los
// datos: sin esto, estas páginas afirman "no hay nada" cuando la verdad es "todavía no
// llegó". Va en los wrappers y no adentro de las páginas para no cambiarles la firma.
function SeccionCargando({ texto }: { texto: string }) {
  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center text-gray-400">
      <Loader2 size={48} className="mx-auto mb-4 animate-spin" />
      <p className="font-display text-lg">{texto}</p>
    </div>
  );
}

function BlogListRoute() {
  const { posts, datosListos } = useStore();
  usePageMeta({
    title: 'Blog',
    description: 'Novedades del pickleball en Uruguay, la comunidad y todo lo que pasa en VOLEA.',
  });
  if (!datosListos && posts.length === 0) return <SeccionCargando texto="Cargando el blog…" />;
  return <BlogListPage posts={posts} />;
}
function BlogPostRoute() {
  const { posts, datosListos } = useStore();
  const { slug } = useParams<{ slug: string }>();
  const post = posts.find(p => p.published && p.slug === slug);
  usePageMeta({
    title: post ? post.title : 'Publicación no encontrada',
    description: post?.excerpt,
    image: post?.coverUrl,
  });
  if (!post && !datosListos) return <SeccionCargando texto="Cargando la publicación…" />;
  return <BlogPostPage posts={posts} />;
}
function StandingsRoute() {
  const { standings, datosListos } = useStore();
  usePageMeta({
    title: 'Clasificación — Camino al Mundial',
    description: 'Ranking de jugadores de pickleball rumbo al Mundial, actualizado por el equipo VOLEA después de cada torneo.',
  });
  if (!datosListos && standings.length === 0) return <SeccionCargando texto="Cargando la clasificación…" />;
  return <StandingsPage standings={standings} />;
}

// Torneos online (Etapa 2, público): ranking VOLEA + lista de torneos + detalle en vivo.
// Cada wrapper llama usePageMeta acá (mismo patrón que los de arriba) y suspende el chunk
// lazy con un fallback en clases Tailwind (torneos.css todavía no cargó en ese instante).
function TorneosCargando() {
  return <div className="max-w-5xl mx-auto px-4 py-16 text-center text-navy-500 text-sm">Cargando…</div>;
}
function RankingRoute() {
  usePageMeta({
    title: 'Ranking',
    description: 'Ranking oficial de pickleball de VOLEA Uruguay: puntos por torneo, categorías A y B, actualizado después de cada fecha.',
  });
  return (
    <Suspense fallback={<TorneosCargando />}>
      <RankingPageLazy />
    </Suspense>
  );
}
function TorneosListaRoute() {
  usePageMeta({
    title: 'Torneos',
    description: 'Torneos de pickleball organizados por VOLEA en Uruguay: grupos, llaves y resultados.',
  });
  return (
    <Suspense fallback={<TorneosCargando />}>
      <TorneosListaPageLazy />
    </Suspense>
  );
}
function TorneoDetalleRoute() {
  const [nombre, setNombre] = useState<string | undefined>(undefined);
  usePageMeta({
    title: nombre ?? 'Torneo',
    description: 'Resultados en vivo del torneo: grupos, llave y podio. VOLEA pickleball Uruguay.',
  });
  return (
    <Suspense fallback={<TorneosCargando />}>
      <TorneoDetallePageLazy onNombre={setNombre} />
    </Suspense>
  );
}

// Galería (público): álbumes de fotos de torneos, cada uno un link de salida a un Google
// Drive/Photos externo. Mismo patrón que los wrappers de arriba (usePageMeta acá, Suspense
// alrededor del chunk lazy) pero con fallback en Tailwind (SeccionCargando) en vez de
// TorneosCargando: la Galería no es parte del motor de torneos, es una página del sitio
// principal con su propio módulo de datos (src/galeria/datos.ts).
function GaleriaRoute() {
  usePageMeta({
    title: 'Galería',
    description: 'Álbumes de fotos de los torneos VOLEA: elegí un torneo y mirá las fotos en Google Drive o Google Photos.',
  });
  return (
    <Suspense fallback={<SeccionCargando texto="Cargando la galería…" />}>
      <GaleriaPageLazy />
    </Suspense>
  );
}

// Resultado del pago (público): aterrizaje de la vuelta de Mercado Pago. Mismo patrón que
// los wrappers de arriba (usePageMeta acá, Suspense alrededor del chunk lazy), pero además
// lee clearCart del store y se lo pasa como prop a la página lazy — useStore no está
// exportado de este archivo y ninguna página lazy lo importa directo, así que el wrapper es
// quien conecta el store con el chunk.
function ResultadoPagoRoute() {
  const { clearCart } = useStore();
  usePageMeta({ title: 'Resultado del pago', description: 'Resultado de tu pago con Mercado Pago.' });
  return (
    <Suspense fallback={<SeccionCargando texto="Cargando el resultado…" />}>
      <ResultadoPagoPageLazy clearCart={clearCart} />
    </Suspense>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  // Sin AnimatePresence: con framer-motion 12 + React 19, mode="wait" deja la
  // animación de salida colgada y la ruta nueva nunca monta (navegación rota).
  // El key en Routes fuerza remount por ruta, así cada página repite su fade-in.
  return (
    <Routes location={location} key={location.pathname}>
      <Route path="/" element={<PageTransition><HomePage /></PageTransition>} />
      <Route path="/tienda" element={<PageTransition><ShopPage /></PageTransition>} />
      <Route path="/producto/:id" element={<PageTransition><ProductDetailPage /></PageTransition>} />
      <Route path="/blog" element={<PageTransition><BlogListRoute /></PageTransition>} />
      <Route path="/blog/:slug" element={<PageTransition><BlogPostRoute /></PageTransition>} />
      <Route path="/clasificacion" element={<PageTransition><StandingsRoute /></PageTransition>} />
      <Route path="/ranking" element={<PageTransition><RankingRoute /></PageTransition>} />
      <Route path="/galeria" element={<PageTransition><GaleriaRoute /></PageTransition>} />
      <Route path="/torneos" element={<PageTransition><TorneosListaRoute /></PageTransition>} />
      <Route path="/torneos/:id" element={<PageTransition><TorneoDetalleRoute /></PageTransition>} />
      <Route path="/eventos" element={<PageTransition><EventsPage /></PageTransition>} />
      <Route path="/inscripcion/:eventId" element={<PageTransition><InscripcionPage /></PageTransition>} />
      <Route path="/mapa" element={<PageTransition><MapPage /></PageTransition>} />
      <Route path="/contacto" element={<PageTransition><ContactPage /></PageTransition>} />
      <Route path="/checkout" element={<PageTransition><CheckoutPage /></PageTransition>} />
      <Route path="/pago/resultado" element={<PageTransition><ResultadoPagoRoute /></PageTransition>} />
      <Route path="/admin" element={<PageTransition><AdminPage /></PageTransition>} />
      <Route path="*" element={<PageTransition><NotFoundPage /></PageTransition>} />
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <StoreProvider>
        <ScrollToTop />
        <Toaster
          position="bottom-right"
          theme="dark"
          richColors
          toastOptions={{
            style: {
              background: '#001F3F',
              color: '#fff',
              border: '1px solid #ccff00',
            },
          }}
        />
        <div className="flex flex-col min-h-screen">
          <TopBar />
          <Navbar />
          <CartDrawer />
          <main className="flex-1">
            <AnimatedRoutes />
          </main>
          <Footer />
          <FloatingWhatsApp />
          <BarraAdmin />
        </div>
      </StoreProvider>
    </HashRouter>
  );
}
