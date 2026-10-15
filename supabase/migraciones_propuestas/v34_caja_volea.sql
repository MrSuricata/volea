-- v34: CAJA VOLEA, la plata física de la caja como un cuarto "tenedor" además de los socios.
-- · Al liquidar, una venta puede quedar en la Caja (no mueve las cuentas de socios: es de los tres)
--   y un gasto puede salir de la Caja.
-- · Al cobrar una deuda o pagar un gasto se puede elegir "caja".
-- · Movimientos propios: conteo (ajusta al efectivo real), retiro (un socio se lleva plata: queda
--   debiendo la parte de los otros), aporte (un socio pone plata: los otros le deben su parte) y
--   reparto 50/25/25 (sale de la caja, no cambia saldos entre socios).
-- Nada de esto toca movimientos ya liquidados.

-- 1) "caja" como valor válido de quién tiene / puso la plata
ALTER TABLE bot_ledger DROP CONSTRAINT IF EXISTS bot_ledger_paid_by_check;
ALTER TABLE bot_ledger ADD CONSTRAINT bot_ledger_paid_by_check
  CHECK (paid_by IS NULL OR paid_by IN ('brian', 'paula', 'gaston', 'caja'));
ALTER TABLE gastos_pendientes DROP CONSTRAINT IF EXISTS gastos_pendientes_pagado_por_check;
ALTER TABLE gastos_pendientes ADD CONSTRAINT gastos_pendientes_pagado_por_check
  CHECK (pagado_por IN ('brian', 'paula', 'gaston', 'caja'));

-- 2) Movimientos de la caja física. monto con signo: + entra, − sale.
CREATE TABLE IF NOT EXISTS caja_volea_movs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  fecha date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Montevideo')::date,
  tipo text NOT NULL CHECK (tipo IN ('venta', 'gasto', 'conteo', 'retiro', 'aporte', 'reparto')),
  monto numeric NOT NULL,
  descripcion text NOT NULL,
  socio text CHECK (socio IS NULL OR socio IN ('brian', 'paula', 'gaston')),
  contado numeric,
  socio_move_id uuid REFERENCES socio_moves(id) ON DELETE SET NULL,
  reported_by text NOT NULL DEFAULT 'Web',
  reverted boolean NOT NULL DEFAULT false
);
ALTER TABLE caja_volea_movs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS caja_volea_equipo_lee ON caja_volea_movs;
CREATE POLICY caja_volea_equipo_lee ON caja_volea_movs FOR SELECT USING (es_equipo());

