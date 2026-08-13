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
  -- v10: teléfono de inscripciones (arma el botón de WhatsApp de la home) y último
  -- día para eventos de varios días (sin él, un torneo de 3 días se archiva solo el
  -- segundo día). NULL = evento de un solo día.
  phone TEXT DEFAULT '',
  end_date DATE,
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

-- ============================================
-- v6 (2026-08-06): Hardening de seguridad (auditoría pre-lanzamiento)
-- ============================================
-- Migración "hardening_search_path_y_revokes" (+ "hardening_bot_rpc_revoke_public"
-- para cerrar el grant PUBLIC residual) aplicadas en el proyecto volea-web.
--
-- 1) search_path fijo (pg_catalog, public) en todas las funciones SECURITY
--    DEFINER / trigger de public que el advisor 0011 (function_search_path_mutable)
--    marcaba con search_path mutable:
--      is_admin(), orders_clamp_pago(), tg_set_updated_at(), update_updated_at(),
--      bot_esc(text), bot_fmt(numeric)
--    (is_admin_email() queda anon-callable A PROPÓSITO, no se tocó su grant).
--
-- 2) bot_handle(...) y bot_pick_variant(...) (RPCs SECURITY DEFINER del bot de
--    Telegram): se les quitó el grant PUBLIC residual del CREATE FUNCTION
--    (REVOKE ... FROM PUBLIC), pero anon CONSERVA EXECUTE explícito.
--    ⚠ CORRECCIÓN 2026-08-07: el revoke total a anon del 06/08 ROMPIÓ EL BOT
--    (n8n llama estas RPCs con la ANON key + el secreto compartido de
--    bot_config — NO con service role; el 401 "permission denied for function
--    bot_handle" tumbó el Cerebro un día entero). Se restauró GRANT EXECUTE
--    TO anon para ambas. La protección real de estas funciones es el secreto
--    en bot_config (ilegible para anon): NO volver a revocar anon sin cambiar
--    antes la credencial de n8n a service role.

-- ============================================
-- v7 (2026-08-09): Nueva venta / Gasto desde la Caja web
-- ============================================
-- Migración "caja_web_registrar" aplicada en el proyecto volea-web.
-- Dos RPCs para que el admin web registre ventas y gastos con la MISMA
-- semántica que bot_do_register (el bot de Telegram): descuento atómico de
-- stock (SELECT ... FOR UPDATE + jsonb_set sobre products.stock_by_size) y
-- fila en bot_ledger con las mismas columnas, así deudas, "cobré",
-- liquidación a socios, anulación (admin_revert_ledger repone stock) y
-- export Excel siguen funcionando igual.
--
-- Diferencias a propósito con el bot:
--  * chat_id = 0 marca los registros hechos desde la web (columna NOT NULL;
--    ningún chat real de Telegram usa el id 0, así el "deshacer" del bot
--    nunca los toca).
--  * Sin stock suficiente se RECHAZA ({ok:false, error:'sin stock: quedan N'})
--    en vez de avisar y clavar en 0 como hace el bot.

CREATE OR REPLACE FUNCTION public.admin_registrar_venta(
  p_label text,
  p_amount numeric,
  p_payment text,
  p_reported_by text,
  p_product_id text DEFAULT NULL,
  p_variant_key text DEFAULT NULL,
  p_qty integer DEFAULT 1,
  p_debtor text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_label text := btrim(COALESCE(p_label, ''));
  v_reported text := COALESCE(NULLIF(btrim(COALESCE(p_reported_by, '')), ''), 'Web');
  v_stock jsonb;
  v_before int;
  v_after int := NULL;
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'solo admins');
  END IF;

  IF p_payment IS NULL OR p_payment NOT IN ('mp', 'efectivo', 'transferencia', 'debe') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'método de pago inválido');
  END IF;
  IF p_payment = 'debe' AND COALESCE(btrim(p_debtor), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta el nombre de quién debe');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'monto inválido');
  END IF;
  IF p_qty IS NULL OR p_qty < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cantidad inválida');
  END IF;

  IF p_product_id IS NOT NULL THEN
    -- Venta de catálogo: lock de la fila + chequeo + descuento, misma mecánica
    -- que bot_do_register (SELECT ... FOR UPDATE + jsonb_set; el label pasa a
    -- ser el nombre del producto, como hace el bot).
    SELECT name, stock_by_size INTO v_label, v_stock
      FROM products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ese producto ya no está en el catálogo');
    END IF;
    IF p_variant_key IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'falta la variante (talle|color)');
    END IF;
    v_before := COALESCE((v_stock ->> p_variant_key)::int, 0);
    IF v_before < p_qty THEN
      RETURN jsonb_build_object('ok', false, 'error', 'sin stock: quedan ' || v_before);
    END IF;
    v_after := v_before - p_qty;
    UPDATE products
      SET stock_by_size = jsonb_set(stock_by_size, ARRAY[p_variant_key], to_jsonb(v_after))
      WHERE id = p_product_id;
  ELSIF v_label = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta el nombre del ítem');
  END IF;

  INSERT INTO bot_ledger (kind, product_id, variant_key, label, qty, amount, reported_by, chat_id, payment_method, debtor_name)
  VALUES ('venta', p_product_id,
          CASE WHEN p_product_id IS NOT NULL THEN p_variant_key ELSE NULL END,
          v_label, p_qty, p_amount, v_reported, 0, p_payment,
          CASE WHEN p_payment = 'debe' THEN btrim(p_debtor) ELSE NULL END);

  RETURN jsonb_build_object('ok', true, 'stock_left', v_after);
