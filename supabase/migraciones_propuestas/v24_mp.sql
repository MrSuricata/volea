-- ============================================
-- v24 (PROPUESTA, sin aplicar): Mercado Pago blindado — monto esperado,
-- descuento de stock al acreditar y marca de revisión
-- ============================================
-- Acompaña a la rama feat/mp-blindado (api/mp/preferencia.ts y
-- api/mp/webhook.ts). Revisar y aplicar como migración
-- "v24_mp_monto_stock_revision" en el proyecto volea-web. Después de
-- aplicarla, copiar este bloque (resumido, como v22/v23) al final de
-- supabase-schema.sql.
--
-- Por qué (auditoría 23/09, #7 y #14):
--   · El webhook de MP marcaba el pedido pagado sin descontar stock: dos
--     personas compraban la última unidad y MP les cobraba a las dos, y el
--     stock de la web quedaba mintiendo.
--   · El webhook no comparaba lo cobrado contra lo pedido. orders.total lo
--     manda el cliente anónimo (el trigger v22 solo lo acota a 0..1.000.000),
--     así que no sirve de referencia firme.
--
-- Qué agrega:
--   1. orders.mp_monto_esperado numeric: lo escribe preferencia.ts (service
--      role) con el total que calculó desde products + promos, el mismo que
--      le pide cobrar a MP. El webhook compara transaction_amount contra este
--      valor (y contra orders.total si está vacío).
--   2. orders.stock_descontado_at timestamptz: marca de idempotencia de (4).
--   3. orders.requiere_revision text: NULL = todo bien; si no, POR QUÉ el
--      equipo tiene que mirar el pedido (monto o moneda distintos, doble
--      cobro, sin stock al acreditar). Lo escriben el webhook y la RPC.
--   4. RPC descontar_stock_pedido(p_order_id text): descuenta el stock de un
--      pedido aprobado, todo o nada, una sola vez. Solo service_role.
--   5. Trigger orders_limpiar_control_mp_insert: el alta pública no puede
--      traer (1)-(3) cargados. Sin esto, un anónimo insertaba su pedido con
--      stock_descontado_at ya puesto y el stock nunca se descontaba.
--   6. Backfill: los pedidos YA aprobados quedan con stock_descontado_at
--      puesto (su stock se manejó a mano), así un reintento tardío de MP no
--      les descuenta stock de nuevo.
--
-- Qué NO toca (a propósito): rk_torneos, is_admin_email, is_admin /
-- es_equipo / mi_rol, orders_clamp_pago, orders_validar_alta_publica,
-- orders_anon_insert, las policies de orders, los grants de tabla y nada de
-- los otros sitios del proyecto. admin_registrar_venta (Caja) sigue igual.
--
-- ⚠ OPERATIVO: desde que esto esté aplicado, un pedido pagado por MP YA
-- descontó su stock. Al entregarlo NO hay que registrar la venta en la Caja
-- eligiendo el producto (admin_registrar_venta descontaría OTRA vez). Ver el
-- reporte de la rama.
--
-- Si el código se despliega ANTES que esta migración:
--   · preferencia.ts no puede guardar mp_monto_esperado (PGRST204): lo loguea
--     y sigue; el webhook compara contra orders.total.
--   · webhook.ts no encuentra la RPC (PGRST202): el pago queda acreditado
--     igual, NO se descuenta stock (como hoy) y queda un console.error.
--     Esos pedidos NO se descuentan solos después de aplicar la migración:
--     el backfill (6) los marca como ya descontados. Revisarlos a mano.
--   · Si un pago no cierra en monto/moneda, el pedido queda 'pendiente' con
--     el monto real en paid_amount, pero sin el motivo (falta la columna):
--     el motivo solo queda en los logs de Vercel.

-- --------------------------------------------
-- 0. Pre-chequeo: el catálogo es el que se leyó para escribir esto.
-- --------------------------------------------
DO $pre$
DECLARE
  v_tipo text;
BEGIN
  IF to_regclass('public.orders') IS NULL OR to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION 'v24: faltan orders o products';
  END IF;
  IF to_regprocedure('public.es_equipo()') IS NULL THEN
    RAISE EXCEPTION 'v24: falta es_equipo()';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'orders' AND column_name IN ('id', 'items', 'payment_status', 'paid_at'))
           OR (table_name = 'products' AND column_name IN ('id', 'stock_by_size')))) <> 6 THEN
    RAISE EXCEPTION 'v24: cambió el esquema de orders/products';
  END IF;
  SELECT data_type INTO v_tipo FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'stock_by_size';
  IF v_tipo <> 'jsonb' THEN
    RAISE EXCEPTION 'v24: products.stock_by_size no es jsonb (es %)', v_tipo;
  END IF;
  -- Si alguna columna nueva ya existe con otro tipo, frenar antes de pisar nada.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'orders'
                AND ((column_name = 'mp_monto_esperado' AND data_type <> 'numeric')
                  OR (column_name = 'stock_descontado_at' AND data_type <> 'timestamp with time zone')
                  OR (column_name = 'requiere_revision' AND data_type <> 'text'))) THEN
    RAISE EXCEPTION 'v24: ya existe una columna nueva de orders con otro tipo';
  END IF;
