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

-- Tabla de admins (allowlist para el login por magic link en /#/admin).
-- role + activo son la base de mi_rol() / es_equipo() / es_owner() (ver v12 y
-- v13): 'sublimacion' es una cuenta de acceso acotado que NO integra el equipo
-- dueño, por eso la plata de los socios se guarda con es_equipo() y no is_admin().
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'sublimacion')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Baja lógica: mi_rol() devuelve '' si activo = false, así que desactivar a
  -- alguien lo saca de todas las policies sin borrarle la fila ni el historial.
  activo BOOLEAN NOT NULL DEFAULT TRUE
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
  -- v11: inscripción online (form público) y sus categorías ("Singles A,Doble Mixto B,...")
  inscripciones_abiertas BOOLEAN NOT NULL DEFAULT false,
  categorias TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- v11 — Inscripciones online a eventos. SIN políticas para anon a propósito: los
-- datos personales (nombre, celular) no son legibles públicamente. El público
-- escribe SOLO vía la RPC inscribir_evento (SECURITY DEFINER con validaciones y
-- topes de longitud; mismo celular en el mismo evento actualiza en vez de
-- duplicar) y lee SOLO el número agregado vía contar_inscriptos. El admin ve y
-- administra vía is_admin(). Las definiciones completas de ambas RPCs viven en
-- las migraciones inscripciones_online / inscripciones_celular_con_espacios.
CREATE TABLE IF NOT EXISTS inscripciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  celular TEXT NOT NULL,
  email TEXT DEFAULT '',
  categorias TEXT NOT NULL,
  pareja TEXT DEFAULT '',
  dupr_id TEXT DEFAULT '',
  notas TEXT DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmada', 'baja')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inscripciones_event_idx ON inscripciones (event_id, created_at);
ALTER TABLE inscripciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inscripciones_admin_select ON inscripciones;
CREATE POLICY inscripciones_admin_select ON inscripciones FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS inscripciones_admin_update ON inscripciones;
CREATE POLICY inscripciones_admin_update ON inscripciones FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS inscripciones_admin_delete ON inscripciones;
CREATE POLICY inscripciones_admin_delete ON inscripciones FOR DELETE USING (is_admin());

