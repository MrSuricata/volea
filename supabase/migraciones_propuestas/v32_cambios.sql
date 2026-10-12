-- v32: cambios de prendas. Una prenda vuelve (suma stock), otra se va (resta stock) y la
-- diferencia de plata se resuelve en el momento:
--   cliente paga   → efectivo / transferencia / mp / debe  (venta en bot_ledger)
--   le sobra plata → le devolvés (venta NEGATIVA en bot_ledger) o queda «a favor»
--   0              → sin cargo (1 a 1, premio, falla…)
-- Anular un cambio deshace el stock y la venta.

CREATE TABLE IF NOT EXISTS cambios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  cliente text NOT NULL,
  order_id text REFERENCES orders(id) ON DELETE SET NULL,
  devuelve_product_id text REFERENCES products(id) ON DELETE SET NULL,
  devuelve_variant text,
  devuelve_nombre text NOT NULL,
  devuelve_precio numeric NOT NULL DEFAULT 0,
  lleva_product_id text REFERENCES products(id) ON DELETE SET NULL,
  lleva_variant text,
  lleva_nombre text NOT NULL,
  lleva_precio numeric NOT NULL DEFAULT 0,
  -- lo que paga el cliente (+) o lo que se le debe (−); 0 = sin cargo
  monto numeric NOT NULL DEFAULT 0,
  metodo text NOT NULL CHECK (metodo IN ('efectivo', 'transferencia', 'mp', 'debe', 'a_favor', 'sin_cargo')),
  nota text,
  reported_by text NOT NULL DEFAULT 'Web',
  ledger_id uuid REFERENCES bot_ledger(id) ON DELETE SET NULL,
  saldo_usado_el timestamptz,
  reverted boolean NOT NULL DEFAULT false
);

