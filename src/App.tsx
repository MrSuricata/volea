import React, { createContext, useContext, useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion, useScroll, useTransform, type Variants } from 'framer-motion';
import {
  ShoppingCart, Menu, X, Search, Star, MapPin, Calendar, Phone, Mail, Instagram,
  MessageCircle, ChevronRight, ChevronLeft, Plus, Minus, Trash2, Edit, Package,
  Users, BarChart3, Tag, ArrowRight, Heart, Shield, Zap, Trophy, Eye, Filter,
  SortAsc, ExternalLink, Check, AlertCircle, Home, Store, CalendarDays, Settings,
  LogOut, ChevronDown, Upload, Image as ImageIcon, Save, XCircle, Map, Megaphone,
  Globe, Navigation, Newspaper, Wallet
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import type { Product, CartItem, Event, Order, CustomerInfo, Category, ProductColor, Club, Announcement, Post, StandingEntry } from './types';
import {
  WHATSAPP_NUMBER, INSTAGRAM_HANDLE, ADMIN_PASSWORD,
  INITIAL_EVENTS, INITIAL_CLUBS, INITIAL_ANNOUNCEMENTS
} from './constants';
import { StorageService } from './services/storageService';
import { SupabaseService } from './services/supabaseService';
import { isSupabaseConnected, supabaseReady } from './services/supabaseClient';
import {
  sendMagicLink,
  signInWithPassword,
  getCurrentAdmin,
  onAuthStateChange,
  signOut as authSignOut,
  type AdminUser,
} from './services/authService';
// Snapshot legacy de Shopify: solo como fallback si Supabase está caído.
import { getProductsAsInternal, getCategoriesAsInternal } from './services/shopifyService';
import { BlogListPage, BlogPostPage } from './components/BlogPages';
import { StandingsPage } from './components/StandingsPage';
import { AdminBlogTab } from './components/AdminBlogTab';
import { AdminCajaTab } from './components/AdminCajaTab';
import { AdminSociosTab } from './components/AdminSociosTab';
import { AdminOrderModal } from './components/AdminOrderModal';
import { AdminStandingsTab } from './components/AdminStandingsTab';
import { ProductEditor } from './components/ProductEditor';
// NOTA sobre './torneos/cacheTorneos': no se importa arriba a proposito (ver logout, mas
// abajo, que lo importa dinamicamente). Es un modulo hoja sin imports de React/Supabase/el
// hook, pero aun un import ESTATICO de una sola constante desde aca alcanzaria para que
// quede en el chunk de entrada; con dynamic import ni siquiera eso - se pide solo al cerrar
// sesion. Importar cualquier cosa de useSyncTorneos.ts aca (no solo de cacheTorneos.ts)
// seria mucho peor: arrastra el hook entero (supabase, mergeTorneos, etc.) de vuelta al
// chunk de entrada y rompe el split lazy de AdminTorneosTab de abajo.

// Gestor de torneos: ~42 KB gzip que solo usa el admin. Lazy para que la tienda publica
// (critical path) no lo cargue nunca; el chunk se pide recien al entrar a la pestaña Torneos.
const AdminTorneosTab = lazy(() =>
  import('./components/AdminTorneosTab').then((m) => ({ default: m.AdminTorneosTab })),
);
// Paginas publicas de Torneos (Etapa 2): mismo motivo que AdminTorneosTab arriba - cargan
// el motor de torneos + torneos.css (.rk) que la tienda publica (critical path) no
// necesita. Se piden recien cuando alguien navega a /ranking, /torneos o /torneos/:id.
const RankingPageLazy = lazy(() => import('./torneos/publico/RankingPage'));
const TorneosListaPageLazy = lazy(() => import('./torneos/publico/TorneosListaPage'));
const TorneoDetallePageLazy = lazy(() => import('./torneos/publico/TorneoDetallePage'));
// Callback estable (identidad fija entre renders): si fuera una arrow function inline en el
// JSX, cambiaria de identidad en cada render de AdminPage, lo que tira abajo useSyncTorneos'
// avisarLimitado -> push -> pull (todos useCallback encadenados) y dispara el effect de
// persistencia de cache de nuevo aunque `cache` no haya cambiado (JSON.stringify + write a
// localStorage en cada render del admin, no solo cuando hay algo que sincronizar).
const avisarTorneos = (mensaje: string) => toast.error(mensaje);

// ─── 1. Utility Functions ────────────────────────────────────────────────────

const formatPrice = (price: number): string => `$ ${price.toLocaleString('es-UY')}`;

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
  orders: Order[];
  setOrders: (o: Order[]) => void;
  addOrder: (o: Order) => void;
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

function StoreProvider({ children }: { children: React.ReactNode }) {
  const [products, _setProducts] = useState<Product[]>([]);
  const [events, _setEvents] = useState<Event[]>([]);
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
    (async () => {
      await supabaseReady;
      const admin = await getCurrentAdmin();
      if (!mounted) return;
      if (admin) {
        setCurrentAdmin(admin);
        setIsAdmin(true);
      } else if (isSupabaseConnected()) {
        // Supabase sano pero sin sesión real: el flag legacy de password no vale.
        sessionStorage.removeItem('volea_admin');
        setIsAdmin(false);
      }
    })();
    const unsub = onAuthStateChange((admin) => {
      if (!mounted) return;
      setCurrentAdmin(admin);
      if (admin) setIsAdmin(true);
      else if (isSupabaseConnected()) setIsAdmin(false); // sesión expirada/revocada
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
      // Wait for Supabase health probe (max 2.5s); falls back on failure.
      await supabaseReady;

      // Supabase es la fuente de verdad de todo. Fallback: snapshot legacy para
      // productos/categorías y localStorage para el resto.
      let loadedProducts: Product[];
      if (isSupabaseConnected()) {
        const [p, c, e, o, cl, an, po, st] = await Promise.all([
          SupabaseService.getProducts(),
          SupabaseService.getCategories(),
          SupabaseService.getEvents(),
          SupabaseService.getOrders(),
          SupabaseService.getClubs(),
          SupabaseService.getAnnouncements(),
          SupabaseService.getPosts(),
          SupabaseService.getStandings(),
        ]);
        // null = fetch falló → snapshot legacy; [] = catálogo vacío a propósito.
        loadedProducts = p ?? getProductsAsInternal();
        _setProducts(loadedProducts);
        _setCategories(c ?? getCategoriesAsInternal());
        _setEvents(e.length ? e : INITIAL_EVENTS);
        _setOrders(o);
        _setClubs(cl.length ? cl : INITIAL_CLUBS);
        _setAnnouncements(an.length ? an : INITIAL_ANNOUNCEMENTS);
        _setPosts(po);
        _setStandings(st);
      } else {
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

  // Aviso genérico cuando la nube rechaza una escritura (sin conexión, sesión
  // vencida, RLS). El cambio siempre quedó guardado en este dispositivo; el
  // aviso evita que se pierda "en silencio" sin llegar a la nube.
  const warnCloudFail = (ok: boolean) => {
    if (!ok) toast.error(
      '⚠️ No se pudo subir a la nube. El cambio quedó guardado solo en este dispositivo. Revisá tu conexión / que sigas con sesión de admin, y guardá de nuevo.',
      { duration: 9000 },
    );
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
  const addOrder = useCallback((order: Order) => {
    _setOrders(prev => {
      const next = [...prev, order];
      StorageService.setOrders(next);
      return next;
    });
    SupabaseService.addOrder(order);
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

  const login = useCallback((password: string) => {
    // Legacy fallback: only allowed when Supabase auth is unavailable
    if (isSupabaseConnected()) return false;
    if (password === ADMIN_PASSWORD) {
      setIsAdmin(true);
      sessionStorage.setItem('volea_admin', 'true');
      return true;
    }
    return false;
  }, []);

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
      products, setProducts, refreshProducts, saveProduct, removeProduct, events, setEvents, orders, setOrders, addOrder,
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
    { to: '/clasificacion', label: 'Clasificación' },
    { to: '/ranking', label: 'Ranking' },
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
        <div className="hidden md:flex items-center gap-5 lg:gap-7">
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
            className="md:hidden text-white hover:text-lime-400 transition-colors"
          >
            <Menu size={24} />
          </button>
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 md:hidden" style={{zIndex: 9999}}>
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 bg-navy-800 slide-in-left">
            <div className="flex items-center justify-between p-4 border-b border-navy-600">
              <img src="/logo.png" alt="VOLEA" className="h-8" onError={handleImgError} />
              <button onClick={() => setMobileOpen(false)} className="text-white hover:text-lime-400">
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
  const total = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);

  if (!cartOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={() => setCartOpen(false)} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl slide-in-right flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="font-display text-xl font-bold text-navy-700">Tu carrito</h2>
          <button onClick={() => setCartOpen(false)} className="text-navy-700 hover:text-red-500 transition-colors">
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
                className="mt-4 text-lime-500 hover:text-lime-600 font-semibold"
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
                      <button
                        onClick={() => updateCartQuantity(item.product.id, item.selectedSize, item.selectedColor, item.quantity + 1)}
                        className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-200 transition-colors"
                      >
                        <Plus size={14} />
                      </button>
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
              Coordinamos la entrega y el pago por WhatsApp.
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
  const totalStock = getTotalStock(product);
  const isNew = (Date.now() - new Date(product.createdAt).getTime()) < 30 * 24 * 60 * 60 * 1000;
  return (
    <Link to={`/producto/${product.id}`} className="product-card group block bg-white rounded-2xl overflow-hidden shadow-md border border-gray-100">
      <div className="relative aspect-square bg-gray-100 overflow-hidden">
        <img
          src={product.images[0] || FALLBACK_IMG}
          alt={product.name}
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
          {product.isOffer && (
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
          <span className="font-display font-bold text-lg text-navy-700">{formatPrice(product.price)}</span>
          {product.isOffer && product.originalPrice && (
            <span className="text-sm text-gray-400 line-through">{formatPrice(product.originalPrice)}</span>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-lime-600 font-semibold text-sm flex items-center gap-1 group-hover:gap-2 transition-all">
            Ver producto <ArrowRight size={14} />
          </span>
        </div>
      </div>
    </Link>
  );
}

// ─── 7. HomePage ─────────────────────────────────────────────────────────────

function HomePage() {
  const { products, categories, posts, standings, announcements } = useStore();
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

  const activeAnnouncements = announcements.filter(a => a.active);

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
      title: 'Coordinamos por WhatsApp',
      desc: 'Te escribimos para coordinar la entrega y el pago, simple y sin vueltas.',
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
                to="/clasificacion"
                className="inline-flex items-center justify-center gap-2 border-2 border-white/30 hover:border-lime-400 text-white hover:text-lime-400 font-display font-bold py-4 px-10 rounded-lg text-lg transition-colors"
              >
                <Trophy size={20} /> Camino al Mundial
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
        </motion.div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 text-white/50">
          <span className="text-xs font-body tracking-widest uppercase">Deslizá</span>
          <div className="w-5 h-8 border-2 border-white/30 rounded-full flex justify-center pt-1">
            <div className="w-1 h-2 bg-lime-400 rounded-full animate-bounce" />
          </div>
        </div>
      </section>

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
              Sin pago online: coordinamos entrega y pago por WhatsApp, con transferencia o efectivo.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── 3. Destacados ───────────────────────────────────────────────── */}
      <section className="py-20 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-lime-500 font-display font-bold text-sm uppercase tracking-[0.2em]">La selección de la casa</span>
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

      {/* ── 4. Categorías ───────────────────────────────────────────────── */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-lime-500 font-display font-bold text-sm uppercase tracking-[0.2em]">Encontrá lo tuyo</span>
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
                <span className="text-lime-500 font-display font-bold text-sm uppercase tracking-[0.2em]">Historias del deporte</span>
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
                      <span className="inline-flex items-center gap-1 text-lime-600 font-display font-bold text-sm mt-4">
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

      {/* ── 7. VOLEA en acción ──────────────────────────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-lime-500 font-display font-bold text-sm uppercase tracking-[0.2em]">Comunidad</span>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mt-2">VOLEA en acción</h2>
              <p className="text-gray-500 mt-4 max-w-xl mx-auto">
                Atardeceres, canchas y buena compañía: así se vive el pickleball con VOLEA puesta.
              </p>
              <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
            </div>
          </Reveal>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {[
              { src: '/products/lifestyle-sunset-front.jpg', span: 'md:row-span-2', height: 'h-64 md:h-full' },
              { src: '/products/lifestyle-sunset-2.jpg', span: '', height: 'h-48 md:h-64' },
              { src: '/products/lifestyle-sunset-3.jpg', span: '', height: 'h-48 md:h-64' },
              { src: '/products/lifestyle-sunset-4.jpg', span: '', height: 'h-48 md:h-64' },
              { src: '/products/lifestyle-sunset-back.jpg', span: '', height: 'h-48 md:h-64' },
            ].map((photo, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className={`gallery-item rounded-xl overflow-hidden ${photo.span} ${photo.height}`}>
                  <img
                    src={photo.src}
                    alt="Jugadores con indumentaria VOLEA en la cancha"
                    className="w-full h-full object-cover"
                    onError={handleImgError}
                  />
                  <div className="gallery-overlay flex items-end p-4">
                    <span className="text-white font-display font-bold text-sm flex items-center gap-1">
                      <Instagram size={14} /> @{INSTAGRAM_HANDLE}
                    </span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <div className="text-center mt-10">
              <a
                href={`https://instagram.com/${INSTAGRAM_HANDLE}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-display font-bold py-3 px-8 rounded-lg transition-transform hover:scale-105"
              >
                <Instagram size={20} /> Seguinos en @{INSTAGRAM_HANDLE}
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 8. Nuestra esencia + Equipo ─────────────────────────────────── */}
      <section
        className="relative py-24 overflow-hidden"
        style={{
          backgroundImage: 'url(/products/lifestyle-sunset-2.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
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
                  src="/products/7.png"
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
  const { products, categories, addToCart, setCartOpen } = useStore();
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
      if (product.sizes.length > 0) setSelectedSize(product.sizes[0]);
      if (product.colors.length > 0) setSelectedColor(product.colors[0].name);
      setMainImg(0);
      setQty(1);
      setAdded(false);
    }
  }, [product]);

  if (!product) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <AlertCircle size={64} className="mx-auto text-gray-300 mb-4" />
        <h1 className="font-display text-2xl font-bold text-navy-700 mb-4">Producto no encontrado</h1>
        <Link to="/tienda" className="text-lime-500 hover:text-lime-600 font-semibold">Volver a la tienda</Link>
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
                  <img src={img} alt="" className="w-full h-full object-cover" onError={handleImgError} />
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
          <div className="flex items-center gap-3 mb-6">
            <span className="font-display text-3xl font-bold text-navy-700">{formatPrice(product.price)}</span>
            {product.isOffer && product.originalPrice && (
              <>
                <span className="text-lg text-gray-400 line-through">{formatPrice(product.originalPrice)}</span>
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                  -{Math.round((1 - product.price / product.originalPrice) * 100)}%
                </span>
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
  const { events } = useStore();
  const [filter, setFilter] = useState<string>('all');
  usePageMeta({
    title: 'Eventos y torneos de pickleball',
    description: 'Torneos, clínicas y encuentros de pickleball en Uruguay. Mirá el calendario y sumate al próximo evento VOLEA.',
  });

  const isEventPast = (event: Event) => {
    const eventDate = new Date(event.date);
    return eventDate < new Date();
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
                    <p className="flex items-center gap-2"><Calendar size={14} /> {new Date(evt.date).toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' })} - {evt.time}hs</p>
                    <p className="flex items-center gap-2"><MapPin size={14} /> {evt.location}, {evt.city}</p>
                    {evt.maxParticipants && (
                      <p className="flex items-center gap-2"><Users size={14} /> Máx. {evt.maxParticipants} participantes</p>
                    )}
                  </div>
                  <p className="text-gray-500 text-sm line-clamp-2">{evt.description}</p>
                  {evt.mapsUrl && (
                    <a
                      href={evt.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-lime-600 font-semibold text-sm mt-3 hover:text-lime-700"
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
                    <p className="flex items-center gap-2"><Calendar size={14} /> {new Date(evt.date).toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    <p className="flex items-center gap-2"><MapPin size={14} /> {evt.location}, {evt.city}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
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
  const { clubs } = useStore();
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
                <p className="flex items-center gap-2"><Instagram size={14} className="flex-shrink-0" /> @{club.instagram}</p>
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
                className="inline-flex items-center gap-1 text-lime-600 font-semibold text-sm hover:text-lime-700 ml-auto"
              >
                Google Maps <ExternalLink size={14} />
              </a>
            </div>
          </div>
        ))}
      </div>

      {filteredClubs.length === 0 && (
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

// ─── 12. CheckoutPage ────────────────────────────────────────────────────────

function CheckoutPage() {
  const { cart, clearCart, addOrder } = useStore();
  usePageMeta({
    title: 'Finalizar pedido',
    description: 'Completá tus datos y enviá tu pedido: te contactamos por WhatsApp para coordinar la entrega y el pago.',
  });
  const [customer, setCustomer] = useState<CustomerInfo>({
    name: '', phone: '', email: '', address: '', city: '', department: 'Montevideo', notes: ''
  });
  const [success, setSuccess] = useState(false);

  const total = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);

  if (cart.length === 0 && !success) {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <ShoppingCart size={64} strokeWidth={1} className="mx-auto text-gray-300 mb-4" />
        <h1 className="font-display text-2xl font-bold text-navy-700 mb-4">Tu carrito está vacío</h1>
        <Link to="/tienda" className="text-lime-500 hover:text-lime-600 font-semibold inline-flex items-center gap-1">
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

  const handleSubmitWhatsApp = (e: React.FormEvent) => {
    e.preventDefault();
    // Última validación de stock antes de registrar el pedido
    const shortItem = cart.find(i => {
      const key = i.selectedColor ? `${i.selectedSize}|${i.selectedColor}` : i.selectedSize;
      return (i.product.stockBySize[key] || 0) < i.quantity;
    });
    if (shortItem) {
      toast.error(`No queda stock suficiente de ${shortItem.product.name} — ajustá la cantidad en el carrito.`);
      return;
    }
    const orderId = `VO-${Date.now().toString(36).toUpperCase()}`;
    const order: Order = {
      id: orderId,
      items: cart,
      customer,
      total,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    addOrder(order);

    // Build WhatsApp message
    const lines = [
      `🏓 *Nuevo pedido VOLEA*`,
      `📌 Ref: ${orderId}`,
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
      `💰 *Total: ${formatPrice(total)}*`,
      ``,
      `_¡Hola! Quiero coordinar la entrega y el pago de este pedido._`,
    ].filter(Boolean).join('\n');

    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines)}`;
    window.open(whatsappUrl, '_blank');
    clearCart();
    setSuccess(true);
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
            <div className="border-t border-gray-200 pt-4 flex justify-between items-center">
              <span className="font-display text-lg font-semibold">Total</span>
              <span className="font-display text-2xl font-bold text-navy-700">{formatPrice(total)}</span>
            </div>
          </div>

          {/* Cómo funciona */}
          <div className="mt-6 bg-gradient-to-br from-navy-700 to-navy-900 rounded-xl p-6 text-white">
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle size={18} className="text-lime-400" />
              <h3 className="font-display font-bold text-lg">Compra coordinada por WhatsApp</h3>
            </div>
            <p className="text-sm text-gray-300">
              Completá tus datos y tu pedido nos llega al instante. Te escribimos
              por WhatsApp para coordinar la entrega y el pago (transferencia,
              efectivo o el medio que te quede más cómodo).
            </p>
          </div>
        </div>

        {/* Customer Form for WhatsApp */}
        <div className="order-1 lg:order-2">
          <h2 className="font-display text-xl font-bold text-navy-700 mb-2">Completá tus datos</h2>
          <p className="text-sm text-gray-500 mb-4">Con esto armamos tu pedido y te contactamos por WhatsApp.</p>
          <form onSubmit={handleSubmitWhatsApp} className="space-y-4">
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
            <button
              type="submit"
              className="pulse-glow w-full bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <MessageCircle size={20} /> Enviar pedido por WhatsApp
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
                      <td className="px-4 py-2 font-medium text-navy-700">{v.size}</td>
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
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [loginError, setLoginError] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  // 'password' es el modo principal; el magic link queda como alternativa
  // (el SMTP built-in de Supabase tiene límite de ~2 mails/hora).
  const [authMode, setAuthMode] = useState<'password' | 'magiclink'>('password');
  const [signingIn, setSigningIn] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const useSupabaseAuth = isSupabaseConnected();

  // Product modal state
  const [productModal, setProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Event modal state
  const [eventModal, setEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [deleteEventConfirm, setDeleteEventConfirm] = useState<string | null>(null);

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
                className="text-lime-600 text-sm font-semibold hover:underline"
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
                className="w-full mt-3 text-lime-600 text-sm font-semibold hover:underline"
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
                className="w-full mt-3 text-lime-600 text-sm font-semibold hover:underline"
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
      <aside className={`fixed lg:static top-0 left-0 h-full z-50 w-64 bg-navy-800 text-white flex flex-col transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
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
        <div className="p-4 border-t border-navy-600">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-display text-sm font-semibold text-gray-300 hover:text-red-400 hover:bg-navy-700 transition-colors"
          >
            <LogOut size={18} /> Cerrar sesión
          </button>
        </div>
      </aside>

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
                        <td className="px-4 py-3">
                          <img src={p.images[0] || FALLBACK_IMG} alt={p.name} className="w-12 h-12 object-cover rounded-lg" onError={handleImgError} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono hidden sm:table-cell">{p.sku}</td>
                        <td className="px-4 py-3 font-display font-semibold text-navy-700 text-sm">{p.name}</td>
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
                        <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{new Date(evt.date).toLocaleDateString('es-UY')}</td>
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
              <AdminOrderModal
                products={products}
                onClose={() => setOrderModal(false)}
                onSave={(o) => {
                  addOrder(o);
                  setOrderModal(false);
                  setExpandedOrder(o.id);
                  toast.success(`Pedido ${o.id} creado`);
                }}
              />
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
            <AdminCajaTab
              loadLedger={loadLedger}
              loadLedgerFull={loadLedgerFull}
              revertEntry={revertLedgerEntry}
              loadSocioMoves={SupabaseService.getSocioMoves}
            />
          </div>
        )}

        {/* Socios Tab (cuentas entre socios + números del negocio) */}
        {activeTab === 'socios' && (
          <AdminSociosTab
            loadLedgerFull={loadLedgerFull}
            loadSocioMoves={SupabaseService.getSocioMoves}
            addSocioMove={SupabaseService.addSocioMove}
            deleteSocioMove={SupabaseService.deleteSocioMove}
            liquidarCaja={SupabaseService.liquidarCaja}
          />
        )}

        {/* Blog Tab */}
        {activeTab === 'blog' && (
          <div className="fade-in">
            <AdminBlogTab
              posts={posts}
              onSave={savePost}
              onDelete={removePost}
              uploadImage={(f) => SupabaseService.uploadImage(f, 'blog')}
            />
          </div>
        )}

        {/* Standings Tab */}
        {activeTab === 'standings' && (
          <div className="fade-in">
            <AdminStandingsTab
              standings={standings}
              onSave={saveStanding}
              onDelete={removeStanding}
            />
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
        )}

        {deleteConfirm && (
          <ConfirmDialog
            title="¿Eliminar producto?"
            message="Se borra de la tienda y del catálogo. Esta acción no se puede deshacer."
            onCancel={() => setDeleteConfirm(null)}
            onConfirm={() => {
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

// ─── EventModal ──────────────────────────────────────────────────────────────

function EventModal({
  event, onClose, onSave
}: {
  event: Event | null;
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">URL Imagen</label>
              <input
                type="text"
                value={form.imageUrl}
                onChange={e => setForm({ ...form, imageUrl: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
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

// ─── 16. Footer ──────────────────────────────────────────────────────────────

function Footer() {
  const { categories } = useStore();

  return (
    <footer className="relative text-white">
      {/* Parallax background strip */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(/products/lifestyle-sunset-back.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
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
            <p className="text-gray-400 text-sm mt-4 leading-relaxed">
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
              className="text-gray-400 hover:text-lime-400 transition-colors"
            >
              <Instagram size={20} />
            </a>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
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
function BlogListRoute() {
  const { posts } = useStore();
  usePageMeta({
    title: 'Blog',
    description: 'Novedades del pickleball en Uruguay, la comunidad y todo lo que pasa en VOLEA.',
  });
  return <BlogListPage posts={posts} />;
}
function BlogPostRoute() {
  const { posts } = useStore();
  const { slug } = useParams<{ slug: string }>();
  const post = posts.find(p => p.published && p.slug === slug);
  usePageMeta({
    title: post ? post.title : 'Publicación no encontrada',
    description: post?.excerpt,
    image: post?.coverUrl,
  });
  return <BlogPostPage posts={posts} />;
}
function StandingsRoute() {
  const { standings } = useStore();
  usePageMeta({
    title: 'Clasificación — Camino al Mundial',
    description: 'Ranking de jugadores de pickleball rumbo al Mundial, actualizado por el equipo VOLEA después de cada torneo.',
  });
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
      <Route path="/torneos" element={<PageTransition><TorneosListaRoute /></PageTransition>} />
      <Route path="/torneos/:id" element={<PageTransition><TorneoDetalleRoute /></PageTransition>} />
      <Route path="/eventos" element={<PageTransition><EventsPage /></PageTransition>} />
      <Route path="/mapa" element={<PageTransition><MapPage /></PageTransition>} />
      <Route path="/contacto" element={<PageTransition><ContactPage /></PageTransition>} />
      <Route path="/checkout" element={<PageTransition><CheckoutPage /></PageTransition>} />
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
        </div>
      </StoreProvider>
    </HashRouter>
  );
}
