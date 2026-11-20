-- v39 · One Point Challenge: link para los árbitros, sin usuario.
--
-- Hasta acá, cargar un cruce del One Point Challenge desde En vivo (/programacion) pedía una sesión
-- de dueño o admin (la policy de rk_torneos), y esa sesión abre todo el panel. Con esta migración el
-- organizador crea UNA clave por torneo y reparte un link (/programacion?arbitro=CLAVE&cancha=N):
-- quien lo abre puede cargar resultados de la llave de ESE torneo, y nada más.
--
-- Qué puede hacer el que tiene la clave: reemplazar puntosA / puntosB / wo / cargadoEl de los cruces
-- de la llave de ese torneo individual. Qué NO: tocar jugadores, el armado de la llave, las canchas,
-- otros torneos ni ninguna otra tabla (la función compara el esqueleto antes de guardar).
-- La clave no se puede leer desde la web: la tabla no tiene policies y solo la usan estas funciones.
-- Renovarla o borrarla deja sin efecto los links repartidos.
--
-- Idempotente. No toca rk_torneos (ni su policy), ni las funciones de arbitraje (v35-v37).

CREATE TABLE IF NOT EXISTS public.opc_claves (
  torneo_id text PRIMARY KEY,
  clave text NOT NULL UNIQUE,
  creada timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.opc_claves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opc_claves FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- del organizador
-- Devuelve la clave del torneo (la crea si no hay). p_renovar = true la cambia: los links viejos mueren.
CREATE OR REPLACE FUNCTION public.admin_opc_clave(p_torneo_id text, p_renovar boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_clave text;
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo el equipo'); END IF;
  IF NOT EXISTS (SELECT 1 FROM rk_torneos WHERE id = p_torneo_id AND data->>'formato' = 'individual') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'torneo');
  END IF;
  IF p_renovar THEN DELETE FROM opc_claves WHERE torneo_id = p_torneo_id; END IF;
  SELECT clave INTO v_clave FROM opc_claves WHERE torneo_id = p_torneo_id;
  IF v_clave IS NULL THEN
    v_clave := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
    INSERT INTO opc_claves (torneo_id, clave) VALUES (p_torneo_id, v_clave);
  END IF;
  RETURN jsonb_build_object('ok', true, 'clave', v_clave);
END $$;

-- Apaga los links del torneo (para cuando terminó).
CREATE OR REPLACE FUNCTION public.admin_opc_clave_borrar(p_torneo_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo el equipo'); END IF;
  DELETE FROM opc_claves WHERE torneo_id = p_torneo_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------------------------------------------------------------- del árbitro (sin sesión)
-- ¿De qué torneo es esta clave?
CREATE OR REPLACE FUNCTION public.opc_arbitro_entrar(p_clave text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_id text;
BEGIN
  IF p_clave IS NULL OR length(p_clave) < 12 THEN RETURN jsonb_build_object('ok', false, 'error', 'clave'); END IF;
  SELECT torneo_id INTO v_id FROM opc_claves WHERE clave = p_clave;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'clave'); END IF;
  RETURN jsonb_build_object('ok', true, 'torneo_id', v_id);
END $$;

-- Un cruce sin su resultado: lo que NO puede cambiar el árbitro.
CREATE OR REPLACE FUNCTION public._opc_esqueleto(p_llave jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT COALESCE(jsonb_agg((e - ARRAY['puntosA', 'puntosB', 'wo', 'cargadoEl']) ORDER BY o), '[]'::jsonb)
    FROM jsonb_array_elements(p_llave) WITH ORDINALITY AS t(e, o)
$$;

-- Guarda la llave con los resultados nuevos. La web calcula el toque (y los W.O. en cascada) con la
-- misma lógica que el gestor y manda la llave entera; acá se comprueba que solo cambiaron resultados
-- y que nadie guardó en el medio (p_updated_at = el updated_at que leyó la web).
CREATE OR REPLACE FUNCTION public.opc_arbitro_guardar(p_clave text, p_torneo_id text, p_updated_at timestamptz, p_llave jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_data jsonb;
  v_upd timestamptz;
BEGIN
  IF p_clave IS NULL OR NOT EXISTS (SELECT 1 FROM opc_claves WHERE torneo_id = p_torneo_id AND clave = p_clave) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clave');
  END IF;
  SELECT data, updated_at INTO v_data, v_upd FROM rk_torneos WHERE id = p_torneo_id FOR UPDATE;
  IF v_data IS NULL OR v_data->>'formato' IS DISTINCT FROM 'individual' OR jsonb_typeof(v_data->'partidosLlave') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'torneo');
  END IF;
  IF v_upd IS DISTINCT FROM p_updated_at THEN RETURN jsonb_build_object('ok', false, 'error', 'conflicto'); END IF;
  IF jsonb_typeof(p_llave) IS DISTINCT FROM 'array' OR _opc_esqueleto(p_llave) IS DISTINCT FROM _opc_esqueleto(v_data->'partidosLlave') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalido');
  END IF;
  -- Un cruce a un punto: sin resultado, 1-0 o 0-1; wo solo true/false; cargadoEl un texto.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_llave) e
     WHERE NOT (
       (COALESCE(e->'puntosA', 'null') = 'null' AND COALESCE(e->'puntosB', 'null') = 'null')
       OR (e->'puntosA' = '1' AND e->'puntosB' = '0') OR (e->'puntosA' = '0' AND e->'puntosB' = '1'))
       OR (e ? 'wo' AND jsonb_typeof(e->'wo') NOT IN ('boolean', 'null'))
       OR (e ? 'cargadoEl' AND (jsonb_typeof(e->'cargadoEl') NOT IN ('string', 'null') OR length(e->>'cargadoEl') > 40))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalido');
  END IF;
  UPDATE rk_torneos SET data = jsonb_set(v_data, '{partidosLlave}', p_llave), updated_at = now() WHERE id = p_torneo_id;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.admin_opc_clave(text, boolean), public.admin_opc_clave_borrar(text),
  public.opc_arbitro_entrar(text), public.opc_arbitro_guardar(text, text, timestamptz, jsonb), public._opc_esqueleto(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_opc_clave(text, boolean), public.admin_opc_clave_borrar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.opc_arbitro_entrar(text), public.opc_arbitro_guardar(text, text, timestamptz, jsonb) TO anon, authenticated;
