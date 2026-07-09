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

-- Tabla de pedidos (consultas por WhatsApp desde el checkout; los pagos
-- online reales viven en Shopify)
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
  source TEXT DEFAULT 'whatsapp' CHECK (source IN ('whatsapp', 'shopify', 'web')),
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

-- admins: lectura pública (el login pre-chequea el email), sin escritura via API
CREATE POLICY "admins_public_read" ON admins FOR SELECT USING (true);

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

-- Seed de admins (allowlist del panel)
INSERT INTO admins (email, name, role) VALUES
  ('brianridv@gmail.com', 'Brian Ridvanovich', 'owner'),
  ('bridvanovich@twf.uy', 'Brian Ridvanovich', 'owner'),
  ('somosvolea@gmail.com', 'VOLEA Team', 'admin')
ON CONFLICT (email) DO NOTHING;