END
$pre$;

-- --------------------------------------------
-- 1-3. Columnas nuevas de orders.
-- --------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS mp_monto_esperado numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_descontado_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS requiere_revision text;

COMMENT ON COLUMN public.orders.mp_monto_esperado IS
  'v24: total que preferencia.ts le pidió cobrar a MP (desde products + promos). El webhook compara el pago contra esto.';
COMMENT ON COLUMN public.orders.stock_descontado_at IS
  'v24: cuándo descontar_stock_pedido descontó el stock de este pedido. NULL = todavía no. Idempotencia.';
COMMENT ON COLUMN public.orders.requiere_revision IS
  'v24: NULL = ok. Si no, por qué el equipo tiene que revisar el pago (monto/moneda, doble cobro, sin stock). Se limpia a mano.';

-- --------------------------------------------
-- 4. RPC descontar_stock_pedido.
-- --------------------------------------------
-- La llama webhook.ts con service_role cada vez que MP informa un pago
-- aprobado y correcto. Contrato:
--   · Idempotente: el pedido se bloquea (FOR UPDATE) y si ya tiene
--     stock_descontado_at devuelve {ok:true, ya_descontado:true} sin tocar
--     nada. Dos notificaciones simultáneas del mismo pago se serializan acá.
--   · Solo pedidos con payment_status = 'aprobado' (lo escribe el webhook
--     justo antes). Cualquier otro estado: {ok:false} sin tocar nada.
--   · Atómica, todo o nada: bloquea los productos del pedido en orden de id
--     (dos pedidos con productos en común no se trancan entre sí), verifica
--     TODAS las líneas y recién después descuenta. Si alguna no alcanza
--     (otro pedido se llevó la última unidad, el producto se borró, la
--     variante ya no existe, un renglón es ilegible), NO descuenta nada, NO
--     deja negativos, escribe el motivo en requiere_revision y devuelve
--     {ok:false, motivo:'sin stock', detalle:[...]}; stock_descontado_at
--     queda NULL. Ese pedido lo resuelve el equipo a mano (devolver el pago
--     o conseguir la prenda).
--   · Clave de stock_by_size: la MISMA que el carrito y que
--     api/_lib/mp.ts (claveStock): "talle|color", o solo "talle" si no hay
--     color. Cantidades por producto+variante sumadas (el pedido lo arma el
--     cliente y puede traer la misma variante en dos renglones).
CREATE OR REPLACE FUNCTION public.descontar_stock_pedido(p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_items jsonb;
  v_estado text;
  v_descontado timestamptz;
  v_linea record;
  v_stock jsonb;
  v_hay bigint;
  v_faltan text[] := ARRAY[]::text[];
  v_msg text;
BEGIN
  SELECT o.items, o.payment_status, o.stock_descontado_at
    INTO v_items, v_estado, v_descontado
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'pedido inexistente');
  END IF;
  IF v_descontado IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ya_descontado', true);
  END IF;
  IF v_estado IS DISTINCT FROM 'aprobado' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'el pedido no está aprobado');
  END IF;

  -- Forma de los renglones. ELSIF encadenados a propósito (como los IFs
  -- anidados del trigger v22): jsonb_array_length / jsonb_array_elements
  -- revientan si items no es un array, y SQL no garantiza cortocircuito en OR.
  IF COALESCE(jsonb_typeof(v_items), '') <> 'array' THEN
    v_faltan := ARRAY['items no es un array'];
  ELSIF jsonb_array_length(v_items) = 0 THEN
    v_faltan := ARRAY['items vacío'];
  ELSIF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_items) AS e(v)
     WHERE COALESCE(jsonb_typeof(e.v), '') <> 'object'
        OR COALESCE(e.v -> 'product' ->> 'id', '') = ''
        OR COALESCE(jsonb_typeof(e.v -> 'quantity'), '') <> 'number'
        OR COALESCE(e.v ->> 'quantity', '') !~ '^[1-9][0-9]{0,5}$'
  ) THEN
    v_faltan := ARRAY['hay renglones ilegibles en items'];
  END IF;

  IF cardinality(v_faltan) = 0 THEN
    -- Lock de los productos del pedido, en orden de id.
    PERFORM 1
       FROM public.products p
      WHERE p.id IN (SELECT DISTINCT e.v -> 'product' ->> 'id' FROM jsonb_array_elements(v_items) AS e(v))
      ORDER BY p.id
        FOR UPDATE;

    -- Primera pasada: verificar todo.
    FOR v_linea IN
      SELECT e.v -> 'product' ->> 'id' AS producto,
             CASE WHEN COALESCE(e.v ->> 'selectedColor', '') <> ''
                  THEN COALESCE(e.v ->> 'selectedSize', '') || '|' || (e.v ->> 'selectedColor')
                  ELSE COALESCE(e.v ->> 'selectedSize', '')
             END AS clave,
             sum((e.v ->> 'quantity')::int) AS cantidad
        FROM jsonb_array_elements(v_items) AS e(v)
       GROUP BY 1, 2
       ORDER BY 1, 2
    LOOP
      SELECT p.stock_by_size INTO v_stock FROM public.products p WHERE p.id = v_linea.producto;
      IF NOT FOUND THEN
        v_faltan := v_faltan || format('%s: el producto ya no existe', v_linea.producto);
        CONTINUE;
      END IF;
      v_hay := CASE WHEN jsonb_typeof(v_stock -> v_linea.clave) = 'number'
                    THEN floor((v_stock ->> v_linea.clave)::numeric)::bigint
                    ELSE 0 END;
      IF v_hay < v_linea.cantidad THEN
        v_faltan := v_faltan || format('%s (%s): pide %s, hay %s',
                                       v_linea.producto, v_linea.clave, v_linea.cantidad, v_hay);
      END IF;
    END LOOP;
  END IF;

  IF cardinality(v_faltan) > 0 THEN
    v_msg := 'no se pudo descontar stock al acreditar el pago: ' || array_to_string(v_faltan, '; ');
    -- Sin duplicar el motivo si MP reintenta la notificación.
    UPDATE public.orders
       SET requiere_revision = CASE
             WHEN requiere_revision IS NULL THEN v_msg
             WHEN position('no se pudo descontar stock' IN requiere_revision) > 0 THEN requiere_revision
             ELSE requiere_revision || ' | ' || v_msg
           END
     WHERE id = p_order_id;
    RETURN jsonb_build_object('ok', false, 'motivo', 'sin stock', 'detalle', to_jsonb(v_faltan));
  END IF;

  -- Segunda pasada: descontar (ya se verificó que todo alcanza).
  FOR v_linea IN
    SELECT e.v -> 'product' ->> 'id' AS producto,
           CASE WHEN COALESCE(e.v ->> 'selectedColor', '') <> ''
                THEN COALESCE(e.v ->> 'selectedSize', '') || '|' || (e.v ->> 'selectedColor')
                ELSE COALESCE(e.v ->> 'selectedSize', '')
           END AS clave,
           sum((e.v ->> 'quantity')::int) AS cantidad
      FROM jsonb_array_elements(v_items) AS e(v)
     GROUP BY 1, 2
  LOOP
    UPDATE public.products p
       SET stock_by_size = jsonb_set(
             p.stock_by_size,
             ARRAY[v_linea.clave],
             to_jsonb(floor((p.stock_by_size ->> v_linea.clave)::numeric)::bigint - v_linea.cantidad))
     WHERE p.id = v_linea.producto;
  END LOOP;

  UPDATE public.orders SET stock_descontado_at = now() WHERE id = p_order_id;
  RETURN jsonb_build_object('ok', true, 'descontado', true);
