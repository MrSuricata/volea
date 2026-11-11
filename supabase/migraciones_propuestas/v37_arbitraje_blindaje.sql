-- v37: blindaje del tanteador de árbitros (antes del Sudamericano, árbitros con mala señal).
--
-- Aditiva e idempotente: tablas/columnas con IF NOT EXISTS y funciones con CREATE OR REPLACE y LAS
-- MISMAS FIRMAS que v35/v36 (la web vieja y la nueva hablan con ellas; solo se agregan campos a las
-- respuestas). No se borra nada que la web vieja lea.
--
-- Qué cambia:
--  1. Freno a quien prueba códigos al azar. Lo pasan entrar, marcar y terminar (antes marcar y
--     terminar respondían "válido / inválido" sin anotar nada: se podían barrer los 10.000 códigos).
--     · Origen = cf-connecting-ip (lo pone Cloudflare, el cliente no lo puede elegir); si no está,
--       el ÚLTIMO valor de x-forwarded-for (lo agrega el proxy) y no el primero (lo escribe el cliente).
--     · Por origen: 30 fallos en 15 min o 150 en un día → espera. Un wifi de club con 20 árbitros
--       que se equivocan al tipear no llega; un barrido sí.
--     · Freno global: si entre todos hay 300+ fallos en 15 min (alguien está barriendo desde muchas
--       IP), los orígenes que NO usaron un código válido en el último día pasan a 3 fallos por 15 min,
--       y con 3000+ quedan frenados del todo. Los árbitros que ya entraron desde esa conexión siguen
--       con el límite normal: un ataque no deja a la cancha sin tanteador.
--     · Un código dado de baja (cuadro rearmado, renovado) se reconoce durante un día y NO cuenta como
--       fallo: un celular viejo que reintenta solo no bloquea al wifi del club.
--     · Códigos nuevos de 6 cifras; los de 4 ya emitidos siguen valiendo y admin_codigos_renovar los
--       cambia (solo los de partidos que no empezaron).
--  2. arbitro_terminar valida estricto: formato dentro de lo permitido, el resultado tiene que ser
--     exactamente el que sale de reproducir las jugadas (el servidor rehace la cuenta), puntos >= 0,
--     por 2 exacto si se pasó del objetivo, nada después de definido el partido. En la llave, los dos
--     rivales tienen que estar definidos.
--  3. Idempotente: terminar dos veces devuelve ok con el resultado; entrar con el código de un
--     partido terminado devuelve estado 'terminado' + resultado (sin contar como fallo). El código
--     ya no se borra al terminar (se limpia a los 2 días).
--  4. Si el resultado se cargó a mano desde el gestor, marcar/entrar/terminar lo detectan, cierran la
--     fila (se acaba el "EN VIVO" eterno) y avisan con estado 'terminado' + motivo 'cargado_en_mesa'.
--  5. marcar valida la forma de las jugadas y del marcador, y guarda el marcador que calcula el
--     servidor (la TV nunca recibe un marcador roto).
--  6. admin_codigos_torneo: no emite para partidos con resultado o W.O., da de baja los códigos
--     huérfanos (cuadro rearmado) y los viejos, y la búsqueda de un código libre está acotada.
--  7. La cancha se libera filtrando por torneo_id además de partido_id.

-- ---------------------------------------------------------------- tablas
ALTER TABLE arbitraje_partidos ADD COLUMN IF NOT EXISTS cierre text;      -- 'arbitro' | 'mesa'
ALTER TABLE arbitraje_codigos ADD COLUMN IF NOT EXISTS usado timestamptz; -- primera vez que entró alguien

-- Códigos de 4 (los ya emitidos) o de 6 cifras (los nuevos).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.arbitraje_codigos'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%{4}$%' AND conname <> 'arbitraje_codigos_codigo_largo' LOOP
    EXECUTE format('ALTER TABLE arbitraje_codigos DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.arbitraje_codigos'::regclass AND conname = 'arbitraje_codigos_codigo_largo') THEN
    ALTER TABLE arbitraje_codigos ADD CONSTRAINT arbitraje_codigos_codigo_largo CHECK (codigo ~ '^([0-9]{4}|[0-9]{6})$');
  END IF;
END $$;

