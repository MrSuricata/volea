-- Lo mínimo de Supabase que necesitan v35-v37 para probarse en un Postgres local descartable.
-- NO es el esquema real: solo roles, la publicación de Realtime, rk_torneos, rk_en_cancha y es_equipo().
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.rk_torneos (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rk_en_cancha (
  cancha text PRIMARY KEY,
  torneo_id text,
  partido_id text,
  habilitada boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rk_torneos, public.rk_en_cancha TO anon, authenticated;

-- En las pruebas, "ser del equipo" se simula con SET pruebas.equipo = 'si'.
CREATE OR REPLACE FUNCTION public.es_equipo() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('pruebas.equipo', true), '') = 'si'
$$;