END
$function$;

-- Solo el webhook (service_role). Supabase le da EXECUTE a anon y
-- authenticated en toda función nueva de public por default privileges, así
-- que no alcanza con revocar a PUBLIC.
REVOKE ALL ON FUNCTION public.descontar_stock_pedido(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.descontar_stock_pedido(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.descontar_stock_pedido(text) TO service_role;

-- --------------------------------------------
-- 5. El alta pública no trae los campos de control de MP.
-- --------------------------------------------
-- Mismo criterio que orders_validar_alta_publica (v22): corre para
-- current_user anon/authenticated que NO sea del equipo; service_role,
-- postgres y las SECURITY DEFINER quedan afuera. Trigger aparte (y no un
-- cambio a orders_clamp_pago / orders_validar_alta_publica) para no tocar lo
-- que ya está probado en producción. Los BEFORE de orders corren en orden
-- alfabético: clamp_pago, limpiar_control_mp, validar_alta_publica; ninguno
-- toca los campos de otro.
-- Sin UPDATE: anon no tiene UPDATE en orders (v22) y authenticated solo
-- actualiza si es_equipo (policy orders_admin_all).
CREATE OR REPLACE FUNCTION public.orders_limpiar_control_mp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR es_equipo() THEN
    RETURN NEW;
  END IF;
  NEW.mp_monto_esperado := NULL;
  NEW.stock_descontado_at := NULL;
  NEW.requiere_revision := NULL;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS orders_limpiar_control_mp_insert ON public.orders;
CREATE TRIGGER orders_limpiar_control_mp_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_limpiar_control_mp();

-- --------------------------------------------
-- 6. Backfill: lo ya aprobado no se vuelve a descontar.
-- --------------------------------------------
-- MP está apagado en producción, así que en principio no hay ninguno. Si
-- hubiera, su stock se manejó a mano: sin esta marca, un reintento tardío de
-- MP lo descontaría otra vez.
UPDATE public.orders
   SET stock_descontado_at = COALESCE(paid_at, now())
 WHERE payment_status = 'aprobado'
   AND stock_descontado_at IS NULL;

-- --------------------------------------------
-- 7. Post-chequeo contra el catálogo (si algo no quedó, aborta todo).
-- --------------------------------------------
DO $post$
DECLARE
  v_fn regprocedure := to_regprocedure('public.descontar_stock_pedido(text)');
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders'
         AND ((column_name = 'mp_monto_esperado' AND data_type = 'numeric')
           OR (column_name = 'stock_descontado_at' AND data_type = 'timestamp with time zone')
           OR (column_name = 'requiere_revision' AND data_type = 'text'))) <> 3 THEN
    RAISE EXCEPTION 'v24 post: faltan columnas nuevas en orders';
  END IF;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v24 post: no quedó descontar_stock_pedido(text)';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn)
     OR (SELECT proconfig FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
    RAISE EXCEPTION 'v24 post: descontar_stock_pedido sin SECURITY DEFINER o sin search_path fijo';
  END IF;
  -- has_function_privilege cuenta también lo heredado de PUBLIC.
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v24 post: anon/authenticated pueden ejecutar descontar_stock_pedido';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v24 post: service_role no puede ejecutar descontar_stock_pedido (el webhook no descontaría)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass
                   AND tgname = 'orders_limpiar_control_mp_insert' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'v24 post: falta el trigger orders_limpiar_control_mp_insert';
  END IF;
  -- Lo de v22 sigue en pie.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass
                   AND tgname = 'orders_validar_alta_publica_insert' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass
                   AND tgname = 'orders_clamp_pago_insert' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'v24 post: se perdió un trigger de v22 en orders';
  END IF;
  IF NOT has_table_privilege('anon', 'public.orders', 'INSERT') THEN
    RAISE EXCEPTION 'v24 post: anon perdió INSERT en orders (rompe el checkout)';
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders WHERE payment_status = 'aprobado' AND stock_descontado_at IS NULL) THEN
    RAISE EXCEPTION 'v24 post: quedaron pedidos aprobados sin marca de stock';
  END IF;
END
$post$;

-- --------------------------------------------
-- Prueba sugerida (en una transacción que se deshace, como v22):
-- --------------------------------------------
-- BEGIN;
--   -- producto de prueba con 1 unidad en M|Negro (sumar las columnas NOT
--   -- NULL de products que falten)
--   INSERT INTO products (id, name, price, stock_by_size, active)
--   VALUES ('zz-prueba-v24', 'Prueba v24', 100, '{"M|Negro": 1}', true);
--   INSERT INTO orders (id, customer_name, items, total, source)
--   VALUES ('ZZ-V24-A', 'Prueba', '[{"product":{"id":"zz-prueba-v24"},"quantity":1,"selectedSize":"M","selectedColor":"Negro"}]', 100, 'web'),
--          ('ZZ-V24-B', 'Prueba', '[{"product":{"id":"zz-prueba-v24"},"quantity":1,"selectedSize":"M","selectedColor":"Negro"}]', 100, 'web');
--   -- 'aprobado' con UPDATE: en el INSERT, orders_clamp_pago (v1) lo bajaría
--   -- a 'iniciado' (desde el editor SQL auth.role() no es service_role).
--   UPDATE orders SET payment_status = 'aprobado' WHERE id LIKE 'ZZ-V24-%';
--   SELECT descontar_stock_pedido('ZZ-V24-A');  -- {"ok": true, "descontado": true}
--   SELECT descontar_stock_pedido('ZZ-V24-A');  -- {"ok": true, "ya_descontado": true}
--   SELECT descontar_stock_pedido('ZZ-V24-B');  -- {"ok": false, "motivo": "sin stock", ...}
--   SELECT stock_by_size FROM products WHERE id = 'zz-prueba-v24';   -- {"M|Negro": 0}
--   SELECT id, stock_descontado_at IS NOT NULL, requiere_revision FROM orders WHERE id LIKE 'ZZ-V24-%';
--   SET LOCAL ROLE anon;
--   SELECT descontar_stock_pedido('ZZ-V24-A');  -- ERROR: permission denied
-- ROLLBACK;
--
-- Para deshacer la migración entera (si hiciera falta):
--   DROP TRIGGER IF EXISTS orders_limpiar_control_mp_insert ON public.orders;
--   DROP FUNCTION IF EXISTS public.orders_limpiar_control_mp();
--   DROP FUNCTION IF EXISTS public.descontar_stock_pedido(text);
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS requiere_revision,
--     DROP COLUMN IF EXISTS stock_descontado_at, DROP COLUMN IF EXISTS mp_monto_esperado;
--   (el código degrada solo: ver arriba.)
