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
  category: string;
  images: string[];
  sizes: string[];
  colors: ProductColor[];
  stockBySize: Record<string, number>;
  isFeatured: boolean;
  isOffer: boolean;
  createdAt: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedSize: string;
  selectedColor: string;
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
}

export interface Order {
  id: string;
  items: CartItem[];
  customer: CustomerInfo;
  total: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered';
  createdAt: string;
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
