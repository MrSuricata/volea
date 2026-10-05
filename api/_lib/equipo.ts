// Quién del equipo está haciendo un pedido a una función serverless.
// El panel manda el token de su sesión de Supabase; acá se valida contra Supabase Auth y se
// pregunta a la base si esa persona es del equipo con la MISMA función que usan las políticas
// (es_equipo), así no hay una segunda lista de "quién es admin" que mantener.
import { createClient } from '@supabase/supabase-js';
import type { VercelRequest } from '@vercel/node';

const SUPABASE_URL = 'https://scftuxrtflfowohiewsc.supabase.co';
// La anon key es la pública (la misma que viaja en el JS del sitio y en api/og.ts).
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZnR1eHJ0Zmxmb3dvaGlld3NjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDgyMjAsImV4cCI6MjA5NTMyNDIyMH0.F9n9X_urG0O0Oo2vTI_S8LcRWR93girs1e4eZb8bWUI';

/** Mail de quien hace el pedido si es owner o admin; null si no hay sesión válida o no es del equipo. */
export async function equipoDe(req: VercelRequest): Promise<string | null> {
  const cabecera = req.headers.authorization;
  const token = /^Bearer (.+)$/.exec(Array.isArray(cabecera) ? cabecera[0] ?? '' : cabecera ?? '')?.[1];
  if (!token) return null;
  const sb = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await sb.auth.getUser(token);
  const email = data?.user?.email;
  if (error || !email) return null;
  const { data: esEquipo, error: errRol } = await sb.rpc('es_equipo');
  return !errRol && esEquipo === true ? email : null;
}