-- v10 — Promociones de la tienda. Una sola fila vigente por vez (cliente y server
-- toman la primera activa cuya ventana incluya HOY en Montevideo). Vive en la DB
-- porque el descuento lo aplican por igual el carrito (src/utils/promo.ts) y la
-- preferencia de Mercado Pago (api/mp/preferencia.ts): una sola fuente de verdad
-- y la promo se prende/apaga sola por fecha. Lectura pública; escritura solo por
-- SQL/service role (sin políticas de INSERT/UPDATE a propósito).
CREATE TABLE IF NOT EXISTS promos (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  percent NUMERIC NOT NULL CHECK (percent > 0 AND percent < 100),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL CHECK (ends_on >= starts_on),
  delivery_note TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE promos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promos_public_read ON promos;
CREATE POLICY promos_public_read ON promos FOR SELECT USING (true);

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

-- Función helper: ¿el usuario autenticado es admin del panel?
-- Historia: nacó como allowlist por email a secas; v14 le sumó activo; v15 le
-- sumó role IN ('owner','admin') para que la cuenta de sublimación no pase
-- ('sublimacion' nunca fue un admin — que diera true era el bug). Desde v15,
-- is_admin() ≡ es_equipo() en la práctica; se conserva porque 24 policies
-- (21 en public + 3 en storage) cuelgan de este nombre.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins
    WHERE lower(email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
      AND activo
      AND role IN ('owner', 'admin')
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
-- Desactualizado: hoy son TRES policies, no una. Ver v13 al final del archivo.

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
-- ⚠️ v14: el guard de estas RPCs cambió de is_admin() a es_equipo().
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
-- ⚠️ v14: el guard de admin_cobrar_deudor cambió de is_admin() a es_equipo().
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

-- ============================================
-- v12 (2026-09-01): Gastos por pagar en la Caja
-- ============================================
-- Lo que ya sabemos que hay que pagar y todavía no salió de la caja vivía solo
-- en la cabeza de los tres. Ahora se anota, se ve vencido cuando lo está, y
-- cualquiera de los tres lo marca pagado.
--
-- Los pendientes viven en su PROPIA tabla, no en bot_ledger: mientras no se
-- pagan no son plata que salió, y meterlos en el ledger torcería totales,
-- balance y liquidación a socios. Recién al marcarlo pagado se asienta el gasto
-- real en bot_ledger y se linkean las dos filas en una sola transacción.
--
-- Quien lo CARGA (created_by) y quien PONE LA PLATA (pagado_por) se guardan por
-- separado: el segundo recién se conoce al pagar, y es el que define el reparto
-- Brian 50 / Paula 25 / Gastón 25 (mismo criterio que bot_ledger.paid_by del v9).

-- Helpers de rol. No estaban documentados en este archivo y son la dependencia
-- de la RLS de abajo, así que van acá. anon tiene EXECUTE a propósito: las
-- policies se evalúan con el rol de quien consulta, y sin EXECUTE la policy
-- rompe en vez de dar false.
-- OJO: mi_rol() lee admins.activo, una columna que el CREATE TABLE admins de
-- arriba (v3) todavía no documenta.
CREATE OR REPLACE FUNCTION public.mi_rol()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select coalesce((select role from admins
                   where lower(email) = lower(auth.jwt() ->> 'email') and activo), '');
$$;

CREATE OR REPLACE FUNCTION public.es_equipo()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select mi_rol() in ('owner', 'admin');
$$;

CREATE TABLE IF NOT EXISTS public.gastos_pendientes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT NOT NULL,
  amount      NUMERIC NOT NULL CHECK (amount > 0),
  -- Vencimiento; NULL = sin fecha, se paga cuando se pueda.
  vence_el    DATE,
  -- A quién hay que pagarle (opcional).
  proveedor   TEXT,
  notas       TEXT,
  created_by  TEXT NOT NULL DEFAULT 'Web',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Cuándo se pagó; NULL = sigue pendiente.
  pagado_at   TIMESTAMPTZ,
  -- Qué socio puso la plata (define el reparto 50/25/25).
  pagado_por  TEXT CHECK (pagado_por IN ('brian', 'paula', 'gaston')),
  -- Movimiento de caja que generó el pago.
  ledger_id   UUID REFERENCES bot_ledger(id) ON DELETE SET NULL,
  -- Pagado sin pagador (o al revés) no existe: o están los dos, o ninguno.
  CONSTRAINT gastos_pendientes_pago_completo CHECK (
    (pagado_at IS NULL AND pagado_por IS NULL) OR
    (pagado_at IS NOT NULL AND pagado_por IS NOT NULL)
  )
);

-- Índice parcial: la pantalla solo lista los abiertos, ordenados por vencimiento.
CREATE INDEX IF NOT EXISTS gastos_pendientes_abiertos_idx
  ON public.gastos_pendientes (vence_el, created_at)
  WHERE pagado_at IS NULL;

ALTER TABLE public.gastos_pendientes ENABLE ROW LEVEL SECURITY;

-- es_equipo() y NO is_admin(): is_admin() da true para cualquier fila de admins
-- e incluiría a la cuenta de sublimación, que no tiene por qué ver ni tocar la
-- plata de los socios.
DROP POLICY IF EXISTS gastos_pendientes_equipo ON public.gastos_pendientes;
CREATE POLICY gastos_pendientes_equipo ON public.gastos_pendientes
  FOR ALL USING (es_equipo()) WITH CHECK (es_equipo());

-- Marcar pagado: asienta el gasto real en bot_ledger y linkea las dos filas.
CREATE OR REPLACE FUNCTION public.admin_pagar_gasto_pendiente(
  p_id uuid, p_paid_by text, p_reported_by text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
declare
  v_paid     text := nullif(btrim(lower(coalesce(p_paid_by, ''))), '');
  v_reported text := coalesce(nullif(btrim(coalesce(p_reported_by, '')), ''), 'Web');
  v_g        public.gastos_pendientes%rowtype;
  v_ledger   uuid;
begin
  if not es_equipo() then
    return jsonb_build_object('ok', false, 'error', 'solo el equipo');
  end if;
  if v_paid is null or v_paid not in ('brian', 'paula', 'gaston') then
    return jsonb_build_object('ok', false, 'error', 'falta quien puso la plata');
  end if;

  -- FOR UPDATE: si dos de los tres tocan "pagar" a la vez, el segundo espera y
  -- despues ve que ya estaba pagado, en vez de duplicar el gasto en la caja.
  select * into v_g from public.gastos_pendientes where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'el gasto ya no existe');
  end if;
  if v_g.pagado_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ese gasto ya figura pagado');
  end if;

  insert into public.bot_ledger
    (kind, product_id, variant_key, label, qty, amount, reported_by, chat_id,
     payment_method, debtor_name, paid_by)
  values
    ('gasto', null, null, v_g.label, 1, v_g.amount, v_reported, 0,
     null, null, v_paid)
  returning id into v_ledger;

  update public.gastos_pendientes
     set pagado_at = now(), pagado_por = v_paid, ledger_id = v_ledger, updated_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'ledger_id', v_ledger);