ALTER TABLE cambios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cambios_equipo_lee ON cambios;
CREATE POLICY cambios_equipo_lee ON cambios FOR SELECT USING (es_equipo());
-- Las escrituras van solo por las RPC de abajo (SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.admin_registrar_cambio(
  p_cliente text, p_order_id text,
  p_dev_product text, p_dev_variant text,
  p_lleva_product text, p_lleva_variant text,
  p_monto numeric, p_metodo text, p_nota text, p_reported_by text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cliente text := upper(btrim(COALESCE(p_cliente, '')));
  v_reported text := COALESCE(NULLIF(btrim(COALESCE(p_reported_by, '')), ''), 'Web');
  v_monto numeric := COALESCE(p_monto, 0);
  v_dev record;
  v_lleva record;
  v_stock int;
  v_label text;
  v_ledger uuid := NULL;
  v_id uuid;
BEGIN
  IF NOT es_equipo() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'solo admins');
  END IF;
  IF v_cliente = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta el nombre del cliente');
  END IF;
  IF p_metodo IS NULL OR p_metodo NOT IN ('efectivo', 'transferencia', 'mp', 'debe', 'a_favor', 'sin_cargo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forma de pago inválida');
  END IF;
  IF v_monto = 0 AND p_metodo <> 'sin_cargo' THEN p_metodo := 'sin_cargo'; END IF;
  IF v_monto > 0 AND p_metodo IN ('a_favor', 'sin_cargo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'el cliente tiene que pagar la diferencia');
  END IF;
  IF v_monto < 0 AND p_metodo IN ('debe', 'sin_cargo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'la diferencia es a favor del cliente: devolvela o dejala a favor');
  END IF;
  IF p_dev_product IS NULL OR p_lleva_product IS NULL OR p_dev_variant IS NULL OR p_lleva_variant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'faltan las prendas o sus talles');
  END IF;

  -- La que se lleva: tiene que haber.
  SELECT id, name, price, stock_by_size INTO v_lleva FROM products WHERE id = p_lleva_product FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'la prenda nueva ya no está en el catálogo');
  END IF;
  v_stock := COALESCE((v_lleva.stock_by_size ->> p_lleva_variant)::int, 0);
  IF v_stock < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no queda stock de la prenda nueva en ese talle');
  END IF;
  UPDATE products SET stock_by_size = jsonb_set(COALESCE(stock_by_size, '{}'::jsonb), ARRAY[p_lleva_variant], to_jsonb(v_stock - 1))
    WHERE id = p_lleva_product;

  -- La que devuelve: vuelve al stock (puede ser el mismo producto en otro talle).
  SELECT id, name, price, stock_by_size INTO v_dev FROM products WHERE id = p_dev_product FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'la prenda devuelta no está en el catálogo');
  END IF;
  UPDATE products SET stock_by_size = jsonb_set(COALESCE(stock_by_size, '{}'::jsonb), ARRAY[p_dev_variant],
      to_jsonb(COALESCE((stock_by_size ->> p_dev_variant)::int, 0) + 1))
    WHERE id = p_dev_product;

  v_label := 'Cambio ' || v_cliente || ': ' || v_dev.name || ' ' || replace(p_dev_variant, '|', ' ') ||
             ' → ' || v_lleva.name || ' ' || replace(p_lleva_variant, '|', ' ') ||
             CASE WHEN v_monto < 0 THEN ' (devolución)' ELSE '' END;

  IF p_metodo IN ('efectivo', 'transferencia', 'mp', 'debe') AND v_monto <> 0 THEN
    INSERT INTO bot_ledger (kind, product_id, variant_key, label, qty, amount, reported_by, chat_id, payment_method, debtor_name)
    VALUES ('venta', NULL, NULL, v_label, 1, v_monto, v_reported, 0, p_metodo,
            CASE WHEN p_metodo = 'debe' THEN v_cliente ELSE NULL END)
    RETURNING id INTO v_ledger;
  END IF;

  INSERT INTO cambios (cliente, order_id, devuelve_product_id, devuelve_variant, devuelve_nombre, devuelve_precio,
                       lleva_product_id, lleva_variant, lleva_nombre, lleva_precio, monto, metodo, nota, reported_by, ledger_id)
  VALUES (v_cliente, NULLIF(btrim(COALESCE(p_order_id, '')), ''), v_dev.id, p_dev_variant, v_dev.name, COALESCE(v_dev.price, 0),
          v_lleva.id, p_lleva_variant, v_lleva.name, COALESCE(v_lleva.price, 0), v_monto, p_metodo,
          NULLIF(btrim(COALESCE(p_nota, '')), ''), v_reported, v_ledger)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_anular_cambio(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v cambios%ROWTYPE;
BEGIN
  IF NOT es_equipo() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'solo admins');
  END IF;
  SELECT * INTO v FROM cambios WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ese cambio no existe'); END IF;
  IF v.reverted THEN RETURN jsonb_build_object('ok', false, 'error', 'ya estaba anulado'); END IF;

  -- Deshacer stock: la nueva vuelve, la devuelta sale (sin bajar de 0).
  IF v.lleva_product_id IS NOT NULL THEN
    UPDATE products SET stock_by_size = jsonb_set(COALESCE(stock_by_size, '{}'::jsonb), ARRAY[v.lleva_variant],
        to_jsonb(COALESCE((stock_by_size ->> v.lleva_variant)::int, 0) + 1))
      WHERE id = v.lleva_product_id;
  END IF;
  IF v.devuelve_product_id IS NOT NULL THEN
    UPDATE products SET stock_by_size = jsonb_set(COALESCE(stock_by_size, '{}'::jsonb), ARRAY[v.devuelve_variant],
        to_jsonb(GREATEST(COALESCE((stock_by_size ->> v.devuelve_variant)::int, 0) - 1, 0)))
      WHERE id = v.devuelve_product_id;
  END IF;
  IF v.ledger_id IS NOT NULL THEN
    UPDATE bot_ledger SET reverted = true WHERE id = v.ledger_id;
  END IF;
  UPDATE cambios SET reverted = true WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Saldo a favor: marcar que ya lo usó (o volver a dejarlo pendiente).
CREATE OR REPLACE FUNCTION public.admin_saldo_cambio_usado(p_id uuid, p_usado boolean) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT es_equipo() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'solo admins');
  END IF;
  UPDATE cambios SET saldo_usado_el = CASE WHEN p_usado THEN now() ELSE NULL END
    WHERE id = p_id AND metodo = 'a_favor' AND NOT reverted;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ese saldo no existe'); END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.admin_registrar_cambio(text, text, text, text, text, text, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_anular_cambio(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_saldo_cambio_usado(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_registrar_cambio(text, text, text, text, text, text, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_anular_cambio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_saldo_cambio_usado(uuid, boolean) TO authenticated;
