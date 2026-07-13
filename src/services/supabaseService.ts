import { supabase, isSupabaseConnected } from './supabaseClient';
import type { Product, Event, Order, Category, Club, Announcement, Post, StandingEntry, LedgerEntry } from '../types';

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

function productToRow(p: Product) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku || '',
    description: p.description || '',
    price: Math.round(p.price) || 0,
    original_price: p.originalPrice ? Math.round(p.originalPrice) : null,
    category: p.category,
    images: p.images || [],
    sizes: p.sizes || [],
    colors: p.colors || [],
    stock_by_size: p.stockBySize || {},
    is_featured: p.isFeatured || false,
    is_offer: p.isOffer || false,
    active: p.active !== false,
    sort_order: p.sortOrder ?? 0,
  };
}

function rowToProduct(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku || '',
    description: row.description || '',
    price: Number(row.price) || 0,
    originalPrice: row.original_price ? Number(row.original_price) : undefined,
    category: row.category,
    images: row.images || [],
    sizes: row.sizes || [],
    colors: row.colors || [],
    stockBySize: row.stock_by_size || {},
    isFeatured: row.is_featured || false,
    isOffer: row.is_offer || false,
    active: row.active !== false,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at?.split('T')[0] || '',
  };
}

export const SupabaseService = {
  isConnected: isSupabaseConnected,

  // ── Products (Supabase es la fuente de verdad desde la migración nativa) ──
  // null = fetch falló (usar fallback); [] = catálogo legítimamente vacío.
  async getProducts(): Promise<Product[] | null> {
    if (!supabase || !isSupabaseConnected()) return null;
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) { console.error('Error fetching products:', error); return null; }
    return (data || []).map(rowToProduct);
  },

  // Las escrituras admin devuelven false si la nube las rechazó (RLS/sesión vencida),
  // para que la UI avise en vez de fingir éxito.
  async setProducts(products: Product[]): Promise<boolean> {
    if (!supabase || !isSupabaseConnected()) return true;
    let ok = true;
    for (const p of products) {
      const { error } = await supabase.from('products').upsert(productToRow(p), { onConflict: 'id' });
      if (error) { console.error('Error upserting product:', error); ok = false; }
    }
    return ok;
  },

  async upsertProduct(p: Product): Promise<boolean> {
    if (!supabase || !isSupabaseConnected()) return true;
    const { error } = await supabase.from('products').upsert(productToRow(p), { onConflict: 'id' });
    if (error) { console.error('Error upserting product:', error); return false; }
    return true;
  },

  async deleteProduct(id: string): Promise<boolean> {
    if (!supabase || !isSupabaseConnected()) return true;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) { console.error('Error deleting product:', error); return false; }
    return true;
  },

  // ── Categories ──
  async getCategories(): Promise<Category[] | null> {
    if (!supabase || !isSupabaseConnected()) return null;
    const { data, error } = await supabase.from('categories').select('*').order('sort_order', { ascending: true });
    if (error) { console.error('Error fetching categories:', error); return null; }
    return (data || []).map(row => ({ id: row.id, name: row.name, sortOrder: row.sort_order || 0 }));
  },

  async setCategories(categories: Category[]): Promise<boolean> {
    if (!supabase || !isSupabaseConnected()) return true;
    let ok = true;
    for (const c of categories) {
      const { error } = await supabase.from('categories').upsert(
        { id: c.id, name: c.name, sort_order: c.sortOrder },
        { onConflict: 'id' }
      );
      if (error) { console.error('Error upserting category:', error); ok = false; }
    }
    return ok;
  },

  async deleteCategory(id: string): Promise<boolean> {
    if (!supabase || !isSupabaseConnected()) return true;
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) { console.error('Error deleting category:', error); return false; }
    return true;
  },

  // ── Posts (blog) ──
  async getPosts(): Promise<Post[]> {
    if (!supabase || !isSupabaseConnected()) return [];
    const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
    if (error) { console.error('Error fetching posts:', error); return []; }
    return (data || []).map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt || '',
      content: row.content || '',
      coverUrl: row.cover_url || '',
      published: row.published || false,
      publishedAt: row.published_at || undefined,
      createdAt: row.created_at?.split('T')[0] || '',
    }));
  },

  async upsertPost(p: Post): Promise<boolean> {
    if (!supabase || !isSupabaseConnected()) return true;
    const { error } = await supabase.from('posts').upsert({
      id: p.id,
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt || '',
      content: p.content || '',
      cover_url: p.coverUrl || '',
      published: p.published,
      published_at: p.published ? (p.publishedAt || new Date().toISOString()) : null,
    }, { onConflict: 'id' });
    if (error) { console.error('Error upserting post:', error); return false; }
    return true;
  },

  async deletePost(id: string): Promise<boolean> {
    if (!supabase || !isSupabaseConnected()) return true;
    const { error } = await supabase.from('posts').delete().eq('id', id);
    if (error) { console.error('Error deleting post:', error); return false; }
    return true;
  },

  // ── Standings (clasificación al Mundial) ──
  async getStandings(): Promise<StandingEntry[]> {
    if (!supabase || !isSupabaseConnected()) return [];
    const { data, error } = await supabase.from('standings').select('*')
      .order('category', { ascending: true })
      .order('position', { ascending: true });
    if (error) { console.error('Error fetching standings:', error); return []; }
    return (data || []).map(row => ({
      id: row.id,
      position: row.position || 0,
      playerName: row.player_name,
      points: Number(row.points) || 0,
      category: row.category || 'General',
      notes: row.notes || '',
    }));
  },

  async upsertStanding(s: StandingEntry): Promise<boolean> {
    if (!supabase || !isSupabaseConnected()) return true;
    const { error } = await supabase.from('standings').upsert({
      id: s.id,
      position: s.position,
      player_name: s.playerName,
      points: s.points,
      category: s.category || 'General',
      notes: s.notes || '',
    }, { onConflict: 'id' });
    if (error) { console.error('Error upserting standing:', error); return false; }
    return true;
  },

  async deleteStanding(id: string): Promise<boolean> {
    if (!supabase || !isSupabaseConnected()) return true;
    const { error } = await supabase.from('standings').delete().eq('id', id);
    if (error) { console.error('Error deleting standing:', error); return false; }
    return true;
  },

  // ── Caja: libro de ventas/gastos del bot de Telegram (solo admins vía RLS) ──
  async getLedger(): Promise<LedgerEntry[] | null> {
    if (!supabase || !isSupabaseConnected()) return null;
    // Sin sesión de magic link, RLS devuelve lista vacía sin error: mejor
    // avisar el problema de sesión que mostrar una caja "vacía" engañosa.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await supabase.from('bot_ledger').select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) { console.error('Error fetching ledger:', error); return null; }
    return (data || []).map(row => ({
      id: row.id,
      kind: row.kind === 'gasto' ? 'gasto' as const : 'venta' as const,
      productId: row.product_id ?? null,
      variantKey: row.variant_key ?? null,
      label: row.label || '',
      qty: row.qty || 1,
      amount: Number(row.amount) || 0,
      reportedBy: row.reported_by || '',
      reverted: row.reverted || false,
      createdAt: row.created_at || '',
    }));
  },

  /** Anula un movimiento de la Caja; si era una venta de catálogo, repone stock. */
  async revertLedgerEntry(id: string): Promise<{ ok: boolean; stockRestored: boolean; error?: string }> {
    if (!supabase || !isSupabaseConnected()) {
      return { ok: false, stockRestored: false, error: 'Sin conexión con Supabase' };
    }
    const { data, error } = await supabase.rpc('admin_revert_ledger', { p_id: id });
    if (error) {
      console.error('Error reverting ledger entry:', error);
      return { ok: false, stockRestored: false, error: error.message };
    }
    return {
      ok: data?.ok === true,
      stockRestored: data?.stock_restored === true,
      error: typeof data?.error === 'string' ? data.error : undefined,
    };
  },

  // ── Storage: subida de imágenes (bucket product-images, requiere sesión admin) ──
  async uploadImage(file: File, folder = 'uploads'): Promise<string | null> {
    if (!supabase || !isSupabaseConnected()) return null;
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (error) { console.error('Error uploading image:', error); return null; }
    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    return data.publicUrl;
  },

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
  async setOrders(orders: Order[]): Promise<boolean> {
    if (!supabase || !isSupabaseConnected()) return true;
    let ok = true;
    for (const o of orders) {
      const { error } = await supabase.from('orders').upsert(orderToRow(o), { onConflict: 'id' });
      if (error) { console.error('Error upserting order:', error); ok = false; }
    }
    return ok;
  },

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
