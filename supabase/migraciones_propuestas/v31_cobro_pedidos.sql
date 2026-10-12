-- v31: cobro de pedidos de la tienda en la Caja.
-- El estado del pedido (pendiente → entregado) es logística; si te pagó o te debe
-- vive en bot_ledger. Esta migración une las dos: una venta de caja puede apuntar
-- a su pedido (order_id) y «Cobro» en el pedido la anota con un toque.
-- Sin producto a propósito: el stock de los pedidos de WhatsApp se maneja aparte.

ALTER TABLE bot_ledger ADD COLUMN IF NOT EXISTS order_id text REFERENCES orders(id) ON DELETE SET NULL;

-- Un pedido se anota una sola vez (anular el cobro libera el lugar para volver a anotarlo).
CREATE UNIQUE INDEX IF NOT EXISTS bot_ledger_order_id_uidx
  ON bot_ledger (order_id) WHERE order_id IS NOT NULL AND NOT reverted;

CREATE OR REPLACE FUNCTION public.admin_cobrar_pedido(
  p_order_id text, p_payment text, p_reported_by text, p_jugador_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_order record;
  v_label text;
  v_jugador text := NULL;
  v_nombre_jug text;
  v_debtor text;
  v_reported text := COALESCE(NULLIF(btrim(COALESCE(p_reported_by, '')), ''), 'Web');
BEGIN
  IF NOT es_equipo() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'solo admins');
  END IF;
  IF p_payment IS NULL OR p_payment NOT IN ('mp', 'efectivo', 'transferencia', 'debe') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'método de pago inválido');
  END IF;

  SELECT id, total, customer_name, items INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ese pedido no existe');
  END IF;
  IF COALESCE(v_order.total, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'el pedido no tiene total');
  END IF;
  IF EXISTS (SELECT 1 FROM bot_ledger WHERE order_id = p_order_id AND NOT reverted) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ese pedido ya está anotado en la caja');
  END IF;

  IF COALESCE(btrim(p_jugador_id), '') <> '' THEN
    SELECT id, nombre INTO v_jugador, v_nombre_jug FROM rk_jugadores WHERE id = btrim(p_jugador_id);
    IF v_jugador IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ese jugador no está en el padrón');
    END IF;
  END IF;
  v_debtor := COALESCE(v_nombre_jug, NULLIF(upper(btrim(COALESCE(v_order.customer_name, ''))), ''));
  IF p_payment = 'debe' AND COALESCE(v_debtor, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'el pedido no tiene nombre de cliente');
  END IF;

  SELECT 'Pedido ' || v_order.id || ': ' || COALESCE(string_agg(
           COALESCE(it->'product'->>'name', it->>'name', 'producto') ||
           CASE WHEN COALESCE(it->>'selectedColor', '') <> '' THEN ' ' || (it->>'selectedColor') ELSE '' END ||
           CASE WHEN COALESCE((it->>'quantity')::int, 1) > 1 THEN ' x' || (it->>'quantity') ELSE '' END,
           ', '), 'productos')
    INTO v_label
    FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb)) it;

  INSERT INTO bot_ledger (kind, product_id, variant_key, label, qty, amount, reported_by, chat_id,
                          payment_method, debtor_name, jugador_id, order_id)
  VALUES ('venta', NULL, NULL, v_label, 1, v_order.total, v_reported, 0, p_payment,
          CASE WHEN p_payment = 'debe' THEN v_debtor ELSE NULL END, v_jugador, v_order.id);

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.admin_cobrar_pedido(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cobrar_pedido(text, text, text, text) TO authenticated;
