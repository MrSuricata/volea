-- v35: tanteador de árbitros. arbitraje_partidos = marcador en vivo (lectura pública + Realtime);
-- arbitraje_codigos = el código de 4 dígitos de cada partido (privada: nunca viaja por Realtime);
-- arbitraje_intentos = códigos fallidos para frenar a quien prueba números. Todo se escribe por RPC.

CREATE TABLE IF NOT EXISTS arbitraje_partidos (
  torneo_id text NOT NULL,
  partido_id text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_juego', 'terminado')),
  formato jsonb NOT NULL,
  dobles boolean NOT NULL DEFAULT true,
  jugadas jsonb NOT NULL DEFAULT '[]'::jsonb,
  marcador jsonb,
  version int NOT NULL DEFAULT 0,
  actualizado timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (torneo_id, partido_id)
);
ALTER TABLE arbitraje_partidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS arbitraje_lectura ON arbitraje_partidos;
CREATE POLICY arbitraje_lectura ON arbitraje_partidos FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON arbitraje_partidos FROM anon, authenticated;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE arbitraje_partidos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS arbitraje_codigos (
  codigo text PRIMARY KEY CHECK (codigo ~ '^[0-9]{4}$'),
  torneo_id text NOT NULL,
  partido_id text NOT NULL,
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (torneo_id, partido_id)
);
ALTER TABLE arbitraje_codigos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arbitraje_codigos FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS arbitraje_intentos (
  origen text NOT NULL,
  cuando timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arbitraje_intentos_origen ON arbitraje_intentos (origen, cuando);
ALTER TABLE arbitraje_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arbitraje_intentos FROM anon, authenticated;

-- Quién llama (IP según el proxy de Supabase); sin cabecera, un valor fijo.
CREATE OR REPLACE FUNCTION public._arbitraje_origen() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(btrim(split_part(COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1)), ''), 'sin-origen')
$$;

-- Un resultado es legal según el formato: un game ganado por 2 llegando al objetivo, o 2 games en mejor de 3.
CREATE OR REPLACE FUNCTION public._arbitraje_resultado_legal(f jsonb, r jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  obj int := (f->>'a')::int;
  pa int := (r->>'puntosA')::int;
  pb int := (r->>'puntosB')::int;
  g jsonb; ga int := 0; gb int := 0;
BEGIN
  IF pa IS NULL OR pb IS NULL OR pa = pb THEN RETURN false; END IF;
  IF COALESCE((f->>'mejorDe')::int, 1) = 1 THEN
    RETURN GREATEST(pa, pb) >= obj AND abs(pa - pb) >= 2;
  END IF;
  IF GREATEST(pa, pb) <> 2 OR LEAST(pa, pb) > 1 OR jsonb_typeof(r->'games') <> 'array' THEN RETURN false; END IF;
  FOR g IN SELECT * FROM jsonb_array_elements(r->'games') LOOP
    IF NOT (GREATEST((g->>'a')::int, (g->>'b')::int) >= obj AND abs((g->>'a')::int - (g->>'b')::int) >= 2) THEN RETURN false; END IF;
    IF (g->>'a')::int > (g->>'b')::int THEN ga := ga + 1; ELSE gb := gb + 1; END IF;
  END LOOP;
  RETURN ga = pa AND gb = pb;
END $$;

-- Entrar con el código: devuelve el partido o un error genérico (y anota el intento fallido).
CREATE OR REPLACE FUNCTION public.arbitro_entrar(p_codigo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_origen text := _arbitraje_origen();
  v_c arbitraje_codigos%ROWTYPE;
  v_p arbitraje_partidos%ROWTYPE;
BEGIN
  IF (SELECT count(*) FROM arbitraje_intentos WHERE origen = v_origen AND cuando > now() - interval '10 minutes') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Demasiados códigos incorrectos: esperá unos minutos.');
  END IF;
  SELECT * INTO v_c FROM arbitraje_codigos WHERE codigo = btrim(COALESCE(p_codigo, ''));
  IF NOT FOUND THEN
    INSERT INTO arbitraje_intentos (origen) VALUES (v_origen);
    DELETE FROM arbitraje_intentos WHERE cuando < now() - interval '1 day';
    RETURN jsonb_build_object('ok', false, 'error', 'Código incorrecto o el partido ya terminó.');
  END IF;
  SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id;
  RETURN jsonb_build_object('ok', true, 'torneo_id', v_c.torneo_id, 'partido_id', v_c.partido_id,
    'formato', v_p.formato, 'dobles', v_p.dobles, 'jugadas', v_p.jugadas, 'version', v_p.version, 'estado', v_p.estado);
END $$;

-- Guardar el estado del partido (lista de jugadas + resumen). version = control de concurrencia.
CREATE OR REPLACE FUNCTION public.arbitro_marcar(p_codigo text, p_version int, p_jugadas jsonb, p_marcador jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_c arbitraje_codigos%ROWTYPE;
  v_p arbitraje_partidos%ROWTYPE;
  v_nueva int;
BEGIN
  SELECT * INTO v_c FROM arbitraje_codigos WHERE codigo = btrim(COALESCE(p_codigo, ''));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'El código ya no es válido.'); END IF;
  IF jsonb_typeof(p_jugadas) <> 'array' OR jsonb_array_length(p_jugadas) > 1500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Jugadas inválidas.');
  END IF;
  UPDATE arbitraje_partidos SET jugadas = p_jugadas, marcador = p_marcador, version = version + 1,
         estado = CASE WHEN jsonb_array_length(p_jugadas) > 0 THEN 'en_juego' ELSE 'pendiente' END, actualizado = now()
   WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id AND version = p_version AND estado <> 'terminado'
  RETURNING version INTO v_nueva;
  IF v_nueva IS NULL THEN
    SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id;
    RETURN jsonb_build_object('ok', false, 'error', 'desfasado', 'jugadas', v_p.jugadas, 'version', v_p.version);
  END IF;
  RETURN jsonb_build_object('ok', true, 'version', v_nueva);
END $$;

-- Terminar: escribe el resultado en el cuadro, libera la cancha y da de baja el código.
CREATE OR REPLACE FUNCTION public.arbitro_terminar(p_codigo text, p_version int, p_jugadas jsonb, p_marcador jsonb, p_resultado jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_c arbitraje_codigos%ROWTYPE;
  v_p arbitraje_partidos%ROWTYPE;
  v_data jsonb;
  v_lista text;
  v_idx int;
  v_elem jsonb;
  v_ahora text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  SELECT * INTO v_c FROM arbitraje_codigos WHERE codigo = btrim(COALESCE(p_codigo, ''));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'El código ya no es válido.'); END IF;
  SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id FOR UPDATE;
  IF v_p.version <> p_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'desfasado', 'jugadas', v_p.jugadas, 'version', v_p.version);
  END IF;
  IF NOT _arbitraje_resultado_legal(v_p.formato, p_resultado) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El resultado no cierra con el formato del partido.');
  END IF;

  SELECT data INTO v_data FROM rk_torneos WHERE id = v_c.torneo_id FOR UPDATE;
  IF v_data IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'El torneo ya no existe.'); END IF;
  FOREACH v_lista IN ARRAY ARRAY['partidosGrupo', 'partidosLlave'] LOOP
    SELECT (o - 1)::int, x INTO v_idx, v_elem
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_data->v_lista) = 'array' THEN v_data->v_lista ELSE '[]'::jsonb END) WITH ORDINALITY y(x, o)
     WHERE x->>'id' = v_c.partido_id;
    EXIT WHEN v_idx IS NOT NULL;
  END LOOP;
  IF v_idx IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'El partido ya no está en el cuadro (¿se rearmó?).'); END IF;
  IF v_elem->>'puntosA' IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese partido ya tiene un resultado cargado.');
  END IF;

  v_elem := v_elem || jsonb_build_object('puntosA', (p_resultado->>'puntosA')::int, 'puntosB', (p_resultado->>'puntosB')::int, 'cargadoEl', v_ahora);
  IF jsonb_typeof(p_resultado->'games') = 'array' THEN v_elem := v_elem || jsonb_build_object('games', p_resultado->'games'); END IF;
  UPDATE rk_torneos SET data = jsonb_set(v_data, ARRAY[v_lista, v_idx::text], v_elem), updated_at = now() WHERE id = v_c.torneo_id;
  UPDATE rk_en_cancha SET torneo_id = NULL, partido_id = NULL, updated_at = now() WHERE partido_id = v_c.partido_id;
  UPDATE arbitraje_partidos SET jugadas = p_jugadas, marcador = p_marcador, estado = 'terminado', version = version + 1, actualizado = now()
   WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id;
  DELETE FROM arbitraje_codigos WHERE codigo = v_c.codigo;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Gestor: crea los códigos que falten y actualiza el formato de los que no empezaron.
