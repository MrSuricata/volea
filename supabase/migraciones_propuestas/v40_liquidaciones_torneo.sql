-- v40 · Liquidaciones de campeonatos (Admin › Torneos › Liquidaciones).
-- Un documento por campeonato: el acuerdo con el club, los inscriptos y los gastos asociados.
-- Es plata: solo la ve y la toca el equipo (es_equipo(), no is_admin()).
-- Se puede pegar más de una vez.

CREATE TABLE IF NOT EXISTS public.liquidaciones_torneo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  event_id text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  cerrada boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.liquidaciones_torneo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS liquidaciones_torneo_equipo ON public.liquidaciones_torneo;
CREATE POLICY liquidaciones_torneo_equipo ON public.liquidaciones_torneo
  FOR ALL USING (es_equipo()) WITH CHECK (es_equipo());

REVOKE ALL ON public.liquidaciones_torneo FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.liquidaciones_torneo TO authenticated;
