-- v31 — Base de la integración con DUPR como partner (2026-10-05)
--
-- Por qué: Brian pidió conectar la web a DUPR. La vía oficial es el Partner API
-- (https://dupr.gitbook.io/dupr-raas): el jugador conecta su cuenta con "Login with DUPR",
-- DUPR avisa cada cambio de rating a un webhook nuestro y los partidos se suben, corrigen y
-- borran desde la web. Guía de puesta en marcha: docs/DUPR.md.
--
-- Todo es ADITIVO: tablas y funciones nuevas, dos columnas nuevas con valor por defecto. No
-- toca inscribir_evento ni nada de lo que usa hoy la web (eso va en la v32, que se aplica
-- recién al salir a producción con DUPR). Sin claves cargadas en Vercel nada de esto se usa.
--
-- `entorno` ('uat' | 'prod') separa las pruebas en el ambiente de DUPR del uso real: lo de
-- 'uat' nunca toca el padrón (rk_jugadores).
--
-- Aplicada en volea-web el 2026-10-05.

-- ── Cuentas DUPR conectadas ──────────────────────────────────────────────────
create table if not exists public.dupr_conexiones (
  entorno text not null check (entorno in ('uat', 'prod')),
  dupr_id text not null,
  nombre text,                    -- como lo compartió el jugador (completo o parcial)
  genero text,
  anio_nacimiento integer,
  ubicacion text,
  rating_singles numeric(5, 3),
  rating_dobles numeric(5, 3),
  fiabilidad_singles numeric,
  fiabilidad_dobles numeric,
  rating_at timestamptz,
  habilitado boolean,             -- tiene BASIC_L1: puede jugar partidos que suben a DUPR
  premium boolean,                -- tiene PREMIUM_L1 (DUPR+)
  entitlements jsonb,
  entitlements_at timestamptz,
  suscripto boolean not null default false,  -- anotado al aviso de cambios de rating
  admin_email text,               -- cuenta DUPR de alguien del equipo (la que sube partidos del club)
  conectado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  primary key (entorno, dupr_id)
);

-- Los tokens de cada cuenta van aparte y sin ninguna política: solo los lee el servidor.
create table if not exists public.dupr_tokens (
  entorno text not null,
  dupr_id text not null,
  access_token text not null,
  refresh_token text,
  actualizado_at timestamptz not null default now(),
  primary key (entorno, dupr_id),
  foreign key (entorno, dupr_id) references public.dupr_conexiones (entorno, dupr_id) on delete cascade
);

-- Comprobante de "esta persona acaba de conectar esta cuenta DUPR": lo devuelve el servidor al
-- conectar y la inscripción lo canjea. Así el DUPR ID nunca sale de lo que escribe el navegador.
create table if not exists public.dupr_tickets (
  ticket uuid primary key default gen_random_uuid(),
  entorno text not null,
  dupr_id text not null,
  creado_at timestamptz not null default now(),
  vence_at timestamptz not null default now() + interval '6 hours',
  usado_at timestamptz,
  inscripcion_id uuid
);

-- Un renglón por partido de un cuadro que se mandó a DUPR.
create table if not exists public.dupr_partidos (
  entorno text not null,
  torneo_id text not null,
  partido_id text not null,
  intento integer not null default 1,   -- DUPR no deja reutilizar un identifier ni después de borrar
  identifier text not null unique,
  match_code text,
  hashed_match_code text,
  huella text not null,                 -- hash de lo enviado: si el partido cambia, hay que actualizarlo
  payload jsonb not null,
  estado text not null check (estado in ('subido', 'borrado', 'error')),
  error text,
  subido_at timestamptz,
  actualizado_at timestamptz not null default now(),
  por text,
  primary key (entorno, torneo_id, partido_id)
);

-- Bitácora de los avisos que manda DUPR (para diagnosticar; no la lee la web pública).
create table if not exists public.dupr_eventos (
  id bigint generated always as identity primary key,
  entorno text not null,
  evento text not null,
  dupr_id text,
  cuerpo jsonb not null,
  recibido_at timestamptz not null default now()
);
create index if not exists dupr_eventos_recibido_idx on public.dupr_eventos (recibido_at desc);

alter table public.dupr_conexiones enable row level security;
alter table public.dupr_tokens enable row level security;
alter table public.dupr_tickets enable row level security;
alter table public.dupr_partidos enable row level security;
alter table public.dupr_eventos enable row level security;

-- El equipo lee conexiones, partidos subidos y avisos desde el panel. Escribe solo el servidor
-- (service role) y las funciones de abajo. Tokens y tickets: nadie, ni el equipo.
drop policy if exists "dupr conexiones lee equipo" on public.dupr_conexiones;
create policy "dupr conexiones lee equipo" on public.dupr_conexiones for select using (public.es_equipo());
drop policy if exists "dupr partidos lee equipo" on public.dupr_partidos;
create policy "dupr partidos lee equipo" on public.dupr_partidos for select using (public.es_equipo());
drop policy if exists "dupr eventos lee equipo" on public.dupr_eventos;
create policy "dupr eventos lee equipo" on public.dupr_eventos for select using (public.es_equipo());

revoke all on public.dupr_tokens, public.dupr_tickets from anon, authenticated;

-- ── Inscripciones y eventos ──────────────────────────────────────────────────
-- dupr_conectado: el DUPR ID comprobado con el login de DUPR (dupr_id sigue siendo lo que la
-- persona escribió a mano en el formulario de antes).
alter table public.inscripciones
  add column if not exists dupr_conectado text,
  add column if not exists dupr_conectado_at timestamptz;

-- Evento solo para DUPR+ (requisito de DUPR: la plataforma tiene que ofrecer la opción).
alter table public.events
  add column if not exists dupr_premium boolean not null default false;

-- ── Funciones ────────────────────────────────────────────────────────────────

-- Nombre comparable: sin tildes, en minúscula y con un solo espacio (lo mismo que hace inscribir_evento).
create or replace function public.dupr_nombre_comparable(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.lower(pg_catalog.translate(
    pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p, '')), '\s+', ' ', 'g'),
    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
$$;

-- Guarda el rating que avisó DUPR. En producción lo copia también al padrón, a los jugadores
-- que tienen ese DUPR ID: así los topes por categoría usan siempre el rating del día.
create or replace function public.dupr_aplicar_rating(
  p_entorno text, p_dupr_id text, p_singles numeric, p_dobles numeric,
  p_fiabilidad_singles numeric default null, p_fiabilidad_dobles numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conexiones integer := 0;
  v_padron integer := 0;
begin
  -- Un aviso sin rating (jugador que todavía no tiene, o un cuerpo incompleto) no borra el
  -- último rating conocido.
  update public.dupr_conexiones set
    rating_singles = coalesce(p_singles, rating_singles),
    rating_dobles = coalesce(p_dobles, rating_dobles),
    fiabilidad_singles = coalesce(p_fiabilidad_singles, fiabilidad_singles),
    fiabilidad_dobles = coalesce(p_fiabilidad_dobles, fiabilidad_dobles),
    rating_at = case when p_singles is not null or p_dobles is not null then pg_catalog.now() else rating_at end,
    actualizado_at = pg_catalog.now()
  where entorno = p_entorno and dupr_id = p_dupr_id;
  get diagnostics v_conexiones = row_count;

  -- El padrón solo guarda ratings de 1 a 8 (CHECK): lo que no entra ahí no se copia.
  if p_entorno = 'prod' and v_conexiones > 0 then
    update public.rk_jugadores set
      dupr_rating = case when p_dobles between 1 and 8 then p_dobles else dupr_rating end,
      dupr_rating_singles = case when p_singles between 1 and 8 then p_singles else dupr_rating_singles end,
      dupr_rating_at = case when p_dobles between 1 and 8 or p_singles between 1 and 8
        then (pg_catalog.now() at time zone 'America/Montevideo')::date else dupr_rating_at end,
      updated_at = pg_catalog.now()
    where dupr_id = p_dupr_id;
    get diagnostics v_padron = row_count;
  end if;

  return pg_catalog.jsonb_build_object('conexiones', v_conexiones, 'padron', v_padron);
end;
$$;

-- Asocia una inscripción recién hecha con la cuenta DUPR que la persona conectó. La llama el
-- formulario público con el id que devolvió inscribir_evento y el ticket que devolvió el
-- servidor al conectar. En producción también anota el DUPR ID en el padrón, pero solo si:
--   · el nombre de pila de la cuenta DUPR coincide con el de la inscripción (que alguien se
--     anote con el nombre de otro y conecte SU cuenta no le cambia el DUPR a ese otro), y
--   · en el padrón hay UNA sola persona con ese nombre, sin DUPR ID o con el mismo.
-- No le cuenta al que llama qué encontró en el padrón.
create or replace function public.inscripcion_conectar_dupr(p_inscripcion_id uuid, p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.dupr_tickets%rowtype;
  c public.dupr_conexiones%rowtype;
  v_nombre text;
  v_coinciden integer;
  v_jugador text;
  v_dupr_actual text;
begin
  select * into t from public.dupr_tickets where ticket = p_ticket for update;
  if not found or t.vence_at < pg_catalog.now() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'La conexión con DUPR venció: conectá tu cuenta de nuevo');
  end if;
  if t.usado_at is not null and t.inscripcion_id is distinct from p_inscripcion_id then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'Esa conexión con DUPR ya se usó en otra inscripción');
  end if;

  update public.inscripciones set
    dupr_conectado = t.dupr_id,
    dupr_conectado_at = pg_catalog.now(),
    dupr_id = t.dupr_id
  where id = p_inscripcion_id and estado <> 'baja'
  returning nombre into v_nombre;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'No encontramos la inscripción');
  end if;

  update public.dupr_tickets set usado_at = pg_catalog.now(), inscripcion_id = p_inscripcion_id where ticket = p_ticket;

  if t.entorno = 'prod' then
    select * into c from public.dupr_conexiones where entorno = t.entorno and dupr_id = t.dupr_id;
    if c.nombre is not null
       and pg_catalog.split_part(public.dupr_nombre_comparable(c.nombre), ' ', 1) = pg_catalog.split_part(public.dupr_nombre_comparable(v_nombre), ' ', 1) then
      select pg_catalog.count(*), pg_catalog.min(j.id), pg_catalog.min(j.dupr_id)
        into v_coinciden, v_jugador, v_dupr_actual
        from public.rk_jugadores j
       where public.dupr_nombre_comparable(j.nombre) = public.dupr_nombre_comparable(v_nombre)
          or exists (
            select 1 from pg_catalog.jsonb_array_elements_text(
              case when pg_catalog.jsonb_typeof(j.alias) = 'array' then j.alias else '[]'::jsonb end) a(alias)
            where public.dupr_nombre_comparable(a.alias) = public.dupr_nombre_comparable(v_nombre));
      if v_coinciden = 1 and (coalesce(v_dupr_actual, '') = '' or v_dupr_actual = t.dupr_id) then
        update public.rk_jugadores set
          dupr_id = t.dupr_id,
          dupr_rating = case when c.rating_dobles between 1 and 8 then c.rating_dobles else dupr_rating end,
          dupr_rating_singles = case when c.rating_singles between 1 and 8 then c.rating_singles else dupr_rating_singles end,
          dupr_rating_at = case when c.rating_dobles between 1 and 8 or c.rating_singles between 1 and 8
            then (pg_catalog.now() at time zone 'America/Montevideo')::date else dupr_rating_at end,
          updated_at = pg_catalog.now()
        where id = v_jugador;
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_build_object('ok', true, 'dupr_id', t.dupr_id);
end;
$$;

revoke all on function public.dupr_aplicar_rating(text, text, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.dupr_aplicar_rating(text, text, numeric, numeric, numeric, numeric) to service_role;
revoke all on function public.inscripcion_conectar_dupr(uuid, uuid) from public;
grant execute on function public.inscripcion_conectar_dupr(uuid, uuid) to anon, authenticated, service_role;