end;
$$;

-- Deshacer el pago (me equivoqué de pagador, o no era este gasto).
CREATE OR REPLACE FUNCTION public.admin_despagar_gasto_pendiente(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
declare
  v_g public.gastos_pendientes%rowtype;
begin
  if not es_equipo() then
    return jsonb_build_object('ok', false, 'error', 'solo el equipo');
  end if;

  select * into v_g from public.gastos_pendientes where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'el gasto ya no existe');
  end if;
  if v_g.pagado_at is null then
    return jsonb_build_object('ok', false, 'error', 'ese gasto no figura pagado');
  end if;

  -- El ledger no borra filas: marca reverted, igual que "anular movimiento".
  if v_g.ledger_id is not null then
    update public.bot_ledger set reverted = true where id = v_g.ledger_id;
  end if;

  update public.gastos_pendientes
     set pagado_at = null, pagado_por = null, ledger_id = null, updated_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Grants: el CREATE FUNCTION deja EXECUTE a PUBLIC (mismo gotcha del v6); se
-- cierra explícito y solo queda authenticated. es_equipo() es el guard real
-- adentro de cada función. Verificado con has_function_privilege:
-- anon=false, authenticated=true en las dos.
REVOKE ALL ON FUNCTION public.admin_pagar_gasto_pendiente(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pagar_gasto_pendiente(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_despagar_gasto_pendiente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_despagar_gasto_pendiente(uuid) TO authenticated;

-- ============================================
-- v13 (2026-09-01): Roles reales de admins (es_owner + las 3 policies)
-- ============================================
-- El CREATE TABLE admins de arriba decía role IN ('owner','admin') y no tenía
-- activo; el v6 documentaba UNA sola policy de lectura propia. Nada de eso es
-- lo que corre hoy. Esta sección cierra ese hueco: sin ella, recrear el proyecto
-- desde el repo dejaba mi_rol() sin compilar y la tabla admins sin RLS real.

-- es_owner(): el escalón de arriba de es_equipo(). Solo el owner da de alta o
-- baja gente del equipo.
CREATE OR REPLACE FUNCTION public.es_owner()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select mi_rol() = 'owner';
$$;

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Tres policies, cada una con su motivo:
--   self_read     : cualquiera autenticado lee SU fila — es lo que necesita el
--                   login para saber con qué rol entrar (incluye sublimación).
--   equipo_lee    : owner/admin ven la lista completa del equipo.
--   owner_gestiona: solo el owner escribe (alta, baja, cambio de rol).
DROP POLICY IF EXISTS admins_self_read ON public.admins;
CREATE POLICY admins_self_read ON public.admins
  FOR SELECT USING (lower(email) = lower(COALESCE((auth.jwt() ->> 'email'), '')));

DROP POLICY IF EXISTS admins_equipo_lee ON public.admins;
CREATE POLICY admins_equipo_lee ON public.admins
  FOR SELECT USING (es_equipo());

DROP POLICY IF EXISTS admins_owner_gestiona ON public.admins;
CREATE POLICY admins_owner_gestiona ON public.admins
  FOR ALL USING (es_owner()) WITH CHECK (es_owner());

-- mi_rol() / es_equipo() / es_owner() / is_admin() quedan con EXECUTE para anon
-- a propósito, al revés que las RPC admin_*: las policies se evalúan con el rol
-- de quien consulta, y sin EXECUTE la policy revienta en vez de dar false.
-- Verificado con has_function_privilege: anon=true, authenticated=true en las cuatro.

-- Nota de orden: is_admin() (v3, más arriba) sigue existiendo y la usan events,
-- clubs, announcements, orders e inscripciones. Es a propósito más laxa —
-- "¿está en la allowlist?" — y por eso NO sirve para la plata: ahí va es_equipo().

-- ============================================
-- v14 (2026-09-01): La plata solo para el equipo — migración de seguridad
-- ============================================
-- Migración "cerrar_caja_y_socios_a_es_equipo" aplicada en volea-web tras una
-- auditoría adversarial (5 agentes, hallazgos confirmados contra el catálogo).
-- Tres agujeros cerrados:
--
-- (1) sublimacion@volea.uy pasaba is_admin(): leía bot_ledger, podía
--     insertar/borrar socio_moves y ejecutar las 8 RPCs de plata (liquidar
--     caja, revertir movimientos, registrar ventas/gastos, cobrar deudores).
-- (2) bot_pick_variant tenía EXECUTE para anon SIN guard interno; encadenaba
--     como owner hasta bot_do_register: un anónimo podía insertar ventas y
--     gastos en la caja y tocar stock salteando el secreto del bot y la
--     allowlist bot_users. El único caller legítimo es bot_handle (interno).
-- (3) TRUNCATE (que NO pasa por RLS) estaba grantado a anon y authenticated
--     en las tablas de plata — y "authenticated" no es rol de confianza acá:
--     conviven otros sitios en el proyecto y hay usuarios auth fuera de la
--     allowlist de admins.
--
-- Qué cambió:
--   · is_admin() e is_admin_email(): ahora exigen activo=true (antes la baja
--     lógica no cortaba nada por esta vía). Siguen siendo la allowlist LAXA
--     (no miran role) para lo no-monetario: products, events, orders, etc.
--   · Guard is_admin() -> es_equipo() en: admin_registrar_venta,
--     admin_registrar_gasto, admin_cobrar_deudor, admin_liquidar_caja,
--     admin_revert_ledger, admin_pago_inscripcion, admin_vincular_deudor,
--     admin_set_dupr_ids. (Cuerpos intactos: regenerados desde
--     pg_get_functiondef con solo el guard reemplazado.)
--   · Policies renombradas al cambiar el guard:
--       bot_ledger:  ledger_admin_read -> ledger_equipo_read
--       socio_moves: socio_moves_admin_select/insert/delete -> socio_moves_equipo_*
--     socio_moves sigue SIN policy de UPDATE a propósito (se anula y recrea,
--     no se edita).
--   · REVOKE TRUNCATE a anon+authenticated y REVOKE INSERT/UPDATE/DELETE a
--     anon en bot_ledger, socio_moves y gastos_pendientes.
--   · REVOKE ALL sobre bot_pick_variant a PUBLIC/anon/authenticated (queda
--     como el resto de la familia bot_*: solo owner/service_role; bot_handle
--     la sigue llamando internamente sin problema).
--   · search_path = pg_catalog, public parejo en admin_revert_ledger,
--     admin_liquidar_caja, mi_rol, es_equipo y es_owner (regla del v6).
--
-- Verificado post-migración contra el catálogo: 8/8 RPCs con guard es_equipo
-- y search_path parejo; bot_pick_variant anon=false auth=false; policies
-- nuevas con es_equipo(); TRUNCATE fuera y anon sin DML en las 3 tablas de
-- plata. Chequeo de rotura previo (código + n8n): sublimación solo usa
-- compras/compra_items/sublimacion_estado; el bot de n8n llama SOLO
-- bot_handle con p_secret; el webhook MP usa service_role.
--
-- Deuda conocida que v14 NO toca (decisión pendiente de Brian): sublimacion
-- sigue pasando is_admin() en las policies no-monetarias (products, orders,
-- events, inscripciones, rk_*, standings, gallery, storage product-images).
-- Si el taller solo debe ver su sector, eso es otra migración.

-- ============================================
-- Tablas que faltaban documentar (DDL real del catálogo, 01/09/2026)
-- ============================================

-- La CAJA: cada venta y gasto de VOLEA. Escriben solo las RPC SECURITY DEFINER
-- (admin_* desde la web, bot_do_register desde Telegram vía bot_handle);
-- por tabla directa solo lee el equipo (ledger_equipo_read).
CREATE TABLE IF NOT EXISTS public.bot_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('venta', 'gasto')),
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  variant_key TEXT,
  label TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  amount NUMERIC NOT NULL,
  reported_by TEXT NOT NULL,
  chat_id BIGINT NOT NULL,           -- 0 = vino de la web; si no, chat de Telegram
  reverted BOOLEAN NOT NULL DEFAULT FALSE,  -- anulado: nunca se borra, se marca
  created_at TIMESTAMPTZ DEFAULT NOW(),
  payment_method TEXT CHECK (payment_method IN ('mp', 'efectivo', 'transferencia', 'debe')),
  debtor_name TEXT,                  -- si payment_method='debe', quién debe
  settled_at TIMESTAMPTZ,            -- cuándo se cobró la deuda
  settled_method TEXT CHECK (settled_method IN ('mp', 'efectivo', 'transferencia')),
  socio_settled_at TIMESTAMPTZ,      -- cuándo se liquidó a socios (admin_liquidar_caja)
  paid_by TEXT CHECK (paid_by IS NULL OR paid_by IN ('brian', 'paula', 'gaston')),  -- v9: quién puso la plata
  jugador_id TEXT REFERENCES rk_jugadores(id) ON DELETE SET NULL
);

