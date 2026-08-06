// Cliente Supabase con service role para las funciones serverless.
// La URL va hardcodeada a propósito (mismo criterio que src/services/
// supabaseClient.ts tras el incidente de env vars de 2026-07-13); la service
// role key SÍ viene de env porque solo existe en el runtime de Vercel.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://scftuxrtflfowohiewsc.supabase.co';

export function clienteAdmin(serviceRoleKey: string) {
  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
