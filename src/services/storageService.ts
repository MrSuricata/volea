import type { Product, Event, Order, Category, Club, Announcement, CartItem } from '../types';
import { almacenLocal } from '../utils/almacen';

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
  return almacenLocal.leerJSON<T>(key);
}

// Nunca tira (ver utils/almacen.ts): con la cuota llena o el almacenamiento bloqueado
// el setItem pelado tiraba y cortaba la escritura a la NUBE que venía después en la
// misma función del store. La copia local es comodidad; la nube es la verdad.
function set<T>(key: string, value: T): boolean {
  return almacenLocal.guardarJSON(key, value);
}

export const StorageService = {
  getVersion: (): string | null => get<string>(KEYS.version),
  setVersion: (): boolean => set(KEYS.version, STORAGE_VERSION),
  currentVersion: STORAGE_VERSION,

  getProducts: (): Product[] => get<Product[]>(KEYS.products) || [],
  setProducts: (p: Product[]): boolean => set(KEYS.products, p),

  getEvents: (): Event[] => get<Event[]>(KEYS.events) || [],
  setEvents: (e: Event[]): boolean => set(KEYS.events, e),

  getOrders: (): Order[] => get<Order[]>(KEYS.orders) || [],
  setOrders: (o: Order[]): boolean => set(KEYS.orders, o),

  getCategories: (): Category[] => get<Category[]>(KEYS.categories) || [],
  setCategories: (c: Category[]): boolean => set(KEYS.categories, c),

  getClubs: (): Club[] => get<Club[]>(KEYS.clubs) || [],
  setClubs: (c: Club[]): boolean => set(KEYS.clubs, c),

  getAnnouncements: (): Announcement[] => get<Announcement[]>(KEYS.announcements) || [],
  setAnnouncements: (a: Announcement[]): boolean => set(KEYS.announcements, a),

  getCart: (): CartItem[] => get<CartItem[]>(KEYS.cart) || [],
  setCart: (c: CartItem[]): boolean => set(KEYS.cart, c),

  clearAll: (): void => {
    Object.values(KEYS).forEach((k) => almacenLocal.borrar(k));
  },
};
