-- Pruebas de la base del tanteador de árbitros (v35 + v36 + v37). Ver README.md en esta carpeta.
-- Cada chequeo imprime "ok · ..." y el primero que falla corta todo con ERROR.
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.ok(nombre text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALLA · %', nombre; END IF;
  RAISE NOTICE 'ok · %', nombre;
END $$;

-- Jugadas: saca = quién saca primero; seq = 'A'/'B' rally ganado, 'a'/'b' tiempo pedido.
CREATE FUNCTION pg_temp.j(saca text, seq text, formato jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('t', 'inicio', 'saca', saca, 'derechaA', 0, 'derechaB', 0, 'formato', formato)))
      || COALESCE((SELECT jsonb_agg(CASE WHEN c IN ('A', 'B') THEN jsonb_build_object('t', 'rally', 'gana', c)
                                         ELSE jsonb_build_object('t', 'tiempo', 'equipo', upper(c)) END ORDER BY o)
                     FROM regexp_split_to_table(seq, '') WITH ORDINALITY AS s(c, o) WHERE c <> ''), '[]'::jsonb)
$$;
CREATE FUNCTION pg_temp.rep(n int, c text) RETURNS text LANGUAGE sql AS $$ SELECT repeat(c, n) $$;
-- Lo que manda el celular como marcador (la misma cuenta que el motor).
CREATE FUNCTION pg_temp.m(f jsonb, j jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT _arbitraje_replay(f, true, j) $$;
CREATE FUNCTION pg_temp.origen(ip text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.headers', jsonb_build_object('cf-connecting-ip', ip)::text, false); $$;
CREATE FUNCTION pg_temp.cod(t text, p text) RETURNS text LANGUAGE sql AS $$
  SELECT codigo FROM arbitraje_codigos WHERE torneo_id = t AND partido_id = p $$;
CREATE FUNCTION pg_temp.elem(t text, p text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT _arbitraje_partido_cuadro(data, p)->'elem' FROM rk_torneos WHERE id = t $$;
CREATE FUNCTION pg_temp.limpiar_freno() RETURNS void LANGUAGE sql AS $$
  DELETE FROM arbitraje_intentos; DELETE FROM arbitraje_origenes_ok; $$;

-- ------------------------------------------------------------------ datos
TRUNCATE arbitraje_partidos, arbitraje_codigos, arbitraje_codigos_baja, arbitraje_intentos, arbitraje_origenes_ok, rk_torneos, rk_en_cancha;
INSERT INTO rk_torneos (id, data) VALUES
('t1', '{
  "id":"t1","nombre":"MIXTO A","parejas":[{"id":"p1","nombre":"A y B"},{"id":"p2","nombre":"C y D"},{"id":"p3","nombre":"E y F"},{"id":"p4","nombre":"G y H"}],
  "grupos":[{"id":"g1","nombre":"A","parejaIds":["p1","p2"]}],
  "partidosGrupo":[
    {"id":"m1","grupoId":"g1","ronda":1,"aId":"p1","bId":"p2","puntosA":null,"puntosB":null},
    {"id":"m2","grupoId":"g1","ronda":1,"aId":"p3","bId":"p4","puntosA":null,"puntosB":null},
    {"id":"m3","grupoId":"g1","ronda":2,"aId":"p1","bId":"p3","puntosA":null,"puntosB":null},
    {"id":"m4","grupoId":"g1","ronda":2,"aId":"p2","bId":"p4","puntosA":11,"puntosB":3},
    {"id":"m5","grupoId":"g1","ronda":3,"aId":"p1","bId":"p4","puntosA":11,"puntosB":0,"wo":true},
    {"id":"m6","grupoId":"g1","ronda":3,"aId":"p2","bId":"p3","puntosA":null,"puntosB":null}],
  "partidosLlave":[
    {"id":"s1","ronda":1,"posicion":0,"a":{"tipo":"seed","parejaId":"p1"},"b":{"tipo":"seed","parejaId":"p3"},"puntosA":15,"puntosB":9,"esTercerPuesto":false},
    {"id":"s2","ronda":1,"posicion":1,"a":{"tipo":"seed","parejaId":"p2"},"b":{"tipo":"seed","parejaId":"p4"},"puntosA":null,"puntosB":null,"esTercerPuesto":false},
    {"id":"f","ronda":2,"posicion":0,"a":{"tipo":"ganadorDe","partidoId":"s1"},"b":{"tipo":"ganadorDe","partidoId":"s2"},"puntosA":null,"puntosB":null,"esTercerPuesto":false},
    {"id":"x1","ronda":1,"posicion":2,"a":null,"b":{"tipo":"seed","parejaId":"p4"},"puntosA":null,"puntosB":null,"esTercerPuesto":false},
    {"id":"x2","ronda":2,"posicion":1,"a":{"tipo":"ganadorDe","partidoId":"x1"},"b":{"tipo":"seed","parejaId":"p1"},"puntosA":null,"puntosB":null,"esTercerPuesto":false},
    {"id":"x3","ronda":2,"posicion":2,"a":{"tipo":"perdedorDe","partidoId":"x1"},"b":{"tipo":"seed","parejaId":"p1"},"puntosA":null,"puntosB":null,"esTercerPuesto":false}]
}'),
('t2', '{"id":"t2","parejas":[],"grupos":[],"partidosGrupo":[{"id":"m1","grupoId":"g","ronda":1,"aId":"q1","bId":"q2","puntosA":null,"puntosB":null}],"partidosLlave":[]}');
INSERT INTO rk_en_cancha (cancha, torneo_id, partido_id) VALUES ('Cancha 1', 't1', 'm1'), ('Cancha 2', 't2', 'm1');

SET pruebas.equipo = 'si';
SELECT pg_temp.ok('admin: genera códigos', (admin_codigos_torneo('t1', true, '[
  {"partido_id":"m1","formato":{"tipo":"sideout","a":11,"mejorDe":1}},
  {"partido_id":"m2","formato":{"tipo":"rally","a":15,"mejorDe":1}},
  {"partido_id":"m3","formato":{"tipo":"rally","a":11,"mejorDe":3}},
  {"partido_id":"m4","formato":{"tipo":"rally","a":15,"mejorDe":1}},
  {"partido_id":"m5","formato":{"tipo":"rally","a":15,"mejorDe":1}},
  {"partido_id":"m6","formato":{"tipo":"rally","a":21,"mejorDe":1}},
  {"partido_id":"s1","formato":{"tipo":"rally","a":15,"mejorDe":1}},
  {"partido_id":"s2","formato":{"tipo":"rally","a":11,"mejorDe":1}},
  {"partido_id":"f","formato":{"tipo":"rally","a":11,"mejorDe":1}},
  {"partido_id":"x2","formato":{"tipo":"rally","a":11,"mejorDe":1}},
  {"partido_id":"x3","formato":{"tipo":"rally","a":11,"mejorDe":1}}]'::jsonb)->>'ok')::boolean);
SELECT admin_codigos_torneo('t2', true, '[{"partido_id":"m1","formato":{"tipo":"rally","a":11,"mejorDe":1}}]');
RESET pruebas.equipo;

-- ------------------------------------------------------------------ A6: códigos
SELECT pg_temp.ok('A6 códigos nuevos de 6 cifras', (SELECT bool_and(codigo ~ '^[0-9]{6}$') FROM arbitraje_codigos));
SELECT pg_temp.ok('A6 sin código para partido con resultado (m4) ni W.O. (m5) ni llave jugada (s1)',
  pg_temp.cod('t1', 'm4') IS NULL AND pg_temp.cod('t1', 'm5') IS NULL AND pg_temp.cod('t1', 's1') IS NULL);
SELECT pg_temp.ok('A6 código para los pendientes y para cruces todavía sin rivales (f)',
  pg_temp.cod('t1', 'm1') IS NOT NULL AND pg_temp.cod('t1', 's2') IS NOT NULL AND pg_temp.cod('t1', 'f') IS NOT NULL);
SELECT pg_temp.ok('A6 el mismo partido en dos torneos tiene códigos distintos', pg_temp.cod('t1', 'm1') <> pg_temp.cod('t2', 'm1'));
DO $$
DECLARE n int;
BEGIN
  -- Bucle acotado: con los 1.000.000 de códigos de 6 cifras ocupados no se cuelga, devuelve NULL.
  INSERT INTO arbitraje_codigos (codigo, torneo_id, partido_id)
    SELECT lpad(i::text, 6, '0'), 'lleno', 'p' || i FROM generate_series(0, 999999) i
    ON CONFLICT DO NOTHING;
  PERFORM pg_temp.ok('A6 búsqueda de código libre acotada (todo ocupado → NULL, sin colgarse)', _arbitraje_codigo_nuevo() IS NULL);
  DELETE FROM arbitraje_codigos WHERE torneo_id = 'lleno';
  SELECT count(*) INTO n FROM arbitraje_codigos;
  PERFORM pg_temp.ok('A6 limpieza de la prueba de bucle', n = 9);
END $$;

-- ------------------------------------------------------------------ A2: origen
SELECT set_config('request.headers', '{"x-forwarded-for":"6.6.6.6, 10.0.0.1"}', false);
SELECT pg_temp.ok('A2 origen: último valor de x-forwarded-for (el primero lo elige el cliente)', _arbitraje_origen() = '10.0.0.1');
SELECT set_config('request.headers', '{"x-forwarded-for":"6.6.6.6, 10.0.0.1","cf-connecting-ip":"200.1.1.1"}', false);
SELECT pg_temp.ok('A2 origen: cf-connecting-ip manda', _arbitraje_origen() = '200.1.1.1');
SELECT set_config('request.headers', 'esto no es json', false);
SELECT pg_temp.ok('A2 origen: cabecera rota no rompe', _arbitraje_origen() = 'sin-origen');

-- ------------------------------------------------------------------ A1: marcar y terminar pasan por el freno
SELECT pg_temp.limpiar_freno();
SELECT pg_temp.origen('7.7.7.7');
SELECT arbitro_marcar('00000', -1, '[]', '{}') AS r \gset
SELECT pg_temp.ok('A1 marcar con código inválido: error y anota el intento',
  (:'r'::jsonb->>'ok')::boolean = false AND (SELECT count(*) FROM arbitraje_intentos WHERE origen = '7.7.7.7') = 1);
SELECT arbitro_terminar('00001', -1, '[]', '{}', '{}') AS r \gset
SELECT pg_temp.ok('A1 terminar con código inválido: error y anota el intento',
  (:'r'::jsonb->>'ok')::boolean = false AND (SELECT count(*) FROM arbitraje_intentos WHERE origen = '7.7.7.7') = 2);
DO $$ BEGIN
  FOR i IN 1..28 LOOP PERFORM arbitro_marcar(lpad(i::text, 5, '9'), -1, '[]', '{}'); END LOOP;
END $$;
SELECT pg_temp.ok('A1 tras 30 fallos el origen queda frenado', (arbitro_entrar('12345')->>'bloqueado')::boolean);
SELECT pg_temp.ok('A1 frenado: un código VÁLIDO recibe la misma respuesta (no hay oráculo)',
  (arbitro_marcar(pg_temp.cod('t1', 'm1'), -1, '[]', '{}')->>'bloqueado')::boolean
  AND (arbitro_terminar(pg_temp.cod('t1', 'm1'), -1, '[]', '{}', '{}')->>'bloqueado')::boolean
  AND (arbitro_entrar(pg_temp.cod('t1', 'm1'))->>'bloqueado')::boolean);
SELECT pg_temp.ok('A1 los pedidos frenados no se anotan (el bloqueo se levanta solo)', (SELECT count(*) FROM arbitraje_intentos WHERE origen = '7.7.7.7') = 30);
SELECT pg_temp.origen('7.7.7.8');
SELECT pg_temp.ok('A2 otro origen no queda frenado por el primero', (arbitro_entrar(pg_temp.cod('t1', 'm1'))->>'ok')::boolean);

-- ------------------------------------------------------------------ A2: wifi del club y freno global
SELECT pg_temp.limpiar_freno();
SELECT pg_temp.origen('190.0.0.1'); -- el wifi del club: todos los árbitros salen por acá
DO $$ BEGIN FOR i IN 1..25 LOOP PERFORM arbitro_entrar('5555' || (i % 10)); END LOOP; END $$;
SELECT pg_temp.ok('A2 25 errores de tipeo desde el wifi del club no frenan a nadie',
  (arbitro_entrar(pg_temp.cod('t1', 'm2'))->>'ok')::boolean AND NOT (arbitro_marcar(pg_temp.cod('t1', 'm2'), -5, '[]', '{}') ? 'bloqueado'));
-- Barrido distribuido: 300 fallos de 300 IP distintas en 15 minutos.
INSERT INTO arbitraje_intentos (origen) SELECT 'bot-' || i FROM generate_series(1, 300) i;
SELECT pg_temp.origen('201.0.0.9');
DO $$ BEGIN FOR i IN 1..3 LOOP PERFORM arbitro_entrar('4444' || i); END LOOP; END $$;
SELECT pg_temp.ok('A2 con freno global, un origen desconocido se frena a los 3 fallos', (arbitro_entrar('44449')->>'bloqueado')::boolean);
SELECT pg_temp.origen('190.0.0.1');
SELECT pg_temp.ok('A2 con freno global, el wifi del club (ya entró antes) sigue con su límite normal',
  (arbitro_entrar(pg_temp.cod('t1', 'm2'))->>'ok')::boolean);
INSERT INTO arbitraje_intentos (origen) SELECT 'bot-' || i FROM generate_series(1, 2700) i;
SELECT pg_temp.origen('201.0.0.10');
SELECT pg_temp.ok('A2 con 3000 fallos globales, un origen nuevo queda frenado de entrada', (arbitro_entrar(pg_temp.cod('t1', 'm2'))->>'bloqueado')::boolean);
SELECT pg_temp.origen('190.0.0.1');
SELECT pg_temp.ok('A2 con 3000 fallos globales, los árbitros conocidos siguen marcando', (arbitro_entrar(pg_temp.cod('t1', 'm2'))->>'ok')::boolean);
SELECT pg_temp.limpiar_freno();

-- Códigos de 4 cifras ya emitidos siguen valiendo.
INSERT INTO arbitraje_partidos (torneo_id, partido_id, formato) VALUES ('t2', 'viejo', '{"tipo":"rally","a":11}') ON CONFLICT DO NOTHING;
UPDATE rk_torneos SET data = jsonb_set(data, '{partidosGrupo}', data->'partidosGrupo' || '[{"id":"viejo","grupoId":"g","ronda":2,"aId":"q1","bId":"q2","puntosA":null,"puntosB":null}]') WHERE id = 't2';
INSERT INTO arbitraje_codigos (codigo, torneo_id, partido_id) VALUES ('4321', 't2', 'viejo');
SELECT pg_temp.origen('8.8.8.8');
SELECT pg_temp.ok('A2 un código viejo de 4 cifras sigue entrando', (arbitro_entrar('4321')->>'ok')::boolean);
SELECT pg_temp.ok('A3 formato viejo sin mejorDe: se marca',
  (arbitro_marcar('4321', 0, pg_temp.j('A', pg_temp.rep(11, 'A')), pg_temp.m('{"tipo":"rally","a":11,"mejorDe":1}', pg_temp.j('A', pg_temp.rep(11, 'A'))))->>'ok')::boolean);
SELECT pg_temp.ok('A3 formato viejo sin mejorDe: vale un game y se termina',
  (arbitro_terminar('4321', 1, pg_temp.j('A', pg_temp.rep(11, 'A')), NULL, '{"puntosA":11,"puntosB":0}')->>'ok')::boolean);

-- ------------------------------------------------------------------ A7: forma de jugadas y marcador
SELECT pg_temp.ok('A7 marcar rechaza un marcador sin games',
  arbitro_marcar(pg_temp.cod('t1', 'm1'), 0, pg_temp.j('A', 'A'), '{"puntos":{"a":1,"b":0},"saca":"A"}')->>'error' = 'Marcador inválido.');
SELECT pg_temp.ok('A7 marcar rechaza jugadas sin inicio o con basura',
  arbitro_marcar(pg_temp.cod('t1', 'm1'), 0, '[{"t":"rally","gana":"A"}]', pg_temp.m('{"tipo":"rally","a":11,"mejorDe":1}', '[]'))->>'error' = 'Jugadas inválidas.'
  AND arbitro_marcar(pg_temp.cod('t1', 'm1'), 0, pg_temp.j('A', '') || '[{"t":"rally","gana":"C"}]', pg_temp.m('{"tipo":"rally","a":11,"mejorDe":1}', '[]'))->>'error' = 'Jugadas inválidas.'
  AND arbitro_marcar(pg_temp.cod('t1', 'm1'), 0, '{"no":"lista"}', pg_temp.m('{"tipo":"rally","a":11,"mejorDe":1}', '[]'))->>'error' = 'Jugadas inválidas.');
SELECT pg_temp.ok('A3 marcar rechaza un formato fuera de lo permitido',
  arbitro_marcar(pg_temp.cod('t1', 'm1'), 0, pg_temp.j('A', 'A', '{"tipo":"rally","a":9,"mejorDe":1}'), pg_temp.m('{"tipo":"rally","a":11,"mejorDe":1}', '[]'))->>'error' = 'Jugadas inválidas.');
SELECT arbitro_marcar(pg_temp.cod('t1', 'm1'), 0, pg_temp.j('A', 'AAB'),
     '{"puntos":{"a":99,"b":0},"games":[],"gamesA":0,"gamesB":0,"game":1,"saca":"A","servidor":1,"canto":"x","terminado":false,"ganador":null}') AS r \gset
SELECT pg_temp.ok('A7 marcar guarda el marcador que calcula el servidor, no el que manda el celular',
  (:'r'::jsonb->>'ok')::boolean
  AND (SELECT marcador->'puntos' = '{"a":2,"b":0}' AND marcador->>'canto' = '0-2-1' AND estado = 'en_juego'
         FROM arbitraje_partidos WHERE torneo_id = 't1' AND partido_id = 'm1'));
SELECT pg_temp.ok('marcar con versión vieja: desfasado con lo del servidor',
  (SELECT r->>'error' = 'desfasado' AND (r->>'version')::int = 1 AND jsonb_array_length(r->'jugadas') = 4
     FROM (SELECT arbitro_marcar(pg_temp.cod('t1', 'm1'), 0, pg_temp.j('A', 'A'), pg_temp.m('{"tipo":"sideout","a":11,"mejorDe":1}', pg_temp.j('A', 'A'))) r) s));

-- ------------------------------------------------------------------ A3: terminar estricto
SELECT pg_temp.ok('A3 legal: 11-9, 12-10, 13-11, 21-19, 15-0',
  _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":11,"puntosB":9}')
  AND _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":10,"puntosB":12}')
  AND _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":13,"puntosB":11}')
  AND _arbitraje_resultado_legal('{"tipo":"rally","a":21,"mejorDe":1}', '{"puntosA":21,"puntosB":19}')
  AND _arbitraje_resultado_legal('{"tipo":"rally","a":15,"mejorDe":1}', '{"puntosA":15,"puntosB":0}'));
SELECT pg_temp.ok('A3 ilegal: 13-5 a 11, 11-10, 13-10, 10-8, 11 a -3, 11-11, texto',
  NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":13,"puntosB":5}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":11,"puntosB":10}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":13,"puntosB":10}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":10,"puntosB":8}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":11,"puntosB":-3}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":11,"puntosB":11}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":"once","puntosB":3}'));
SELECT pg_temp.ok('A3 mejor de 3: 2-0 y 2-1 legales; tercer game tras 2-0, game suelto, 1-1 y games que no suman: ilegales',
  _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":3}', '{"puntosA":2,"puntosB":0,"games":[{"a":11,"b":3},{"a":11,"b":9}]}')
  AND _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":3}', '{"puntosA":1,"puntosB":2,"games":[{"a":11,"b":3},{"a":9,"b":11},{"a":12,"b":14}]}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":3}', '{"puntosA":2,"puntosB":1,"games":[{"a":11,"b":3},{"a":11,"b":9},{"a":3,"b":11}]}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":3}', '{"puntosA":11,"puntosB":5}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":3}', '{"puntosA":1,"puntosB":0,"games":[{"a":11,"b":3}]}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":3}', '{"puntosA":2,"puntosB":0,"games":[{"a":11,"b":3},{"a":3,"b":11}]}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":1}', '{"puntosA":11,"puntosB":3,"games":[{"a":11,"b":3}]}'));
SELECT pg_temp.ok('A3 formato fuera del conjunto: ilegal',
  NOT _arbitraje_resultado_legal('{"tipo":"rally","a":9,"mejorDe":1}', '{"puntosA":9,"puntosB":3}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"bolea","a":11,"mejorDe":1}', '{"puntosA":11,"puntosB":3}')
  AND NOT _arbitraje_resultado_legal('{"tipo":"rally","a":11,"mejorDe":5}', '{"puntosA":3,"puntosB":0}'));

-- m2 (rally a 15). Se marca 15-0 y se prueban terminaciones tramposas.
SELECT arbitro_marcar(pg_temp.cod('t1', 'm2'), 0, pg_temp.j('A', pg_temp.rep(15, 'A')), pg_temp.m('{"tipo":"rally","a":15,"mejorDe":1}', pg_temp.j('A', pg_temp.rep(15, 'A'))));
SELECT pg_temp.ok('A3 terminar: resultado que no sale de las jugadas (13-5) → rechazo',
  arbitro_terminar(pg_temp.cod('t1', 'm2'), 1, pg_temp.j('A', pg_temp.rep(15, 'A')), NULL, '{"puntosA":13,"puntosB":5}')->>'ok' = 'false');
SELECT pg_temp.ok('A3 terminar: resultado legal pero distinto de lo marcado (15-3) → rechazo',
  arbitro_terminar(pg_temp.cod('t1', 'm2'), 1, pg_temp.j('A', pg_temp.rep(15, 'A')), NULL, '{"puntosA":15,"puntosB":3}')->>'ok' = 'false');
SELECT pg_temp.ok('A3 terminar: partido sin terminar según las jugadas → rechazo',
  arbitro_terminar(pg_temp.cod('t1', 'm2'), 1, pg_temp.j('A', pg_temp.rep(14, 'A')), NULL, '{"puntosA":15,"puntosB":0}')->>'error' = 'Según lo marcado el partido todavía no terminó.');
SELECT pg_temp.ok('A3 terminar: formato cambiado a uno inválido → rechazo',
  arbitro_terminar(pg_temp.cod('t1', 'm2'), 1, pg_temp.j('A', pg_temp.rep(9, 'A'), '{"tipo":"rally","a":9,"mejorDe":1}'), NULL, '{"puntosA":9,"puntosB":0}')->>'ok' = 'false');
SELECT pg_temp.ok('A3 terminar: el árbitro eligió mejor de 3 y manda un game suelto → rechazo',
  arbitro_terminar(pg_temp.cod('t1', 'm2'), 1, pg_temp.j('A', pg_temp.rep(11, 'A'), '{"tipo":"rally","a":11,"mejorDe":3}'), NULL, '{"puntosA":11,"puntosB":0}')->>'ok' = 'false');
SELECT pg_temp.ok('A3 terminar: un tercer game después del 2-0 → rechazo',
  arbitro_terminar(pg_temp.cod('t1', 'm3'), 0, pg_temp.j('A', pg_temp.rep(22, 'A') || pg_temp.rep(11, 'B')), NULL,
    '{"puntosA":2,"puntosB":1,"games":[{"a":11,"b":0},{"a":11,"b":0},{"a":0,"b":11}]}')->>'ok' = 'false');
SELECT pg_temp.ok('A3/A4 los rechazos con código válido no cuentan como intento al azar', (SELECT count(*) FROM arbitraje_intentos) = 0);

-- ------------------------------------------------------------------ A4: idempotencia y A8 cancha
UPDATE rk_en_cancha SET torneo_id = 't1', partido_id = 'm2' WHERE cancha = 'Cancha 1';
INSERT INTO rk_en_cancha (cancha, torneo_id, partido_id) VALUES ('Cancha 3', 'otro', 'm2');
SELECT pg_temp.ok('A4 terminar bien: ok con el resultado',
  (SELECT (r->>'ok')::boolean AND r->'resultado' = '{"puntosA":15,"puntosB":0}'
     FROM (SELECT arbitro_terminar(pg_temp.cod('t1', 'm2'), 1, pg_temp.j('A', pg_temp.rep(15, 'A')), pg_temp.m('{"tipo":"rally","a":15,"mejorDe":1}', pg_temp.j('A', pg_temp.rep(15, 'A'))), '{"puntosA":15,"puntosB":0}') r) s));
SELECT pg_temp.ok('A4 el resultado entró al cuadro con cargadoEl',
  (SELECT e->>'puntosA' = '15' AND e->>'puntosB' = '0' AND e ? 'cargadoEl' FROM (SELECT pg_temp.elem('t1', 'm2') e) s));
SELECT pg_temp.ok('A8 se libera la cancha de ESTE torneo y no la de otro con el mismo partido_id',
  (SELECT partido_id IS NULL FROM rk_en_cancha WHERE cancha = 'Cancha 1') AND (SELECT partido_id = 'm2' FROM rk_en_cancha WHERE cancha = 'Cancha 3'));
SELECT pg_temp.ok('A4 terminar otra vez (respuesta perdida): ok + mismo resultado, aunque la versión sea vieja',
  (SELECT (r->>'ok')::boolean AND (r->>'ya_cargado')::boolean AND r->'resultado' = '{"puntosA":15,"puntosB":0}'
     FROM (SELECT arbitro_terminar(pg_temp.cod('t1', 'm2'), 1, pg_temp.j('A', pg_temp.rep(15, 'A')), NULL, '{"puntosA":15,"puntosB":0}') r) s));
SELECT pg_temp.ok('A4 entrar con el código de un partido terminado: estado terminado + resultado',
  (SELECT (r->>'ok')::boolean AND r->>'estado' = 'terminado' AND r->>'motivo' = 'terminado' AND r->'resultado' = '{"puntosA":15,"puntosB":0}'
     FROM (SELECT arbitro_entrar(pg_temp.cod('t1', 'm2')) r) s));
SELECT pg_temp.ok('A4 web vieja: marcar sobre un partido terminado responde desfasado con las jugadas (deja de reintentar)',
  (SELECT r->>'error' = 'desfasado' AND r->>'estado' = 'terminado' AND jsonb_array_length(r->'jugadas') = 16
     FROM (SELECT arbitro_marcar(pg_temp.cod('t1', 'm2'), 1, pg_temp.j('A', 'A'), pg_temp.m('{"tipo":"rally","a":15,"mejorDe":1}', '[]')) r) s));
SELECT pg_temp.ok('A4 nada de eso cuenta como intento fallido', (SELECT count(*) FROM arbitraje_intentos) = 0);

-- ------------------------------------------------------------------ A5: resultado cargado a mano mientras se marca
SELECT arbitro_marcar(pg_temp.cod('t1', 'm6'), 0, pg_temp.j('B', 'AB'), pg_temp.m('{"tipo":"rally","a":21,"mejorDe":1}', pg_temp.j('B', 'AB')));
UPDATE rk_torneos SET data = jsonb_set(data, '{partidosGrupo,5}', (data->'partidosGrupo'->5) || '{"puntosA":21,"puntosB":10}') WHERE id = 't1';
SELECT pg_temp.ok('A5 marcar detecta el resultado cargado en la mesa: estado terminado, motivo cargado_en_mesa',
  (SELECT r->>'estado' = 'terminado' AND r->>'motivo' = 'cargado_en_mesa' AND r->'resultado' = '{"puntosA":21,"puntosB":10}'
     FROM (SELECT arbitro_marcar(pg_temp.cod('t1', 'm6'), 1, pg_temp.j('B', 'ABA'), pg_temp.m('{"tipo":"rally","a":21,"mejorDe":1}', pg_temp.j('B', 'ABA'))) r) s));
SELECT pg_temp.ok('A5 la fila queda cerrada (se acaba el EN VIVO)',
  (SELECT estado = 'terminado' AND cierre = 'mesa' FROM arbitraje_partidos WHERE torneo_id = 't1' AND partido_id = 'm6'));
SELECT pg_temp.ok('A5 terminar después: avisa que se cargó en la mesa y no pisa el resultado',
  (SELECT r->>'motivo' = 'cargado_en_mesa' AND NOT (r->>'ok')::boolean FROM (SELECT arbitro_terminar(pg_temp.cod('t1', 'm6'), 2, pg_temp.j('B', ''), NULL, '{}') r) s)
  AND pg_temp.elem('t1', 'm6')->>'puntosB' = '10');
SELECT pg_temp.ok('A5 entrar también lo informa', arbitro_entrar(pg_temp.cod('t1', 'm6'))->>'motivo' = 'cargado_en_mesa');

-- ------------------------------------------------------------------ A8: llave con rivales sin definir
SELECT pg_temp.ok('A8 entrar informa que el cruce todavía no tiene rivales (f depende de s2)', (arbitro_entrar(pg_temp.cod('t1', 'f'))->>'rivales')::boolean = false);
SELECT pg_temp.ok('A8 resolución de lugares: bye pasa, perdedor de un bye no existe',
  (arbitro_entrar(pg_temp.cod('t1', 'x2'))->>'rivales')::boolean AND NOT (arbitro_entrar(pg_temp.cod('t1', 'x3'))->>'rivales')::boolean);
SELECT pg_temp.ok('A8 entrar trae los nombres aunque el torneo no se pueda leer (cuadro), con el rival que falta en null',
  (SELECT r->'cuadro' = '{"fase":"llave","titulo":"Ronda 2","a":{"parejaId":"p1","nombre":"A y B"},"b":null}'
     FROM (SELECT arbitro_entrar(pg_temp.cod('t1', 'f')) r) s));
SELECT pg_temp.ok('cuadro de un partido de grupo y del lugar que viene de un bye',
  (SELECT r->'cuadro' = '{"fase":"grupo","titulo":"Grupo A · Ronda 2","a":{"parejaId":"p1","nombre":"A y B"},"b":{"parejaId":"p3","nombre":"E y F"}}'
     FROM (SELECT arbitro_entrar(pg_temp.cod('t1', 'm3')) r) s)
  AND (SELECT r->'cuadro'->'a'->>'parejaId' = 'p4' FROM (SELECT arbitro_entrar(pg_temp.cod('t1', 'x2')) r) s));
SELECT arbitro_marcar(pg_temp.cod('t1', 'f'), 0, pg_temp.j('A', pg_temp.rep(11, 'A')), pg_temp.m('{"tipo":"rally","a":11,"mejorDe":1}', pg_temp.j('A', pg_temp.rep(11, 'A'))));
SELECT pg_temp.ok('A8 terminar un cruce sin los dos rivales definidos → rechazo',
  arbitro_terminar(pg_temp.cod('t1', 'f'), 1, pg_temp.j('A', pg_temp.rep(11, 'A')), NULL, '{"puntosA":11,"puntosB":0}')->>'error' = 'Todavía no están definidos los dos rivales de este cruce.');
UPDATE rk_torneos SET data = jsonb_set(data, '{partidosLlave,1}', (data->'partidosLlave'->1) || '{"puntosA":11,"puntosB":7}') WHERE id = 't1';
SELECT arbitro_terminar(pg_temp.cod('t1', 'f'), 1, pg_temp.j('A', pg_temp.rep(11, 'A')), NULL, '{"puntosA":11,"puntosB":0}') AS r \gset
SELECT pg_temp.ok('A8 con s2 jugado, la final se puede cerrar', (:'r'::jsonb->>'ok')::boolean AND pg_temp.elem('t1', 'f')->>'puntosA' = '11');
SELECT pg_temp.ok('con s2 jugado, la final ya nombra a los dos (ganador de s1 y de s2)',
  (SELECT r->'cuadro'->'a'->>'parejaId' = 'p1' AND r->'cuadro'->'b'->>'parejaId' = 'p2' FROM (SELECT arbitro_entrar(pg_temp.cod('t1', 'f')) r) s));

-- ------------------------------------------------------------------ mejor de 3 completo
SELECT arbitro_marcar(pg_temp.cod('t1', 'm3'), 0, pg_temp.j('A', pg_temp.rep(11, 'A') || pg_temp.rep(11, 'B') || pg_temp.rep(10, 'A') || pg_temp.rep(10, 'B') || 'BB'),
  pg_temp.m('{"tipo":"rally","a":11,"mejorDe":3}', '[]'));
SELECT arbitro_terminar(pg_temp.cod('t1', 'm3'), 1, pg_temp.j('A', pg_temp.rep(11, 'A') || pg_temp.rep(11, 'B') || pg_temp.rep(10, 'A') || pg_temp.rep(10, 'B') || 'BB'), NULL,
     '{"puntosA":1,"puntosB":2,"games":[{"a":11,"b":0},{"a":0,"b":11},{"a":10,"b":12}]}') AS r \gset
SELECT pg_temp.ok('mejor de 3 a 11 que se va 10-12 en el tercero: entra 1-2 con el detalle',
  (:'r'::jsonb->>'ok')::boolean
  AND pg_temp.elem('t1', 'm3')->'games' = '[{"a":11,"b":0},{"a":0,"b":11},{"a":10,"b":12}]');

-- ------------------------------------------------------------------ A6: cuadro rearmado, huérfanos y bajas
SELECT pg_temp.origen('8.8.8.9');
SELECT pg_temp.ok('previo: m1 tiene código y está en juego', pg_temp.cod('t1', 'm1') IS NOT NULL);
CREATE TEMP TABLE viejo AS SELECT pg_temp.cod('t1', 'm1') AS m1, pg_temp.cod('t1', 's2') AS s2;
-- Se rearma el cuadro: m1 desaparece (los partidos nuevos tienen otro id).
UPDATE rk_torneos SET data = jsonb_set(data, '{partidosGrupo}', (SELECT jsonb_agg(x) FROM jsonb_array_elements(data->'partidosGrupo') x WHERE x->>'id' <> 'm1')) WHERE id = 't1';
SET pruebas.equipo = 'si';
SELECT pg_temp.ok('A6 admin con s2 ya jugado y m1 fuera del cuadro',
  (SELECT (r->>'ok')::boolean AND NOT (r->'codigos' @> '[{"partido_id":"m1"}]') AND NOT (r->'codigos' @> '[{"partido_id":"s2"}]')
     FROM (SELECT admin_codigos_torneo('t1', true, '[{"partido_id":"m2","formato":{"tipo":"rally","a":15,"mejorDe":1}},{"partido_id":"m6","formato":{"tipo":"rally","a":21,"mejorDe":1}},{"partido_id":"s2","formato":{"tipo":"rally","a":11,"mejorDe":1}}]') r) s));
RESET pruebas.equipo;
SELECT pg_temp.ok('A6 el código huérfano se dio de baja y su fila en juego se borró',
  pg_temp.cod('t1', 'm1') IS NULL AND EXISTS (SELECT 1 FROM arbitraje_codigos_baja WHERE codigo = (SELECT m1 FROM viejo))
  AND NOT EXISTS (SELECT 1 FROM arbitraje_partidos WHERE torneo_id = 't1' AND partido_id = 'm1'));
SELECT pg_temp.ok('A6 el código de s2 (cargado a mano, nunca empezado) se dio de baja', pg_temp.cod('t1', 's2') IS NULL);
SELECT pg_temp.ok('A6 un celular viejo que reintenta con el código dado de baja no cuenta como intento al azar',
  (arbitro_marcar((SELECT m1 FROM viejo), 1, '[]', '{}')->>'baja')::boolean AND (arbitro_entrar((SELECT m1 FROM viejo))->>'baja')::boolean
  AND (SELECT count(*) FROM arbitraje_intentos) = 0);
SELECT pg_temp.ok('A6 los códigos de otros torneos no se tocan', pg_temp.cod('t2', 'm1') IS NOT NULL);
-- Códigos viejos: terminados hace más de 2 días.
UPDATE arbitraje_partidos SET actualizado = now() - interval '3 days' WHERE torneo_id = 't1' AND partido_id = 'm2';
SET pruebas.equipo = 'si';
SELECT admin_codigos_torneo('t1', true, '[{"partido_id":"m2","formato":{"tipo":"rally","a":15,"mejorDe":1}}]');
RESET pruebas.equipo;
SELECT pg_temp.ok('A6 el código de un partido terminado hace más de 2 días se limpia', pg_temp.cod('t1', 'm2') IS NULL);

-- Renovar los de 4 cifras que no empezaron.
INSERT INTO arbitraje_partidos (torneo_id, partido_id, formato) VALUES ('t2', 'nuevo4', '{"tipo":"rally","a":11,"mejorDe":1}');
INSERT INTO arbitraje_codigos (codigo, torneo_id, partido_id) VALUES ('9876', 't2', 'nuevo4');
SET pruebas.equipo = 'si';
SELECT admin_codigos_renovar('t2') AS r \gset
SELECT pg_temp.ok('A2 renovar: cambia el código de 4 cifras sin usar por uno de 6',
  (:'r'::jsonb->>'renovados')::int = 1 AND pg_temp.cod('t2', 'nuevo4') ~ '^[0-9]{6}$');
RESET pruebas.equipo;

-- ------------------------------------------------------------------ permisos
SET ROLE anon;
SELECT pg_temp.ok('permisos: anon entra por RPC', arbitro_entrar('000000') ? 'ok');
DO $$ BEGIN
  BEGIN PERFORM admin_codigos_torneo('t1', true, '[]'); RAISE EXCEPTION 'anon pudo llamar admin_codigos_torneo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM _arbitraje_freno('x'); RAISE EXCEPTION 'anon pudo llamar una auxiliar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM arbitraje_codigos; RAISE EXCEPTION 'anon pudo leer los códigos';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.ok('permisos: anon no llama al gestor ni a las auxiliares ni lee códigos', true);
END $$;
RESET ROLE;

\echo 'TODAS LAS PRUEBAS DE ARBITRAJE PASARON'