END;
$$;

-- v9 — quién PUSO LA PLATA del gasto, para el reparto Brian 50 / Paula 25 / Gastón 25.
-- Es distinto de reported_by (quién lo cargó): con la cuenta compartida "VOLEA Team"
-- no son la misma persona. Antes se adivinaba al liquidar por el nombre de quien
-- registró y todo lo no reconocido caía en Gastón. NULL = gasto del bot o histórico:
-- ahí el modal de liquidación sigue con la heurística, marcado "pagador a confirmar".
ALTER TABLE bot_ledger ADD COLUMN IF NOT EXISTS paid_by text;
ALTER TABLE bot_ledger DROP CONSTRAINT IF EXISTS bot_ledger_paid_by_check;
ALTER TABLE bot_ledger ADD CONSTRAINT bot_ledger_paid_by_check
  CHECK (paid_by IS NULL OR paid_by IN ('brian', 'paula', 'gaston'));

CREATE OR REPLACE FUNCTION public.admin_registrar_gasto(
  p_label text,
  p_amount numeric,
  p_reported_by text,
  p_paid_by text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_label text := btrim(COALESCE(p_label, ''));
  v_reported text := COALESCE(NULLIF(btrim(COALESCE(p_reported_by, '')), ''), 'Web');
  v_paid text := NULLIF(btrim(lower(COALESCE(p_paid_by, ''))), '');
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'solo admins');
  END IF;
  IF v_label = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta la descripción del gasto');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'monto inválido');
  END IF;
  IF v_paid IS NOT NULL AND v_paid NOT IN ('brian', 'paula', 'gaston') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'socio inválido');
  END IF;

  INSERT INTO bot_ledger (kind, product_id, variant_key, label, qty, amount, reported_by, chat_id, payment_method, debtor_name, paid_by)
  VALUES ('gasto', NULL, NULL, v_label, 1, p_amount, v_reported, 0, NULL, NULL, v_paid);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- La firma vieja de 3 args se dropea: conviviendo con la nueva, PostgREST no sabe
-- cuál elegir y falla por ambigüedad (mismo problema que tuvo admin_cobrar_deudor).
-- El bot de Telegram NO usa esta función (bot_do_register inserta directo en
-- bot_ledger), así que dropearla no lo afecta.
DROP FUNCTION IF EXISTS public.admin_registrar_gasto(text, numeric, text);

-- Grants: el CREATE FUNCTION deja EXECUTE a PUBLIC (mismo gotcha residual del
-- v6); se cierra explícito y solo queda authenticated. El admin web llama con
-- su sesión de usuario — is_admin() es el guard real dentro de cada función.
-- Verificado con has_function_privilege: anon=false, authenticated=true en ambas.
REVOKE ALL ON FUNCTION public.admin_registrar_venta(text, numeric, text, text, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_registrar_venta(text, numeric, text, text, text, text, integer, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_registrar_gasto(text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_registrar_gasto(text, numeric, text, text) TO authenticated;

-- ============================================
-- v8 (2026-08-09): Cobro de deudas desde la Caja web
-- ============================================
-- Migraciones "caja_web_cobrar_deudor" + "caja_web_cobrar_parcial" +
-- "caja_web_cobrar_drop_v1" aplicadas en volea-web.
-- admin_cobrar_deudor(p_debtor, p_method, p_monto DEFAULT NULL):
--   SECURITY DEFINER (is_admin() primero, search_path fijo). Cierra deudas
--   pendientes del deudor (nombre EXACTO del agrupado de la Caja) con
--   settled_at/settled_method — misma semántica que el «cobré» del bot.
--   p_monto NULL o >= deuda => cobra todo. Parcial => FIFO por created_at;
--   el ítem a caballo se PARTE: la fila original conserva producto/qty con el
--   resto pendiente, y la parte pagada nace como fila nueva ya cobrada con
--   product_id NULL (anularla jamás toca stock). Grants: authenticated ✓,
--   anon/PUBLIC revocados (regla del 2026-08-06). La v1 de 2 args se DROPeó
--   (quedaba como sobrecarga ambigua para PostgREST).