-- p_partidos = [{partido_id, formato}] (lo arma la web con partidosArbitrables + formatoDe).
CREATE OR REPLACE FUNCTION public.admin_codigos_torneo(p_torneo_id text, p_dobles boolean, p_partidos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  x jsonb;
  v_codigo text;
  v_estado text;
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo el equipo'); END IF;
  IF jsonb_typeof(p_partidos) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'error', 'lista inválida'); END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_partidos) LOOP
    INSERT INTO arbitraje_partidos (torneo_id, partido_id, formato, dobles)
    VALUES (p_torneo_id, x->>'partido_id', x->'formato', p_dobles)
    ON CONFLICT (torneo_id, partido_id) DO UPDATE SET formato = EXCLUDED.formato, dobles = EXCLUDED.dobles
      WHERE arbitraje_partidos.estado = 'pendiente';
    SELECT estado INTO v_estado FROM arbitraje_partidos WHERE torneo_id = p_torneo_id AND partido_id = x->>'partido_id';
    IF v_estado <> 'terminado' AND NOT EXISTS (SELECT 1 FROM arbitraje_codigos WHERE torneo_id = p_torneo_id AND partido_id = x->>'partido_id') THEN
      LOOP
        v_codigo := lpad(floor(random() * 10000)::int::text, 4, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM arbitraje_codigos WHERE codigo = v_codigo);
      END LOOP;
      INSERT INTO arbitraje_codigos (codigo, torneo_id, partido_id) VALUES (v_codigo, p_torneo_id, x->>'partido_id');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'codigos',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('partido_id', c.partido_id, 'codigo', c.codigo)) FROM arbitraje_codigos c WHERE c.torneo_id = p_torneo_id), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.arbitro_entrar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.arbitro_marcar(text, int, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.arbitro_terminar(text, int, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_codigos_torneo(text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.arbitro_entrar(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arbitro_marcar(text, int, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arbitro_terminar(text, int, jsonb, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_codigos_torneo(text, boolean, jsonb) TO authenticated;
