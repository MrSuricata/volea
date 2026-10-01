-- v29 — Los avisos de Telegram también salen para lo que se carga desde el panel (2026-10-01)
--
-- Por qué: Brian reportó "no llegan los mensajes de Telegram con las inscripciones y pedidos;
-- por ejemplo Gastón se inscribió y no llegó". La cadena estaba sana (trigger habilitado,
-- pg_net 200, workflows publicados): la inscripción de Gastón se había cargado desde el panel
-- (POST /rest/v1/inscripciones con rol authenticated, 2026-10-01 17:23 UTC) y las v26/v27
-- avisaban SOLO lo que entraba por el formulario público (rol anon). Para el equipo "se anotó
-- alguien" es lo mismo venga de donde venga.
--
-- Qué cambia:
--   · inscripciones: avisa toda ALTA hecha con clave pública o con sesión del panel
--     (anon / authenticated). Los CAMBIOS siguen avisando solo si los hace el público: en el
--     panel el equipo edita estados, pagos y parejas todo el tiempo.
--   · orders: avisa todo pedido nuevo de la web o del panel (source whatsapp/web). Los del bot
--     de Telegram (source telegram) siguen sin avisar.
--   · El cuerpo suma `origen` ('web' | 'panel') y `cargo` (mail de la sesión que lo cargó); los
--     workflows de n8n lo muestran en el mensaje.
--   · Lo que se hace por SQL directo (sin JWT) no avisa: mantenimiento y pruebas no molestan.
--
-- Aplicada en volea-web el 2026-10-01. No toca secretos ni triggers: solo las dos funciones.

create or replace function public.inscripciones_avisar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_rol text;
  v_url text;
  v_secreto text;
  v_evento jsonb;
  v_total int;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_rol := coalesce(v_claims ->> 'role', '');
  -- v29: avisa TODA inscripción nueva, venga del formulario público (anon) o la cargue el
  -- equipo desde el panel (authenticated). Los cambios solo avisan si los hace el público:
  -- en el panel el equipo edita estados, pagos y parejas todo el tiempo.
  if tg_op = 'INSERT' then
    if v_rol not in ('anon', 'authenticated') then
      return new;
    end if;
  else
    if v_rol <> 'anon' then
      return new;
    end if;
    if new.nombre is not distinct from old.nombre
       and new.categorias is not distinct from old.categorias
       and new.parejas is not distinct from old.parejas
       and new.notas is not distinct from old.notas
       and new.email is not distinct from old.email
       and new.dupr_id is not distinct from old.dupr_id then
      return new;
    end if;
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
      'origen', case when v_rol = 'anon' then 'web' else 'panel' end,
      'cargo', v_claims ->> 'email',
      'inscripcion', to_jsonb(new), 'evento', v_evento, 'total', v_total),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-volea-secreto', v_secreto),
    timeout_milliseconds := 8000
  );
  return new;
exception when others then
  return new;
end;
$$;

create or replace function public.orders_avisar_pedido_web()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_rol text;
  v_url text;
  v_secreto text;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_rol := coalesce(v_claims ->> 'role', '');
  -- v29: avisa todo pedido nuevo, entre por el checkout de la web (anon) o lo cargue el
  -- equipo desde el panel (authenticated). Los del bot de Telegram (source telegram) no.
  if v_rol not in ('anon', 'authenticated') or coalesce(new.source, '') not in ('whatsapp', 'web') then
    return new;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'volea_aviso_pedido_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'volea_aviso_pedido_secreto';
  if v_url is null or v_secreto is null then
    return new;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'pedido', to_jsonb(new),
      -- El checkout de la web arma ids "VO-XXXX-XXXXXXXX"; el alta del panel, "VO-XXXX".
      'origen', case when v_rol = 'anon' or new.id ~ '^VO-[0-9A-Z]+-[0-9A-F]{8}$' then 'web' else 'panel' end,
      'cargo', v_claims ->> 'email'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-volea-secreto', v_secreto),
    timeout_milliseconds := 8000
  );
  return new;
exception when others then
  return new;
end;
$$;

-- Post-check
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('inscripciones_avisar', 'orders_avisar_pedido_web')
         and position('v29' in p.prosrc) > 0) <> 2 then
    raise exception 'v29 post: las funciones de aviso no quedaron en la v29';
  end if;
end $$;
