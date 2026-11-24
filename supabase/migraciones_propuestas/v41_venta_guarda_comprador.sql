-- v41 · La venta de la Caja guarda SIEMPRE el nombre de quién compró / quién pagó.
-- Antes el nombre solo se guardaba si la venta era «Debe»; en las demás (efectivo, MP,
-- transferencia) se perdía salvo que coincidiera con un jugador del padrón. Gastón anotaba
-- ahí de quién era cada transferencia y después no lo encontraba.
-- Las deudas no cambian: todo lo que mira deudas filtra por payment_method = 'debe'.
-- Se puede pegar más de una vez.

CREATE OR REPLACE FUNCTION public.admin_registrar_venta(p_label text, p_amount numeric, p_payment text, p_reported_by text, p_product_id text DEFAULT NULL::text, p_variant_key text DEFAULT NULL::text, p_qty integer DEFAULT 1, p_debtor text DEFAULT NULL::text, p_jugador_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_label text := btrim(COALESCE(p_label, ''));
  v_reported text := COALESCE(NULLIF(btrim(COALESCE(p_reported_by, '')), ''), 'Web');
  v_stock jsonb;
  v_before int;
  v_after int := NULL;
  v_jugador text := NULL;
  v_nombre_jug text;
  v_debtor text;
BEGIN
  IF NOT es_equipo() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'solo admins');
  END IF;

  IF p_payment IS NULL OR p_payment NOT IN ('mp', 'efectivo', 'transferencia', 'debe') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'método de pago inválido');
  END IF;

  -- Comprador opcional (en cualquier método). Si existe, su nombre canónico
  -- manda para el deudor: así las deudas de la misma persona se agrupan.
  IF COALESCE(btrim(p_jugador_id), '') <> '' THEN
    SELECT id, nombre INTO v_jugador, v_nombre_jug FROM rk_jugadores WHERE id = btrim(p_jugador_id);
    IF v_jugador IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ese jugador no está en el padrón');
    END IF;
  END IF;
  v_debtor := COALESCE(v_nombre_jug, NULLIF(btrim(COALESCE(p_debtor, '')), ''));

  IF p_payment = 'debe' AND COALESCE(v_debtor, '') = '' THEN
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
    -- que bot_do_register. A diferencia del bot (que clampa), acá se RECHAZA
    -- vender más que el stock: en la web hay tiempo de elegir otra variante.
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

  -- v41: el nombre se guarda en cualquier método (antes solo con 'debe').
  INSERT INTO bot_ledger (kind, product_id, variant_key, label, qty, amount, reported_by, chat_id, payment_method, debtor_name, jugador_id)
  VALUES ('venta', p_product_id,
          CASE WHEN p_product_id IS NOT NULL THEN p_variant_key ELSE NULL END,
          v_label, p_qty, p_amount, v_reported, 0, p_payment,
          v_debtor,
          v_jugador);

  RETURN jsonb_build_object('ok', true, 'stock_left', v_after);
END;
$function$;

-- Las ventas ya vinculadas a un jugador del padrón recuperan el nombre (era lo único que se había guardado).
UPDATE public.bot_ledger l SET debtor_name = j.nombre
FROM public.rk_jugadores j
WHERE l.jugador_id = j.id AND l.kind = 'venta' AND l.debtor_name IS NULL;
