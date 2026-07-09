import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

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
