-- v28 — Fecha de cierre de inscripciones (2026-10-01)
--
-- Por qué: las inscripciones del aniversario de Pickleball City cierran el jueves 8/10 y el
-- torneo arranca el viernes 9. Hasta ahora un evento solo se cerraba a mano (interruptor del
-- admin) o solo cuando terminaba. events.inscripciones_cierre guarda el último día para
-- anotarse (inclusive, día de Uruguay); NULL = como antes, hasta que termine el evento.
--
-- La regla corre en dos lados: inscribir_evento rechaza el alta o el cambio después de esa
-- fecha, y la web deja de ofrecer el formulario (inscripcionAbierta() en utils/inscripciones.ts)
-- y avisa "Inscripciones hasta el jueves 8 de octubre". El upsert del admin no manda esta
-- columna, así que editar el evento desde el panel no la pisa: se setea por SQL, como la tarifa.
--
-- Aplicada en volea-web el 2026-10-01.

alter table public.events add column if not exists inscripciones_cierre date;
comment on column public.events.inscripciones_cierre is
  'Último día para inscribirse por la web (inclusive). NULL = hasta que termine el evento.';

CREATE OR REPLACE FUNCTION public.inscribir_evento(p_event_id text, p_nombre text, p_celular text, p_categorias text, p_email text DEFAULT ''::text, p_pareja text DEFAULT ''::text, p_dupr_id text DEFAULT ''::text, p_notas text DEFAULT ''::text, p_parejas jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_nombre text := btrim(COALESCE(p_nombre, ''));
  v_celular text := btrim(COALESCE(p_celular, ''));
  v_categorias text := btrim(COALESCE(p_categorias, ''));
  v_parejas jsonb := COALESCE(p_parejas, '{}'::jsonb);
  v_abierto boolean;
  v_ultimo_dia date;        -- v22: end_date, o date si el evento es de un día
  v_id uuid;
  v_nombre_actual text;     -- v22: nombre de la inscripción que ya tiene ese celular
  v_estado text;            -- v22
  v_pago_at timestamptz;    -- v22
  v_max int;                -- v27: tope de categorías por participante (events.tarifa.max)
  v_ncats int;              -- v27
  v_cierre date;            -- v28: último día para inscribirse (events.inscripciones_cierre)
BEGIN
  IF v_nombre = '' OR length(v_nombre) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Poné tu nombre completo');
  END IF;
  IF v_celular = '' OR length(v_celular) > 40
     OR length(regexp_replace(v_celular, '\D', '', 'g')) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Poné un celular válido');
  END IF;
  IF v_categorias = '' OR length(v_categorias) > 400 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Elegí al menos una categoría');
  END IF;
  IF length(COALESCE(p_email, '')) > 200 OR length(COALESCE(p_pareja, '')) > 200
     OR length(COALESCE(p_dupr_id, '')) > 40 OR length(COALESCE(p_notas, '')) > 600 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Alguno de los campos es demasiado largo');
  END IF;
  IF jsonb_typeof(v_parejas) <> 'object' OR length(v_parejas::text) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Parejas inválidas');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(v_parejas) AS kv(k, v)
    WHERE jsonb_typeof(kv.v) <> 'string' OR length(kv.k) > 120 OR length(kv.v #>> '{}') > 120
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Parejas inválidas');
  END IF;

  SELECT inscripciones_abiertas, COALESCE(end_date, date),
         CASE WHEN jsonb_typeof(tarifa -> 'max') = 'number' THEN (tarifa ->> 'max')::numeric::int END,
         inscripciones_cierre
    INTO v_abierto, v_ultimo_dia, v_max, v_cierre
    FROM events WHERE id = p_event_id;
  IF v_abierto IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El evento no existe');
  END IF;
  -- v22: el switch del admin Y la fecha.
  IF NOT v_abierto
     OR v_ultimo_dia < (now() AT TIME ZONE 'America/Montevideo')::date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Las inscripciones de este evento están cerradas');
  END IF;
  -- v28: fecha de cierre de inscripciones (inclusive), si el evento la define.
  IF v_cierre IS NOT NULL AND v_cierre < (now() AT TIME ZONE 'America/Montevideo')::date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Las inscripciones de este evento ya cerraron');
  END IF;

  -- v27: tope de categorías por participante, si el evento lo define en tarifa.max.
  IF v_max IS NOT NULL AND v_max > 0 THEN
    SELECT count(*) INTO v_ncats
      FROM unnest(string_to_array(v_categorias, ',')) AS c(x)
     WHERE btrim(c.x) <> '';
    IF v_ncats > v_max THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('Podés anotarte en hasta %s categorías por participante', v_max));
    END IF;
  END IF;

  -- v22: trae nombre/estado/pago y bloquea la fila, igual que admin_pago_inscripcion.
  SELECT id, nombre, estado, pago_at
    INTO v_id, v_nombre_actual, v_estado, v_pago_at
    FROM inscripciones
   WHERE event_id = p_event_id
     AND regexp_replace(celular, '\D', '', 'g') = regexp_replace(v_celular, '\D', '', 'g')
     AND estado <> 'baja'
   LIMIT 1
   FOR UPDATE;
  IF v_id IS NOT NULL THEN
    -- v22: el celular es de una inscripción a OTRO nombre → no se pisa.
    IF lower(translate(regexp_replace(btrim(v_nombre_actual), '\s+', ' ', 'g'),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))
       <> lower(translate(regexp_replace(v_nombre, '\s+', ' ', 'g'),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) THEN
      RETURN jsonb_build_object('ok', false, 'error',
        'Ese celular ya está inscripto a nombre de otra persona. Si querés anotar a alguien más usá su propio celular, o escribinos por WhatsApp.');
    END IF;
    -- v22: lo pago o confirmado lo cambia solo el equipo.
    IF v_pago_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error',
        'Tu inscripción ya está paga: para cambiarla escribinos por WhatsApp');
    END IF;
    IF v_estado = 'confirmada' THEN
      RETURN jsonb_build_object('ok', false, 'error',
        'Tu inscripción ya está confirmada: para cambiarla escribinos por WhatsApp');
    END IF;
    UPDATE inscripciones SET
      nombre = v_nombre,
      categorias = v_categorias,
      email = btrim(COALESCE(p_email, '')),
      pareja = btrim(COALESCE(p_pareja, '')),
      parejas = v_parejas,
      dupr_id = btrim(COALESCE(p_dupr_id, '')),
      notas = btrim(COALESCE(p_notas, ''))
    WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'actualizada', true);
  END IF;

  -- Mismo nombre, otro celular: NO crear otra fila.
  IF EXISTS (
    SELECT 1 FROM inscripciones
    WHERE event_id = p_event_id AND estado <> 'baja'
      AND lower(translate(regexp_replace(btrim(nombre), '\s+', ' ', 'g'),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))
        = lower(translate(regexp_replace(v_nombre, '\s+', ' ', 'g'),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Ya hay una inscripción a tu nombre. Escribinos por WhatsApp para modificarla o si sos otra persona con el mismo nombre.');
  END IF;

  INSERT INTO inscripciones (event_id, nombre, celular, email, categorias, pareja, parejas, dupr_id, notas)
  VALUES (p_event_id, v_nombre, v_celular, btrim(COALESCE(p_email, '')), v_categorias,
          btrim(COALESCE(p_pareja, '')), v_parejas, btrim(COALESCE(p_dupr_id, '')), btrim(COALESCE(p_notas, '')))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'actualizada', false);
END;
$function$;

-- Dato del aniversario de Pickleball City (referencia, no es esquema):
-- update public.events set inscripciones_cierre = '2026-10-08', time = '19:00'
--  where id = 'evt-aniversario-pbcity-2026';

-- Post-check
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'events' and column_name = 'inscripciones_cierre') then
    raise exception 'v28 post: falta events.inscripciones_cierre';
  end if;
  if position('v28' in pg_get_functiondef('public.inscribir_evento(text,text,text,text,text,text,text,text,jsonb)'::regprocedure)) = 0 then
    raise exception 'v28 post: inscribir_evento no controla la fecha de cierre';
  end if;
end $$;
