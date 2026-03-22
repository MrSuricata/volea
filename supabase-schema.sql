-- ============================================
-- VOLEA - Pickleball E-Commerce
-- Supabase Database Schema
-- ============================================
-- Ejecutar este SQL en el SQL Editor de Supabase
-- Dashboard > SQL Editor > New Query > Pegar y Run

-- Tabla de categorías
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de productos
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL,
  original_price INTEGER,
  category TEXT NOT NULL,
  images JSONB DEFAULT '[]'::JSONB,
  sizes JSONB DEFAULT '[]'::JSONB,
  colors JSONB DEFAULT '[]'::JSONB,
  stock INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT false,
  is_offer BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de eventos
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT DEFAULT '',
  location TEXT NOT NULL,
  city TEXT DEFAULT 'Montevideo',
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  maps_url TEXT DEFAULT '',
  max_participants INTEGER,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'past')),
  category TEXT DEFAULT 'tournament' CHECK (category IN ('tournament', 'clinic', 'social')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de pedidos
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  items JSONB NOT NULL,
  customer JSONB NOT NULL,
  total INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Desactivar RLS (autenticación simple por contraseña)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso público (lectura para todos)
CREATE POLICY "Lectura pública de productos" ON products FOR SELECT USING (true);
CREATE POLICY "Lectura pública de eventos" ON events FOR SELECT USING (true);
CREATE POLICY "Lectura pública de categorías" ON categories FOR SELECT USING (true);

-- Políticas de escritura con clave de servicio (usar service_role key en admin)
CREATE POLICY "Admin escribe productos" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin escribe eventos" ON events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin escribe pedidos" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin escribe categorías" ON categories FOR ALL USING (true) WITH CHECK (true);

-- Índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_is_featured ON products(is_featured);
CREATE INDEX IF NOT EXISTS idx_products_is_offer ON products(is_offer);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Datos iniciales (opcional - descomentar si querés cargar datos)
-- ============================================

-- INSERT INTO categories (id, name, sort_order) VALUES
--   ('remeras', 'Remeras', 1),
--   ('polos', 'Polos', 2),
--   ('shorts', 'Shorts', 3),
--   ('vestidos', 'Vestidos', 4),
--   ('gorros', 'Gorros', 5),
--   ('accesorios', 'Accesorios', 6);

-- ============================================
-- Storage Bucket para imágenes (ejecutar en Supabase Dashboard)
-- ============================================
-- 1. Ir a Storage > Create new bucket
-- 2. Nombre: "product-images"
-- 3. Public: true
-- 4. File size limit: 5MB
-- 5. Allowed MIME types: image/png, image/jpeg, image/webp
