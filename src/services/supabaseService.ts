import { supabase, isSupabaseConnected } from './supabaseClient';
import { comprimirImagen } from '../utils/imagenes';
import { conLimite, conReintento } from '../utils/arranque';
import { faltantesEnPadron } from '../utils/nombres';
import type { JugadorPadron } from '../utils/dupr';
import type { Product, Event, Order, Category, Club, Announcement, Post, StandingEntry, Inscripcion, InscripcionInput, LedgerEntry, Promo, SocioMove, SocioMoveInput, SocioLiquidacionMove, SocioName, VentaCajaInput, Compra, CompraItem, CompraArchivo, RecepcionItem, Tarea, MiembroEquipo, GastoPendiente, GastoPendienteInput, TanteadorPartido } from '../types';

// ── Techo de 15s para TODAS las escrituras del admin ──
// supabase-js no tiene timeout propio: con la sesión vencida y el refresh del token
// colgado (la conexión trabada de siempre), una escritura podía quedar esperando PARA
// SIEMPRE — sin error, sin toast, la UI mostraba el cambio local y un F5 lo revertía
// a lo que había en la nube. Con este techo, a los 15s el cuelgue resuelve como fallo
// y toma el mismo camino que una escritura rechazada (console.error + false), así el
// aviso de warnCloudFail sí aparece. uploadImage no pasa por acá: ya tiene su techo de 45s.
const TECHO_ESCRITURA_MS = 15000;
function conTechoEscritura<T extends { data?: unknown; error: { message: string } | null }>(
  escritura: PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => unknown },
): Promise<T | { data: null; error: Error }> {
  // ABORT real al vencer el techo (2026-08-09): resolver el timeout no alcanza —
  // el request colgado seguía vivo ocupando la conexión del navegador a Supabase,
  // los zombies se acumulaban y las llamadas nuevas quedaban encoladas sin salir
  // ("sigue pensando" hasta F5). Abortar libera la cañería; el reintento sale
  // por una conexión nueva. Si el request ya terminó, el abort es un no-op.
  if (typeof escritura.abortSignal === 'function') {
    const ctrl = new AbortController();
    escritura.abortSignal(ctrl.signal);
    setTimeout(() => ctrl.abort(), TECHO_ESCRITURA_MS + 100);
  }
  return conLimite<T | { data: null; error: Error }>(
    escritura,
    TECHO_ESCRITURA_MS,
    { data: null, error: new Error('timeout: la escritura no llegó a Supabase en 15s') },
  );
}

