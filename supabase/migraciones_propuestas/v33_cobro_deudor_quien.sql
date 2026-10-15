-- v33: al cobrar una deuda se guarda QUIÉN RECIBIÓ LA PLATA, para que al liquidar la caja
-- esa venta vaya sola a su cuenta (se puede cambiar igual).
-- En ventas, bot_ledger.paid_by = quién tiene la plata (en gastos sigue siendo quién pagó).
-- Mismo comportamiento que antes si no se manda p_cobrado_por.

DROP FUNCTION IF EXISTS public.admin_cobrar_deudor(text, text, numeric);

CREATE OR REPLACE FUNCTION public.admin_cobrar_deudor(
  p_debtor text, p_method text, p_monto numeric DEFAULT NULL::numeric, p_cobrado_por text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  fila record;
  v_total_deuda numeric := 0;
  v_objetivo numeric;
  v_restante_pago numeric;
  v_cerradas int := 0;
  v_quien text := NULLIF(lower(btrim(COALESCE(p_cobrado_por, ''))), '');
BEGIN
  IF NOT es_equipo() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'solo admins');
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('mp', 'efectivo', 'transferencia') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'método inválido');
  END IF;
  IF v_quien IS NOT NULL AND v_quien NOT IN ('brian', 'paula', 'gaston') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'quién cobró: brian, paula o gaston');
  END IF;
  IF coalesce(btrim(p_debtor), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deudor vacío');
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_total_deuda
  FROM bot_ledger
  WHERE kind = 'venta' AND payment_method = 'debe' AND debtor_name = p_debtor
    AND settled_at IS NULL AND NOT reverted;

  IF v_total_deuda = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no hay deudas pendientes de ' || p_debtor);
  END IF;

  v_objetivo := coalesce(p_monto, v_total_deuda);
  IF v_objetivo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'monto inválido');
  END IF;
  IF v_objetivo > v_total_deuda THEN
    v_objetivo := v_total_deuda; -- pagar de más no existe: se cobra todo
  END IF;

  v_restante_pago := v_objetivo;
  FOR fila IN
    SELECT id, label, amount FROM bot_ledger
    WHERE kind = 'venta' AND payment_method = 'debe' AND debtor_name = p_debtor
      AND settled_at IS NULL AND NOT reverted
    ORDER BY created_at
    FOR UPDATE
  LOOP
    EXIT WHEN v_restante_pago <= 0;
    IF fila.amount <= v_restante_pago THEN
      UPDATE bot_ledger SET settled_at = now(), settled_method = p_method, paid_by = v_quien WHERE id = fila.id;
      v_restante_pago := v_restante_pago - fila.amount;
      v_cerradas := v_cerradas + 1;
    ELSE
      -- Ítem a caballo: la original queda pendiente por el resto,
      -- la parte pagada nace ya cobrada (sin producto: anularla no toca stock).
      UPDATE bot_ledger SET amount = fila.amount - v_restante_pago WHERE id = fila.id;
      INSERT INTO bot_ledger (kind, label, product_id, variant_key, qty, amount, reported_by, chat_id, payment_method, debtor_name, settled_at, settled_method, paid_by)
      VALUES ('venta', fila.label || ' (pago parcial)', NULL, NULL, 1, v_restante_pago, 'Web', 0, 'debe', p_debtor, now(), p_method, v_quien);
      v_cerradas := v_cerradas + 1;
      v_restante_pago := 0;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cobradas', v_cerradas, 'total', v_objetivo, 'restante', v_total_deuda - v_objetivo);
END $function$;

REVOKE ALL ON FUNCTION public.admin_cobrar_deudor(text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cobrar_deudor(text, text, numeric, text) TO authenticated;
