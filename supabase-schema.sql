-- ============================================
-- VOLEA - Pickleball E-Commerce
-- Supabase Database Schema v3
-- Proyecto: volea-web (scftuxrtflfowohiewsc, sa-east-1)
-- ============================================
-- Este archivo DOCUMENTA el schema real de la base (ya aplicado).
-- Para recrear desde cero: SQL Editor > New Query > pegar y Run.
--
-- Nota de arquitectura: products y categories NO viven en Supabase.
-- Shopify (volea-6996.myshopify.com) es la fuente de verdad del catálogo,
-- snapshot en src/data/shopify-catalog.json regenerado con scripts/build-catalog.mjs.

-- Tabla de admins (allowlist para el login por magic link en /#/admin)
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de eventos
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  date DATE NOT NULL,
  time TEXT DEFAULT '',
  location TEXT NOT NULL,
  city TEXT DEFAULT 'Montevideo',
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  maps_url TEXT DEFAULT '',
  max_participants INTEGER,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'past')),
  category TEXT DEFAULT 'tournament' CHECK (category IN ('tournament', 'clinic', 'social')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de clubes
CREATE TABLE IF NOT EXISTS clubs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  country TEXT DEFAULT 'Uruguay',
  lat NUMERIC DEFAULT 0,
  lng NUMERIC DEFAULT 0,
  phone TEXT DEFAULT '',
  instagram TEXT DEFAULT '',
  has_pickleball BOOLEAN DEFAULT true,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de anuncios
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'promo', 'event', 'important')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de pedidos: checkout anónimo coordinado por WhatsApp y/o pagado online
-- con Mercado Pago (el webhook escribe payment_status con service role).
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT DEFAULT '',
  customer_email TEXT DEFAULT '',
  customer_phone TEXT DEFAULT '',
  customer_address TEXT DEFAULT '',
  customer_city TEXT DEFAULT '',
  customer_department TEXT DEFAULT '',
  customer_notes TEXT DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  -- Pago online con Mercado Pago (2026-08-05). null = flujo WhatsApp puro.
  payment_status TEXT,
  payment_provider TEXT,
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  paid_at TIMESTAMPTZ,
  paid_amount NUMERIC,
  source TEXT DEFAULT 'whatsapp' CHECK (source IN ('whatsapp', 'shopify', 'web', 'telegram')),
  shopify_order_gid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Función helper: ¿el usuario autenticado está en la allowlist de admins?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins
    WHERE lower(email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
  )
$$;

-- RLS
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- admins: SIN lectura pública (migración lock_down_admins_table, 2026-07-09).
-- El pre-check del login usa la RPC booleana is_admin_email(p_email) y cada
-- admin autenticado puede leer solo su propia fila:
--   CREATE POLICY "admins_self_read" ON admins FOR SELECT TO authenticated
--     USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email')::text, '')));

-- events / clubs: lectura pública, escritura solo admins
CREATE POLICY "events_public_read" ON events FOR SELECT USING (true);
CREATE POLICY "events_admin_write" ON events FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "clubs_public_read" ON clubs FOR SELECT USING (true);
CREATE POLICY "clubs_admin_write" ON clubs FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- announcements: lectura pública solo de activos, escritura solo admins
CREATE POLICY "announcements_public_read" ON announcements FOR SELECT USING (active = true);
CREATE POLICY "announcements_admin_all" ON announcements FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- orders: cualquiera puede crear (checkout anónimo), solo admins leen/editan
CREATE POLICY "orders_anon_insert" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "orders_admin_all" ON orders FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Valores válidos de payment_status (existentes son NULL: la constraint valida igual)
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IS NULL OR payment_status IN ('iniciado','aprobado','pendiente','rechazado','devuelto'));

-- Nadie que no sea el service role (webhook) puede insertar un pedido "ya pagado":
-- a los inserts de anon/authenticated se les clampa el estado a lo sumo 'iniciado'
-- y se les anulan los campos de acreditación.
CREATE OR REPLACE FUNCTION orders_clamp_pago() RETURNS trigger AS $$
BEGIN
  IF coalesce(auth.role(), 'anon') <> 'service_role' THEN
    IF NEW.payment_status IS NOT NULL THEN
      NEW.payment_status := 'iniciado';
    END IF;
    NEW.mp_payment_id := NULL;
    NEW.paid_at := NULL;
    NEW.paid_amount := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER orders_clamp_pago_insert
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_clamp_pago();

-- Seed de admins (allowlist del panel)
INSERT INTO admins (email, name, role) VALUES
  ('brianridv@gmail.com', 'Brian Ridvanovich', 'owner'),
  ('bridvanovich@twf.uy', 'Brian Ridvanovich', 'owner'),
  ('somosvolea@gmail.com', 'VOLEA Team', 'admin')
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- v4 (2026-07-09): Migración a e-commerce NATIVO
-- ============================================
-- Shopify quedó fuera del flujo. Supabase es la fuente de verdad de TODO:
--
-- CREATE TABLE products (id TEXT PK, name, sku, description, price INTEGER,
--   original_price INTEGER, category TEXT (id de categoría), images JSONB,
--   sizes JSONB, colors JSONB [{name,hex}], stock_by_size JSONB ("talle|color": qty),
--   is_featured BOOL, is_offer BOOL, active BOOL, sort_order INT, timestamps);
-- CREATE TABLE categories (id TEXT PK, name TEXT, sort_order INT);
-- CREATE TABLE posts (id TEXT PK, title, slug UNIQUE, excerpt, content,
--   cover_url, published BOOL, published_at, timestamps);  -- Blog
-- CREATE TABLE standings (id TEXT PK, position INT, player_name, points NUMERIC,
--   category TEXT, notes, timestamps);  -- Clasificación al Mundial
--
-- RLS: lectura pública (products solo active=true para anon; posts solo published);
-- escritura solo is_admin(). Storage: bucket público product-images, escritura
-- solo admins autenticados.
-- El DDL completo está aplicado como migración "native_ecommerce_schema" en el
-- proyecto volea-web (ver Dashboard > Database > Migrations).

-- ============================================
-- v5 (2026-08-04): Galería (álbumes de fotos de torneos)
-- ============================================
-- Cada álbum es un link de salida a un Google Drive/Photos externo (las fotos
-- viven ahí; esta tabla es solo el índice con marca VOLEA). Migración aplicada:
-- "gallery_albums" en el proyecto volea-web.

CREATE TABLE IF NOT EXISTS public.gallery_albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  event_date DATE,
  cover_url TEXT,
  album_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.gallery_albums ENABLE ROW LEVEL SECURITY;
CREATE POLICY gallery_public_read ON public.gallery_albums FOR SELECT USING (true);
CREATE POLICY gallery_admin_write ON public.gallery_albums FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Storage: portadas subidas al bucket product-images, carpeta gallery/ (mismo
-- bucket que blog/ y products/; escritura solo admins autenticados via RLS de storage).
