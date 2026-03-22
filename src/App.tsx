import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ShoppingCart, Menu, X, Search, Star, MapPin, Calendar, Phone, Mail, Instagram,
  MessageCircle, ChevronRight, ChevronLeft, Plus, Minus, Trash2, Edit, Package,
  Users, BarChart3, Tag, ArrowRight, Heart, Shield, Zap, Trophy, Eye, Filter,
  SortAsc, ExternalLink, Check, AlertCircle, Home, Store, CalendarDays, Settings,
  LogOut, ChevronDown, Upload, Image as ImageIcon, Save, XCircle, Map, Megaphone,
  Globe, Navigation
} from 'lucide-react';
import type { Product, CartItem, Event, Order, CustomerInfo, Category, ProductColor, Club, Announcement } from './types';
import {
  WHATSAPP_NUMBER, INSTAGRAM_HANDLE, ADMIN_PASSWORD,
  INITIAL_CATEGORIES, INITIAL_PRODUCTS, INITIAL_EVENTS,
  INITIAL_CLUBS, INITIAL_ANNOUNCEMENTS
} from './constants';
import { StorageService } from './services/storageService';

// ─── 1. Utility Functions ────────────────────────────────────────────────────

const formatPrice = (price: number): string => `$ ${price.toLocaleString('es-UY')}`;

const getTotalStock = (product: Product): number =>
  Object.values(product.stockBySize).reduce((sum, qty) => sum + qty, 0);

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

// ─── 2b. Reveal (IntersectionObserver) ───────────────────────────────────────

