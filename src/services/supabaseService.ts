import { supabase, isSupabaseConnected } from './supabaseClient';
import type { Product, Event, Order, Category, Club, Announcement } from '../types';

export const SupabaseService = {
  isConnected: isSupabaseConnected,

  // ── Products ──
  async getProducts(): Promise<Product[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    if (error) { console.error('Error fetching products:', error); return []; }
    return (data || []).map(row => ({
      id: row.id,
      name: row.name,
      sku: row.sku || '',
      description: row.description || '',
      price: row.price,
      originalPrice: row.original_price || undefined,
      category: row.category,
      images: row.images || [],
      sizes: row.sizes || [],
      colors: row.colors || [],
      stockBySize: row.stock_by_size || {},
      isFeatured: row.is_featured || false,
      isOffer: row.is_offer || false,
      createdAt: row.created_at?.split('T')[0] || '',
    }));
  },

  async setProducts(products: Product[]): Promise<void> {
    if (!supabase) return;
    for (const p of products) {
      const row = {
        id: p.id,
        name: p.name,
        sku: p.sku,
        description: p.description,
        price: p.price,
        original_price: p.originalPrice || null,
        category: p.category,
        images: p.images,
        sizes: p.sizes,
        colors: p.colors,
        stock_by_size: p.stockBySize,
        is_featured: p.isFeatured,
        is_offer: p.isOffer,
      };
      await supabase.from('products').upsert(row, { onConflict: 'id' });
    }
  },

  async upsertProduct(p: Product): Promise<void> {
    if (!supabase) return;
    const { error } = await supabase.from('products').upsert({
      id: p.id,
      name: p.name,
      sku: p.sku,
      description: p.description,
      price: p.price,
      original_price: p.originalPrice || null,
      category: p.category,
      images: p.images,
      sizes: p.sizes,
      colors: p.colors,
      stock_by_size: p.stockBySize,
      is_featured: p.isFeatured,
      is_offer: p.isOffer,
    }, { onConflict: 'id' });
    if (error) console.error('Error upserting product:', error);
  },

  async deleteProduct(id: string): Promise<void> {
    if (!supabase) return;
    await supabase.from('products').delete().eq('id', id);
  },

  // ── Events ──
  async getEvents(): Promise<Event[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('events').select('*').order('date', { ascending: true });
    if (error) { console.error('Error fetching events:', error); return []; }
    return (data || []).map(row => ({
      id: row.id,
      name: row.name,
      date: row.date,
      time: row.time || '',
      location: row.location,
      city: row.city || '',
      description: row.description || '',
      imageUrl: row.image_url || '',
      mapsUrl: row.maps_url || '',
      maxParticipants: row.max_participants || undefined,
      status: row.status || 'upcoming',
      category: row.category || 'tournament',
    }));
  },

  async setEvents(events: Event[]): Promise<void> {
    if (!supabase) return;
    for (const e of events) {
      await supabase.from('events').upsert({
        id: e.id, name: e.name, date: e.date, time: e.time,
        location: e.location, city: e.city, description: e.description,
        image_url: e.imageUrl, maps_url: e.mapsUrl,
        max_participants: e.maxParticipants || null,
        status: e.status, category: e.category,
      }, { onConflict: 'id' });
    }
  },

  async deleteEvent(id: string): Promise<void> {
    if (!supabase) return;
    await supabase.from('events').delete().eq('id', id);
  },

  // ── Orders ──
  async getOrders(): Promise<Order[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) { console.error('Error fetching orders:', error); return []; }
    return (data || []).map(row => ({
      id: row.id,
      items: row.items || [],
      customer: row.customer || {},
      total: row.total,
      status: row.status || 'pending',
      createdAt: row.created_at?.split('T')[0] || '',
    }));
  },

  async setOrders(orders: Order[]): Promise<void> {
    if (!supabase) return;
    for (const o of orders) {
      await supabase.from('orders').upsert({
        id: o.id, items: o.items, customer: o.customer,
        total: o.total, status: o.status,
      }, { onConflict: 'id' });
    }
  },

  // ── Categories ──
  async getCategories(): Promise<Category[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('categories').select('*').order('sort_order', { ascending: true });
    if (error) { console.error('Error fetching categories:', error); return []; }
    return (data || []).map(row => ({
      id: row.id, name: row.name, sortOrder: row.sort_order || 0,
    }));
  },

  async deleteCategory(id: string): Promise<void> {
    if (!supabase) return;
    await supabase.from('categories').delete().eq('id', id);
  },

  async setCategories(categories: Category[]): Promise<void> {
    if (!supabase) return;
    for (const c of categories) {
      await supabase.from('categories').upsert({
        id: c.id, name: c.name, sort_order: c.sortOrder,
      }, { onConflict: 'id' });
    }
  },

  // ── Clubs ──
  async getClubs(): Promise<Club[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('clubs').select('*').order('country', { ascending: true });
    if (error) { console.error('Error fetching clubs:', error); return []; }
    return (data || []).map(row => ({
      id: row.id, name: row.name, address: row.address,
      city: row.city, country: row.country, lat: row.lat, lng: row.lng,
      phone: row.phone || '', instagram: row.instagram || '',
      hasPickleball: row.has_pickleball ?? true, description: row.description || '',
    }));
  },

  async setClubs(clubs: Club[]): Promise<void> {
    if (!supabase) return;
    for (const c of clubs) {
      await supabase.from('clubs').upsert({
        id: c.id, name: c.name, address: c.address, city: c.city,
        country: c.country, lat: c.lat, lng: c.lng, phone: c.phone || '',
        instagram: c.instagram || '', has_pickleball: c.hasPickleball,
        description: c.description,
      }, { onConflict: 'id' });
    }
  },

  async deleteClub(id: string): Promise<void> {
    if (!supabase) return;
    await supabase.from('clubs').delete().eq('id', id);
  },

  // ── Announcements ──
  async getAnnouncements(): Promise<Announcement[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
    if (error) { console.error('Error fetching announcements:', error); return []; }
    return (data || []).map(row => ({
      id: row.id, title: row.title, content: row.content,
      type: row.type || 'info', active: row.active ?? true,
      createdAt: row.created_at?.split('T')[0] || '',
    }));
  },

  async setAnnouncements(announcements: Announcement[]): Promise<void> {
    if (!supabase) return;
    for (const a of announcements) {
      await supabase.from('announcements').upsert({
        id: a.id, title: a.title, content: a.content,
        type: a.type, active: a.active,
      }, { onConflict: 'id' });
    }
  },

  async deleteAnnouncement(id: string): Promise<void> {
    if (!supabase) return;
    await supabase.from('announcements').delete().eq('id', id);
  },
};