-- El REPARTO entre socios (Brian 50 / Paula 25 / Gastón 25). Cada fila cierra
-- en cero por diseño (socio_moves_cero). Sin policy UPDATE a propósito.
CREATE TABLE IF NOT EXISTS public.socio_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area TEXT NOT NULL CHECK (area IN ('marca', 'showroom', 'cafeteria', 'crp', 'argentinos', 'otros')),
  tipo TEXT NOT NULL CHECK (tipo IN ('gasto', 'pago', 'venta', 'ajuste')),
  periodo TEXT,
  fecha DATE,
  descripcion TEXT NOT NULL,
  monto NUMERIC NOT NULL CHECK (monto >= 0),
  pagador TEXT CHECK (pagador IN ('brian', 'paula', 'gaston')),
  de TEXT CHECK (de IN ('brian', 'paula', 'gaston')),
  para TEXT CHECK (para IN ('brian', 'paula', 'gaston')),
  moneda TEXT NOT NULL DEFAULT 'UYU' CHECK (moneda IN ('UYU', 'ARS')),
  imp_brian NUMERIC NOT NULL,
  imp_paula NUMERIC NOT NULL,
  imp_gaston NUMERIC NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  orden INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cuota_grupo TEXT,
  CONSTRAINT socio_moves_cero CHECK (abs(imp_brian + imp_paula + imp_gaston) < 0.05)
);

