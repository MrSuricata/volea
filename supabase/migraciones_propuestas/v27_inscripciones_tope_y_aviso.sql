-- v27 — Inscripciones: tope de categorías por participante y aviso por Telegram (2026-10-01)
--
-- Por qué:
--   · El aniversario de Pickleball City cobra $900 las primeras 2 categorías, $300 cada
--     adicional, con un máximo de 4 categorías por participante. La tarifa ya vivía en
--     events.tarifa ({base, incluye, extra}); se le suma `max` (opcional) y
--     inscribir_evento lo hace cumplir en el server (el form público también lo respeta).
--   · Brian pidió enterarse por Telegram de cada inscripción, igual que con los pedidos
--     (v26): trigger en inscripciones → pg_net → webhook de n8n
--     "VOLEA · aviso inscripción (web)" (workflow n4jhrCxuF7YbqDV9) → Telegram a Brian y
--     Gastón. Solo avisa lo que viene del formulario público (rol anon del JWT): altas, y
--     modificaciones que cambien algo. Lo que hace el equipo desde el panel no avisa.
--
-- Aplicada en volea-web el 2026-10-01. Los dos secretos de Vault (URL del webhook y
-- secreto del header x-volea-secreto) NO están en este archivo: viven en Vault y en el IF
-- del workflow. Para recrearlos, reemplazar <URL_WEBHOOK> y <SECRETO>.

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
         CASE WHEN jsonb_typeof(tarifa -> 'max') = 'number' THEN (tarifa ->> 'max')::numeric::int END
    INTO v_abierto, v_ultimo_dia, v_max
    FROM events WHERE id = p_event_id;
  IF v_abierto IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El evento no existe');
  END IF;
  -- v22: el switch del admin Y la fecha.
  IF NOT v_abierto
     OR v_ultimo_dia < (now() AT TIME ZONE 'America/Montevideo')::date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Las inscripciones de este evento están cerradas');
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

-- Solo la primera vez (los valores reales no se guardan en el repo):
-- select vault.create_secret('<URL_WEBHOOK>', 'volea_aviso_inscripcion_url',
--   'URL del webhook de n8n que avisa cada inscripción web de VOLEA');
-- select vault.create_secret('<SECRETO>', 'volea_aviso_inscripcion_secreto',
--   'Secreto que el workflow de inscripciones verifica en el header x-volea-secreto');

create or replace function public.inscripciones_avisar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol text;
  v_url text;
  v_secreto text;
  v_evento jsonb;
  v_total int;
begin
  -- Solo lo que entra por el formulario público (inscribir_evento con la clave anon).
  v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  if v_rol <> 'anon' then
    return new;
  end if;
  -- Reenvío del mismo formulario sin cambios: no molesta.
  if tg_op = 'UPDATE'
     and new.nombre is not distinct from old.nombre
     and new.categorias is not distinct from old.categorias
     and new.parejas is not distinct from old.parejas
     and new.notas is not distinct from old.notas
     and new.email is not distinct from old.email
     and new.dupr_id is not distinct from old.dupr_id then
    return new;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'volea_aviso_inscripcion_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'volea_aviso_inscripcion_secreto';
  if v_url is null or v_secreto is null then
    return new;
  end if;
  select jsonb_build_object('id', e.id, 'name', e.name, 'tarifa', e.tarifa) into v_evento
    from public.events e where e.id = new.event_id;
  select count(*) into v_total from public.inscripciones i where i.event_id = new.event_id and i.estado <> 'baja';
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'tipo', case when tg_op = 'INSERT' then 'nueva' else 'actualizada' end,
      'inscripcion', to_jsonb(new), 'evento', v_evento, 'total', v_total),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-volea-secreto', v_secreto),
    timeout_milliseconds := 8000
  );
  return new;
exception when others then
  -- Un aviso caído nunca puede voltear una inscripción.
  return new;
end;
$$;

drop trigger if exists inscripciones_avisar_cambio on public.inscripciones;
create trigger inscripciones_avisar_cambio
  after insert or update on public.inscripciones
  for each row execute function public.inscripciones_avisar();

-- Tarifa del aniversario de Pickleball City (dato, no esquema; queda acá como referencia):
-- update public.events set tarifa = '{"base": 900, "incluye": 2, "extra": 300, "max": 4}'::jsonb
--  where id = 'evt-aniversario-pbcity-2026';

-- Post-check
do $$
begin
  if (select count(*) from vault.secrets where name in ('volea_aviso_inscripcion_url', 'volea_aviso_inscripcion_secreto')) <> 2 then
    raise exception 'v27 post: faltan los secretos en Vault';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.inscripciones'::regclass and tgname = 'inscripciones_avisar_cambio') then
    raise exception 'v27 post: falta el trigger inscripciones_avisar_cambio';
  end if;
  if position('v27' in pg_get_functiondef('public.inscribir_evento(text,text,text,text,text,text,text,text,jsonb)'::regprocedure)) = 0 then
    raise exception 'v27 post: inscribir_evento no tiene el tope de categorías';
  end if;
end $$;
