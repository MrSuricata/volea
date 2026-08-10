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

// ── Rescate de tokens del magic link (HashRouter) ───────────────────────────
// GoTrue redirige a `${redirect_to}#access_token=...`. Como redirect_to ya
// contiene la ruta "#/admin", la URL final queda "#/admin#access_token=..."
// (doble numeral) y supabase-js NO encuentra los tokens: parsea todo el
// fragmento como una sola clave y los descarta, dejando al usuario en el
// formulario de login otra vez. Acá los extraemos a mano, limpiamos la URL
// (queda "#/admin") y más abajo creamos la sesión con setSession().
function rescueHashTokens(): { access_token: string; refresh_token: string } | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  const i = hash.indexOf('#access_token=');
  if (i <= 0) return null; // sin doble hash: lo maneja detectSessionInUrl
  const params = new URLSearchParams(hash.slice(i + 1));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  window.history.replaceState(null, '', window.location.pathname + window.location.search + hash.slice(0, i));
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

// Links vencidos o ya usados vuelven como "#/admin#error=...": limpiar la ruta
// para que el formulario de login quede utilizable.
function stripHashError(): void {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash;
  const i = hash.indexOf('#error');
  if (i > 0) {
    console.warn('Magic link rechazado por Supabase:', hash.slice(i + 1));
    window.history.replaceState(null, '', window.location.pathname + window.location.search + hash.slice(0, i));
  }
}

const _pendingMagicLink = rescueHashTokens();
stripHashError();

// ── Fetch con techo duro (aborta de verdad) ─────────────────────────────────
// PROPÓSITO: un fetch que nunca responde (socket zombie de la red/proxy) dentro
// del refresh de token de supabase-js deja tomado el navigator lock de auth
// PARA SIEMPRE: toda consulta posterior espera ese lock sin salir a la red y la
// app queda "pensando" hasta un F5 (recargar libera los locks). Visto el
// 2026-08-10 en la Caja: lock:sb-…-auth-token retenido y cero requests nuevas.
// Los techos de supabaseService resuelven la promesa de la UI pero no liberan
// el lock (el refresh corre por dentro de auth-js, fuera de nuestro alcance).
// Acá se corta el fetch en sí: auth cortito (suelta el lock rápido), storage
// largo (subidas de fotos pesadas), resto intermedio como red de seguridad.
function techoFetchMs(url: string): number {
  if (url.includes('/auth/v1/')) return 15_000;
  if (url.includes('/storage/v1/')) return 180_000;
  return 60_000;
}

const fetchConTecho: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout: Supabase no respondió', 'TimeoutError')), techoFetchMs(url));
  // Respetar la señal del que llama (los techos por consulta de supabaseService).
  const propia = init?.signal;
  if (propia) {
    if (propia.aborted) ctrl.abort(propia.reason);
    else propia.addEventListener('abort', () => ctrl.abort(propia.reason), { once: true });
  }
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
};

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: fetchConTecho } })
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
  // Sesión pendiente del magic link: crearla ANTES de que el resto de la app
  // toque Supabase (todo el arranque espera supabaseReady). getSession()
  // espera la inicialización interna del cliente, evitando la pelea por el
  // navigator lock que se da si setSession corre en paralelo con otras
  // llamadas en la primera carga.
  if (_pendingMagicLink) {
    try {
      await supabase.auth.getSession();
      const { error } = await supabase.auth.setSession(_pendingMagicLink);
      if (error) console.error('No se pudo crear la sesión desde el magic link:', error);
    } catch (e) {
      console.error('No se pudo crear la sesión desde el magic link:', e);
    }
  }
  // Chequeo con reintento: Supabase free "frío" puede tardar en la primera
  // respuesta. Un timeout corto de un solo intento daba falsos negativos que
  // mandaban la app a datos viejos y hacían que las escrituras no llegaran a
  // la nube. 2 intentos de 6s; cualquier respuesta HTTP (incluso 401/404)
  // significa DNS + servidor arriba.
  for (let intento = 0; intento < 2 && !_healthy; intento++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      // /auth/v1/health en vez de HEAD a /rest/v1/: aquel respondía 401 (esperado: la raíz
      // REST no es un endpoint público) y el navegador lo loguea como error en CADA carga,
      // ensuciando la consola de producción y tapando errores de verdad. Este devuelve 200
      // y no depende de que exista ninguna tabla. Sirve igual: lo que se mide es que el
      // DNS resuelva y el servidor conteste, no el contenido.
      const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
        headers: { apikey: supabaseAnonKey },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      _healthy = res.status >= 200 && res.status < 600;
    } catch {
      _healthy = false;
    }
  }
  _checked = true;
  return _healthy;
})();

export const isSupabaseConnected = (): boolean => _checked && _healthy && supabase !== null;
