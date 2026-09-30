-- v26 — Aviso automático de cada pedido que entra por la web (2026-09-30)
--
-- Por qué: el único "aviso" de un pedido web era el WhatsApp que manda el propio
-- cliente al final del checkout. Si no toca Enviar (o el navegador de Instagram no
-- abre WhatsApp), el pedido queda en el panel y nadie se entera. Desde acá, cada
-- INSERT público en orders dispara un POST al webhook de n8n
-- "VOLEA · aviso pedido nuevo (web)" (workflow ROzfJpqWtm67Vw7J), que manda Telegram
-- a Brian y Gastón y un mail a somosvolea@gmail.com y bridvanovich@twf.uy.
--
-- Qué hace:
--   1. Habilita pg_net (HTTP asíncrono desde Postgres; la respuesta no bloquea el alta).
--   2. Guarda en Vault la URL del webhook y el secreto que n8n verifica en el header
--      x-volea-secreto. Los valores reales NO están en este archivo ni en ninguna
--      tabla pública: viven en Vault (Supabase → Integrations → Vault) y en el IF del
--      workflow de n8n. Para rotarlos: vault.update_secret + el IF del workflow.
--   3. Trigger AFTER INSERT en orders: solo avisa si el alta viene con la clave pública
--      (rol anon del JWT = checkout de la web) y con source whatsapp/web. Los pedidos
--      que carga el equipo desde el panel (authenticated) y los del bot de Telegram
--      (source telegram, alta por RPC) no avisan: los crean ellos mismos.
--   4. Cualquier error del aviso se traga: un aviso caído nunca voltea un pedido.
--
-- Aplicada en volea-web el 2026-09-30. Idempotente salvo los dos secretos de Vault,
-- que se crean una sola vez (reemplazar <URL_WEBHOOK> y <SECRETO> si hay que
-- recrearlos).

create extension if not exists pg_net;

-- Solo la primera vez (los valores reales no se guardan en el repo):
-- select vault.create_secret('<URL_WEBHOOK>', 'volea_aviso_pedido_url',
--   'URL del webhook de n8n que avisa cada pedido web de VOLEA');
-- select vault.create_secret('<SECRETO>', 'volea_aviso_pedido_secreto',
--   'Secreto que el workflow de n8n verifica en el header x-volea-secreto');

create or replace function public.orders_avisar_pedido_web()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol text;
  v_url text;
  v_secreto text;
begin
  v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  if v_rol <> 'anon' or coalesce(new.source, '') not in ('whatsapp', 'web') then
    return new;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'volea_aviso_pedido_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'volea_aviso_pedido_secreto';
  if v_url is null or v_secreto is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('pedido', to_jsonb(new)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-volea-secreto', v_secreto),
    timeout_milliseconds := 8000
  );
  return new;
exception when others then
  -- Un aviso caído nunca puede voltear el alta del pedido.
  return new;
end;
$$;

drop trigger if exists orders_avisar_pedido_web_insert on public.orders;
create trigger orders_avisar_pedido_web_insert
  after insert on public.orders
  for each row execute function public.orders_avisar_pedido_web();

-- Post-check
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'v26 post: falta pg_net';
  end if;
  if (select count(*) from vault.secrets where name in ('volea_aviso_pedido_url', 'volea_aviso_pedido_secreto')) <> 2 then
    raise exception 'v26 post: faltan los secretos en Vault';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.orders'::regclass and tgname = 'orders_avisar_pedido_web_insert') then
    raise exception 'v26 post: falta el trigger orders_avisar_pedido_web_insert';
  end if;
end $$;