-- Compras a proveedor y encargos al taller de sublimación. RLS: compras_equipo
-- (ALL, es_equipo) + compras_sublimacion_lee (SELECT solo tipo='sublimacion'
-- no-borrador para mi_rol()='sublimacion'). Ídem compra_items vía su compra.
CREATE TABLE IF NOT EXISTS public.compras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL DEFAULT 'proveedor' CHECK (tipo IN ('proveedor', 'sublimacion')),
  proveedor TEXT NOT NULL,
  referencia TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'pedido', 'en_proceso', 'en_camino', 'recibido', 'cancelado')),
  fecha_pedido DATE DEFAULT CURRENT_DATE,
  fecha_estimada DATE,
  recibido_at TIMESTAMPTZ,
  notas TEXT,
  prenda_base TEXT,
  mockup_url TEXT,
  archivos JSONB NOT NULL DEFAULT '[]'::jsonb,
  comentario_taller TEXT,
  creado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.compra_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id UUID NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  descripcion TEXT NOT NULL,
  variante TEXT,
  cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  cantidad_recibida INTEGER NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0),
  costo_unitario NUMERIC,
  orden INTEGER NOT NULL DEFAULT 0
);

-- Tareas internas del equipo. RLS: tareas_equipo (ALL, es_equipo).
CREATE TABLE IF NOT EXISTS public.tareas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  detalle TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_curso', 'hecha')),
  prioridad TEXT NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('baja', 'normal', 'alta')),
  asignado_a TEXT,
  creado_por TEXT,
  vence_el DATE,
  completada_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Infraestructura del bot de Telegram. Las 4 con RLS habilitado y CERO
