-- v38: cupones de un solo uso (los del PDF de premios: inscripción gratis, 50% en inscripción, 20% en tienda).
--
-- Sin login: el código ES el secreto (6 caracteres de un alfabeto de 32 → ~10^9 combinaciones) y sirve
-- una sola vez. Aditiva e idempotente: tabla nueva + 2 columnas nuevas en inscripciones + funciones nuevas
-- y admin_pago_inscripcion con LA MISMA firma (solo descuenta el cupón si la inscripción tiene uno).
--
--  · cupon_consultar(codigo)                       público: ¿vale? → tipo y % (no lo gasta)
--  · cupon_canjear_tienda(codigo, pedido, nombre)  público: lo gasta en un pedido de la tienda
--  · cupon_canjear_inscripcion(codigo, insc_id)    público: lo gasta en una inscripción (guarda el %)
--  · admin_cupon(codigo, accion, ...)              equipo: marcar usado en persona / liberar

CREATE TABLE IF NOT EXISTS public.cupones (
  codigo     text PRIMARY KEY,
  tipo       text NOT NULL CHECK (tipo IN ('inscripcion', 'tienda')),
  percent    int  NOT NULL CHECK (percent > 0 AND percent <= 100),
  etiqueta   text NOT NULL DEFAULT '',
  vence      date,                       -- inclusive, día de Uruguay; null = no vence
  usado_at   timestamptz,
  usado_por  text,                       -- nombre de quien lo usó
  usado_ref  text,                       -- id del pedido o de la inscripción (o 'en persona')
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cupones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupones_equipo_lee ON public.cupones;
CREATE POLICY cupones_equipo_lee ON public.cupones FOR SELECT USING (es_equipo());
-- Sin policies de escritura: todo pasa por las funciones de abajo.

ALTER TABLE public.inscripciones ADD COLUMN IF NOT EXISTS cupon text;
ALTER TABLE public.inscripciones ADD COLUMN IF NOT EXISTS cupon_percent int;

-- Los códigos NO van en el repo (es público): se cargan con un INSERT aparte que tiene Brian, así:
--   INSERT INTO public.cupones (codigo, tipo, percent, etiqueta, vence) VALUES
--     ('XXX-XXXXXX', 'tienda', 20, '20% en la tienda', '2026-12-31'), ...
--   ON CONFLICT (codigo) DO NOTHING;

-- Normaliza lo que tipea la gente: mayúsculas, sin espacios, guion opcional ("abc 123456" → "ABC-123456").
CREATE OR REPLACE FUNCTION public._cupon_normalizar(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $$
  -- Se sacan espacios y guiones y el guion se vuelve a poner en su lugar (todos son XXX-XXXXXX).
  SELECT CASE WHEN v ~ '^[A-Z0-9]{9}$' THEN substr(v, 1, 3) || '-' || substr(v, 4) ELSE v END
  FROM (SELECT upper(regexp_replace(COALESCE(p, ''), '[[:space:]-]', '', 'g')) AS v) s
$$;

-- Motivo por el que un cupón no sirve, o null si sirve.
CREATE OR REPLACE FUNCTION public._cupon_problema(c public.cupones, p_tipo text) RETURNS text
LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT CASE
    WHEN c.codigo IS NULL THEN 'Ese código no existe. Revisá que esté bien escrito.'
    WHEN c.usado_at IS NOT NULL THEN 'Ese código ya se usó.'
    WHEN c.vence IS NOT NULL AND c.vence < (now() AT TIME ZONE 'America/Montevideo')::date THEN 'Ese código está vencido.'
    WHEN p_tipo IS NOT NULL AND c.tipo <> p_tipo THEN
      CASE WHEN c.tipo = 'tienda' THEN 'Ese código es para la tienda online, no para inscripciones.'
           ELSE 'Ese código es para inscripciones a torneos, no para la tienda.' END
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.cupon_consultar(p_codigo text, p_tipo text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  c public.cupones;
  v_problema text;
BEGIN
  SELECT * INTO c FROM cupones WHERE codigo = _cupon_normalizar(p_codigo);
  v_problema := _cupon_problema(c, p_tipo);
  IF v_problema IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', v_problema); END IF;
  RETURN jsonb_build_object('ok', true, 'codigo', c.codigo, 'tipo', c.tipo, 'percent', c.percent, 'etiqueta', c.etiqueta);
END;
$$;

CREATE OR REPLACE FUNCTION public.cupon_canjear_tienda(p_codigo text, p_pedido text, p_nombre text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  c public.cupones;
  v_problema text;
BEGIN
  IF btrim(COALESCE(p_pedido, '')) = '' OR length(p_pedido) > 60 OR length(COALESCE(p_nombre, '')) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Datos del pedido inválidos');
  END IF;
  SELECT * INTO c FROM cupones WHERE codigo = _cupon_normalizar(p_codigo) FOR UPDATE;
  v_problema := _cupon_problema(c, 'tienda');
  IF v_problema IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', v_problema); END IF;
  UPDATE cupones SET usado_at = now(), usado_por = btrim(COALESCE(p_nombre, '')), usado_ref = btrim(p_pedido)
   WHERE codigo = c.codigo;
  RETURN jsonb_build_object('ok', true, 'codigo', c.codigo, 'percent', c.percent);
END;
$$;

CREATE OR REPLACE FUNCTION public.cupon_canjear_inscripcion(p_codigo text, p_inscripcion uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  c public.cupones;
  i record;
  v_problema text;
BEGIN
  SELECT id, nombre, cupon, pago_at, estado INTO i FROM inscripciones WHERE id = p_inscripcion FOR UPDATE;
  IF NOT FOUND OR i.estado = 'baja' THEN RETURN jsonb_build_object('ok', false, 'error', 'No encontramos la inscripción'); END IF;
  IF i.cupon IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Tu inscripción ya tiene un cupón aplicado (no son acumulables).'); END IF;
  IF i.pago_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Tu inscripción ya está paga: escribinos por WhatsApp.'); END IF;
  SELECT * INTO c FROM cupones WHERE codigo = _cupon_normalizar(p_codigo) FOR UPDATE;
  v_problema := _cupon_problema(c, 'inscripcion');
  IF v_problema IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', v_problema); END IF;
  UPDATE cupones SET usado_at = now(), usado_por = i.nombre, usado_ref = i.id::text WHERE codigo = c.codigo;
  UPDATE inscripciones SET cupon = c.codigo, cupon_percent = c.percent WHERE id = i.id;
  RETURN jsonb_build_object('ok', true, 'codigo', c.codigo, 'percent', c.percent);
END;
$$;

-- Equipo: 'usar' = se canjeó en persona (p_nombre, p_ref opcionales); 'liberar' = vuelve a quedar disponible.
CREATE OR REPLACE FUNCTION public.admin_cupon(p_codigo text, p_accion text, p_nombre text DEFAULT '', p_ref text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  c public.cupones;
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo el equipo'); END IF;
  SELECT * INTO c FROM cupones WHERE codigo = _cupon_normalizar(p_codigo) FOR UPDATE;
  IF c.codigo IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no existe'); END IF;
  IF p_accion = 'usar' THEN
    IF c.usado_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ya estaba usado'); END IF;
    UPDATE cupones SET usado_at = now(), usado_por = btrim(COALESCE(p_nombre, '')),
           usado_ref = COALESCE(NULLIF(btrim(COALESCE(p_ref, '')), ''), 'en persona')
     WHERE codigo = c.codigo;
  ELSIF p_accion = 'liberar' THEN
    -- Si estaba en una inscripción todavía sin pagar, se le saca el descuento.
    UPDATE inscripciones SET cupon = NULL, cupon_percent = NULL WHERE cupon = c.codigo AND pago_at IS NULL;
    UPDATE cupones SET usado_at = NULL, usado_por = NULL, usado_ref = NULL WHERE codigo = c.codigo;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'acción inválida');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cupon_consultar(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cupon_canjear_tienda(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cupon_canjear_inscripcion(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cupon(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cupon_consultar(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupon_canjear_tienda(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cupon_canjear_inscripcion(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cupon(text, text, text, text) TO authenticated;

-- admin_pago_inscripcion: misma firma; el costo descuenta el cupón de la inscripción (redondeo a peso).
CREATE OR REPLACE FUNCTION public.admin_pago_inscripcion(p_id uuid, p_monto numeric, p_metodo text, p_reported_by text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_insc record;
  v_tarifa jsonb;
  v_ncats int;
  v_costo numeric;
  v_monto numeric := COALESCE(p_monto, 0);
  v_deuda numeric;
  v_reported text := COALESCE(NULLIF(btrim(COALESCE(p_reported_by, '')), ''), 'Web');
BEGIN
  IF NOT es_equipo() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'solo admins');
  END IF;
  IF p_metodo IS NULL OR p_metodo NOT IN ('mp', 'efectivo', 'transferencia', 'freepass') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'método inválido');
  END IF;

  SELECT * INTO v_insc FROM inscripciones WHERE id = p_id AND estado <> 'baja' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'inscripción no encontrada');
  END IF;
  IF v_insc.pago_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ya tiene un pago registrado');
  END IF;

  SELECT tarifa INTO v_tarifa FROM events WHERE id = v_insc.event_id;
  IF v_tarifa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'el evento no tiene tarifa');
  END IF;

  SELECT count(*) INTO v_ncats
  FROM unnest(string_to_array(v_insc.categorias, ',')) c WHERE btrim(c) <> '';
  IF v_ncats = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'la inscripción no tiene categorías');
  END IF;
  v_costo := (v_tarifa ->> 'base')::numeric
             + greatest(0, v_ncats - (v_tarifa ->> 'incluye')::int) * (v_tarifa ->> 'extra')::numeric;
  -- v38: cupón de la inscripción.
  IF v_insc.cupon_percent IS NOT NULL AND v_insc.cupon_percent > 0 THEN
    v_costo := round(v_costo * (100 - least(v_insc.cupon_percent, 100)) / 100.0);
  END IF;

  IF p_metodo = 'freepass' THEN
    UPDATE inscripciones SET
      pago_costo = v_costo, pago_monto = 0, pago_metodo = 'freepass',
      pago_deuda = 0, pago_at = now(), estado = 'confirmada'
    WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'costo', v_costo, 'deuda', 0);
  END IF;

  IF v_monto < 0 OR v_monto > v_costo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'el monto tiene que estar entre 0 y ' || v_costo);
  END IF;
  v_deuda := v_costo - v_monto;

  IF v_monto > 0 THEN
    INSERT INTO bot_ledger (kind, product_id, variant_key, label, qty, amount, reported_by, chat_id, payment_method, debtor_name)
    VALUES ('venta', NULL, NULL, 'Inscripción: ' || v_insc.nombre, 1, v_monto, v_reported, 0, p_metodo, NULL);
  END IF;
  IF v_deuda > 0 THEN
    INSERT INTO bot_ledger (kind, product_id, variant_key, label, qty, amount, reported_by, chat_id, payment_method, debtor_name)
    VALUES ('venta', NULL, NULL, 'Inscripción: ' || v_insc.nombre || ' (saldo)', 1, v_deuda, v_reported, 0, 'debe', btrim(v_insc.nombre));
  END IF;

  UPDATE inscripciones SET
    pago_costo = v_costo, pago_monto = v_monto, pago_metodo = p_metodo,
    pago_deuda = v_deuda, pago_at = now(), estado = 'confirmada'
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'costo', v_costo, 'deuda', v_deuda);
END;
$function$;
