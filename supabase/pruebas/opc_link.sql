-- Pruebas de v39 (link de árbitros del One Point Challenge). Cada chequeo imprime "ok · ..."; el
-- primero que falla corta con ERROR. Corre sobre base_minima.sql + v39 en un Postgres local.
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
CREATE FUNCTION pg_temp.ok(nombre text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALLA · %', nombre; END IF;
  RAISE NOTICE 'ok · %', nombre;
END $$;

TRUNCATE rk_torneos, opc_claves;
INSERT INTO rk_torneos (id, data) VALUES
 ('opc', '{"id":"opc","formato":"individual","parejas":[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}],"opc":{"canchas":3},"partidosLlave":[
   {"id":"s1","ronda":1,"posicion":0,"a":{"tipo":"seed","parejaId":"a"},"b":{"tipo":"seed","parejaId":"b"},"puntosA":null,"puntosB":null,"esTercerPuesto":false},
   {"id":"s2","ronda":1,"posicion":1,"a":{"tipo":"seed","parejaId":"c"},"b":{"tipo":"seed","parejaId":"d"},"puntosA":null,"puntosB":null,"esTercerPuesto":false},
   {"id":"f","ronda":2,"posicion":0,"a":{"tipo":"ganadorDe","partidoId":"s1"},"b":{"tipo":"ganadorDe","partidoId":"s2"},"puntosA":null,"puntosB":null,"esTercerPuesto":false}]}'),
 ('otro', '{"id":"otro","formato":"individual","parejas":[],"partidosLlave":[]}'),
 ('grupos', '{"id":"grupos","formato":"grupos","parejas":[],"partidosLlave":[]}');

