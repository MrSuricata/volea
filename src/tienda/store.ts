// Contexto del store (catálogo, carrito, sesión de admin). El StoreProvider vive en
// App.tsx; el contexto y el hook están acá para que el panel admin — un chunk lazy —
// los use sin importar App.tsx (eso lo metería de vuelta en el mismo chunk).

import { createContext, useContext } from 'react';
import type { Product, Event, Order, Category, Club, Announcement, Post, StandingEntry, CartItem, Promo } from '../types';
import type { AdminUser } from '../services/authService';
import type { ResultadoBorrado } from '../utils/filas';

export interface StoreContextType {
  // false mientras los datos de la nube siguen viajando. La web se muestra a los 4s
  // pase lo que pase (ver techoSplash), así que sin esta bandera una tienda todavía
  // vacía diría "no encontramos productos", que es mentira: aún no llegaron.
  datosListos: boolean;
  products: Product[];
  refreshProducts: () => Promise<void>;
  saveProduct: (p: Product, opts?: { sinStock?: boolean }) => void;
  removeProduct: (id: string) => void;
  events: Event[];
  /** Guarda UN evento (alta o edición). Nunca la lista entera: ver utils/filas.ts. */
  saveEvent: (e: Event) => Promise<boolean>;
  /** Borra en la nube y RECIÉN AHÍ de la lista; si no se pudo, avisa y el evento queda. */
  removeEvent: (id: string) => Promise<ResultadoBorrado>;
  /** Promos activas (tabla promos). La vigencia por fecha se decide al mostrar. */
  promos: Promo[];
  orders: Order[];
  updateOrderStatus: (id: string, status: Order['status']) => void;
  addOrder: (o: Order) => Promise<boolean>;
  posts: Post[];
  savePost: (p: Post) => void;
  removePost: (id: string) => void;
  standings: StandingEntry[];
  saveStanding: (s: StandingEntry) => void;
  removeStanding: (id: string) => void;
  categories: Category[];
  saveCategory: (c: Category) => Promise<boolean>;
  removeCategory: (id: string) => void;
  clubs: Club[];
  saveClub: (c: Club) => Promise<boolean>;
  removeClub: (id: string) => void;
  announcements: Announcement[];
  saveAnnouncement: (a: Announcement) => Promise<boolean>;
  removeAnnouncement: (id: string) => void;
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

export const StoreContext = createContext<StoreContextType | null>(null);

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be inside StoreProvider');
  return ctx;
}
