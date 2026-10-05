-- v30 — Ajustes de la programación en vivo, guardados desde la pantalla (2026-10-05)
--
-- Por qué: para el Aniversario Pickleball City (9 y 10 de octubre) Brian pidió poder organizar
-- los horarios él mismo: cuánto dura un partido, a qué hora arranca cada día, en qué orden
-- entran las categorías. Hasta el Racket Roll eso estaba escrito en el código de
-- /programacion y cada cambio era un deploy.
--
-- Qué agrega:
--   · Tabla rk_programa: una fila por evento (clave = la del programa en
--     src/torneos/publico/programa.ts) con los ajustes en `config`. Lo que no esté ajustado
--     sale del programa escrito en el código.
--   · Lectura pública (la pantalla En vivo es pública y va en la TV del club), escritura solo
--     del equipo: las mismas reglas que rk_en_cancha.
--   · Entra en la publicación de Realtime para que un cambio de horario se vea al instante en
--     todos los dispositivos.
--
-- Aplicada en volea-web el 2026-10-05.

create table if not exists public.rk_programa (
  clave text primary key,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.rk_programa enable row level security;

drop policy if exists "programa lectura publica" on public.rk_programa;
create policy "programa lectura publica" on public.rk_programa
  for select using (true);

drop policy if exists "programa escribe equipo" on public.rk_programa;
create policy "programa escribe equipo" on public.rk_programa
  for all using (public.es_equipo()) with check (public.es_equipo());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rk_programa'
  ) then
    alter publication supabase_realtime add table public.rk_programa;
  end if;
end $$;
