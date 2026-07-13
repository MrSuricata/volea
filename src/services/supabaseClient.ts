import { createClient } from '@supabase/supabase-js';

// Proyecto Supabase volea-web (scftuxrtflfowohiewsc), fijado en el código A
// PROPÓSITO: las env vars de Vercel apuntaban a un proyecto viejo y pausado
// (pbdcmdtlzblycyapdhqb) y dejaron producción desconectada durante semanas.
// La URL y la anon key NO son secretos (van embebidas en el JS del navegador
// por diseño; la seguridad la dan las políticas RLS). Si algún día se migra
// de proyecto, cambiar estas dos constantes.
const supabaseUrl = 'https://scftuxrtflfowohiewsc.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZnR1eHJ0Zmxmb3dvaGlld3NjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDgyMjAsImV4cCI6MjA5NTMyNDIyMH0.F9n9X_urG0O0Oo2vTI_S8LcRWR93girs1e4eZb8bWUI';

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Probe reachability once at startup so the rest of the app can fall back to
// localStorage silently when the project is missing or DNS fails.
let _healthy = false;
let _checked = false;

export const supabaseReady: Promise<boolean> = (async () => {
  if (!supabase) {
    _checked = true;
    return false;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: supabaseAnonKey },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    // Any HTTP response (even 401/404) means DNS resolved + server is up.
    // Network errors throw and land in the catch below.
    _healthy = res.status >= 200 && res.status < 600;
  } catch {
    _healthy = false;
  }
  _checked = true;
  return _healthy;
})();

export const isSupabaseConnected = (): boolean => _checked && _healthy && supabase !== null;