-- 3) Gastos y deudas: aceptar "caja"
CREATE OR REPLACE FUNCTION public.admin_registrar_gasto(p_label text, p_amount numeric, p_reported_by text, p_paid_by text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_label text := btrim(COALESCE(p_label, ''));
  v_reported text := COALESCE(NULLIF(btrim(COALESCE(p_reported_by, '')), ''), 'Web');
  v_paid text := NULLIF(btrim(lower(COALESCE(p_paid_by, ''))), '');
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo admins'); END IF;
  IF v_label = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'falta la descripción del gasto'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'monto inválido'); END IF;
  IF v_paid IS NOT NULL AND v_paid NOT IN ('brian', 'paula', 'gaston', 'caja') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'socio inválido');
  END IF;
  INSERT INTO bot_ledger (kind, product_id, variant_key, label, qty, amount, reported_by, chat_id, payment_method, debtor_name, paid_by)
  VALUES ('gasto', NULL, NULL, v_label, 1, p_amount, v_reported, 0, NULL, NULL, v_paid);
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_pagar_gasto_pendiente(p_id uuid, p_paid_by text, p_reported_by text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_paid     text := nullif(btrim(lower(coalesce(p_paid_by, ''))), '');
  v_reported text := coalesce(nullif(btrim(coalesce(p_reported_by, '')), ''), 'Web');
  v_g        public.gastos_pendientes%rowtype;
  v_ledger   uuid;
begin
  if not es_equipo() then return jsonb_build_object('ok', false, 'error', 'solo el equipo'); end if;
  if v_paid is null or v_paid not in ('brian', 'paula', 'gaston', 'caja') then
    return jsonb_build_object('ok', false, 'error', 'falta quien puso la plata');
  end if;
  select * into v_g from public.gastos_pendientes where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'el gasto ya no existe'); end if;
  if v_g.pagado_at is not null then return jsonb_build_object('ok', false, 'error', 'ese gasto ya figura pagado'); end if;
  insert into public.bot_ledger (kind, product_id, variant_key, label, qty, amount, reported_by, chat_id, payment_method, debtor_name, paid_by)
  values ('gasto', null, null, v_g.label, 1, v_g.amount, v_reported, 0, null, null, v_paid)
  returning id into v_ledger;
  update public.gastos_pendientes set pagado_at = now(), pagado_por = v_paid, ledger_id = v_ledger, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'ledger_id', v_ledger);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_cobrar_deudor(
  p_debtor text, p_method text, p_monto numeric DEFAULT NULL::numeric, p_cobrado_por text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  fila record;
  v_total_deuda numeric := 0;
  v_objetivo numeric;
  v_restante_pago numeric;
  v_cerradas int := 0;
  v_quien text := NULLIF(lower(btrim(COALESCE(p_cobrado_por, ''))), '');
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo admins'); END IF;
  IF p_method IS NULL OR p_method NOT IN ('mp', 'efectivo', 'transferencia') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'método inválido');
  END IF;
  IF v_quien IS NOT NULL AND v_quien NOT IN ('brian', 'paula', 'gaston', 'caja') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'quién cobró: brian, paula, gaston o caja');
  END IF;
  IF coalesce(btrim(p_debtor), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'deudor vacío'); END IF;

  SELECT coalesce(sum(amount), 0) INTO v_total_deuda FROM bot_ledger
  WHERE kind = 'venta' AND payment_method = 'debe' AND debtor_name = p_debtor AND settled_at IS NULL AND NOT reverted;
  IF v_total_deuda = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'no hay deudas pendientes de ' || p_debtor); END IF;

  v_objetivo := coalesce(p_monto, v_total_deuda);
  IF v_objetivo <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'monto inválido'); END IF;
  IF v_objetivo > v_total_deuda THEN v_objetivo := v_total_deuda; END IF;

  v_restante_pago := v_objetivo;
  FOR fila IN
    SELECT id, label, amount FROM bot_ledger
    WHERE kind = 'venta' AND payment_method = 'debe' AND debtor_name = p_debtor AND settled_at IS NULL AND NOT reverted
    ORDER BY created_at FOR UPDATE
  LOOP
    EXIT WHEN v_restante_pago <= 0;
    IF fila.amount <= v_restante_pago THEN
      UPDATE bot_ledger SET settled_at = now(), settled_method = p_method, paid_by = v_quien WHERE id = fila.id;
      v_restante_pago := v_restante_pago - fila.amount;
      v_cerradas := v_cerradas + 1;
    ELSE
      UPDATE bot_ledger SET amount = fila.amount - v_restante_pago WHERE id = fila.id;
      INSERT INTO bot_ledger (kind, label, product_id, variant_key, qty, amount, reported_by, chat_id, payment_method, debtor_name, settled_at, settled_method, paid_by)
      VALUES ('venta', fila.label || ' (pago parcial)', NULL, NULL, 1, v_restante_pago, 'Web', 0, 'debe', p_debtor, now(), p_method, v_quien);
      v_cerradas := v_cerradas + 1;
      v_restante_pago := 0;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'cobradas', v_cerradas, 'total', v_objetivo, 'restante', v_total_deuda - v_objetivo);
END $function$;