-- la llave de 'opc' con un cambio en el cruce i (0-based)
CREATE FUNCTION pg_temp.con(i int, cambio jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_set(data->'partidosLlave', ARRAY[i::text], (data->'partidosLlave'->i) || cambio) FROM rk_torneos WHERE id = 'opc' $$;
CREATE FUNCTION pg_temp.upd() RETURNS timestamptz LANGUAGE sql AS $$ SELECT updated_at FROM rk_torneos WHERE id = 'opc' $$;
CREATE FUNCTION pg_temp.clave() RETURNS text LANGUAGE sql AS $$ SELECT clave FROM opc_claves WHERE torneo_id = 'opc' $$;

-- ---- el organizador
SELECT pg_temp.ok('sin ser del equipo no se crea la clave', (admin_opc_clave('opc')->>'ok') = 'false');
SET pruebas.equipo = 'si';
SELECT pg_temp.ok('el equipo crea la clave (16 caracteres)', length(admin_opc_clave('opc')->>'clave') = 16);
SELECT pg_temp.ok('pedirla de nuevo devuelve la misma', admin_opc_clave('opc')->>'clave' = pg_temp.clave());
SELECT pg_temp.ok('no hay clave para un torneo que no es individual', admin_opc_clave('grupos')->>'error' = 'torneo');
SELECT pg_temp.ok('ni para uno que no existe', admin_opc_clave('nada')->>'error' = 'torneo');
RESET pruebas.equipo;

-- ---- el árbitro
SELECT pg_temp.ok('entrar con la clave dice el torneo', opc_arbitro_entrar(pg_temp.clave())->>'torneo_id' = 'opc');
SELECT pg_temp.ok('entrar con una clave inventada: no', opc_arbitro_entrar('0123456789abcdef')->>'error' = 'clave');
SELECT pg_temp.ok('entrar con clave vacía o nula: no', opc_arbitro_entrar('')->>'error' = 'clave' AND opc_arbitro_entrar(NULL)->>'error' = 'clave');

SELECT pg_temp.ok('guardar un toque (1-0)', (opc_arbitro_guardar(pg_temp.clave(), 'opc', pg_temp.upd(), pg_temp.con(0, '{"puntosA":1,"puntosB":0,"cargadoEl":"2026-11-21T15:00:00.000Z"}'))->>'ok') = 'true');
SELECT pg_temp.ok('quedó guardado y el resto del torneo intacto',
  (SELECT data->'partidosLlave'->0->>'puntosA' = '1' AND data->'opc' = '{"canchas":3}' AND jsonb_array_length(data->'parejas') = 4 FROM rk_torneos WHERE id = 'opc'));
SELECT pg_temp.ok('con un updated_at viejo: conflicto', opc_arbitro_guardar(pg_temp.clave(), 'opc', pg_temp.upd() - interval '1 second', pg_temp.con(1, '{"puntosA":0,"puntosB":1}'))->>'error' = 'conflicto');
SELECT pg_temp.ok('W.O. y deshacer (vuelve a null) se aceptan',
  (opc_arbitro_guardar(pg_temp.clave(), 'opc', pg_temp.upd(), pg_temp.con(1, '{"puntosA":0,"puntosB":1,"wo":true}'))->>'ok') = 'true'
  AND (opc_arbitro_guardar(pg_temp.clave(), 'opc', pg_temp.upd(), pg_temp.con(1, '{"puntosA":null,"puntosB":null,"wo":false}'))->>'ok') = 'true');

SELECT pg_temp.ok('clave equivocada: no guarda', opc_arbitro_guardar('0123456789abcdef', 'opc', pg_temp.upd(), pg_temp.con(1, '{"puntosA":1,"puntosB":0}'))->>'error' = 'clave');
SELECT pg_temp.ok('la clave de un torneo no sirve para otro', opc_arbitro_guardar(pg_temp.clave(), 'otro', (SELECT updated_at FROM rk_torneos WHERE id = 'otro'), '[]')->>'error' = 'clave');
SELECT pg_temp.ok('cambiar quién juega un cruce: inválido', opc_arbitro_guardar(pg_temp.clave(), 'opc', pg_temp.upd(), pg_temp.con(1, '{"a":{"tipo":"seed","parejaId":"a"}}'))->>'error' = 'invalido');
SELECT pg_temp.ok('agregar un campo a un cruce: inválido', opc_arbitro_guardar(pg_temp.clave(), 'opc', pg_temp.upd(), pg_temp.con(1, '{"games":[[11,2]]}'))->>'error' = 'invalido');
SELECT pg_temp.ok('sacar un cruce: inválido', opc_arbitro_guardar(pg_temp.clave(), 'opc', pg_temp.upd(), (SELECT (data->'partidosLlave') - 2 FROM rk_torneos WHERE id = 'opc'))->>'error' = 'invalido');
SELECT pg_temp.ok('un marcador que no es de un punto: inválido', opc_arbitro_guardar(pg_temp.clave(), 'opc', pg_temp.upd(), pg_temp.con(1, '{"puntosA":11,"puntosB":3}'))->>'error' = 'invalido');
SELECT pg_temp.ok('medio resultado: inválido', opc_arbitro_guardar(pg_temp.clave(), 'opc', pg_temp.upd(), pg_temp.con(1, '{"puntosA":1,"puntosB":null}'))->>'error' = 'invalido');
SELECT pg_temp.ok('algo que no es una lista: inválido', opc_arbitro_guardar(pg_temp.clave(), 'opc', pg_temp.upd(), '{"x":1}')->>'error' = 'invalido');
SELECT pg_temp.ok('después de los rechazos sigue el único resultado bueno',
  (SELECT count(*) = 1 FROM rk_torneos, jsonb_array_elements(data->'partidosLlave') e WHERE id = 'opc' AND e->>'puntosA' IS NOT NULL));

-- ---- permisos
SELECT pg_temp.ok('anon no lee la tabla de claves', NOT has_table_privilege('anon', 'public.opc_claves', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.opc_claves', 'SELECT'));
SELECT pg_temp.ok('anon puede entrar y guardar; no puede crear ni borrar claves',
  has_function_privilege('anon', 'public.opc_arbitro_entrar(text)', 'EXECUTE') AND has_function_privilege('anon', 'public.opc_arbitro_guardar(text, text, timestamptz, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_opc_clave(text, boolean)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.admin_opc_clave_borrar(text)', 'EXECUTE'));

-- ---- renovar y borrar
CREATE TEMP TABLE vieja AS SELECT pg_temp.clave() AS c;
SET pruebas.equipo = 'si';
SELECT pg_temp.ok('renovar da otra clave', admin_opc_clave('opc', true)->>'clave' <> (SELECT c FROM vieja));
RESET pruebas.equipo;
SELECT pg_temp.ok('la clave vieja ya no entra ni guarda',
  opc_arbitro_entrar((SELECT c FROM vieja))->>'error' = 'clave'
  AND opc_arbitro_guardar((SELECT c FROM vieja), 'opc', pg_temp.upd(), pg_temp.con(1, '{"puntosA":1,"puntosB":0}'))->>'error' = 'clave');
SELECT pg_temp.ok('sin ser del equipo no se borra', (admin_opc_clave_borrar('opc')->>'ok') = 'false' AND pg_temp.clave() IS NOT NULL);
SET pruebas.equipo = 'si';
CREATE TEMP TABLE nueva AS SELECT pg_temp.clave() AS c;
SELECT pg_temp.ok('borrar apaga los links', (admin_opc_clave_borrar('opc')->>'ok') = 'true' AND opc_arbitro_entrar((SELECT c FROM nueva))->>'error' = 'clave');
RESET pruebas.equipo;
DO $$ BEGIN RAISE NOTICE 'PASARON las pruebas de v39'; END $$;
