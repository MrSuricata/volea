import type { Product, Event, Order, Category, Club, Announcement } from '../types';

const STORAGE_VERSION = '1.4.0';
const KEYS = {
  products: 'volea_products',
  events: 'volea_events',
  orders: 'volea_orders',
  categories: 'volea_categories',
  cart: 'volea_cart',
  clubs: 'volea_clubs',
  announcements: 'volea_announcements',
  version: 'volea_version',
};

function get<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function set<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export const StorageService = {
  getVersion: (): string | null => get<string>(KEYS.version),
  setVersion: (): void => set(KEYS.version, STORAGE_VERSION),
  currentVersion: STORAGE_VERSION,

  getProducts: (): Product[] => get<Product[]>(KEYS.products) || [],
  setProducts: (p: Product[]): void => set(KEYS.products, p),

  getEvents: (): Event[] => get<Event[]>(KEYS.events) || [],
  setEvents: (e: Event[]): void => set(KEYS.events, e),

  getOrders: (): Order[] => get<Order[]>(KEYS.orders) || [],
  setOrders: (o: Order[]): void => set(KEYS.orders, o),

  getCategories: (): Category[] => get<Category[]>(KEYS.categories) || [],
  setCategories: (c: Category[]): void => set(KEYS.categories, c),

  getClubs: (): Club[] => get<Club[]>(KEYS.clubs) || [],
  setClubs: (c: Club[]): void => set(KEYS.clubs, c),

  getAnnouncements: (): Announcement[] => get<Announcement[]>(KEYS.announcements) || [],
  setAnnouncements: (a: Announcement[]): void => set(KEYS.announcements, a),

  getCart: (): { product: Product; quantity: number; selectedSize: string; selectedColor: string }[] =>
    get(KEYS.cart) || [],
  setCart: (c: { product: Product; quantity: number; selectedSize: string; selectedColor: string }[]): void =>
    set(KEYS.cart, c),

  clearAll: (): void => {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  },
};