-- 4) Liquidar caja: los movimientos con "caja": true van a la Caja VOLEA, no a socios.
CREATE OR REPLACE FUNCTION public.admin_liquidar_caja(p_ids uuid[], p_moves jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_n int;
  v_bot_ventas numeric;
  v_bot_gastos numeric;
  v_mv_ventas numeric;
  v_mv_gastos numeric;
  m jsonb;
begin
  if not public.es_equipo() then return jsonb_build_object('ok', false, 'error', 'No autorizado'); end if;
  if p_ids is null or array_length(p_ids, 1) is null or p_moves is null or jsonb_array_length(p_moves) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Sin movimientos para liquidar');
  end if;

  select count(*),
         coalesce(sum(amount) filter (where kind = 'venta'), 0),
         coalesce(sum(amount) filter (where kind = 'gasto'), 0)
    into v_n, v_bot_ventas, v_bot_gastos
    from bot_ledger where id = any(p_ids) and not reverted and socio_settled_at is null;
  if v_n <> array_length(p_ids, 1) then
    return jsonb_build_object('ok', false, 'error', 'Alguna venta o gasto ya fue liquidado o anulado. Actualizá y volvé a intentar.');
  end if;

  select coalesce(sum((x->>'monto')::numeric) filter (where x->>'tipo' = 'venta'), 0),
         coalesce(sum((x->>'monto')::numeric) filter (where x->>'tipo' = 'gasto'), 0)
    into v_mv_ventas, v_mv_gastos from jsonb_array_elements(p_moves) x;
  if abs(v_mv_ventas - v_bot_ventas) > 0.05 or abs(v_mv_gastos - v_bot_gastos) > 0.05 then
    return jsonb_build_object('ok', false, 'error', 'Los montos a liquidar no coinciden con la caja seleccionada.');
  end if;

  for m in select * from jsonb_array_elements(p_moves) loop
    if coalesce((m->>'caja')::boolean, false) then
      insert into caja_volea_movs (fecha, tipo, monto, descripcion, reported_by)
      values (coalesce((m->>'fecha')::date, (now() at time zone 'America/Montevideo')::date), m->>'tipo',
              case when m->>'tipo' = 'gasto' then -(m->>'monto')::numeric else (m->>'monto')::numeric end,
              m->>'descripcion', 'Liquidación');
    else
      insert into socio_moves (area, tipo, fecha, descripcion, monto, pagador, de, para, moneda,
                               imp_brian, imp_paula, imp_gaston, source)
      values (m->>'area', m->>'tipo', (m->>'fecha')::date, m->>'descripcion', (m->>'monto')::numeric,
              nullif(m->>'pagador', ''), nullif(m->>'de', ''), nullif(m->>'para', ''), 'UYU',
              (m->>'imp_brian')::numeric, (m->>'imp_paula')::numeric, (m->>'imp_gaston')::numeric,
              'liquidacion-caja');
    end if;
  end loop;

  update bot_ledger set socio_settled_at = now() where id = any(p_ids);
  return jsonb_build_object('ok', true, 'liquidados', v_n, 'ventas', v_bot_ventas, 'gastos', v_bot_gastos);
end
$function$;

-- 5) Movimientos propios de la Caja VOLEA
CREATE OR REPLACE FUNCTION public.admin_caja_volea(
  p_tipo text, p_monto numeric, p_socio text DEFAULT NULL, p_descripcion text DEFAULT NULL, p_reported_by text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_socio text := NULLIF(lower(btrim(COALESCE(p_socio, ''))), '');
  v_rep text := COALESCE(NULLIF(btrim(COALESCE(p_reported_by, '')), ''), 'Web');
  v_hoy date := (now() AT TIME ZONE 'America/Montevideo')::date;
  v_saldo numeric;
  v_m numeric := round(COALESCE(p_monto, 0), 2);
  v_desc text;
  b numeric; p numeric; g numeric;
  v_sm uuid := NULL;
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo el equipo'); END IF;
  IF p_tipo NOT IN ('conteo', 'retiro', 'aporte', 'reparto') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tipo inválido');
  END IF;
  IF v_m < 0 OR (p_tipo <> 'conteo' AND v_m = 0) THEN RETURN jsonb_build_object('ok', false, 'error', 'monto inválido'); END IF;
  IF p_tipo IN ('retiro', 'aporte') AND (v_socio IS NULL OR v_socio NOT IN ('brian', 'paula', 'gaston')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'falta el socio');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('caja_volea'));
  SELECT COALESCE(sum(monto), 0) INTO v_saldo FROM caja_volea_movs WHERE NOT reverted;

  IF p_tipo = 'conteo' THEN
    INSERT INTO caja_volea_movs (fecha, tipo, monto, contado, descripcion, reported_by)
    VALUES (v_hoy, 'conteo', v_m - v_saldo, v_m,
            COALESCE(NULLIF(btrim(p_descripcion), ''), 'Conteo de la caja') ||
            ' — había $' || to_char(v_m, 'FM999G999G990') || ', se esperaban $' || to_char(v_saldo, 'FM999G999G990'),
            v_rep);
    RETURN jsonb_build_object('ok', true, 'saldo', v_m, 'diferencia', v_m - v_saldo);
  END IF;

  IF p_tipo IN ('retiro', 'reparto') AND v_m > v_saldo + 0.005 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'en la caja hay $' || to_char(v_saldo, 'FM999G999G990'));
  END IF;

  IF p_tipo = 'retiro' THEN
    -- Se lleva plata de los tres: queda debiendo la parte de los otros (como una venta que cobró él).
    b := round(v_m * 0.50, 2); p := round(v_m * 0.25, 2); g := round(v_m * 0.25, 2);
    v_desc := COALESCE(NULLIF(btrim(p_descripcion), ''), 'Retiro de la caja VOLEA');
    INSERT INTO socio_moves (area, tipo, fecha, descripcion, monto, pagador, de, para, moneda, imp_brian, imp_paula, imp_gaston, source)
    VALUES ('marca', 'venta', v_hoy, v_desc, v_m, NULL, NULL, v_socio, 'UYU',
            CASE WHEN v_socio = 'brian' THEN p + g ELSE -b END,
            CASE WHEN v_socio = 'paula' THEN b + g ELSE -p END,
            CASE WHEN v_socio = 'gaston' THEN b + p ELSE -g END,
            'caja-volea')
    RETURNING id INTO v_sm;
    INSERT INTO caja_volea_movs (fecha, tipo, monto, socio, descripcion, socio_move_id, reported_by)
    VALUES (v_hoy, 'retiro', -v_m, v_socio, v_desc, v_sm, v_rep);
  ELSIF p_tipo = 'aporte' THEN
    -- Pone plata suya: los otros le deben su parte (como un gasto que pagó él).
    b := round(v_m * 0.50, 2); p := round(v_m * 0.25, 2); g := round(v_m - b - p, 2);
    v_desc := COALESCE(NULLIF(btrim(p_descripcion), ''), 'Aporte a la caja VOLEA');
    INSERT INTO socio_moves (area, tipo, fecha, descripcion, monto, pagador, de, para, moneda, imp_brian, imp_paula, imp_gaston, source)
    VALUES ('marca', 'gasto', v_hoy, v_desc, v_m, v_socio, NULL, NULL, 'UYU',
            b - CASE WHEN v_socio = 'brian' THEN v_m ELSE 0 END,
            p - CASE WHEN v_socio = 'paula' THEN v_m ELSE 0 END,
            g - CASE WHEN v_socio = 'gaston' THEN v_m ELSE 0 END,
            'caja-volea')
    RETURNING id INTO v_sm;
    INSERT INTO caja_volea_movs (fecha, tipo, monto, socio, descripcion, socio_move_id, reported_by)
    VALUES (v_hoy, 'aporte', v_m, v_socio, v_desc, v_sm, v_rep);
  ELSE
    -- Reparto 50/25/25: cada uno se lleva su parte, nadie le debe a nadie.
    v_desc := COALESCE(NULLIF(btrim(p_descripcion), ''), 'Reparto 50/25/25') ||
              ' — Brian $' || to_char(round(v_m * 0.5, 2), 'FM999G999G990D00') ||
              ', Paula $' || to_char(round(v_m * 0.25, 2), 'FM999G999G990D00') ||
              ', Gastón $' || to_char(v_m - round(v_m * 0.5, 2) - round(v_m * 0.25, 2), 'FM999G999G990D00');
    INSERT INTO caja_volea_movs (fecha, tipo, monto, descripcion, reported_by)
    VALUES (v_hoy, 'reparto', -v_m, v_desc, v_rep);
  END IF;

  RETURN jsonb_build_object('ok', true, 'saldo', v_saldo + CASE WHEN p_tipo = 'aporte' THEN v_m ELSE -v_m END);
END $function$;

-- Anular un movimiento propio de la caja (no los que vienen de una liquidación).
CREATE OR REPLACE FUNCTION public.admin_anular_caja_volea(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v caja_volea_movs%ROWTYPE;
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo el equipo'); END IF;
  SELECT * INTO v FROM caja_volea_movs WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.reverted THEN RETURN jsonb_build_object('ok', false, 'error', 'ese movimiento no existe o ya está anulado'); END IF;
  IF v.tipo IN ('venta', 'gasto') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'viene de una liquidación: no se anula desde acá');
  END IF;
  IF v.socio_move_id IS NOT NULL THEN DELETE FROM socio_moves WHERE id = v.socio_move_id; END IF;
  UPDATE caja_volea_movs SET reverted = true WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.admin_caja_volea(text, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_anular_caja_volea(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_caja_volea(text, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_anular_caja_volea(uuid) TO authenticated;