// Las lecturas del admin (caja, socios, pedidos) también se cuelgan cuando la
// sesión quedó vencida con el refresh trabado: getSession devuelve la sesión
// vieja de memoria, pasa el guard, y el SELECT espera un refresh que no llega.
// Sin techo, la pestaña quedaba en "cargando" para siempre (visto 2026-08-06).
const conTechoLectura = conTechoEscritura;

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
    if (!supabase) return true;
    let ok = true;
    for (const p of products) {
      const { error } = await conTechoEscritura(supabase.from('products').upsert(productToRow(p), { onConflict: 'id' }));
      if (error) { console.error('Error upserting product:', error); ok = false; }
    }
    return ok;
  },

  async upsertProduct(p: Product): Promise<boolean> {
    if (!supabase) return true;
    const { error } = await conTechoEscritura(supabase.from('products').upsert(productToRow(p), { onConflict: 'id' }));
    if (error) { console.error('Error upserting product:', error); return false; }
    return true;
  },

  async deleteProduct(id: string): Promise<boolean> {
    if (!supabase) return true;
    const { error } = await conTechoEscritura(supabase.from('products').delete().eq('id', id));
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
    if (!supabase) return true;
    let ok = true;
    for (const c of categories) {
      const { error } = await conTechoEscritura(supabase.from('categories').upsert(
        { id: c.id, name: c.name, sort_order: c.sortOrder },
        { onConflict: 'id' }
      ));
      if (error) { console.error('Error upserting category:', error); ok = false; }
    }
    return ok;
  },

  async deleteCategory(id: string): Promise<boolean> {
    if (!supabase) return true;
    const { error } = await conTechoEscritura(supabase.from('categories').delete().eq('id', id));
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
    if (!supabase) return true;
    const { error } = await conTechoEscritura(supabase.from('posts').upsert({
      id: p.id,
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt || '',
      content: p.content || '',
      cover_url: p.coverUrl || '',
      published: p.published,
      published_at: p.published ? (p.publishedAt || new Date().toISOString()) : null,
    }, { onConflict: 'id' }));
    if (error) { console.error('Error upserting post:', error); return false; }
    return true;
  },

  async deletePost(id: string): Promise<boolean> {
    if (!supabase) return true;
    const { error } = await conTechoEscritura(supabase.from('posts').delete().eq('id', id));
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
    if (!supabase) return true;
    const { error } = await conTechoEscritura(supabase.from('standings').upsert({
      id: s.id,
      position: s.position,
      player_name: s.playerName,
      points: s.points,
      category: s.category || 'General',
      notes: s.notes || '',
    }, { onConflict: 'id' }));
    if (error) { console.error('Error upserting standing:', error); return false; }
    return true;
  },

  async deleteStanding(id: string): Promise<boolean> {
    if (!supabase) return true;
    const { error } = await conTechoEscritura(supabase.from('standings').delete().eq('id', id));
    if (error) { console.error('Error deleting standing:', error); return false; }
    return true;
  },

  // ── Caja: libro de ventas/gastos del bot de Telegram (solo admins vía RLS) ──
  async getLedger(limit = 500): Promise<LedgerEntry[] | null> {
    if (!supabase || !isSupabaseConnected()) return null;
    // Sin sesión de magic link, RLS devuelve lista vacía sin error: mejor
    // avisar el problema de sesión que mostrar una caja "vacía" engañosa.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    // Reintento único como las lecturas públicas: el primer intento tras abrir
    // la pestaña a veces muere con la conexión trabada y el segundo anda.
    const { data, error } = await conReintento(
      () => conTechoLectura(supabase!.from('bot_ledger').select('*')
        .order('created_at', { ascending: false })
        .limit(limit)),
      r => !!r.error,
    );
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
      paymentMethod: row.payment_method ?? null,
      debtorName: row.debtor_name ?? null,
      jugadorId: row.jugador_id ?? null,
      settledAt: row.settled_at ?? null,
      settledMethod: row.settled_method ?? null,
      socioSettledAt: row.socio_settled_at ?? null,
      paidBy: row.paid_by ?? null,
    }));
  },

  /** Anula un movimiento de la Caja (venta o gasto); si era una venta de catálogo, repone stock. */
  async revertLedgerEntry(id: string): Promise<{ ok: boolean; stockRestored: boolean; error?: string }> {
    // Sin isSupabaseConnected(): misma regla que registrarVentaCaja (fix 2026-07-18).
    if (!supabase) {
      return { ok: false, stockRestored: false, error: 'Sin conexión con Supabase' };
    }
    const { data, error } = await conTechoEscritura(supabase.rpc('admin_revert_ledger', { p_id: id }));
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

  /**
   * Registra una venta desde la Caja web con la misma semántica del bot:
   * la RPC descuenta stock atómicamente (ventas de catálogo) e inserta en
   * bot_ledger, así deudas/cobré/liquidación/anular siguen andando igual.
   */
  async registrarVentaCaja(input: VentaCajaInput, reportedBy: string): Promise<{ ok: boolean; error?: string }> {
    // Sin isSupabaseConnected(): las escrituras del admin intentan SIEMPRE que
    // haya cliente (regla del fix 2026-07-18 — el probe del arranque da falsos
    // negativos con la conexión fría y dejaba la pestaña "sin conexión" para
    // siempre; visto de nuevo con los gastos de la Caja el 2026-08-09).
    if (!supabase) {
      return { ok: false, error: 'Sin conexión con Supabase' };
    }
    const { data, error } = await conTechoEscritura(supabase.rpc('admin_registrar_venta', {
      p_label: input.label,
      p_amount: input.amount,
      p_payment: input.payment,
      p_reported_by: reportedBy,
      p_product_id: input.productId ?? null,
      p_variant_key: input.variantKey ?? null,
      p_qty: input.qty ?? 1,
      p_debtor: input.debtor ?? null,
      p_jugador_id: input.jugadorId ?? null,
    }));
    if (error) {
      console.error('Error registrando venta:', error);
      return { ok: false, error: error.message };
    }
    return { ok: data?.ok === true, error: typeof data?.error === 'string' ? data.error : undefined };
  },

  /**
   * Cobra deudas de un deudor (nombre exacto del agrupado de la Caja).
   * monto null = cobra todo; con monto = pago parcial FIFO (la RPC parte el
   * ítem a caballo y deja el resto pendiente). Misma semántica que «cobré».
   */
  async cobrarDeudorCaja(debtor: string, method: 'mp' | 'efectivo' | 'transferencia', monto: number | null): Promise<{ ok: boolean; error?: string; restante?: number }> {
    // Misma regla que registrarVentaCaja: intentar siempre que haya cliente.
    if (!supabase) {
      return { ok: false, error: 'Sin conexión con Supabase' };
    }
    const { data, error } = await conTechoEscritura(supabase.rpc('admin_cobrar_deudor', {
      p_debtor: debtor,
      p_method: method,
      p_monto: monto,
    }));
    if (error) {
      console.error('Error cobrando deudor:', error);
      return { ok: false, error: error.message };
    }
    return {
      ok: data?.ok === true,
      error: typeof data?.error === 'string' ? data.error : undefined,
      restante: typeof data?.restante === 'number' ? data.restante : undefined,
    };
  },

  /**
   * Registra un gasto desde la Caja web (fila 'gasto' en bot_ledger, sin stock ni método).
   * `paidBy` = de qué socio salió la plata, para el reparto 50/25/25. Va aparte de
   * `reportedBy` (quién lo cargó): con la cuenta compartida "VOLEA Team" los dos no
   * son la misma persona, y antes se adivinaba mal.
   */
  // paidBy es OBLIGATORIO a propósito: con un default a null, un llamador futuro que
  // se olvide del argumento compila en silencio y graba un gasto sin atribuir — que
  // es exactamente el bug que este cambio vino a cerrar.
  async registrarGastoCaja(
    label: string, amount: number, reportedBy: string, paidBy: SocioName,
  ): Promise<{ ok: boolean; error?: string }> {
    // Misma regla que registrarVentaCaja: intentar siempre que haya cliente.
    if (!supabase) {
      return { ok: false, error: 'Sin conexión con Supabase' };
    }
    const { data, error } = await conTechoEscritura(supabase.rpc('admin_registrar_gasto', {
      p_label: label,
      p_amount: amount,
      p_reported_by: reportedBy,
      p_paid_by: paidBy,
    }));
    if (error) {
      console.error('Error registrando gasto:', error);
      return { ok: false, error: error.message };
    }
    return { ok: data?.ok === true, error: typeof data?.error === 'string' ? data.error : undefined };
  },

  // ── Gastos pendientes: lo que falta pagar, antes de tocar la caja ─────────
  /** Trae pendientes y pagados; la UI separa. Solo equipo (owner/admin) vía RLS. */
  async getGastosPendientes(): Promise<GastoPendiente[] | null> {
    if (!supabase || !isSupabaseConnected()) return null;
    // Misma cautela que la caja: sin sesión, RLS devuelve vacío sin error y
    // mostraríamos "no hay nada que pagar", que es una mentira peligrosa.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await conReintento(
      () => conTechoLectura(supabase!.from('gastos_pendientes').select('*')
        .order('vence_el', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(500)),
      r => !!r.error,
    );
    if (error) { console.error('Error fetching gastos pendientes:', error); return null; }
    return ((data as Record<string, unknown>[]) || []).map(filaAGastoPendiente);
  },

  async saveGastoPendiente(g: GastoPendienteInput, createdBy: string): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: 'Sin conexión con Supabase' };
    const fila: Record<string, unknown> = {
      label: g.label.trim(),
      amount: g.amount,
      vence_el: g.venceEl || null,
      proveedor: g.proveedor?.trim() || null,
      notas: g.notas?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    // created_by solo en el alta: editar un gasto no cambia quién lo cargó.
    if (g.id) fila.id = g.id; else fila.created_by = createdBy || 'Web';
    const { error } = await conTechoEscritura(
      supabase.from('gastos_pendientes').upsert(fila, { onConflict: 'id' }),
    );
    if (error) { console.error('Error guardando gasto pendiente:', error); return { ok: false, error: error.message }; }
    return { ok: true };
  },

  async deleteGastoPendiente(id: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(supabase.from('gastos_pendientes').delete().eq('id', id));
    if (error) { console.error('Error borrando gasto pendiente:', error); return false; }
    return true;
  },

  /**
   * Lo marca pagado y asienta el gasto real en la caja, en una sola transacción.
   * `paidBy` es de quién salió la plata: es el dato que recién se conoce al pagar
   * y el que necesita el reparto 50/25/25.
   */
  async pagarGastoPendiente(
    id: string, paidBy: SocioName, reportedBy: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: 'Sin conexión con Supabase' };
    const { data, error } = await conTechoEscritura(supabase.rpc('admin_pagar_gasto_pendiente', {
      p_id: id, p_paid_by: paidBy, p_reported_by: reportedBy,
    }));
    if (error) { console.error('Error pagando gasto pendiente:', error); return { ok: false, error: error.message }; }
    const r = data as { ok?: boolean; error?: string } | null;
    return { ok: r?.ok === true, error: typeof r?.error === 'string' ? r.error : undefined };
  },

  /** Deshace un pago marcado por error: anula el movimiento y vuelve a pendiente. */
  async despagarGastoPendiente(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: 'Sin conexión con Supabase' };
    const { data, error } = await conTechoEscritura(
      supabase.rpc('admin_despagar_gasto_pendiente', { p_id: id }),
    );
    if (error) { console.error('Error deshaciendo pago:', error); return { ok: false, error: error.message }; }
    const r = data as { ok?: boolean; error?: string } | null;
    return { ok: r?.ok === true, error: typeof r?.error === 'string' ? r.error : undefined };
  },

  // ── Cuentas entre socios (tabla socio_moves, solo admins vía RLS) ──
  async getSocioMoves(): Promise<SocioMove[] | null> {
    if (!supabase || !isSupabaseConnected()) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await conReintento(
      () => conTechoLectura(supabase!.from('socio_moves').select('*')
        .order('orden', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(3000)),
      r => !!r.error,
    );
    if (error) { console.error('Error fetching socio moves:', error); return null; }
    return (data || []).map(row => ({
      id: row.id,
      area: row.area,
      tipo: row.tipo,
      periodo: row.periodo ?? null,
      fecha: row.fecha ?? null,
      descripcion: row.descripcion || '',
      monto: Number(row.monto) || 0,
      pagador: row.pagador ?? null,
      de: row.de ?? null,
      para: row.para ?? null,
      moneda: row.moneda === 'ARS' ? 'ARS' as const : 'UYU' as const,
      impBrian: Number(row.imp_brian) || 0,
      impPaula: Number(row.imp_paula) || 0,
      impGaston: Number(row.imp_gaston) || 0,
      source: row.source || '',
      cuotaGrupo: row.cuota_grupo ?? null,
      createdAt: row.created_at || '',
    }));
  },

  /**
   * Alta de movimientos de socios. Acepta varios (las cuotas de una compra van
   * juntas) y hace UN solo insert: o entran todas o ninguna. Cada fila tiene
   * que cerrar en cero por su cuenta — se rechaza cualquier alta cuyo reparto
   * no cuadre (protege la contabilidad ante bugs del form).
   */
  async addSocioMoves(inputs: SocioMoveInput[]): Promise<boolean> {
    if (!supabase || inputs.length === 0) return false;
    for (const input of inputs) {
      const suma = input.impBrian + input.impPaula + input.impGaston;
      if (Math.abs(suma) > 0.04 || !(input.monto > 0)) {
        console.error('Movimiento de socios inválido:', input);
        return false;
      }
    }
    const filas = inputs.map(input => ({
      area: input.area,
      tipo: input.tipo,
      fecha: input.fecha,
      descripcion: input.descripcion,
      monto: Math.round(input.monto * 100) / 100,
      pagador: input.pagador,
      de: input.de,
      para: input.para,
      moneda: 'UYU',
      imp_brian: input.impBrian,
      imp_paula: input.impPaula,
      imp_gaston: input.impGaston,
      source: 'web',
      cuota_grupo: input.cuotaGrupo ?? null,
    }));
    const { error } = await conTechoEscritura(supabase.from('socio_moves').insert(filas));
    if (error) { console.error('Error adding socio moves:', error); return false; }
    return true;
  },

  async deleteSocioMove(id: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(supabase.from('socio_moves').delete().eq('id', id));
    if (error) { console.error('Error deleting socio move:', error); return false; }
    return true;
  },

  /** Borra TODAS las cuotas de una compra (mismo cuota_grupo). */
  async deleteSocioMovesGrupo(grupo: string): Promise<boolean> {
    if (!supabase || !grupo) return false;
    const { error } = await conTechoEscritura(supabase.from('socio_moves').delete().eq('cuota_grupo', grupo));
    if (error) { console.error('Error deleting cuotas:', error); return false; }
    return true;
  },

  /**
   * Liquida ventas/gastos del bot a las cuentas de socios: crea los movimientos
   * y marca las filas de la caja como liquidadas, todo en una sola transacción
   * (el RPC valida que los montos coincidan y que nada esté ya liquidado).
   */
  async liquidarCaja(ids: string[], moves: SocioLiquidacionMove[]): Promise<{ ok: boolean; error?: string }> {
    if (!supabase || !isSupabaseConnected()) {
      return { ok: false, error: 'Sin conexión con Supabase' };
    }
    const { data, error } = await conTechoEscritura(supabase.rpc('admin_liquidar_caja', { p_ids: ids, p_moves: moves }));
    if (error) {
      console.error('Error liquidando caja:', error);
      return { ok: false, error: error.message };
    }
    return { ok: data?.ok === true, error: typeof data?.error === 'string' ? data.error : undefined };
  },

  // ── Storage: subida de imágenes (bucket product-images, requiere sesión admin) ──
  async uploadImage(file: File, folder = 'uploads'): Promise<string | null> {
    if (!supabase) return null;
    // Foto del celular (4-12 MB) → JPEG 1600px (~200-400 KB): sube 10-30× más rápido y
    // no come el 1 GB total del plan gratis. Si no se puede comprimir, va la original.
    // La compresión también con techo: un decode colgado (HEIC raro, tab sin foco
    // con rAF frenado) dejaba el spinner infinito sin toast. Si no llega, va la original.
    const liviana = await conLimite(comprimirImagen(file), 20000, file);
    const ext = (liviana.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    // Techo de 45s: sin él, una conexión trabada dejaba "Subiendo..." infinito sin aviso.
    // Con compresión una subida real tarda ~1-3s; si esto salta es un cuelgue de verdad
    // y el editor muestra su toast de error para que el usuario reintente.
    // Tipo explícito acotado a lo único que se consume (error): sin casts a los tipos
    // internos de supabase-js, que además mentirían sobre la forma del respaldo.
    const resultado = await conLimite<{ error: { message: string } | null }>(
      supabase.storage.from('product-images').upload(path, liviana, { cacheControl: '3600', upsert: false }),
      45000,
      { error: new Error('La subida tardó demasiado (conexión trabada)') },
    );
    if (resultado.error) { console.error('Error uploading image:', resultado.error); return null; }
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
      phone: row.phone || '',
      endDate: row.end_date || '',
      inscripcionesAbiertas: row.inscripciones_abiertas === true,
      categorias: row.categorias || '',
      // Topes DUPR por categoría (editables desde la pestaña Inscripciones).
      topes: row.topes && typeof row.topes === 'object' && !Array.isArray(row.topes)
        ? Object.fromEntries(
            Object.entries(row.topes as Record<string, { individual?: unknown; suma?: unknown }>)
              .filter(([, v]) => v && typeof (v as { individual?: unknown }).individual === 'number')
              .map(([k, v]) => [k, {
                individual: (v as { individual: number }).individual,
                suma: typeof (v as { suma?: unknown }).suma === 'number' ? (v as { suma: number }).suma : null,
              }]),
          )
        : null,
      // La tarifa se setea por SQL; el upsert del admin no la incluye y no la pisa.
      tarifa: row.tarifa && typeof row.tarifa === 'object' && typeof row.tarifa.base === 'number'
        && typeof row.tarifa.incluye === 'number' && typeof row.tarifa.extra === 'number'
        ? { base: row.tarifa.base, incluye: row.tarifa.incluye, extra: row.tarifa.extra }
        : null,
    }));
  },

  async setEvents(events: Event[]): Promise<void> {
    if (!supabase) return;
    for (const e of events) {
      await conTechoEscritura(supabase.from('events').upsert({
        id: e.id, name: e.name, date: e.date, time: e.time,
        location: e.location, city: e.city, description: e.description,
        image_url: e.imageUrl, maps_url: e.mapsUrl,
        max_participants: e.maxParticipants || null,
        status: e.status, category: e.category,
        phone: e.phone || null,
        end_date: e.endDate || null,
        inscripciones_abiertas: e.inscripcionesAbiertas === true,
        categorias: e.categorias || '',
      }, { onConflict: 'id' }));
    }
  },

  async deleteEvent(id: string): Promise<void> {
    if (!supabase) return;
    await conTechoEscritura(supabase.from('events').delete().eq('id', id));
  },

  // ── Inscripciones ──
  /**
   * Alta pública de inscripción (RPC inscribir_evento, corre como anon).
   * Sin isSupabaseConnected(): misma regla que las escrituras del admin — se
   * intenta siempre que haya cliente, el probe frío da falsos negativos.
   */
  async inscribirEvento(i: InscripcionInput): Promise<{ ok: boolean; actualizada?: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: 'Sin conexión con el servidor' };
    const { data, error } = await conTechoEscritura(supabase.rpc('inscribir_evento', {
      p_event_id: i.eventId,
      p_nombre: i.nombre,
      p_celular: i.celular,
      p_categorias: i.categorias,
      p_email: i.email || '',
      p_pareja: i.pareja || '',
      p_parejas: i.parejas || {},
      p_dupr_id: i.duprId || '',
      p_notas: i.notas || '',
    }));
    if (error) {
      console.error('Error inscribiendo:', error);
      return { ok: false, error: 'No pudimos enviar tu inscripción. Probá de nuevo en un rato.' };
    }
    return {
      ok: data?.ok === true,
      actualizada: data?.actualizada === true,
      error: typeof data?.error === 'string' ? data.error : undefined,
    };
  },

  /** Guarda los topes DUPR por categoría del evento (solo esa columna). */
  async setTopesEvento(eventId: string, topes: Record<string, { individual: number; suma: number | null }>): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(supabase.from('events').update({ topes }).eq('id', eventId));
    if (error) { console.error('Error guardando topes:', error); return false; }
    return true;
  },

  /** ¿Este nombre ya está anotado en el evento? Boolean pelado, apto público. */
  async inscripcionExiste(eventId: string, nombre: string): Promise<boolean> {
    if (!supabase || nombre.trim() === '') return false;
    const { data, error } = await conTechoLectura(
      supabase.rpc('inscripcion_existe', { p_event_id: eventId, p_nombre: nombre.trim() }),
    );
    if (error) return false;
    return data === true;
  },

  /** Cuántos inscriptos tiene un evento (número agregado, apto público). */
  async contarInscriptos(eventId: string): Promise<number | null> {
    if (!supabase) return null;
    const { data, error } = await conTechoLectura(supabase.rpc('contar_inscriptos', { p_event_id: eventId }));
    if (error) return null;
    return typeof data === 'number' ? data : null;
  },

  /** Lista de inscriptos de un evento — solo admins (RLS con is_admin()). */
  async getInscripciones(eventId: string): Promise<Inscripcion[] | null> {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await conTechoLectura(
      supabase.from('inscripciones').select('*').eq('event_id', eventId).order('created_at', { ascending: true }),
    );
    if (error) { console.error('Error fetching inscripciones:', error); return null; }
    return (data || []).map(row => ({
      id: row.id,
      eventId: row.event_id,
      nombre: row.nombre || '',
      celular: row.celular || '',
      email: row.email || '',
      categorias: row.categorias || '',
      pareja: row.pareja || '',
      parejas: row.parejas && typeof row.parejas === 'object' && !Array.isArray(row.parejas) ? row.parejas : {},
      duprId: row.dupr_id || '',
      notas: row.notas || '',
      estado: row.estado || 'pendiente',
      pagoCosto: row.pago_costo !== null && row.pago_costo !== undefined ? Number(row.pago_costo) : null,
      pagoMonto: row.pago_monto !== null && row.pago_monto !== undefined ? Number(row.pago_monto) : null,
      pagoMetodo: row.pago_metodo ?? null,
      pagoDeuda: row.pago_deuda !== null && row.pago_deuda !== undefined ? Number(row.pago_deuda) : null,
      pagoAt: row.pago_at ?? null,
      createdAt: row.created_at || '',
    }));
  },

  /**
   * Garantiza ficha en el padrón (rk_jugadores) para cada nombre: los que no
   * matchean por normalizado (contra nombres Y alias) se crean con id nuevo.
   * Devuelve los creados. Pedido de Brian 15/8: todo el que él "decreta"
   * (inscripto o pareja declarada) tiene ficha, haya jugado o no. Si la
   * lectura del padrón falla NO se crea nada (evita duplicar a ciegas).
   * Server-side es seguro: el sync de torneos solo borra ids que ese cliente
   * ya tenía en su jugadoresBase.
   */
  async asegurarJugadoresPadron(nombres: string[]): Promise<string[]> {
    if (!supabase || nombres.length === 0) return [];
    const { data, error } = await conTechoLectura(supabase.from('rk_jugadores').select('nombre, alias'));
    if (error || !data) return [];
    const conocidos: string[] = [];
    for (const j of data as { nombre?: string; alias?: unknown }[]) {
      if (typeof j.nombre === 'string' && j.nombre) conocidos.push(j.nombre);
      if (Array.isArray(j.alias)) for (const a of j.alias) if (typeof a === 'string' && a) conocidos.push(a);
    }
    const faltan = faltantesEnPadron(nombres, conocidos);
    if (faltan.length === 0) return [];
    const ABC = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const idJugador = () => Array.from({ length: 8 }, () => ABC[Math.floor(Math.random() * ABC.length)]).join('');
    const filas = faltan.map(nombre => ({ id: idJugador(), nombre, alias: [], updated_at: new Date().toISOString() }));
    const { error: e2 } = await conTechoEscritura(supabase.from('rk_jugadores').insert(filas));
    if (e2) { console.error('Error creando fichas de padrón:', e2); return []; }
    return faltan;
  },

  /**
   * Alta manual desde el admin (inscripciones que llegan por WhatsApp): insert
   * directo con la policy de admins, sin las validaciones del form público
   * (celular opcional; sirve aunque las inscripciones online estén cerradas).
   */
  async addInscripcionAdmin(i: InscripcionInput & { estado: Inscripcion['estado'] }): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(supabase.from('inscripciones').insert({
      event_id: i.eventId,
      nombre: i.nombre.trim(),
      celular: (i.celular || '').trim(),
      email: (i.email || '').trim(),
      categorias: i.categorias,
      pareja: '',
      parejas: i.parejas || {},
      dupr_id: (i.duprId || '').trim(),
      notas: (i.notas || '').trim(),
      estado: i.estado,
    }));
    if (error) { console.error('Error alta inscripción admin:', error); return false; }
    return true;
  },

  /** Edición completa de una inscripción desde el admin (no toca el `pareja` legacy). */
  async updateInscripcionAdmin(id: string, i: InscripcionInput & { estado: Inscripcion['estado'] }): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(supabase.from('inscripciones').update({
      nombre: i.nombre.trim(),
      celular: (i.celular || '').trim(),
      email: (i.email || '').trim(),
      categorias: i.categorias,
      parejas: i.parejas || {},
      dupr_id: (i.duprId || '').trim(),
      notas: (i.notas || '').trim(),
      estado: i.estado,
    }).eq('id', id));
    if (error) { console.error('Error edición inscripción admin:', error); return false; }
    return true;
  },

  /**
   * Registra el pago de una inscripción (RPC atómica): el costo se calcula
   * server-side, lo pagado entra a la Caja como venta y el saldo queda como
   * deuda con el nombre en «Por cobrar». freepass = sin cargo, sin caja.
   */
  async pagoInscripcion(
    id: string,
    monto: number,
    metodo: 'mp' | 'efectivo' | 'transferencia' | 'freepass',
    reportedBy: string,
  ): Promise<{ ok: boolean; error?: string; deuda?: number }> {
    if (!supabase) return { ok: false, error: 'Sin conexión con el servidor' };
    const { data, error } = await conTechoEscritura(supabase.rpc('admin_pago_inscripcion', {
      p_id: id,
      p_monto: monto,
      p_metodo: metodo,
      p_reported_by: reportedBy,
    }));
    if (error) {
      console.error('Error registrando pago de inscripción:', error);
      return { ok: false, error: 'No se pudo registrar el pago. Verificá tu sesión.' };
    }
    return {
      ok: data?.ok === true,
      error: typeof data?.error === 'string' ? data.error : undefined,
      deuda: typeof data?.deuda === 'number' ? data.deuda : undefined,
    };
  },

  async setEstadoInscripcion(id: string, estado: Inscripcion['estado']): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(supabase.from('inscripciones').update({ estado }).eq('id', id));
    if (error) { console.error('Error updating inscripción:', error); return false; }
    return true;
  },

  /**
   * Cuántas inscripciones entraron después de `desdeISO` (badge del admin).
   * Head count, sin filas: barato para consultarlo al montar el panel.
   */
  async getInscripcionesNuevas(desdeISO: string): Promise<number | null> {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const res = await conTechoLectura(
      supabase.from('inscripciones').select('id', { count: 'exact', head: true }).gt('created_at', desdeISO),
    );
    if (res.error) return null;
    return ('count' in res ? res.count : 0) ?? 0;
  },

  /** Padrón completo con alias y DUPR ID (para la carga masiva de DUPR). */
  async getJugadoresPadron(): Promise<JugadorPadron[]> {
    if (!supabase) return [];
    const { data, error } = await conTechoLectura(
      supabase.from('rk_jugadores').select('id, nombre, alias, dupr_id, dupr_rating, dupr_rating_at'),
    );
    if (error || !data) return [];
    return (data as { id: string; nombre?: string; alias?: unknown; dupr_id?: string | null; dupr_rating?: number | string | null; dupr_rating_at?: string | null }[]).map(j => ({
      id: j.id,
      nombre: j.nombre || '',
      alias: Array.isArray(j.alias) ? j.alias.filter((a): a is string => typeof a === 'string') : [],
      duprId: j.dupr_id || null,
      rating: j.dupr_rating !== null && j.dupr_rating !== undefined ? Number(j.dupr_rating) : null,
      ratingAt: j.dupr_rating_at || null,
    }));
  },

  /**
   * Vincula todas las filas de un deudor a un jugador del padrón y canoniza el
   * nombre: las deudas partidas de la misma persona se juntan solas.
   */
  async vincularDeudor(nombre: string, jugadorId: string): Promise<{ ok: boolean; tocadas?: number; nombre?: string; error?: string }> {
    if (!supabase) return { ok: false, error: 'Sin conexión con el servidor' };
    const { data, error } = await conTechoEscritura(
      supabase.rpc('admin_vincular_deudor', { p_nombre: nombre, p_jugador_id: jugadorId }),
    );
    if (error) {
      console.error('Error vinculando deudor:', error);
      return { ok: false, error: 'No se pudo vincular. Verificá tu sesión de admin.' };
    }
    return {
      ok: data?.ok === true,
      tocadas: typeof data?.tocadas === 'number' ? data.tocadas : undefined,
      nombre: typeof data?.nombre === 'string' ? data.nombre : undefined,
      error: typeof data?.error === 'string' ? data.error : undefined,
    };
  },

  /**
   * Guarda DUPR (id y/o rating) en lote. Solo se pisa lo que viene: mandar solo
   * el rating no borra el ID y viceversa. El rating se guarda fechado.
   */
  async setDuprIds(asignaciones: { id: string; duprId?: string; rating?: number | null }[]): Promise<{ ok: boolean; tocados?: number; error?: string }> {
    if (!supabase || asignaciones.length === 0) return { ok: false, error: 'Nada para guardar' };
    const { data, error } = await conTechoEscritura(supabase.rpc('admin_set_dupr_ids', { p_asignaciones: asignaciones }));
    if (error) {
      console.error('Error guardando DUPR IDs:', error);
      return { ok: false, error: 'No se pudo guardar. Verificá tu sesión de admin.' };
    }
    return {
      ok: data?.ok === true,
      tocados: typeof data?.tocados === 'number' ? data.tocados : undefined,
      error: typeof data?.error === 'string' ? data.error : undefined,
    };
  },

  /**
   * Nombres del padrón (rk_jugadores, lectura pública) + alias, para datalists
   * del form de inscripción y sugerencias de deudor en la Caja.
   */
  async getJugadoresNombres(): Promise<string[]> {
    if (!supabase) return [];
    const { data, error } = await conTechoLectura(supabase.from('rk_jugadores').select('nombre, alias'));
    if (error || !data) return [];
    const out: string[] = [];
    for (const j of data as { nombre?: string; alias?: unknown }[]) {
      if (typeof j.nombre === 'string' && j.nombre) out.push(j.nombre);
      if (Array.isArray(j.alias)) for (const a of j.alias) if (typeof a === 'string' && a) out.push(a);
    }
    return out;
  },

  // ── Promos ──
  // Solo lectura desde el sitio: el alta/edición de promos es por SQL. El server
  // de Mercado Pago lee la MISMA tabla para cobrar el descuento (api/mp/preferencia).
  async getPromos(): Promise<Promo[]> {
    if (!supabase || !isSupabaseConnected()) return [];
    const { data, error } = await supabase
      .from('promos')
      .select('id, label, percent, starts_on, ends_on, delivery_note, active')
      .eq('active', true);
    if (error) { console.error('Error fetching promos:', error); return []; }
    return (data || []).map(row => ({
      id: row.id,
      label: row.label || '',
      percent: Number(row.percent) || 0,
      startsOn: row.starts_on || '',
      endsOn: row.ends_on || '',
      deliveryNote: row.delivery_note || '',
      active: row.active !== false,
    }));
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
      paymentStatus: row.payment_status ?? null,
      paymentProvider: row.payment_provider ?? null,
      mpPreferenceId: row.mp_preference_id ?? null,
      mpPaymentId: row.mp_payment_id ?? null,
      paidAt: row.paid_at ?? null,
      paidAmount: row.paid_amount ?? null,
      createdAt: row.created_at?.split('T')[0] || '',
    }));
  },

  // Insert plano para el checkout anónimo. RLS permite INSERT a cualquiera,
  // pero rechaza el upsert (ON CONFLICT DO UPDATE) porque el brazo UPDATE
  // exige is_admin(). No usar upsert acá.
  // Devuelve true si el insert llegó a Supabase: el flujo de Mercado Pago
  // NO manda al cliente a pagar si el pedido no quedó en la DB.
  async addOrder(o: Order): Promise<boolean> {
    if (!supabase) return false;
    const row: Record<string, unknown> = orderToRow(o);
    // Los campos de pago se escriben SOLO acá (insert del checkout). El
    // upsert del admin (setOrders/orderToRow) no los incluye a propósito:
    // así nunca pisa lo que el webhook de MP escribió con service role.
    if (o.paymentStatus) {
      row.payment_status = o.paymentStatus;
      row.payment_provider = o.paymentProvider ?? 'mp';
      // 'web' y no 'web-mp': el CHECK orders_source_check de la DB viva solo
      // admite whatsapp/shopify/web/telegram. El pago se distingue por
      // payment_provider, no por source.
      row.source = 'web';
    }
    // Mismo techo de 15s que las escrituras admin: el flujo de Mercado Pago espera
    // este insert; un cuelgue acá dejaba el checkout colgado en vez de avisar.
    const { error } = await conTechoEscritura(supabase.from('orders').insert(row));
    if (error) { console.error('Error inserting order:', error); return false; }
    return true;
  },

  // Solo admins autenticados (magic link) pueden actualizar pedidos existentes.
  async setOrders(orders: Order[]): Promise<boolean> {
    if (!supabase) return true;
    let ok = true;
    for (const o of orders) {
      const { error } = await conTechoEscritura(supabase.from('orders').upsert(orderToRow(o), { onConflict: 'id' }));
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
    if (!supabase) return;
    for (const c of clubs) {
      await conTechoEscritura(supabase.from('clubs').upsert({
        id: c.id, name: c.name, address: c.address, city: c.city,
        country: c.country, lat: c.lat, lng: c.lng, phone: c.phone || '',
        instagram: c.instagram || '', has_pickleball: c.hasPickleball,
        description: c.description,
      }, { onConflict: 'id' }));
    }
  },

  async deleteClub(id: string): Promise<void> {
    if (!supabase) return;
    await conTechoEscritura(supabase.from('clubs').delete().eq('id', id));
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
    if (!supabase) return;
    for (const a of announcements) {
      await conTechoEscritura(supabase.from('announcements').upsert({
        id: a.id, title: a.title, content: a.content,
        type: a.type, active: a.active,
      }, { onConflict: 'id' }));
    }
  },

  async deleteAnnouncement(id: string): Promise<void> {
    if (!supabase) return;
    await conTechoEscritura(supabase.from('announcements').delete().eq('id', id));
  },

  // ─── Pedidos: proveedores y sublimación ───────────────────────────────────
  // Se leen con sus líneas en una sola consulta (embed de PostgREST).
  async getCompras(): Promise<Compra[] | null> {
    if (!supabase) return null;
    const { data, error } = await conTechoLectura(
      supabase.from('compras').select('*, compra_items(*)').order('created_at', { ascending: false }),
    );
    if (error) { console.error('Error fetching compras:', error); return null; }
    return ((data as Record<string, unknown>[]) || []).map(filaACompra);
  },

  async saveCompra(c: Compra): Promise<{ ok: boolean; id?: string; error?: string }> {
    if (!supabase) return { ok: false, error: 'Sin conexion' };
    const fila: Record<string, unknown> = {
      tipo: c.tipo,
      proveedor: c.proveedor,
      referencia: c.referencia || null,
      estado: c.estado,
      fecha_pedido: c.fechaPedido || null,
      fecha_estimada: c.fechaEstimada || null,
      notas: c.notas || null,
      prenda_base: c.prendaBase || null,
      mockup_url: c.mockupUrl || null,
      archivos: c.archivos ?? [],
      comentario_taller: c.comentarioTaller || null,
      creado_por: c.creadoPor || null,
      updated_at: new Date().toISOString(),
    };
    if (c.id) fila.id = c.id;

    const { data, error } = await conTechoEscritura(
      supabase.from('compras').upsert(fila, { onConflict: 'id' }).select('id').single(),
    );
    if (error) { console.error('Error saving compra:', error); return { ok: false, error: error.message }; }
    const compraId = (data as { id: string } | null)?.id ?? c.id;

    // Las lineas se reemplazan enteras: es un pedido chico y asi no quedan huerfanas.
    const { error: eDel } = await conTechoEscritura(
      supabase.from('compra_items').delete().eq('compra_id', compraId),
    );
    if (eDel) { console.error('Error limpiando items:', eDel); return { ok: false, error: eDel.message }; }

    if (c.items.length > 0) {
      const filas = c.items.map((it, i) => ({
        compra_id: compraId,
        product_id: it.productId,
        descripcion: it.descripcion,
        variante: it.variante,
        cantidad: it.cantidad,
        cantidad_recibida: it.cantidadRecibida ?? 0,
        costo_unitario: it.costoUnitario,
        orden: i,
      }));
      const { error: eIns } = await conTechoEscritura(supabase.from('compra_items').insert(filas));
      if (eIns) { console.error('Error guardando items:', eIns); return { ok: false, error: eIns.message }; }
    }
    return { ok: true, id: compraId };
  },

  async deleteCompra(id: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(supabase.from('compras').delete().eq('id', id));
    if (error) { console.error('Error borrando compra:', error); return false; }
    return true;
  },

  /** Cotejo de recepcion: suma al stock solo la diferencia y cierra el pedido si llego todo. */
  async recibirCompra(compraId: string, items: RecepcionItem[]): Promise<
    { ok: boolean; estado?: string; unidades?: number; pendientes?: number; error?: string }> {
    if (!supabase) return { ok: false, error: 'Sin conexion' };
    const { data, error } = await conTechoEscritura(supabase.rpc('recibir_compra', {
      p_compra_id: compraId,
      p_items: items.map(i => ({ item_id: i.itemId, recibida: i.recibida })),
    }));
    if (error) { console.error('Error recibiendo compra:', error); return { ok: false, error: error.message }; }
    const r = data as { estado?: string; unidades_a_stock?: number; items_pendientes?: number } | null;
    return { ok: true, estado: r?.estado, unidades: r?.unidades_a_stock, pendientes: r?.items_pendientes };
  },

  /** Solo el taller: avanza el estado de su trabajo, sin tocar nada mas. */
  async sublimacionEstado(compraId: string, estado: 'en_proceso' | 'en_camino'): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(
      supabase.rpc('sublimacion_estado', { p_compra_id: compraId, p_estado: estado }),
    );
    if (error) { console.error('Error actualizando estado:', error); return false; }
    return true;
  },

  // ─── Tareas del equipo ────────────────────────────────────────────────────
  async getTareas(): Promise<Tarea[] | null> {
    if (!supabase) return null;
    const { data, error } = await conTechoLectura(
      supabase.from('tareas').select('*').order('created_at', { ascending: false }),
    );
    if (error) { console.error('Error fetching tareas:', error); return null; }
    return ((data as Record<string, unknown>[]) || []).map(filaATarea);
  },

  async saveTarea(t: Tarea): Promise<boolean> {
    if (!supabase) return false;
    const fila: Record<string, unknown> = {
      titulo: t.titulo,
      detalle: t.detalle || null,
      estado: t.estado,
      prioridad: t.prioridad,
      asignado_a: t.asignadoA || null,
      creado_por: t.creadoPor || null,
      vence_el: t.venceEl || null,
      // La marca de completada la decide el estado, no la UI.
      completada_at: t.estado === 'hecha' ? (t.completadaAt || new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    };
    if (t.id) fila.id = t.id;
    const { error } = await conTechoEscritura(supabase.from('tareas').upsert(fila, { onConflict: 'id' }));
    if (error) { console.error('Error guardando tarea:', error); return false; }
    return true;
  },

  async deleteTarea(id: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(supabase.from('tareas').delete().eq('id', id));
    if (error) { console.error('Error borrando tarea:', error); return false; }
    return true;
  },

  // ─── Tanteador (bádminton dobles) ─────────────────────────────────────────
  async getTanteadorPartidos(): Promise<TanteadorPartido[] | null> {
    if (!supabase) return null;
    const { data, error } = await conTechoLectura(
      supabase.from('tanteador_partidos').select('*').order('created_at', { ascending: false }),
    );
    if (error) { console.error('Error fetching tanteador:', error); return null; }
    return ((data as Record<string, unknown>[]) || []).map(filaATanteadorPartido);
  },

  async saveTanteadorPartido(p: TanteadorPartido): Promise<boolean> {
    if (!supabase) return false;
    const fila: Record<string, unknown> = {
      id: p.id,
      torneo_id: p.torneoId,
      categoria: p.categoria,
      modo: p.modo,
      pareja_a: p.parejaA,
      pareja_b: p.parejaB,
      jugadores_a: p.jugadoresA,
      jugadores_b: p.jugadoresB,
      juez: p.juez || null,
      cancha: p.cancha,
      obj: p.obj,
      cap: p.cap,
      cambio_en: p.cambioEn,
      sets: p.sets,
      hist: p.hist,
      estado: p.estado,
      ganador: p.ganador,
      invertido: p.invertido,
      avisos: p.avisos,
      creado_por: p.creadoPor,
      updated_at: new Date().toISOString(),
      terminado_at: p.terminadoAt,
    };
    const { error } = await conTechoEscritura(
      supabase.from('tanteador_partidos').upsert(fila, { onConflict: 'id' }),
    );
    if (error) { console.error('Error guardando partido del tanteador:', error); return false; }
    return true;
  },

  async deleteTanteadorPartido(id: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(
      supabase.from('tanteador_partidos').delete().eq('id', id),
    );
    if (error) { console.error('Error borrando partido del tanteador:', error); return false; }
    return true;
  },

  /**
   * Parejas ya cargadas en los torneos activos (rk_torneos), para armar
   * partidos con un toque. Solo lectura: el tanteador jamás escribe rk_torneos.
   */
  async getTanteadorSugerencias(): Promise<{ torneoId: string; torneo: string; parejas: string[] }[] | null> {
    if (!supabase) return null;
    const { data, error } = await conTechoLectura(
      supabase.from('rk_torneos').select('id, nombre, fase, data'),
    );
    if (error) { console.error('Error fetching sugerencias del tanteador:', error); return null; }
    return ((data as Record<string, unknown>[]) || [])
      .filter((r) => (r.fase as string) !== 'terminado')
      .map((r) => {
        const d = (r.data as Record<string, unknown>) || {};
        const parejas = (Array.isArray(d.parejas) ? d.parejas : [])
          .map((x) => ((x as Record<string, unknown>)?.nombre as string) || '')
          .filter(Boolean);
        return { torneoId: r.id as string, torneo: (r.nombre as string) || '', parejas };
      })
      .filter((t) => t.parejas.length > 0);
  },

  // ─── Equipo ───────────────────────────────────────────────────────────────
  async getEquipo(): Promise<MiembroEquipo[] | null> {
    if (!supabase) return null;
    const { data, error } = await conTechoLectura(
      supabase.from('admins').select('email, name, role, activo').order('role'),
    );
    if (error) { console.error('Error fetching equipo:', error); return null; }
    return ((data as Record<string, unknown>[]) || []).map(r => ({
      email: r.email as string,
      name: (r.name as string) || '',
      role: (r.role as MiembroEquipo['role']) || 'admin',
      activo: (r.activo as boolean) ?? true,
    }));
  },

  /** Solo el owner (lo impone RLS). Da de alta/baja o cambia el rol. */
  async saveMiembro(m: MiembroEquipo): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await conTechoEscritura(supabase.from('admins').upsert({
      email: m.email.toLowerCase().trim(), name: m.name, role: m.role, activo: m.activo,
    }, { onConflict: 'email' }));
    if (error) { console.error('Error guardando miembro:', error); return false; }
    return true;
  },
};