function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${visible ? 'visible' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

// ─── 3. StoreContext & StoreProvider ─────────────────────────────────────────

interface StoreContextType {
  products: Product[];
  setProducts: (p: Product[]) => void;
  events: Event[];
  setEvents: (e: Event[]) => void;
  orders: Order[];
  setOrders: (o: Order[]) => void;
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
  login: (password: string) => boolean;
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
  const [cart, _setCart] = useState<CartItem[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ver = StorageService.getVersion();
    if (ver !== StorageService.currentVersion) {
      StorageService.clearAll();
      StorageService.setVersion();
      StorageService.setProducts(INITIAL_PRODUCTS);
      StorageService.setEvents(INITIAL_EVENTS);
      StorageService.setCategories(INITIAL_CATEGORIES);
      StorageService.setClubs(INITIAL_CLUBS);
      StorageService.setAnnouncements(INITIAL_ANNOUNCEMENTS);
      _setProducts(INITIAL_PRODUCTS);
      _setEvents(INITIAL_EVENTS);
      _setCategories(INITIAL_CATEGORIES);
      _setClubs(INITIAL_CLUBS);
      _setAnnouncements(INITIAL_ANNOUNCEMENTS);
      _setOrders([]);
      _setCart([]);
    } else {
      const p = StorageService.getProducts();
      const e = StorageService.getEvents();
      const c = StorageService.getCategories();
      const o = StorageService.getOrders();
      const ct = StorageService.getCart();
      const cl = StorageService.getClubs();
      const an = StorageService.getAnnouncements();
      _setProducts(p.length ? p : INITIAL_PRODUCTS);
      _setEvents(e.length ? e : INITIAL_EVENTS);
      _setCategories(c.length ? c : INITIAL_CATEGORIES);
      _setClubs(cl.length ? cl : INITIAL_CLUBS);
      _setAnnouncements(an.length ? an : INITIAL_ANNOUNCEMENTS);
      _setOrders(o);
      _setCart(ct);
      if (!p.length) StorageService.setProducts(INITIAL_PRODUCTS);
      if (!e.length) StorageService.setEvents(INITIAL_EVENTS);
      if (!c.length) StorageService.setCategories(INITIAL_CATEGORIES);
      if (!cl.length) StorageService.setClubs(INITIAL_CLUBS);
      if (!an.length) StorageService.setAnnouncements(INITIAL_ANNOUNCEMENTS);
    }
    setLoaded(true);
  }, []);

  const setProducts = useCallback((p: Product[]) => {
    _setProducts(p);
    StorageService.setProducts(p);
  }, []);

  const setEvents = useCallback((e: Event[]) => {
    _setEvents(e);
    StorageService.setEvents(e);
  }, []);

  const setOrders = useCallback((o: Order[]) => {
    _setOrders(o);
    StorageService.setOrders(o);
  }, []);

  const setCategories = useCallback((c: Category[]) => {
    _setCategories(c);
    StorageService.setCategories(c);
  }, []);

  const setClubs = useCallback((c: Club[]) => {
    _setClubs(c);
    StorageService.setClubs(c);
  }, []);

  const setAnnouncements = useCallback((a: Announcement[]) => {
    _setAnnouncements(a);
    StorageService.setAnnouncements(a);
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
      const availableStock = item.product.stockBySize[item.selectedSize] || 0;
      const currentQty = idx >= 0 ? prev[idx].quantity : 0;
      const newQty = Math.min(currentQty + item.quantity, availableStock);
      if (newQty <= 0) return prev;

      let next: CartItem[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = { ...next[idx], quantity: newQty };
      } else {
        next = [...prev, { ...item, quantity: Math.min(item.quantity, availableStock) }];
      }
      StorageService.setCart(next);
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
          const maxStock = ci.product.stockBySize[size] || 0;
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
    if (password === ADMIN_PASSWORD) {
      setIsAdmin(true);
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(() => setIsAdmin(false), []);

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
      products, setProducts, events, setEvents, orders, setOrders,
      categories, setCategories, clubs, setClubs, announcements, setAnnouncements,
      cart, addToCart, removeFromCart,
      updateCartQuantity, clearCart, isAdmin, login, logout,
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
        <div className="hidden md:flex items-center gap-8">
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
          <h2 className="font-display text-xl font-bold text-navy-700">Tu Carrito</h2>
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
          <div className="border-t border-gray-200 p-4">
            <div className="flex justify-between items-center mb-4">
              <span className="font-display font-semibold text-lg">Total</span>
              <span className="font-display font-bold text-xl text-navy-700">{formatPrice(total)}</span>
            </div>
            <Link
              to="/checkout"
              onClick={() => setCartOpen(false)}
              className="block w-full text-center bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 rounded-lg transition-colors"
            >
              Finalizar Compra
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper: ProductCard ─────────────────────────────────────────────────────

function ProductCard({ product }: { product: Product }) {
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
            <Eye size={16} /> Ver Producto
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
        <span className="absolute top-3 right-3 bg-navy-700/80 text-white text-xs px-2 py-1 rounded-full z-10">{product.category}</span>
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
            Ver Producto <ArrowRight size={14} />
          </span>
        </div>
      </div>
    </Link>
  );
}

// ─── 7. HomePage ─────────────────────────────────────────────────────────────

function HomePage() {
  const { products, events, categories, announcements } = useStore();
  const featured = products.filter(p => p.isFeatured).slice(0, 4);
  const upcomingEvents = events.filter(e => e.status === 'upcoming');
  const nextEvent = upcomingEvents.length > 0
    ? upcomingEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]
    : null;

  const activeAnnouncements = announcements.filter(a => a.active);

  const categoryIcons: Record<string, React.ReactNode> = {
    'Remeras': <Tag size={28} />,
    'Polos': <Star size={28} />,
    'Shorts': <Zap size={28} />,
    'Vestidos': <Heart size={28} />,
    'Gorros': <Shield size={28} />,
    'Accesorios': <Package size={28} />,
  };

  const announcementColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    info: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-500' },
    promo: { bg: 'bg-lime-50', border: 'border-lime-300', text: 'text-lime-700', badge: 'bg-lime-500' },
    event: { bg: 'bg-navy-50', border: 'border-navy-200', text: 'text-navy-700', badge: 'bg-navy-700' },
    important: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-500' },
  };

  const announcementTypeLabels: Record<string, string> = {
    info: 'Información',
    promo: 'Promoción',
    event: 'Evento',
    important: 'Importante',
  };

  return (
    <div className="fade-in">
      {/* Hero */}
      <section
        className="relative min-h-screen flex items-center overflow-hidden"
        style={{
          backgroundImage: 'url(/products/lifestyle-sunset-back.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
        }}
      >
        {/* Dark gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-navy-900/95 via-navy-700/85 to-navy-700/70" />
        {/* Subtle pattern */}
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />

        <div className="relative z-10 max-w-7xl mx-auto px-4 py-20 w-full">
          <div className="max-w-3xl">
            <p className="hero-enter hero-enter-1 opacity-0 text-lime-400 font-display font-bold text-sm md:text-base uppercase tracking-[0.3em] mb-6">
              La primera marca de Uruguay
            </p>
            <h1 className="hero-enter hero-enter-2 opacity-0 font-display text-5xl md:text-6xl lg:text-7xl font-black leading-[1.05] mb-6 text-white">
              INDUMENTARIA DE{' '}
              <span className="text-gradient">PICKLEBALL</span>{' '}
              DE ALTO RENDIMIENTO
            </h1>
            <p className="hero-enter hero-enter-3 opacity-0 text-lg md:text-xl text-gray-300 mb-10 font-body max-w-xl leading-relaxed">
              Diseñada para jugadores que buscan comodidad, estilo y máximo rendimiento dentro y fuera de la cancha.
            </p>
            <div className="hero-enter hero-enter-4 opacity-0 flex flex-col sm:flex-row gap-4">
              <Link
                to="/tienda"
                className="pulse-glow inline-flex items-center justify-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-4 px-10 rounded-lg text-lg transition-colors"
              >
                Ver Colección <ArrowRight size={20} />
              </Link>
              <Link
                to="/eventos"
                className="inline-flex items-center justify-center gap-2 border-2 border-white/30 hover:border-lime-400 text-white hover:text-lime-400 font-display font-bold py-4 px-10 rounded-lg text-lg transition-colors"
              >
                Próximos Eventos
              </Link>
            </div>
          </div>

          {/* Stats bar */}
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
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 text-white/50">
          <span className="text-xs font-body tracking-widest uppercase">Scroll</span>
          <div className="w-5 h-8 border-2 border-white/30 rounded-full flex justify-center pt-1">
            <div className="w-1 h-2 bg-lime-400 rounded-full animate-bounce" />
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-20 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-lime-500 font-display font-bold text-sm uppercase tracking-[0.2em]">Lo más vendido</span>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mt-2">Productos Destacados</h2>
              <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featured.map((p, i) => (
              <Reveal key={p.id} delay={i * 100}>
                <ProductCard product={p} />
              </Reveal>
            ))}
          </div>
          <Reveal>
            <div className="text-center mt-10">
              <Link
                to="/tienda"
                className="inline-flex items-center gap-2 border-2 border-navy-700 text-navy-700 hover:bg-navy-700 hover:text-white font-display font-bold py-3 px-8 rounded-lg transition-colors"
              >
                Ver Toda la Colección <ArrowRight size={18} />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Categories */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-lime-500 font-display font-bold text-sm uppercase tracking-[0.2em]">Explorá</span>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mt-2">Categorías</h2>
              <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
            </div>
          </Reveal>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {categories.sort((a, b) => a.sortOrder - b.sortOrder).map((cat, i) => (
              <Reveal key={cat.id} delay={i * 80}>
                <Link
                  to={`/tienda?category=${encodeURIComponent(cat.name)}`}
                  className="hover-scale flex flex-col items-center justify-center bg-white rounded-xl p-6 shadow-md border border-gray-100 hover:border-lime-400 hover:shadow-lg transition-all group"
                >
                  <div className="text-navy-700 group-hover:text-lime-500 transition-colors mb-3">
                    {categoryIcons[cat.name] || <Tag size={28} />}
                  </div>
                  <span className="font-display font-semibold text-navy-700 text-sm">{cat.name}</span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Galería en Acción */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-lime-500 font-display font-bold text-sm uppercase tracking-[0.2em]">Comunidad</span>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mt-2">VOLEA en Acción</h2>
              <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
            </div>
          </Reveal>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {[
              { src: '/products/1.png', span: 'md:row-span-2', height: 'h-64 md:h-full' },
              { src: '/products/mockup-vestido-blanco.jpg', span: '', height: 'h-48 md:h-64' },
              { src: '/products/9.png', span: '', height: 'h-48 md:h-64' },
              { src: '/products/mockup-short-negro.jpg', span: '', height: 'h-48 md:h-64' },
              { src: '/products/lifestyle-sunset-front.jpg', span: '', height: 'h-48 md:h-64' },
              { src: '/products/mockup-vestido-negro.jpg', span: 'md:col-span-1', height: 'h-48 md:h-64' },
            ].map((photo, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className={`gallery-item rounded-xl overflow-hidden ${photo.span} ${photo.height}`}>
                  <img
                    src={photo.src}
                    alt="VOLEA en acción"
                    className="w-full h-full object-cover"
                    onError={handleImgError}
                  />
                  <div className="gallery-overlay flex items-end p-4">
                    <span className="text-white font-display font-bold text-sm flex items-center gap-1">
                      <Instagram size={14} /> @volea.uy
                    </span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Brand Section */}
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
                  Diseñado para el <span className="text-gradient">Pickleball</span>
                </h2>
                <p className="text-gray-300 mb-10 leading-relaxed text-lg">
                  VOLEA es la primera marca de indumentaria de pickleball en Uruguay. Cada prenda está diseñada pensando en las necesidades del jugador: comodidad, rendimiento y estilo dentro y fuera de la cancha.
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
                  alt="VOLEA Brand"
                  className="w-full max-w-md rounded-2xl shadow-2xl"
                  onError={handleImgError}
                />
                <div className="absolute -bottom-4 -right-4 bg-lime-400 text-navy-700 font-display font-bold py-3 px-6 rounded-xl shadow-lg text-sm">
                  100% Uruguayo
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Upcoming Event */}
      {nextEvent && (
        <section className="bg-navy-700 py-20">
          <div className="max-w-7xl mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="font-display text-3xl md:text-4xl font-bold text-white">Próximo Evento</h2>
              <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
            </div>
            <div className="bg-navy-800 rounded-2xl overflow-hidden shadow-2xl max-w-3xl mx-auto">
              <div className="grid md:grid-cols-2">
                <img
                  src={nextEvent.imageUrl || FALLBACK_IMG}
                  alt={nextEvent.name}
                  className="w-full h-64 md:h-full object-cover"
                  onError={handleImgError}
                />
                <div className="p-8 text-white">
                  <span className="inline-block bg-lime-400 text-navy-700 text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase">
                    {nextEvent.category === 'tournament' ? 'Torneo' : nextEvent.category === 'clinic' ? 'Clínica' : 'Social'}
                  </span>
                  <h3 className="font-display text-2xl font-bold mb-3">{nextEvent.name}</h3>
                  <div className="space-y-2 text-gray-300 mb-4">
                    <p className="flex items-center gap-2"><Calendar size={16} /> {new Date(nextEvent.date).toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' })} - {nextEvent.time}hs</p>
                    <p className="flex items-center gap-2"><MapPin size={16} /> {nextEvent.location}, {nextEvent.city}</p>
                    {nextEvent.maxParticipants && (
                      <p className="flex items-center gap-2"><Users size={16} /> Máx. {nextEvent.maxParticipants} participantes</p>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm mb-6 line-clamp-3">{nextEvent.description}</p>
                  <Link
                    to="/eventos"
                    className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors text-sm"
                  >
                    Ver Eventos <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Announcements Marquee */}
      {activeAnnouncements.length > 0 && (
        <section className="py-4 bg-navy-700 overflow-hidden">
          <div className="relative">
            <div className="marquee flex whitespace-nowrap">
              {[...activeAnnouncements, ...activeAnnouncements].map((ann, idx) => {
                const colors = announcementColors[ann.type] || announcementColors.info;
                return (
                  <div key={`${ann.id}-${idx}`} className="inline-flex items-center gap-3 mx-8 flex-shrink-0">
                    <span className={`${colors.badge} text-white text-xs font-bold px-2 py-1 rounded-full`}>
                      {announcementTypeLabels[ann.type]}
                    </span>
                    <span className="font-display font-bold text-white text-sm">{ann.title}</span>
                    <span className="text-gray-400 text-sm hidden md:inline">—</span>
                    <span className="text-gray-300 text-sm hidden md:inline max-w-xs truncate">{ann.content}</span>
                    <span className="text-lime-400 text-lg">•</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Nuestro Equipo */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal>
            <div className="text-center mb-12">
              <span className="text-lime-500 font-display font-bold text-sm uppercase tracking-[0.2em]">Embajadores</span>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mt-2">El Equipo VOLEA</h2>
              <div className="w-20 h-1 bg-lime-400 mx-auto mt-4" />
            </div>
          </Reveal>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
            {[
              { src: '/products/lifestyle-sunset-front.jpg', name: 'Gastón Moirano', role: 'Fundador VOLEA' },
              { src: '/products/14.png', name: 'Enzo Rameau', role: 'Jugador VOLEA' },
              { src: '/products/team-brian.jpg', name: 'Brian Ridvanovich', role: 'Fundador VOLEA' },
              { src: '/products/team-paula.jpg', name: 'Paula Segura', role: 'Fundadora VOLEA' },
              { src: '/products/team-valeria.jpg', name: 'Valeria Morales', role: 'Fundadora VOLEA' },
            ].map((member, i) => (
              <Reveal key={i} delay={i * 120}>
                <div className="group relative rounded-2xl overflow-hidden aspect-[3/4] bg-gray-200">
                  <img
                    src={member.src}
                    alt={member.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    onError={handleImgError}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-navy-900/90 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <div className="w-8 h-1 bg-lime-400 mb-2" />
                    <h3 className="font-display font-bold text-white text-lg">{member.name}</h3>
                    <p className="text-gray-300 text-sm">{member.role}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <Reveal>
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 text-center">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mb-4">Seguinos en Instagram</h2>
            <p className="text-gray-500 mb-8 text-lg">Enterate de las últimas novedades, productos y eventos</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href={`https://instagram.com/${INSTAGRAM_HANDLE}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-display font-bold py-3 px-8 rounded-lg transition-transform hover:scale-105"
              >
                <Instagram size={20} /> @{INSTAGRAM_HANDLE}
              </a>
              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-display font-bold py-3 px-8 rounded-lg transition-colors"
              >
                <MessageCircle size={20} /> WhatsApp
              </a>
            </div>
          </div>
        </section>
      </Reveal>

      {/* Newsletter */}
      <section className="py-16 bg-navy-700">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <Reveal>
            <div className="bg-navy-800/50 backdrop-blur rounded-2xl p-8 md:p-12 border border-navy-600">
              <Mail className="mx-auto text-lime-400 mb-4" size={36} />
              <h2 className="font-display text-2xl md:text-3xl font-bold text-white mb-3">
                Suscribite y recibí ofertas exclusivas
              </h2>
              <p className="text-gray-400 mb-8 max-w-md mx-auto">
                Sé el primero en enterarte de nuevos lanzamientos, promos y eventos de pickleball.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const input = form.querySelector('input') as HTMLInputElement;
                  if (input.value) {
                    input.value = '';
                    const btn = form.querySelector('button') as HTMLButtonElement;
                    btn.textContent = '¡Suscrito!';
                    btn.classList.add('bg-green-500');
                    setTimeout(() => { btn.textContent = 'Suscribirse'; btn.classList.remove('bg-green-500'); }, 2500);
                  }
                }}
                className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
              >
                <input
                  type="email"
                  required
                  placeholder="Tu email"
                  className="flex-1 px-4 py-3 rounded-lg bg-navy-600 border border-navy-500 text-white placeholder-gray-400 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors font-body"
                />
                <button
                  type="submit"
                  className="pulse-glow bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors whitespace-nowrap"
                >
                  Suscribirse
                </button>
              </form>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}

// ─── 8. ShopPage ─────────────────────────────────────────────────────────────

function ShopPage() {
  const { products, categories, searchQuery, setSearchQuery, selectedCategory, setSelectedCategory } = useStore();
  const [searchParams] = useSearchParams();
  const [sort, setSort] = useState('recent');

  useEffect(() => {
    const cat = searchParams.get('category');
    if (cat) setSelectedCategory(cat);
  }, [searchParams, setSelectedCategory]);

  let filtered = products.filter(p => {
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
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mb-2">Nuestra Colección</h1>
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
            onClick={() => setSelectedCategory(selectedCategory === cat.name ? '' : cat.name)}
            className={`px-4 py-2 rounded-full font-display text-sm font-semibold transition-colors ${
              selectedCategory === cat.name ? 'bg-navy-700 text-lime-400' : 'bg-gray-100 text-navy-700 hover:bg-gray-200'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Package size={64} strokeWidth={1} className="mx-auto mb-4" />
          <p className="font-display text-lg">No se encontraron productos</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(p => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}

// ─── 9. ProductDetailPage ────────────────────────────────────────────────────

function ProductDetailPage() {
  const { id } = useParams();
  const { products, addToCart, setCartOpen } = useStore();
  const navigate = useNavigate();
  const product = products.find(p => p.id === id);
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

  const images = product.images.length > 0 ? product.images : [FALLBACK_IMG];
  const related = products.filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);

  const handleAdd = () => {
    const availableStock = product.stockBySize[selectedSize] || 0;
    if (qty > availableStock) {
      alert(`Solo hay ${availableStock} unidades disponibles en talle ${selectedSize}`);
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
            <span className="inline-block bg-navy-700/10 text-navy-700 text-xs font-bold px-3 py-1 rounded-full">{product.category}</span>
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
                    ({(product.stockBySize[selectedSize] || 0)} disponibles)
                  </span>
                )}
              </label>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map(size => {
                  const sizeStock = product.stockBySize[size] || 0;
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
                className="w-10 h-10 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition-colors"
              >
                <Minus size={18} />
              </button>
              <span className="font-display font-bold text-lg w-10 text-center">{qty}</span>
              <button
                onClick={() => setQty(qty + 1)}
                className="w-10 h-10 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition-colors"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>

          {/* Stock */}
          <div className="mb-6">
            {selectedSize && (product.stockBySize[selectedSize] || 0) > 0 ? (
              <span className="flex items-center gap-2 text-green-600 text-sm font-semibold">
                <Check size={16} /> En stock ({product.stockBySize[selectedSize]} disponibles en talle {selectedSize})
              </span>
            ) : getTotalStock(product) === 0 ? (
              <span className="flex items-center gap-2 text-red-500 text-sm font-semibold">
                <XCircle size={16} /> Sin stock
              </span>
            ) : (
              <span className="flex items-center gap-2 text-red-500 text-sm font-semibold">
                <XCircle size={16} /> Sin stock en talle {selectedSize}
              </span>
            )}
          </div>

          {/* Add to Cart */}
          <button
            onClick={handleAdd}
            disabled={!selectedSize || (product.stockBySize[selectedSize] || 0) === 0}
            className={`w-full font-display font-bold py-4 rounded-lg text-lg transition-all flex items-center justify-center gap-2 ${
              added
                ? 'bg-green-500 text-white'
                : !selectedSize || (product.stockBySize[selectedSize] || 0) === 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-lime-400 hover:bg-lime-500 text-navy-700'
            }`}
          >
            {added ? <><Check size={20} /> Agregado</> : <><ShoppingCart size={20} /> Agregar al Carrito</>}
          </button>
        </div>
      </div>

      {/* Related */}
      {related.length > 0 && (
        <section className="mt-20">
          <h2 className="font-display text-2xl font-bold text-navy-700 mb-6">Productos Relacionados</h2>
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

  const filtered = filter === 'all' ? events : events.filter(e => e.category === filter);
  const upcoming = filtered.filter(e => e.status === 'upcoming').sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const past = filtered.filter(e => e.status === 'past').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const categoryLabel = (cat: string) => {
    if (cat === 'tournament') return 'Torneo';
    if (cat === 'clinic') return 'Clínica';
    return 'Social';
  };

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-12">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mb-2">Eventos y Torneos</h1>
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
          <p className="font-display text-lg">No hay eventos para mostrar</p>
        </div>
      )}
    </div>
  );
}

// ─── 10b. MapPage (Clubes y Canchas) ─────────────────────────────────────────

declare const L: any;

function MapPage() {
  const { clubs } = useStore();
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

  const countryFlag = (country: string) => country === 'Uruguay' ? '🇺🇾' : '🇦🇷';

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-12">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mb-2">Clubes y Canchas</h1>
      <p className="text-gray-500 mb-2">Encontrá dónde jugar pickleball en Uruguay y Argentina</p>
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
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = `Hola! Soy ${form.name}.%0A%0A${form.message}%0A%0AEmail: ${form.email}%0ATel: ${form.phone}`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, '_blank');
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
            ¿Tenés alguna consulta? No dudes en contactarnos por cualquiera de estos medios.
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
              <Check size={18} /> Mensaje enviado por WhatsApp
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
  const { cart, clearCart, orders, setOrders } = useStore();
  const navigate = useNavigate();
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
          Ir a la tienda <ArrowRight size={16} />
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
        <h1 className="font-display text-3xl font-bold text-navy-700 mb-4">¡Pedido Confirmado!</h1>
        <p className="text-gray-500 mb-8 max-w-md mx-auto">Tu pedido fue enviado por WhatsApp. Te contactaremos a la brevedad para confirmar los detalles.</p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors"
        >
          Volver al Inicio
        </Link>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const orderId = `VO-${Date.now().toString(36).toUpperCase()}`;
    const order: Order = {
      id: orderId,
      items: cart,
      customer,
      total,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    setOrders([...orders, order]);

    // Build WhatsApp message
    const lines = [
      `🏓 *Nuevo Pedido VOLEA*`,
      `📌 Pedido: ${orderId}`,
      ``,
      `👤 *Cliente:* ${customer.name}`,
      `📱 *Tel:* ${customer.phone}`,
      `📧 *Email:* ${customer.email}`,
      `📦 *Dirección:* ${customer.address}, ${customer.city}, ${customer.department}`,
      customer.notes ? `📝 *Notas:* ${customer.notes}` : '',
      ``,
      `🛍 *Productos:*`,
      ...cart.map(i => `  • [${i.product.sku}] ${i.product.name} (${i.selectedSize}/${i.selectedColor}) x${i.quantity} - ${formatPrice(i.product.price * i.quantity)}`),
      ``,
      `💰 *Total: ${formatPrice(total)}*`,
    ].filter(Boolean).join('%0A');

    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines).replace(/%250A/g, '%0A')}`, '_blank');
    clearCart();
    setSuccess(true);
  };

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-12">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700 mb-2">Finalizar Compra</h1>
      <div className="w-16 h-1 bg-lime-400 mb-8" />

      <form onSubmit={handleSubmit} className="grid lg:grid-cols-2 gap-12">
        {/* Order Summary */}
        <div className="order-2 lg:order-1">
          <h2 className="font-display text-xl font-bold text-navy-700 mb-4">Resumen del Pedido</h2>
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
                  <p className="text-xs text-gray-500">{item.selectedSize} | {item.selectedColor} | x{item.quantity}</p>
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
        </div>

        {/* Customer Form */}
        <div className="order-1 lg:order-2">
          <h2 className="font-display text-xl font-bold text-navy-700 mb-4">Datos de Envío</h2>
          <div className="space-y-4">
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
                placeholder="Instrucciones especiales, horario de entrega, etc."
              />
            </div>
            <button
              type="submit"
              className="w-full bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-lg"
            >
              <MessageCircle size={20} /> Confirmar Pedido por WhatsApp
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ─── 13. AdminPage ───────────────────────────────────────────────────────────

function AdminPage() {
  const store = useStore();
  const {
    isAdmin, login, logout, products, setProducts, events, setEvents,
    orders, setOrders, categories, setCategories, clubs, setClubs,
    announcements, setAnnouncements
  } = store;
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  // Expanded order
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

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
            <p className="text-gray-500 text-sm mt-1">Ingresá la contraseña para acceder</p>
          </div>
          {loginError && (
            <div className="bg-red-50 text-red-600 border border-red-200 rounded-lg p-3 mb-4 flex items-center gap-2 text-sm">
              <AlertCircle size={16} /> Contraseña incorrecta
            </div>
          )}
          <form
            onSubmit={e => {
              e.preventDefault();
              if (!login(password)) {
                setLoginError(true);
                setTimeout(() => setLoginError(false), 3000);
              }
            }}
          >
            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors mb-4"
            />
            <button
              type="submit"
              className="w-full bg-navy-700 hover:bg-navy-800 text-white font-display font-bold py-3 rounded-lg transition-colors"
            >
              Ingresar
            </button>
          </form>
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
    { id: 'products', label: 'Productos', icon: <Package size={18} /> },
    { id: 'events', label: 'Eventos', icon: <CalendarDays size={18} /> },
    { id: 'orders', label: 'Pedidos', icon: <Store size={18} /> },
    { id: 'categories', label: 'Categorías', icon: <Tag size={18} /> },
    { id: 'clubs', label: 'Clubes', icon: <Map size={18} /> },
    { id: 'announcements', label: 'Anuncios', icon: <Megaphone size={18} /> },
  ];

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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Total Productos', value: products.length, icon: <Package size={24} />, color: 'bg-blue-50 text-blue-600' },
                { label: 'Pedidos Pendientes', value: pendingOrders, icon: <Store size={24} />, color: 'bg-yellow-50 text-yellow-600' },
                { label: 'Ingresos Totales', value: formatPrice(totalRevenue), icon: <BarChart3 size={24} />, color: 'bg-green-50 text-green-600' },
                { label: 'Sin Stock', value: outOfStock, icon: <AlertCircle size={24} />, color: 'bg-red-50 text-red-600' },
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

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Productos</h1>
              <button
                onClick={() => { setEditingProduct(null); setProductModal(true); }}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Agregar Producto
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
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden lg:table-cell">Oferta</th>
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
                        <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{p.category}</td>
                        <td className="px-4 py-3 font-display font-bold text-navy-700 text-sm">{formatPrice(p.price)}</td>
                        <td className="px-4 py-3 text-sm hidden sm:table-cell">
                          <span className={`font-semibold ${getTotalStock(p) === 0 ? 'text-red-500' : 'text-green-600'}`}>{getTotalStock(p)}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {p.isFeatured && <Star size={16} className="text-yellow-500 fill-yellow-500" />}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {p.isOffer && <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1 rounded-full">OFERTA</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { setEditingProduct(p); setProductModal(true); }}
                              className="text-navy-700 hover:text-lime-500 transition-colors"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(p.id)}
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

            {/* Product Modal */}
            {productModal && (
              <ProductModal
                product={editingProduct}
                categories={categories}
                onClose={() => { setProductModal(false); setEditingProduct(null); }}
                onSave={(p) => {
                  if (editingProduct) {
                    setProducts(products.map(pr => pr.id === p.id ? p : pr));
                  } else {
                    setProducts([...products, p]);
                  }
                  setProductModal(false);
                  setEditingProduct(null);
                }}
              />
            )}

            {/* Delete Confirm */}
            {deleteConfirm && (
              <ConfirmDialog
                title="¿Eliminar producto?"
                message="Esta acción no se puede deshacer."
                onCancel={() => setDeleteConfirm(null)}
                onConfirm={() => {
                  setProducts(products.filter(p => p.id !== deleteConfirm));
                  setDeleteConfirm(null);
                }}
              />
            )}
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
            <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700 mb-6">Pedidos</h1>
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
                      onClick={() => setCategories(categories.filter(c => c.id !== cat.id))}
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
                        <td className="px-4 py-3 text-sm">{club.country === 'Uruguay' ? '🇺🇾' : '🇦🇷'} {club.country}</td>
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
                  setAnnouncements(announcements.filter(a => a.id !== deleteAnnouncementConfirm));
                  setDeleteAnnouncementConfirm(null);
                }}
              />
            )}
          </div>
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

// ─── ProductModal ────────────────────────────────────────────────────────────

function ProductModal({
  product, categories, onClose, onSave
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSave: (p: Product) => void;
}) {
  const [form, setForm] = useState<Product>(
    product || {
      id: `prod-${Date.now()}`,
      name: '',
      sku: '',
      description: '',
      price: 0,
      originalPrice: undefined,
      category: categories[0]?.name || '',
      images: [''],
      sizes: [],
      colors: [],
      stockBySize: {},
      isFeatured: false,
      isOffer: false,
      createdAt: new Date().toISOString().split('T')[0],
    }
  );
  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('#000000');
  const allSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Único'];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedImages = form.images.filter(img => img.trim() !== '');
    onSave({ ...form, images: cleanedImages });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {product ? 'Editar Producto' : 'Nuevo Producto'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy-700 transition-colors">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
              <label className="block text-sm font-semibold text-navy-700 mb-1">SKU *</label>
              <input
                type="text"
                required
                placeholder="VOL-REM-001"
                value={form.sku}
                onChange={e => setForm({ ...form, sku: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors font-mono text-sm"
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
              <label className="block text-sm font-semibold text-navy-700 mb-1">Precio *</label>
              <input
                type="number"
                required
                min={0}
                value={form.price}
                onChange={e => setForm({ ...form, price: Number(e.target.value) })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Precio Original (oferta)</label>
              <input
                type="number"
                min={0}
                value={form.originalPrice || ''}
                onChange={e => setForm({ ...form, originalPrice: e.target.value ? Number(e.target.value) : undefined })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Categoría</label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors bg-white"
              >
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Stock total: {getTotalStock(form)}</label>
            </div>
          </div>

          {/* Sizes */}
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-2">Talles</label>
            <div className="flex flex-wrap gap-2">
              {allSizes.map(size => (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    if (form.sizes.includes(size)) {
                      const newStockBySize = { ...form.stockBySize };
                      delete newStockBySize[size];
                      setForm({
                        ...form,
                        sizes: form.sizes.filter(s => s !== size),
                        stockBySize: newStockBySize,
                      });
                    } else {
                      setForm({
                        ...form,
                        sizes: [...form.sizes, size],
                        stockBySize: { ...form.stockBySize, [size]: 0 },
                      });
                    }
                  }}
                  className={`px-3 py-1 rounded-lg text-sm font-semibold border transition-colors ${
                    form.sizes.includes(size)
                      ? 'border-lime-400 bg-lime-400 text-navy-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          {/* Stock por talle */}
          {form.sizes.length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-2">Stock por talle (Total: {getTotalStock(form)})</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {form.sizes.map(size => (
                  <div key={size} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-sm font-semibold text-navy-700 w-10">{size}</span>
                    <input
                      type="number"
                      min={0}
                      value={form.stockBySize[size] || 0}
                      onChange={e => setForm({
                        ...form,
                        stockBySize: { ...form.stockBySize, [size]: Math.max(0, Number(e.target.value)) }
                      })}
                      className="flex-1 px-2 py-1 rounded border border-gray-200 focus:border-lime-400 outline-none text-sm text-center"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Colors */}
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-2">Colores</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {form.colors.map((c, i) => (
                <div key={i} className="flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1">
                  <span className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: c.hex }} />
                  <span className="text-xs font-semibold">{c.name}</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, colors: form.colors.filter((_, idx) => idx !== i) })}
                    className="text-gray-400 hover:text-red-500 ml-1"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nombre color"
                value={newColorName}
                onChange={e => setNewColorName(e.target.value)}
                className="flex-1 px-3 py-1 rounded-lg border border-gray-200 focus:border-lime-400 outline-none text-sm"
              />
              <input
                type="color"
                value={newColorHex}
                onChange={e => setNewColorHex(e.target.value)}
                className="w-10 h-8 rounded border border-gray-200 cursor-pointer"
              />
              <button
                type="button"
                onClick={() => {
                  if (newColorName.trim()) {
                    setForm({ ...form, colors: [...form.colors, { name: newColorName.trim(), hex: newColorHex }] });
                    setNewColorName('');
                    setNewColorHex('#000000');
                  }
                }}
                className="bg-navy-700 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-navy-800 transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Images */}
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-2">Imágenes (rutas)</label>
            {form.images.map((img, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="/products/imagen.png"
                  value={img}
                  onChange={e => {
                    const newImgs = [...form.images];
                    newImgs[i] = e.target.value;
                    setForm({ ...form, images: newImgs });
                  }}
                  className="flex-1 px-3 py-1 rounded-lg border border-gray-200 focus:border-lime-400 outline-none text-sm"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, images: form.images.filter((_, idx) => idx !== i) })}
                  className="text-gray-400 hover:text-red-500"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setForm({ ...form, images: [...form.images, ''] })}
              className="text-lime-600 font-semibold text-sm flex items-center gap-1 hover:text-lime-700"
            >
              <Plus size={14} /> Agregar imagen
            </button>
          </div>

          {/* Toggles */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isFeatured}
                onChange={e => setForm({ ...form, isFeatured: e.target.checked })}
                className="w-4 h-4 text-lime-400 border-gray-300 rounded focus:ring-lime-400"
              />
              <span className="text-sm font-semibold text-navy-700">Destacado</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isOffer}
                onChange={e => setForm({ ...form, isOffer: e.target.checked })}
                className="w-4 h-4 text-red-500 border-gray-300 rounded focus:ring-red-400"
              />
              <span className="text-sm font-semibold text-navy-700">Oferta</span>
            </label>
          </div>

          {/* Submit */}
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
  return (
    <div className="fade-in min-h-[60vh] flex flex-col items-center justify-center px-4">
      <h1 className="font-display text-8xl font-black text-navy-700 mb-4">404</h1>
      <p className="font-display text-xl text-gray-500 mb-8">Página no encontrada</p>
      <Link
        to="/"
        className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors"
      >
        <Home size={18} /> Volver al Inicio
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
              La primera marca de indumentaria de pickleball en Uruguay. Diseño, calidad y pasión por el deporte.
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
                    to={`/tienda?category=${encodeURIComponent(cat.name)}`}
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
            &copy; 2026 VOLEA. La primera marca de Pickleball en Uruguay.
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

export default function App() {
  return (
    <HashRouter>
      <StoreProvider>
        <ScrollToTop />
        <div className="flex flex-col min-h-screen">
          <TopBar />
          <Navbar />
          <CartDrawer />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/tienda" element={<ShopPage />} />
              <Route path="/producto/:id" element={<ProductDetailPage />} />
              <Route path="/eventos" element={<EventsPage />} />
              <Route path="/mapa" element={<MapPage />} />
              <Route path="/contacto" element={<ContactPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
          <Footer />
          <FloatingWhatsApp />
        </div>
      </StoreProvider>
    </HashRouter>
  );
}