-- policies A PROPÓSITO: deny-all, solo las toca bot_handle/service_role.
CREATE TABLE IF NOT EXISTS public.bot_config (
  key TEXT PRIMARY KEY,   -- p.ej. el secreto que valida bot_handle
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS public.bot_users (   -- allowlist de chats registrados
  chat_id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.bot_pending ( -- conversación a medias por chat
  chat_id BIGINT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.bot_seen (    -- dedup de updates de Telegram
  update_id BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================
-- v15 (2026-09-01): El taller solo ve su sector
-- ============================================
-- Migración "sectorizar_sublimacion_is_admin_role" aplicada en volea-web.
-- Decisión de Brian: la cuenta sublimacion@volea.uy solo debe ver su sector.
--
-- Cómo: UN solo cambio — is_admin() ahora exige role IN ('owner','admin')
-- (además del activo del v14). Las 24 policies que cuelgan de ella (21 en
-- public: announcements, categories, clubs, events, gallery_albums,
-- inscripciones x4, orders, posts x2, products x2, rk_config, rk_jugadores,
-- rk_torneos x4, standings; + 3 en storage.objects: product_images_admin_
-- insert/update/delete) heredan el cierre de una, y cualquier policy futura
-- escrita con is_admin() nace cerrada.
--
-- Lo que el taller CONSERVA (verificado con 3 agentes antes de aplicar):
--   · login: is_admin_email() NO se tocó (sigue email+activo, sin role) —
--     endurecerla habría roto el login del taller
--   · su fila de admins (admins_self_read, por email)
--   · compras/compra_items tipo sublimacion no-borrador (policies con mi_rol())
--   · RPC sublimacion_estado (guard mi_rol()='sublimacion')
--   · mockups/adjuntos: los lee por URL pública del bucket product-images
--     (public=true + product_images_public_read) — sin auth de por medio
--   · las lecturas públicas del sitio (products activos, events, posts
--     publicados, etc.)
--
-- Lo que el taller PIERDE (todo intencional — era el leak): escritura total
-- en announcements/categories/clubs/events/gallery/inscripciones/orders/
-- posts/products/rk_*/standings, upload al bucket product-images, lectura de
-- orders, del contador de inscripciones, de products inactivos, posts
-- borrador y torneos ocultos. El shell del admin que se monta antes del
-- desvío a SublimacionPanel degrada a vacío/0 sin error (RLS filtra, los
-- setters chequean null/length) — verificado en App.tsx.
--
-- Vecinos intactos: mariel-lá y template-comercio usan sus propias funciones
-- (mariella_is_admin / demo_is_admin) y tablas de admins propias; racket-point,
-- pickle-torneos y tengo-cancha no pegan a este proyecto. OJO al provisionar
-- template-comercio: jamás con prefijo vacío en este proyecto compartido
-- (generaría un is_admin() sin prefijo que pisaría el de VOLEA).
--
-- Verificado post-migración: is_admin con role check; is_admin_email intacta;
-- 24 policies siguen colgando (ninguna dropeada — se usó CREATE OR REPLACE,
-- jamás DROP CASCADE); search_path pg_catalog,public; guard del taller intacto.
-- La definición vigente de is_admin() quedó actualizada arriba, en su bloque
-- original del v3.

-- ============================================
-- v16 (2026-09-05): Tanteador de badminton dobles
-- ============================================
-- Migracion "tanteador_badminton" aplicada en volea-web. Soporta la pestania
-- Tanteador del admin (Copa Badminton 06/09): marcador tactil punto a punto,
-- sets a 15 (desde 14-14 por 2, tope 21) o a 21 (tope 30), mejor de 3.
--
-- Tabla PROPIA a proposito: NO escribe en rk_torneos — el sync local-first de
-- torneos upsertea el documento entero y un write externo genera conflicto o
-- se pisa (incidente del 9/8 documentado en src/torneos/sync.ts). El resultado
-- se carga al torneo a mano como siempre (PasoFaseGrupos).
CREATE TABLE IF NOT EXISTS public.tanteador_partidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  torneo_id TEXT,          -- rk_torneos.id del que salieron las parejas (referencia blanda)
  categoria TEXT NOT NULL DEFAULT 'DM' CHECK (categoria IN ('DM','DF')),
  pareja_a TEXT NOT NULL,
  pareja_b TEXT NOT NULL,
  juez TEXT,
  cancha TEXT NOT NULL DEFAULT '1',
  obj INTEGER NOT NULL DEFAULT 15,        -- set a N puntos
  cap INTEGER NOT NULL DEFAULT 21,        -- tope de la extension
  cambio_en INTEGER NOT NULL DEFAULT 8,   -- cambio de lado del 3er set
  sets JSONB NOT NULL DEFAULT '[]'::jsonb,    -- sets cerrados [{a,b}]
  hist JSONB NOT NULL DEFAULT '[[]]'::jsonb,  -- puntos por set [['A','B',...],...]
  estado TEXT NOT NULL DEFAULT 'en_juego' CHECK (estado IN ('en_juego','final')),
  ganador TEXT CHECK (ganador IN ('A','B')),
  invertido BOOLEAN NOT NULL DEFAULT FALSE,
  avisos JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_por TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminado_at TIMESTAMPTZ
);

-- Solo el equipo (owner/admin activo). El taller no tiene por que ver esto.
ALTER TABLE public.tanteador_partidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tanteador_equipo ON public.tanteador_partidos;
CREATE POLICY tanteador_equipo ON public.tanteador_partidos
  FOR ALL USING (es_equipo()) WITH CHECK (es_equipo());

-- Convenciones v14: TRUNCATE fuera (no pasa por RLS) y anon sin DML.
REVOKE TRUNCATE ON public.tanteador_partidos FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tanteador_partidos FROM anon;

-- Realtime: la lista de partidos se refresca en vivo entre dispositivos, igual
-- que rk_torneos / rk_en_cancha (canal 'tanteador-partidos' en el componente).
ALTER PUBLICATION supabase_realtime ADD TABLE public.tanteador_partidos;