// ─── Mapeo de filas ──────────────────────────────────────────────────────────
function filaACompra(row: Record<string, unknown>): Compra {
  const items = (row.compra_items as Record<string, unknown>[] | null) ?? [];
  return {
    id: row.id as string,
    tipo: (row.tipo as Compra['tipo']) || 'proveedor',
    proveedor: (row.proveedor as string) || '',
    referencia: (row.referencia as string) || '',
    estado: (row.estado as Compra['estado']) || 'borrador',
    fechaPedido: (row.fecha_pedido as string) ?? null,
    fechaEstimada: (row.fecha_estimada as string) ?? null,
    recibidoAt: (row.recibido_at as string) ?? null,
    notas: (row.notas as string) || '',
    prendaBase: (row.prenda_base as string) || '',
    mockupUrl: (row.mockup_url as string) || '',
    archivos: Array.isArray(row.archivos) ? (row.archivos as CompraArchivo[]) : [],
    comentarioTaller: (row.comentario_taller as string) || '',
    creadoPor: (row.creado_por as string) || '',
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
    items: items
      .map((it): CompraItem => ({
        id: it.id as string,
        compraId: it.compra_id as string,
        productId: (it.product_id as string) ?? null,
        descripcion: (it.descripcion as string) || '',
        variante: (it.variante as string) ?? null,
        cantidad: Number(it.cantidad) || 0,
        cantidadRecibida: Number(it.cantidad_recibida) || 0,
        costoUnitario: it.costo_unitario !== null && it.costo_unitario !== undefined
          ? Number(it.costo_unitario) : null,
        orden: Number(it.orden) || 0,
      }))
      .sort((a, b) => a.orden - b.orden),
  };
}

