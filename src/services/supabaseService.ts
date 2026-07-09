import { supabase, isSupabaseConnected } from './supabaseClient';
import type { Product, Event, Order, Category, Club, Announcement } from '../types';

function orderToRow(o: Order) {
  return {
    id: o.id,
    items: o.items,
    customer_name: o.customer.name || '',
    customer_phone: o.customer.phone || '',
    customer_email: o.customer.email || '',
    customer_address: o.customer.address || '',
    customer_city: o.customer.city || '',
    customer_department: o.customer.department || '',
    customer_notes: o.customer.notes || '',
    total: o.total,
    status: o.status,
    source: 'whatsapp',
  };
}

export const SupabaseService = {
  isConnected: isSupabaseConnected,

  // ── Products / Categories ──
  // Shopify es la fuente de verdad (snapshot en src/data/shopify-catalog.json).
  // La base volea-web no tiene tablas products/categories: estas operaciones son no-op.
  async getProducts(): Promise<Product[]> {
    return [];
  },

  async setProducts(_products: Product[]): Promise<void> {},

  async upsertProduct(_p: Product): Promise<void> {},

  async deleteProduct(_id: string): Promise<void> {},

  // ── Events ──
  async getEvents(): Promise<Event[]> {
    if (!supabase || !isSupabaseConnected()) return [];
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
    if (!supabase || !isSupabaseConnected()) return;
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
    if (!supabase || !isSupabaseConnected()) return;
    await supabase.from('events').delete().eq('id', id);
  },

  // ── Orders ──
  // La tabla orders usa columnas planas para el cliente (customer_name, customer_phone, ...).
  async getOrders(): Promise<Order[]> {
    if (!supabase || !isSupabaseConnected()) return [];
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) { console.error('Error fetching orders:', error); return []; }
    return (data || []).map(row => ({
      id: row.id,
      items: row.items || [],
      customer: {
        name: row.customer_name || '',
        phone: row.customer_phone || '',
        email: row.customer_email || '',
        address: row.customer_address || '',
        city: row.customer_city || '',
        department: row.customer_department || '',
        notes: row.customer_notes || '',
      },
      total: Number(row.total) || 0,
      status: row.status || 'pending',
      createdAt: row.created_at?.split('T')[0] || '',
    }));
  },

  // Insert plano para el checkout anónimo. RLS permite INSERT a cualquiera,
  // pero rechaza el upsert (ON CONFLICT DO UPDATE) porque el brazo UPDATE
  // exige is_admin(). No usar upsert acá.
  async addOrder(o: Order): Promise<void> {
    if (!supabase || !isSupabaseConnected()) return;
    const { error } = await supabase.from('orders').insert(orderToRow(o));
    if (error) console.error('Error inserting order:', error);
  },

  // Solo admins autenticados (magic link) pueden actualizar pedidos existentes.
  async setOrders(orders: Order[]): Promise<void> {
    if (!supabase || !isSupabaseConnected()) return;
    for (const o of orders) {
      const { error } = await supabase.from('orders').upsert(orderToRow(o), { onConflict: 'id' });
      if (error) console.error('Error upserting order:', error);
    }
  },

  // ── Categories ──
  // No-op: las categorías se derivan del catálogo de Shopify en build time.
  async getCategories(): Promise<Category[]> {
    return [];
  },

  async deleteCategory(_id: string): Promise<void> {},

  async setCategories(_categories: Category[]): Promise<void> {},

  // ── Clubs ──
  async getClubs(): Promise<Club[]> {
    if (!supabase || !isSupabaseConnected()) return [];
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
    if (!supabase || !isSupabaseConnected()) return;
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
    if (!supabase || !isSupabaseConnected()) return;
    await supabase.from('clubs').delete().eq('id', id);
  },

  // ── Announcements ──
  async getAnnouncements(): Promise<Announcement[]> {
    if (!supabase || !isSupabaseConnected()) return [];
    const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
    if (error) { console.error('Error fetching announcements:', error); return []; }
    return (data || []).map(row => ({
      id: row.id, title: row.title, content: row.content,
      type: row.type || 'info', active: row.active ?? true,
      createdAt: row.created_at?.split('T')[0] || '',
    }));
  },

  async setAnnouncements(announcements: Announcement[]): Promise<void> {
    if (!supabase || !isSupabaseConnected()) return;
    for (const a of announcements) {
      await supabase.from('announcements').upsert({
        id: a.id, title: a.title, content: a.content,
        type: a.type, active: a.active,
      }, { onConflict: 'id' });
    }
  },

  async deleteAnnouncement(id: string): Promise<void> {
    if (!supabase || !isSupabaseConnected()) return;
    await supabase.from('announcements').delete().eq('id', id);
  },
};
