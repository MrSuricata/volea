-- v36: el árbitro elige en cada partido rally o saque tradicional, a cuántos puntos y si es a un game
-- o al mejor de 3. Ese formato viaja en la primera jugada (la de inicio) y arbitro_terminar valida el
-- resultado con él (si no vino o es inválido, vale el de la categoría).
CREATE OR REPLACE FUNCTION public.arbitro_terminar(p_codigo text, p_version int, p_jugadas jsonb, p_marcador jsonb, p_resultado jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_c arbitraje_codigos%ROWTYPE;
  v_p arbitraje_partidos%ROWTYPE;
  v_data jsonb;
  v_lista text;
  v_idx int;
  v_elem jsonb;
  v_formato jsonb;
  v_ahora text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  SELECT * INTO v_c FROM arbitraje_codigos WHERE codigo = btrim(COALESCE(p_codigo, ''));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'El código ya no es válido.'); END IF;
  SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id FOR UPDATE;
  IF v_p.version <> p_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'desfasado', 'jugadas', v_p.jugadas, 'version', v_p.version);
  END IF;
  -- El árbitro puede elegir el formato al empezar: viaja en la jugada de inicio.
  v_formato := p_jugadas->0->'formato';
  IF NOT COALESCE(jsonb_typeof(v_formato) = 'object'
          AND v_formato->>'tipo' IN ('rally', 'sideout')
          AND v_formato->>'a' IN ('11', '15', '21')
          AND COALESCE(v_formato->>'mejorDe', '1') IN ('1', '3'), false) THEN
    v_formato := v_p.formato;
  END IF;
  IF NOT _arbitraje_resultado_legal(v_formato, p_resultado) THEN
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
  UPDATE arbitraje_partidos SET jugadas = p_jugadas, marcador = p_marcador, formato = v_formato, estado = 'terminado', version = version + 1, actualizado = now()
   WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id;
  DELETE FROM arbitraje_codigos WHERE codigo = v_c.codigo;
  RETURN jsonb_build_object('ok', true);
END $$;