function filaAGastoPendiente(row: Record<string, unknown>): GastoPendiente {
  return {
    id: row.id as string,
    label: (row.label as string) || '',
    amount: Number(row.amount) || 0,
    venceEl: (row.vence_el as string) ?? null,
    proveedor: (row.proveedor as string) ?? null,
    notas: (row.notas as string) ?? null,
    createdBy: (row.created_by as string) || '',
    createdAt: (row.created_at as string) || '',
    pagadoAt: (row.pagado_at as string) ?? null,
    pagadoPor: (row.pagado_por as GastoPendiente['pagadoPor']) ?? null,
    ledgerId: (row.ledger_id as string) ?? null,
  };
}

function filaATanteadorPartido(row: Record<string, unknown>): TanteadorPartido {
  const hist = Array.isArray(row.hist) ? (row.hist as TanteadorPartido['hist']) : [[]];
  return {
    id: row.id as string,
    torneoId: (row.torneo_id as string) ?? null,
    categoria: (row.categoria as TanteadorPartido['categoria']) || 'DM',
    modo: (row.modo as TanteadorPartido['modo']) || 'fijas',
    parejaA: (row.pareja_a as string) || '',
    parejaB: (row.pareja_b as string) || '',
    jugadoresA: Array.isArray(row.jugadores_a) ? (row.jugadores_a as string[]) : [],
    jugadoresB: Array.isArray(row.jugadores_b) ? (row.jugadores_b as string[]) : [],
    juez: (row.juez as string) ?? null,
    cancha: (row.cancha as string) || '1',
    obj: (row.obj as number) || 15,
    cap: (row.cap as number) || 21,
    cambioEn: (row.cambio_en as number) || 8,
    sets: Array.isArray(row.sets) ? (row.sets as TanteadorPartido['sets']) : [],
    hist: hist.length ? hist : [[]],
    estado: (row.estado as TanteadorPartido['estado']) || 'en_juego',
    ganador: (row.ganador as TanteadorPartido['ganador']) ?? null,
    invertido: !!row.invertido,
    avisos: (row.avisos as Record<string, boolean>) || {},
    creadoPor: (row.creado_por as string) || '',
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
    terminadoAt: (row.terminado_at as string) ?? null,
  };
}

function filaATarea(row: Record<string, unknown>): Tarea {
  return {
    id: row.id as string,
    titulo: (row.titulo as string) || '',
    detalle: (row.detalle as string) || '',
    estado: (row.estado as Tarea['estado']) || 'pendiente',
    prioridad: (row.prioridad as Tarea['prioridad']) || 'normal',
    asignadoA: (row.asignado_a as string) ?? null,
    creadoPor: (row.creado_por as string) || '',
    venceEl: (row.vence_el as string) ?? null,
    completadaAt: (row.completada_at as string) ?? null,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}