-- Códigos dados de baja hace menos de un día: se reconocen (no cuentan como fallo) y no se reemiten.
CREATE TABLE IF NOT EXISTS arbitraje_codigos_baja (
  codigo text PRIMARY KEY,
  torneo_id text NOT NULL,
  partido_id text NOT NULL,
  baja timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE arbitraje_codigos_baja ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arbitraje_codigos_baja FROM anon, authenticated;

-- Orígenes que usaron un código válido: durante un ataque siguen con el límite normal.
CREATE TABLE IF NOT EXISTS arbitraje_origenes_ok (
  origen text PRIMARY KEY,
  ultimo timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE arbitraje_origenes_ok ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arbitraje_origenes_ok FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS arbitraje_intentos_cuando ON arbitraje_intentos (cuando);

-- ---------------------------------------------------------------- freno
-- Quién llama. cf-connecting-ip la pone Cloudflare (pisa lo que mande el cliente); x-forwarded-for
-- la puede empezar el cliente, así que de esa se toma el último valor (el que agregó el proxy).
CREATE OR REPLACE FUNCTION public._arbitraje_origen() RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  h json;
  v text;
BEGIN
  BEGIN
    h := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::json;
  EXCEPTION WHEN others THEN h := '{}'::json;
  END;
  v := NULLIF(btrim(h->>'cf-connecting-ip'), '');
  IF v IS NULL THEN
    v := NULLIF(btrim(reverse(split_part(reverse(COALESCE(h->>'x-forwarded-for', '')), ',', 1))), '');
  END IF;
  IF v IS NULL THEN v := NULLIF(btrim(h->>'x-real-ip'), ''); END IF;
  RETURN left(COALESCE(v, 'sin-origen'), 64);
END $$;

-- NULL = puede seguir; si no, el texto para el árbitro. Los pedidos frenados NO se anotan como fallo.
CREATE OR REPLACE FUNCTION public._arbitraje_freno(p_origen text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_15 int;
  v_dia int;
  v_global int;
  v_conocido boolean;
  v_msg text := 'Demasiados códigos incorrectos desde esta conexión: esperá unos minutos. Lo marcado queda guardado en el teléfono.';
BEGIN
  SELECT count(*) INTO v_15 FROM arbitraje_intentos WHERE origen = p_origen AND cuando > now() - interval '15 minutes';
  SELECT count(*) INTO v_dia FROM arbitraje_intentos WHERE origen = p_origen AND cuando > now() - interval '1 day';
  IF v_15 >= 30 OR v_dia >= 150 THEN RETURN v_msg; END IF;
  SELECT count(*) INTO v_global FROM (SELECT 1 FROM arbitraje_intentos WHERE cuando > now() - interval '15 minutes' LIMIT 3000) s;
  IF v_global >= 300 THEN
    v_conocido := EXISTS (SELECT 1 FROM arbitraje_origenes_ok WHERE origen = p_origen AND ultimo > now() - interval '1 day');
    IF NOT v_conocido AND (v_global >= 3000 OR v_15 >= 3) THEN RETURN v_msg; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._arbitraje_anotar_fallo(p_origen text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO arbitraje_intentos (origen) VALUES (p_origen);
  DELETE FROM arbitraje_intentos WHERE cuando < now() - interval '1 day';
$$;

CREATE OR REPLACE FUNCTION public._arbitraje_anotar_ok(p_origen text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO arbitraje_origenes_ok (origen) VALUES (p_origen)
  ON CONFLICT (origen) DO UPDATE SET ultimo = now() WHERE arbitraje_origenes_ok.ultimo < now() - interval '10 minutes';
$$;

-- Busca el código. estado: 'ok' (v_c lleno) | 'baja' (dado de baja hace < 1 día) | 'no'.
CREATE OR REPLACE FUNCTION public._arbitraje_codigo(p_codigo text, OUT estado text, OUT torneo_id text, OUT partido_id text, OUT codigo text)
LANGUAGE plpgsql STABLE AS $$
DECLARE v text := btrim(COALESCE(p_codigo, ''));
BEGIN
  SELECT c.torneo_id, c.partido_id, c.codigo INTO torneo_id, partido_id, codigo FROM arbitraje_codigos c WHERE c.codigo = v;
  IF FOUND THEN estado := 'ok'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM arbitraje_codigos_baja b WHERE b.codigo = v AND b.baja > now() - interval '1 day') THEN
    estado := 'baja'; RETURN;
  END IF;
  estado := 'no';
END $$;

CREATE OR REPLACE FUNCTION public._arbitraje_baja_codigo(p_codigo text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO arbitraje_codigos_baja (codigo, torneo_id, partido_id)
    SELECT codigo, torneo_id, partido_id FROM arbitraje_codigos WHERE codigo = p_codigo
  ON CONFLICT (codigo) DO UPDATE SET baja = now(), torneo_id = EXCLUDED.torneo_id, partido_id = EXCLUDED.partido_id;
  DELETE FROM arbitraje_codigos WHERE codigo = p_codigo;
$$;

-- Código libre de 6 cifras con azar del sistema (gen_random_uuid), a lo sumo 40 intentos: NULL si no hay.
CREATE OR REPLACE FUNCTION public._arbitraje_codigo_nuevo() RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE v text;
BEGIN
  FOR i IN 1..40 LOOP
    v := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
    IF NOT EXISTS (SELECT 1 FROM arbitraje_codigos WHERE codigo = v)
       AND NOT EXISTS (SELECT 1 FROM arbitraje_codigos_baja WHERE codigo = v) THEN
      RETURN v;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------- validaciones
CREATE OR REPLACE FUNCTION public._arbitraje_formato_valido(f jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_typeof(f) = 'object'
     AND f->>'tipo' IN ('rally', 'sideout')
     AND jsonb_typeof(f->'a') = 'number' AND f->>'a' IN ('11', '15', '21')
     AND jsonb_typeof(f->'mejorDe') = 'number' AND f->>'mejorDe' IN ('1', '3'), false)
$$;

-- El formato de la categoría (guardado al crear el código), normalizado: sin mejorDe vale 1 (como en
-- motor.ts). NULL si no sirve.
CREATE OR REPLACE FUNCTION public._arbitraje_formato_base(f jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN COALESCE(jsonb_typeof(f) = 'object' AND f->>'tipo' IN ('rally', 'sideout') AND f->>'a' IN ('11', '15', '21')
                            AND COALESCE(f->>'mejorDe', '1') IN ('1', '3'), false)
    THEN jsonb_build_object('tipo', f->>'tipo', 'a', (f->>'a')::int, 'mejorDe', COALESCE(f->>'mejorDe', '1')::int)
  END
$$;

-- Formato con que se juega: el elegido en la jugada de inicio o, si no eligió, el de la categoría.
-- NULL si el elegido no está entre los permitidos (no se cae en silencio al de la categoría).
CREATE OR REPLACE FUNCTION public._arbitraje_formato_de(p_jugadas jsonb, p_base jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_jugadas) = 'array' AND p_jugadas->0->>'t' = 'inicio' AND (p_jugadas->0) ? 'formato'
         AND jsonb_typeof(p_jugadas->0->'formato') <> 'null'
      THEN CASE WHEN _arbitraje_formato_valido(p_jugadas->0->'formato')
                THEN jsonb_build_object('tipo', p_jugadas->0->'formato'->>'tipo', 'a', (p_jugadas->0->'formato'->>'a')::int, 'mejorDe', (p_jugadas->0->'formato'->>'mejorDe')::int)
           END
    ELSE _arbitraje_formato_base(p_base)
  END
$$;

-- Jugadas: [inicio, rally|tiempo, ...]. El inicio va primero y una sola vez.
CREATE OR REPLACE FUNCTION public._arbitraje_jugadas_validas(j jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  x jsonb;
  n int := 0;
BEGIN
  IF j IS NULL OR jsonb_typeof(j) <> 'array' OR jsonb_array_length(j) > 1500 THEN RETURN false; END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(j) WITH ORDINALITY AS t(e, o) ORDER BY o LOOP
    n := n + 1;
    IF jsonb_typeof(x) <> 'object' THEN RETURN false; END IF;
    IF n = 1 THEN
      IF NOT COALESCE(x->>'t' = 'inicio' AND x->>'saca' IN ('A', 'B') AND x->>'derechaA' IN ('0', '1') AND x->>'derechaB' IN ('0', '1'), false) THEN
        RETURN false;
      END IF;
      IF x ? 'formato' AND jsonb_typeof(x->'formato') <> 'null' AND NOT _arbitraje_formato_valido(x->'formato') THEN RETURN false; END IF;
    ELSIF x->>'t' = 'rally' THEN
      IF NOT COALESCE(x->>'gana' IN ('A', 'B'), false) THEN RETURN false; END IF;
    ELSIF x->>'t' = 'tiempo' THEN
      IF NOT COALESCE(x->>'equipo' IN ('A', 'B'), false) THEN RETURN false; END IF;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- Forma del marcador que manda el celular (la misma que arma resumen() en motor.ts).
CREATE OR REPLACE FUNCTION public._arbitraje_marcador_valido(m jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE g jsonb;
BEGIN
  IF NOT COALESCE(jsonb_typeof(m) = 'object'
       AND jsonb_typeof(m->'puntos') = 'object' AND jsonb_typeof(m->'puntos'->'a') = 'number' AND jsonb_typeof(m->'puntos'->'b') = 'number'
       AND jsonb_typeof(m->'games') = 'array' AND jsonb_array_length(m->'games') <= 3
       AND jsonb_typeof(m->'gamesA') = 'number' AND jsonb_typeof(m->'gamesB') = 'number' AND jsonb_typeof(m->'game') = 'number'
       AND m->>'saca' IN ('A', 'B'), false) THEN
    RETURN false;
  END IF;
  FOR g IN SELECT * FROM jsonb_array_elements(m->'games') LOOP
    IF NOT COALESCE(jsonb_typeof(g) = 'object' AND jsonb_typeof(g->'a') = 'number' AND jsonb_typeof(g->'b') = 'number', false) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

-- Reproduce las jugadas con las mismas reglas que estadoDe() de src/torneos/arbitraje/motor.ts y
-- devuelve el marcador con la forma de resumen(). Si se cambia una, cambiar la otra: la prueba
-- supabase/pruebas/paridad_motor.sql (generada desde el motor) compara las dos.
CREATE OR REPLACE FUNCTION public._arbitraje_replay(f jsonb, p_dobles boolean, j jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_obj int := (f->>'a')::int;
  v_tipo text := f->>'tipo';
  v_necesarios int := CASE WHEN COALESCE((f->>'mejorDe')::int, 1) = 3 THEN 2 ELSE 1 END;
  v_serv0 int := CASE WHEN f->>'tipo' = 'sideout' AND p_dobles THEN 2 ELSE 1 END;
  iniciado boolean := false;
  terminado boolean := false;
  ganador text := NULL;
  pa int := 0; pb int := 0; ga int := 0; gb int := 0; game int := 1;
  games jsonb := '[]'::jsonb;
  saca text := 'A'; saco_primero text := 'A'; servidor int := 1;
  x jsonb; gana text; ps int; pr int; canto text := '';
BEGIN
  FOR x IN SELECT e FROM jsonb_array_elements(COALESCE(j, '[]'::jsonb)) WITH ORDINALITY AS t(e, o) ORDER BY o LOOP
    EXIT WHEN terminado;
    IF x->>'t' = 'inicio' THEN
      IF iniciado THEN CONTINUE; END IF;
      iniciado := true;
      saca := x->>'saca'; saco_primero := saca; pa := 0; pb := 0; servidor := v_serv0;
      CONTINUE;
    END IF;
    IF NOT iniciado OR x->>'t' IS DISTINCT FROM 'rally' THEN CONTINUE; END IF;
    gana := x->>'gana';
    IF v_tipo = 'rally' THEN
      IF gana = 'A' THEN pa := pa + 1; ELSE pb := pb + 1; END IF;
      saca := gana;
    ELSIF gana = saca THEN
      IF saca = 'A' THEN pa := pa + 1; ELSE pb := pb + 1; END IF;
    ELSIF p_dobles AND servidor = 1 THEN
      servidor := 2;
    ELSE
      saca := CASE WHEN saca = 'A' THEN 'B' ELSE 'A' END;
      servidor := 1;
    END IF;
    IF (pa >= v_obj AND pa - pb >= 2) OR (pb >= v_obj AND pb - pa >= 2) THEN
      games := games || jsonb_build_array(jsonb_build_object('a', pa, 'b', pb));
      IF pa > pb THEN ga := ga + 1; ELSE gb := gb + 1; END IF;
      IF ga = v_necesarios OR gb = v_necesarios THEN
        terminado := true;
        ganador := CASE WHEN pa > pb THEN 'A' ELSE 'B' END;
      ELSE
        game := game + 1;
        saca := CASE WHEN saco_primero = 'A' THEN 'B' ELSE 'A' END;
        saco_primero := saca; pa := 0; pb := 0; servidor := v_serv0;
      END IF;
    END IF;
  END LOOP;
  IF iniciado THEN
    ps := CASE WHEN saca = 'A' THEN pa ELSE pb END;
    pr := CASE WHEN saca = 'A' THEN pb ELSE pa END;
    canto := CASE WHEN v_tipo = 'sideout' AND p_dobles THEN ps || '-' || pr || '-' || servidor ELSE ps || '-' || pr END;
  END IF;
  RETURN jsonb_build_object('puntos', jsonb_build_object('a', pa, 'b', pb), 'games', games, 'gamesA', ga, 'gamesB', gb,
    'game', game, 'saca', saca, 'servidor', servidor, 'canto', canto, 'terminado', terminado, 'ganador', ganador);
END $$;

-- Lo que se escribe en el cuadro (como resultadoFinal() de motor.ts). NULL si no terminó.
CREATE OR REPLACE FUNCTION public._arbitraje_resultado_de(f jsonb, m jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN NOT COALESCE((m->>'terminado')::boolean, false) THEN NULL
    WHEN COALESCE((f->>'mejorDe')::int, 1) = 1 THEN jsonb_build_object('puntosA', (m->'games'->0->>'a')::int, 'puntosB', (m->'games'->0->>'b')::int)
    ELSE jsonb_build_object('puntosA', (m->>'gamesA')::int, 'puntosB', (m->>'gamesB')::int, 'games', m->'games')
  END
$$;

-- Resultado legal según el formato (estricto): enteros >= 0; cada game llega al objetivo, por 2, y si se
-- pasó del objetivo la diferencia es exactamente 2; ningún game después de definido el partido; un
-- game suelto no vale en mejor de 3 y en un game no viaja detalle de games.
CREATE OR REPLACE FUNCTION public._arbitraje_resultado_legal(f jsonb, r jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  obj int;
  pa int; pb int;
  g jsonb; a int; b int; ga int := 0; gb int := 0; n int := 0;
  necesarios int;
BEGIN
  IF NOT _arbitraje_formato_valido(f) OR r IS NULL OR jsonb_typeof(r) <> 'object' THEN RETURN false; END IF;
  IF NOT COALESCE(r->>'puntosA' ~ '^[0-9]{1,3}$' AND r->>'puntosB' ~ '^[0-9]{1,3}$', false) THEN RETURN false; END IF;
  obj := (f->>'a')::int;
  pa := (r->>'puntosA')::int; pb := (r->>'puntosB')::int;
  IF pa = pb THEN RETURN false; END IF;
  IF (f->>'mejorDe')::int = 1 THEN
    IF r ? 'games' AND jsonb_typeof(r->'games') <> 'null' THEN RETURN false; END IF;
    a := GREATEST(pa, pb); b := LEAST(pa, pb);
    RETURN a >= obj AND a - b >= 2 AND (a = obj OR a - b = 2);
  END IF;
  necesarios := 2;
  IF NOT COALESCE(jsonb_typeof(r->'games') = 'array' AND jsonb_array_length(r->'games') IN (2, 3), false) THEN RETURN false; END IF;
  FOR g IN SELECT e FROM jsonb_array_elements(r->'games') WITH ORDINALITY AS t(e, o) ORDER BY o LOOP
    n := n + 1;
    IF ga = necesarios OR gb = necesarios THEN RETURN false; END IF; -- game después de definido
    IF jsonb_typeof(g) <> 'object' OR NOT COALESCE(g->>'a' ~ '^[0-9]{1,3}$' AND g->>'b' ~ '^[0-9]{1,3}$', false) THEN RETURN false; END IF;
    a := (g->>'a')::int; b := (g->>'b')::int;
    IF NOT (GREATEST(a, b) >= obj AND abs(a - b) >= 2 AND (GREATEST(a, b) = obj OR abs(a - b) = 2)) THEN RETURN false; END IF;
    IF a > b THEN ga := ga + 1; ELSE gb := gb + 1; END IF;
  END LOOP;
  RETURN GREATEST(ga, gb) = necesarios AND ga = pa AND gb = pb;
END $$;

-- ---------------------------------------------------------------- el partido en el cuadro
-- {lista, idx, elem} del partido en rk_torneos.data, o NULL si no está.
CREATE OR REPLACE FUNCTION public._arbitraje_partido_cuadro(p_data jsonb, p_partido_id text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_lista text;
  v_idx int;
  v_elem jsonb;
BEGIN
  IF p_data IS NULL THEN RETURN NULL; END IF;
  FOREACH v_lista IN ARRAY ARRAY['partidosGrupo', 'partidosLlave'] LOOP
    SELECT (o - 1)::int, x INTO v_idx, v_elem
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_data->v_lista) = 'array' THEN p_data->v_lista ELSE '[]'::jsonb END) WITH ORDINALITY y(x, o)
     WHERE x->>'id' = p_partido_id
     LIMIT 1;
    IF v_idx IS NOT NULL THEN RETURN jsonb_build_object('lista', v_lista, 'idx', v_idx, 'elem', v_elem); END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- Resultado ya cargado en el cuadro ({puntosA, puntosB, games?, wo?}) o NULL.
CREATE OR REPLACE FUNCTION public._arbitraje_resultado_cuadro(p_elem jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_elem IS NULL OR (p_elem->>'puntosA' IS NULL AND NOT COALESCE((p_elem->>'wo')::boolean, false)) THEN NULL
    ELSE jsonb_strip_nulls(jsonb_build_object('puntosA', p_elem->'puntosA', 'puntosB', p_elem->'puntosB',
      'games', CASE WHEN jsonb_typeof(p_elem->'games') = 'array' THEN p_elem->'games' END,
      'wo', CASE WHEN COALESCE((p_elem->>'wo')::boolean, false) THEN true END))
  END
$$;

-- Un resultado que cuenta para avanzar en la llave (como resultadoValido() del motor de torneos).
CREATE OR REPLACE FUNCTION public._arbitraje_resultado_valido(p_elem jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_typeof(p_elem->'puntosA') = 'number' AND jsonb_typeof(p_elem->'puntosB') = 'number'
    AND p_elem->>'puntosA' ~ '^[0-9]+$' AND p_elem->>'puntosB' ~ '^[0-9]+$'
    AND p_elem->>'puntosA' <> p_elem->>'puntosB', false)
$$;

-- ¿Se sabe quién ocupa este lugar de la llave? (como resolverSlot() de src/torneos/engine/llave.ts)
CREATE OR REPLACE FUNCTION public._arbitraje_slot_resuelto(p_llave jsonb, p_slot jsonb, p_prof int DEFAULT 0) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_p jsonb;
  v_a_nulo boolean;
  v_b_nulo boolean;
BEGIN
  IF p_prof > 30 OR p_slot IS NULL OR jsonb_typeof(p_slot) <> 'object' THEN RETURN false; END IF;
  IF p_slot->>'tipo' = 'seed' THEN RETURN COALESCE(p_slot->>'parejaId', '') <> ''; END IF;
  IF NOT COALESCE(p_slot->>'tipo' IN ('ganadorDe', 'perdedorDe'), false) THEN RETURN false; END IF;
  SELECT x INTO v_p FROM jsonb_array_elements(p_llave) x WHERE x->>'id' = p_slot->>'partidoId' LIMIT 1;
  IF v_p IS NULL THEN RETURN false; END IF;
  v_a_nulo := v_p->'a' IS NULL OR jsonb_typeof(v_p->'a') = 'null';
  v_b_nulo := v_p->'b' IS NULL OR jsonb_typeof(v_p->'b') = 'null';
  IF v_a_nulo OR v_b_nulo THEN
    -- bye: pasa el otro sin jugar; el perdedor de un bye no existe.
    IF v_a_nulo AND v_b_nulo OR p_slot->>'tipo' = 'perdedorDe' THEN RETURN false; END IF;
    RETURN _arbitraje_slot_resuelto(p_llave, CASE WHEN v_a_nulo THEN v_p->'b' ELSE v_p->'a' END, p_prof + 1);
  END IF;
  RETURN _arbitraje_slot_resuelto(p_llave, v_p->'a', p_prof + 1)
     AND _arbitraje_slot_resuelto(p_llave, v_p->'b', p_prof + 1)
     AND _arbitraje_resultado_valido(v_p);
END $$;

CREATE OR REPLACE FUNCTION public._arbitraje_rivales_definidos(p_data jsonb, p_ubic jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_ubic IS NULL THEN false
    WHEN p_ubic->>'lista' = 'partidosGrupo' THEN COALESCE(p_ubic->'elem'->>'aId', '') <> '' AND COALESCE(p_ubic->'elem'->>'bId', '') <> ''
    ELSE _arbitraje_slot_resuelto(p_data->'partidosLlave', p_ubic->'elem'->'a') AND _arbitraje_slot_resuelto(p_data->'partidosLlave', p_ubic->'elem'->'b')
  END
$$;

-- Respuesta para un partido ya cerrado (por el árbitro o desde la mesa). error = 'desfasado' para
-- que la web vieja (v35/v36) se ponga al día con las jugadas y deje de reintentar.
CREATE OR REPLACE FUNCTION public._arbitraje_cerrado(p_p arbitraje_partidos, p_resultado jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('ok', false, 'error', 'desfasado', 'estado', 'terminado',
    'motivo', CASE WHEN p_p.cierre = 'mesa' THEN 'cargado_en_mesa' ELSE 'terminado' END,
    'resultado', COALESCE(p_resultado, _arbitraje_resultado_de(p_p.formato, p_p.marcador)),
    'jugadas', p_p.jugadas, 'version', p_p.version)
$$;

-- ---------------------------------------------------------------- RPC del árbitro
CREATE OR REPLACE FUNCTION public.arbitro_entrar(p_codigo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_origen text := _arbitraje_origen();
  v_freno text := _arbitraje_freno(v_origen);
  v_c record;
  v_p arbitraje_partidos%ROWTYPE;
  v_data jsonb;
  v_ubic jsonb;
  v_res jsonb;
BEGIN
  IF v_freno IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', v_freno, 'bloqueado', true); END IF;
  SELECT * INTO v_c FROM _arbitraje_codigo(p_codigo);
  IF v_c.estado = 'baja' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese código ya no se usa (el cuadro cambió). Pedí el nuevo en la mesa de control.', 'baja', true);
  ELSIF v_c.estado <> 'ok' THEN
    PERFORM _arbitraje_anotar_fallo(v_origen);
    RETURN jsonb_build_object('ok', false, 'error', 'Código incorrecto. Revisalo o pedilo en la mesa de control.');
  END IF;
  PERFORM _arbitraje_anotar_ok(v_origen);
  UPDATE arbitraje_codigos SET usado = now() WHERE codigo = v_c.codigo AND usado IS NULL;
  SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'El partido no está preparado: avisá en la mesa de control.'); END IF;
  SELECT data INTO v_data FROM rk_torneos WHERE id = v_c.torneo_id;
  v_ubic := _arbitraje_partido_cuadro(v_data, v_c.partido_id);
  v_res := _arbitraje_resultado_cuadro(v_ubic->'elem');
  -- Cargado a mano desde el gestor mientras tanto: se cierra acá (nada de "EN VIVO" eterno).
  IF v_p.estado <> 'terminado' AND v_res IS NOT NULL THEN
    UPDATE arbitraje_partidos SET estado = 'terminado', cierre = 'mesa', version = version + 1, actualizado = now()
     WHERE torneo_id = v_p.torneo_id AND partido_id = v_p.partido_id RETURNING * INTO v_p;
  END IF;
  RETURN jsonb_build_object('ok', true, 'torneo_id', v_c.torneo_id, 'partido_id', v_c.partido_id,
    'formato', v_p.formato, 'dobles', v_p.dobles, 'jugadas', v_p.jugadas, 'version', v_p.version, 'estado', v_p.estado,
    'motivo', CASE WHEN v_p.estado <> 'terminado' THEN NULL WHEN v_p.cierre = 'mesa' THEN 'cargado_en_mesa' ELSE 'terminado' END,
    'resultado', CASE WHEN v_p.estado = 'terminado' THEN COALESCE(v_res, _arbitraje_resultado_de(v_p.formato, v_p.marcador)) END,
    'rivales', CASE WHEN v_data IS NULL THEN NULL ELSE _arbitraje_rivales_definidos(v_data, v_ubic) END);
END $$;

CREATE OR REPLACE FUNCTION public.arbitro_marcar(p_codigo text, p_version int, p_jugadas jsonb, p_marcador jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_origen text := _arbitraje_origen();
  v_freno text := _arbitraje_freno(v_origen);
  v_c record;
  v_p arbitraje_partidos%ROWTYPE;
  v_data jsonb;
  v_ubic jsonb;
  v_res jsonb;
  v_formato jsonb;
BEGIN
  IF v_freno IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', v_freno, 'bloqueado', true); END IF;
  SELECT * INTO v_c FROM _arbitraje_codigo(p_codigo);
  IF v_c.estado = 'baja' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El código ya no es válido.', 'baja', true);
  ELSIF v_c.estado <> 'ok' THEN
    PERFORM _arbitraje_anotar_fallo(v_origen);
    RETURN jsonb_build_object('ok', false, 'error', 'El código ya no es válido.');
  END IF;
  PERFORM _arbitraje_anotar_ok(v_origen);
  SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'El partido no está preparado: avisá en la mesa de control.'); END IF;
  IF v_p.estado = 'terminado' THEN RETURN _arbitraje_cerrado(v_p, NULL); END IF;

  SELECT data INTO v_data FROM rk_torneos WHERE id = v_c.torneo_id;
  v_ubic := _arbitraje_partido_cuadro(v_data, v_c.partido_id);
  IF v_data IS NOT NULL AND v_ubic IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este partido ya no está en el cuadro (se rearmó): avisá en la mesa de control.', 'sin_partido', true);
  END IF;
  v_res := _arbitraje_resultado_cuadro(v_ubic->'elem');
  IF v_res IS NOT NULL THEN
    UPDATE arbitraje_partidos SET estado = 'terminado', cierre = 'mesa', version = version + 1, actualizado = now()
     WHERE torneo_id = v_p.torneo_id AND partido_id = v_p.partido_id RETURNING * INTO v_p;
    RETURN _arbitraje_cerrado(v_p, v_res);
  END IF;

  IF NOT _arbitraje_jugadas_validas(p_jugadas) THEN RETURN jsonb_build_object('ok', false, 'error', 'Jugadas inválidas.'); END IF;
  IF NOT _arbitraje_marcador_valido(p_marcador) THEN RETURN jsonb_build_object('ok', false, 'error', 'Marcador inválido.'); END IF;
  v_formato := _arbitraje_formato_de(p_jugadas, v_p.formato);
  IF v_formato IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Formato inválido.'); END IF;
  IF v_p.version IS DISTINCT FROM p_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'desfasado', 'estado', v_p.estado, 'jugadas', v_p.jugadas, 'version', v_p.version);
  END IF;
  -- El marcador que ve la TV lo calcula el servidor con las jugadas: nunca llega uno roto.
  UPDATE arbitraje_partidos SET jugadas = p_jugadas, marcador = _arbitraje_replay(v_formato, v_p.dobles, p_jugadas), version = version + 1,
         estado = CASE WHEN jsonb_array_length(p_jugadas) > 0 THEN 'en_juego' ELSE 'pendiente' END, actualizado = now()
   WHERE torneo_id = v_p.torneo_id AND partido_id = v_p.partido_id
  RETURNING * INTO v_p;
  RETURN jsonb_build_object('ok', true, 'version', v_p.version);
END $$;

CREATE OR REPLACE FUNCTION public.arbitro_terminar(p_codigo text, p_version int, p_jugadas jsonb, p_marcador jsonb, p_resultado jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_origen text := _arbitraje_origen();
  v_freno text := _arbitraje_freno(v_origen);
  v_c record;
  v_p arbitraje_partidos%ROWTYPE;
  v_data jsonb;
  v_ubic jsonb;
  v_elem jsonb;
  v_res jsonb;
  v_formato jsonb;
  v_marcador jsonb;
  v_calc jsonb;
  v_ahora text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF v_freno IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', v_freno, 'bloqueado', true); END IF;
  SELECT * INTO v_c FROM _arbitraje_codigo(p_codigo);
  IF v_c.estado = 'baja' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El código ya no es válido.', 'baja', true);
  ELSIF v_c.estado <> 'ok' THEN
    PERFORM _arbitraje_anotar_fallo(v_origen);
    RETURN jsonb_build_object('ok', false, 'error', 'El código ya no es válido.');
  END IF;
  PERFORM _arbitraje_anotar_ok(v_origen);
  SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'El partido no está preparado: avisá en la mesa de control.'); END IF;

  SELECT data INTO v_data FROM rk_torneos WHERE id = v_c.torneo_id FOR UPDATE;
  v_ubic := _arbitraje_partido_cuadro(v_data, v_c.partido_id);
  v_res := _arbitraje_resultado_cuadro(v_ubic->'elem');

  -- Ya terminado: reintentar devuelve lo mismo (si la respuesta se perdió, el árbitro sabe que entró).
  IF v_p.estado = 'terminado' THEN
    IF v_p.cierre = 'mesa' THEN
      RETURN _arbitraje_cerrado(v_p, v_res) || jsonb_build_object('error', 'El resultado ya se cargó desde la mesa de control.');
    END IF;
    RETURN jsonb_build_object('ok', true, 'ya_cargado', true, 'estado', 'terminado', 'motivo', 'terminado',
      'resultado', COALESCE(v_res, _arbitraje_resultado_de(v_p.formato, v_p.marcador)));
  END IF;

  IF v_data IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'El torneo ya no existe.'); END IF;
  IF v_ubic IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'El partido ya no está en el cuadro (¿se rearmó?).', 'sin_partido', true); END IF;
  IF v_res IS NOT NULL THEN
    UPDATE arbitraje_partidos SET estado = 'terminado', cierre = 'mesa', version = version + 1, actualizado = now()
     WHERE torneo_id = v_p.torneo_id AND partido_id = v_p.partido_id RETURNING * INTO v_p;
    RETURN _arbitraje_cerrado(v_p, v_res) || jsonb_build_object('error', 'El resultado ya se cargó desde la mesa de control.');
  END IF;

  IF v_p.version IS DISTINCT FROM p_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'desfasado', 'estado', v_p.estado, 'jugadas', v_p.jugadas, 'version', v_p.version);
  END IF;
  IF NOT _arbitraje_jugadas_validas(p_jugadas) THEN RETURN jsonb_build_object('ok', false, 'error', 'Jugadas inválidas.'); END IF;
  IF p_marcador IS NOT NULL AND jsonb_typeof(p_marcador) <> 'null' AND NOT _arbitraje_marcador_valido(p_marcador) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Marcador inválido.');
  END IF;
  v_formato := _arbitraje_formato_de(p_jugadas, v_p.formato);
  IF v_formato IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Formato inválido.'); END IF;

  -- El resultado tiene que ser exactamente el que sale de las jugadas, y legal para el formato.
  v_marcador := _arbitraje_replay(v_formato, v_p.dobles, p_jugadas);
  v_calc := _arbitraje_resultado_de(v_formato, v_marcador);
  IF v_calc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Según lo marcado el partido todavía no terminó.');
  END IF;
  IF NOT _arbitraje_resultado_legal(v_formato, p_resultado) OR NOT _arbitraje_resultado_legal(v_formato, v_calc)
     OR (p_resultado->>'puntosA')::int <> (v_calc->>'puntosA')::int OR (p_resultado->>'puntosB')::int <> (v_calc->>'puntosB')::int
     OR ((v_formato->>'mejorDe')::int = 3 AND (p_resultado->'games') <> (v_calc->'games')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El resultado no cierra con lo marcado y el formato del partido.');
  END IF;
  IF NOT _arbitraje_rivales_definidos(v_data, v_ubic) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Todavía no están definidos los dos rivales de este cruce.');
  END IF;

  v_elem := (v_ubic->'elem') || jsonb_build_object('puntosA', (v_calc->>'puntosA')::int, 'puntosB', (v_calc->>'puntosB')::int, 'cargadoEl', v_ahora);
  IF (v_formato->>'mejorDe')::int = 3 THEN v_elem := v_elem || jsonb_build_object('games', v_calc->'games'); END IF;
  UPDATE rk_torneos SET data = jsonb_set(v_data, ARRAY[v_ubic->>'lista', v_ubic->>'idx'], v_elem), updated_at = now() WHERE id = v_c.torneo_id;
  UPDATE rk_en_cancha SET torneo_id = NULL, partido_id = NULL, updated_at = now()
   WHERE torneo_id = v_c.torneo_id AND partido_id = v_c.partido_id;
  UPDATE arbitraje_partidos SET jugadas = p_jugadas, marcador = v_marcador, formato = v_formato, estado = 'terminado', cierre = 'arbitro',
         version = version + 1, actualizado = now()
   WHERE torneo_id = v_p.torneo_id AND partido_id = v_p.partido_id;
  -- El código queda (2 días) para que reintentar o volver a entrar respondan "terminado".
  RETURN jsonb_build_object('ok', true, 'estado', 'terminado', 'motivo', 'terminado', 'resultado', v_calc);
END $$;

-- ---------------------------------------------------------------- RPC del gestor
-- Crea los códigos que falten (6 cifras), actualiza el formato de los que no empezaron, no emite para
-- partidos con resultado o W.O., da de baja los huérfanos y limpia los viejos.
-- p_partidos = [{partido_id, formato}] (lo arma la web con partidosArbitrables + formatoDe).
CREATE OR REPLACE FUNCTION public.admin_codigos_torneo(p_torneo_id text, p_dobles boolean, p_partidos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  x jsonb;
  v_id text;
  v_formato jsonb;
  v_codigo text;
  v_p arbitraje_partidos%ROWTYPE;
  v_data jsonb;
  v_ubic jsonb;
  v_ids text[];
  v_sin_lugar int := 0;
  v_existe boolean;
  r record;
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo el equipo'); END IF;
  IF jsonb_typeof(p_partidos) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('ok', false, 'error', 'lista inválida'); END IF;
  SELECT data INTO v_data FROM rk_torneos WHERE id = p_torneo_id;
  SELECT COALESCE(array_agg(e->>'partido_id'), '{}') INTO v_ids FROM jsonb_array_elements(p_partidos) e WHERE e->>'partido_id' IS NOT NULL;

  -- Limpieza general: bajas de más de un día, códigos de partidos terminados hace 2 días, códigos de 90 días.
  DELETE FROM arbitraje_codigos_baja WHERE baja < now() - interval '1 day';
  DELETE FROM arbitraje_codigos c USING arbitraje_partidos p
   WHERE p.torneo_id = c.torneo_id AND p.partido_id = c.partido_id AND p.estado = 'terminado' AND p.actualizado < now() - interval '2 days';
  DELETE FROM arbitraje_codigos WHERE creado < now() - interval '90 days';

  -- Huérfanos del torneo: el partido ya no está en la lista (ni en el cuadro). Se dan de baja.
  FOR r IN SELECT c.codigo, c.partido_id FROM arbitraje_codigos c
            WHERE c.torneo_id = p_torneo_id AND NOT (c.partido_id = ANY (v_ids))
              AND (v_data IS NULL OR _arbitraje_partido_cuadro(v_data, c.partido_id) IS NULL) LOOP
    PERFORM _arbitraje_baja_codigo(r.codigo);
    DELETE FROM arbitraje_partidos WHERE torneo_id = p_torneo_id AND partido_id = r.partido_id AND estado <> 'terminado';
  END LOOP;

  FOR x IN SELECT * FROM jsonb_array_elements(p_partidos) LOOP
    v_id := x->>'partido_id';
    CONTINUE WHEN v_id IS NULL;
    v_ubic := _arbitraje_partido_cuadro(v_data, v_id);
    IF v_data IS NOT NULL AND v_ubic IS NULL THEN CONTINUE; END IF; -- la web mandó un partido que no está en el cuadro guardado
    v_formato := COALESCE(_arbitraje_formato_base(x->'formato'), '{"tipo":"rally","a":15,"mejorDe":1}'::jsonb);
    SELECT * INTO v_p FROM arbitraje_partidos WHERE torneo_id = p_torneo_id AND partido_id = v_id FOR UPDATE;
    v_existe := FOUND;

    IF _arbitraje_resultado_cuadro(v_ubic->'elem') IS NOT NULL THEN
      -- Ya tiene resultado (a mano o W.O.): nada de códigos nuevos. Si nunca empezó, el código se da de baja;
      -- si estaba en juego, la fila se cierra y el código queda para que el árbitro reciba el aviso.
      IF v_existe AND v_p.estado = 'en_juego' THEN
        UPDATE arbitraje_partidos SET estado = 'terminado', cierre = 'mesa', version = version + 1, actualizado = now()
         WHERE torneo_id = p_torneo_id AND partido_id = v_id;
      ELSIF v_existe AND v_p.estado = 'pendiente' THEN
        PERFORM _arbitraje_baja_codigo(c.codigo) FROM arbitraje_codigos c WHERE c.torneo_id = p_torneo_id AND c.partido_id = v_id;
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO arbitraje_partidos (torneo_id, partido_id, formato, dobles)
    VALUES (p_torneo_id, v_id, v_formato, p_dobles)
    ON CONFLICT (torneo_id, partido_id) DO UPDATE SET formato = EXCLUDED.formato, dobles = EXCLUDED.dobles
      WHERE arbitraje_partidos.estado = 'pendiente';
    IF NOT EXISTS (SELECT 1 FROM arbitraje_partidos WHERE torneo_id = p_torneo_id AND partido_id = v_id AND estado = 'terminado')
       AND NOT EXISTS (SELECT 1 FROM arbitraje_codigos WHERE torneo_id = p_torneo_id AND partido_id = v_id) THEN
      v_codigo := _arbitraje_codigo_nuevo();
      IF v_codigo IS NULL THEN v_sin_lugar := v_sin_lugar + 1; CONTINUE; END IF;
      INSERT INTO arbitraje_codigos (codigo, torneo_id, partido_id) VALUES (v_codigo, p_torneo_id, v_id);
    END IF;
  END LOOP;

  IF v_sin_lugar > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', format('No hay códigos libres para %s partidos: probá de nuevo.', v_sin_lugar));
  END IF;
  RETURN jsonb_build_object('ok', true,
    'codigos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('partido_id', c.partido_id, 'codigo', c.codigo) ORDER BY c.partido_id)
        FROM arbitraje_codigos c JOIN arbitraje_partidos p ON p.torneo_id = c.torneo_id AND p.partido_id = c.partido_id
       WHERE c.torneo_id = p_torneo_id AND c.partido_id = ANY (v_ids) AND p.estado <> 'terminado'), '[]'::jsonb),
    'cuatro_cifras', (SELECT count(*) FROM arbitraje_codigos c JOIN arbitraje_partidos p ON p.torneo_id = c.torneo_id AND p.partido_id = c.partido_id
                       WHERE c.torneo_id = p_torneo_id AND length(c.codigo) = 4 AND p.estado = 'pendiente'));
END $$;

-- Gestor: cambia por códigos nuevos de 6 cifras los de 4 de partidos que todavía no empezaron.
-- Ojo: la hoja impresa con los códigos viejos deja de servir para esos partidos.
CREATE OR REPLACE FUNCTION public.admin_codigos_renovar(p_torneo_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  r record;
  v_codigo text;
  n int := 0;
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo el equipo'); END IF;
  FOR r IN SELECT c.codigo, c.partido_id FROM arbitraje_codigos c
             JOIN arbitraje_partidos p ON p.torneo_id = c.torneo_id AND p.partido_id = c.partido_id
            WHERE c.torneo_id = p_torneo_id AND length(c.codigo) = 4 AND p.estado = 'pendiente' AND c.usado IS NULL
            FOR UPDATE OF c LOOP
    v_codigo := _arbitraje_codigo_nuevo();
    CONTINUE WHEN v_codigo IS NULL;
    PERFORM _arbitraje_baja_codigo(r.codigo);
    INSERT INTO arbitraje_codigos (codigo, torneo_id, partido_id) VALUES (v_codigo, p_torneo_id, r.partido_id);
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'renovados', n);
END $$;

-- Gestor: qué origen ve la base para esta conexión (para comprobar el freno después de aplicar).
CREATE OR REPLACE FUNCTION public.admin_arbitraje_diagnostico() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE h json;
BEGIN
  IF NOT es_equipo() THEN RETURN jsonb_build_object('ok', false, 'error', 'solo el equipo'); END IF;
  BEGIN h := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::json; EXCEPTION WHEN others THEN h := '{}'::json; END;
  RETURN jsonb_build_object('ok', true, 'origen', _arbitraje_origen(),
    'cf_connecting_ip', h->>'cf-connecting-ip', 'x_forwarded_for', h->>'x-forwarded-for', 'x_real_ip', h->>'x-real-ip',
    'fallos_15min', (SELECT count(*) FROM arbitraje_intentos WHERE cuando > now() - interval '15 minutes'));
END $$;

-- ---------------------------------------------------------------- permisos
-- Las auxiliares no se llaman desde afuera (PostgREST expone todo lo de public).
REVOKE ALL ON FUNCTION public._arbitraje_origen() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_freno(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_anotar_fallo(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_anotar_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_codigo(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_baja_codigo(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_codigo_nuevo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_formato_valido(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_formato_base(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_formato_de(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_jugadas_validas(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_marcador_valido(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_replay(jsonb, boolean, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_resultado_de(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_resultado_legal(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_partido_cuadro(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_resultado_cuadro(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_resultado_valido(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_slot_resuelto(jsonb, jsonb, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_rivales_definidos(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arbitraje_cerrado(arbitraje_partidos, jsonb) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.arbitro_entrar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.arbitro_marcar(text, int, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.arbitro_terminar(text, int, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_codigos_torneo(text, boolean, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_codigos_renovar(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_arbitraje_diagnostico() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.arbitro_entrar(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arbitro_marcar(text, int, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arbitro_terminar(text, int, jsonb, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_codigos_torneo(text, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_codigos_renovar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_arbitraje_diagnostico() TO authenticated;
