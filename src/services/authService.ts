import { supabase, isSupabaseConnected } from './supabaseClient';
import { conLimite } from '../utils/arranque';
import { tokenVencido } from '../utils/sesion';

export interface AdminUser {
  email: string;
  name: string | null;
  role: 'owner' | 'admin';
}

/**
 * Send a magic link to the user's email. Only emails present in the `admins`
 * table will be able to access /admin after authentication (RLS enforces this).
 */
// Mismo techo que el login con contraseña: este es justamente el camino de RESCATE
// cuando aquel anda mal — dejarlo sin límite era conservar el spinner infinito acá.
export function sendMagicLink(email: string): Promise<{ success: boolean; error?: string }> {
  return conLimite(sendMagicLinkInterno(email), LOGIN_TIMEOUT_MS, LOGIN_TARDO);
}

async function sendMagicLinkInterno(email: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase || !isSupabaseConnected()) {
    return { success: false, error: 'Servicio de autenticación no disponible' };
  }
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) {
    return { success: false, error: 'Email inválido' };
  }

  // Pre-check: is this email in the admins allowlist?
  // RPC booleana (la tabla admins ya no es legible públicamente)
  const { data: isAllowed, error: lookupErr } = await supabase
    .rpc('is_admin_email', { p_email: trimmed });

  if (lookupErr) {
    return { success: false, error: 'Error al validar el email' };
  }
  if (!isAllowed) {
    return { success: false, error: 'Este email no tiene acceso al panel' };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: `${window.location.origin}/#/admin`,
      shouldCreateUser: true,
    },
  });
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Sign in with email + password (Supabase Auth). Same allowlist as the magic
 * link: only emails present in `admins` can get in.
 */
// Techo del login: son 3 idas al servidor (chequeo de conexión + allowlist + credenciales)
// y ninguna tenía límite — con la red trabada el botón quedaba en "cargando" infinito.
// 15s cubre de sobra un servidor lento de verdad; pasado eso, mensaje claro y reintentar.
const LOGIN_TIMEOUT_MS = 15000;
const LOGIN_TARDO = { success: false, error: 'El servidor está tardando en responder. Esperá unos segundos y probá de nuevo.' };

export function signInWithPassword(email: string, password: string): Promise<{ success: boolean; error?: string }> {
  return conLimite(signInConPasswordInterno(email, password), LOGIN_TIMEOUT_MS, LOGIN_TARDO);
}

async function signInConPasswordInterno(email: string, password: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase || !isSupabaseConnected()) {
    return { success: false, error: 'Servicio de autenticación no disponible' };
  }
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) {
    return { success: false, error: 'Email inválido' };
  }
  if (!password) {
    return { success: false, error: 'Ingresá la contraseña' };
  }

  const { data: isAllowed, error: lookupErr } = await supabase
    .rpc('is_admin_email', { p_email: trimmed });
  if (lookupErr) {
    return { success: false, error: 'Error al validar el email' };
  }
  if (!isAllowed) {
    return { success: false, error: 'Este email no tiene acceso al panel' };
  }

  const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
  if (error) {
    const msg = /invalid login credentials/i.test(error.message)
      ? 'Contraseña incorrecta'
      : error.message;
    return { success: false, error: msg };
  }
  return { success: true };
}

/**
 * Sign out the current user.
 */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * Returns the AdminUser if the current Supabase session belongs to an admin,
 * null otherwise.
 */
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  if (!supabase || !isSupabaseConnected()) return null;
  // getSession() NO es una lectura local: si al token le quedan menos de 90s dispara
  // el POST de refresh y puede quedarse esperando el candado de auth. Era la única
  // ruta de red del proyecto sin techo, y su rechazo subía sin catch hasta el
  // arranque de App.tsx. Peor caso ahora: se resuelve como "no admin" y se muestra
  // el login, en vez de dejar la pantalla colgada.
  const res = await conLimite(supabase.auth.getSession().catch(() => null), 8000, null);
  const email = res?.data?.session?.user?.email?.toLowerCase();
  if (!email) return null;

  const { data, error } = await supabase
    .from('admins')
    .select('email, name, role')
    .eq('email', email)
    .maybeSingle();

  if (error || !data) return null;
  return data as AdminUser;
}

/**
 * True si hay una sesión guardada pero su access token ya venció (el refresh
 * puede estar colgado por la conexión trabada: en ese estado NO llega ningún
 * evento SIGNED_OUT y la UI sigue mostrando el panel como si nada).
 * getSession() lee de memoria/storage: no cuelga aunque la red esté trabada.
 * OJO: llamar solo desde acciones admin (pre-checks de guardado o caminos de
 * error) — en el sitio público "no hay sesión" es lo normal y daría true sin
 * sentido.
 */
export async function sesionAdminVencida(): Promise<boolean> {
  if (!supabase) return false;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return true; // había panel admin visible pero no hay sesión: vencida/limpiada
  return tokenVencido(session.expires_at, Date.now());
}

/**
 * Subscribe to auth state changes. Returns an unsubscribe function.
 */
export function onAuthStateChange(cb: (admin: AdminUser | null) => void): () => void {
  if (!supabase) return () => {};
  let vivo = true;
  let generacion = 0;
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    // ⚠ NUNCA hacer await ni llamar a supabase DENTRO de este callback.
    // BLOQUEO MUTUO (causa raíz del "se traba la primera vez del día", 2026-08-12):
    // auth-js ejecuta este callback ADENTRO de su inicialización
    // (_recoverAndRefresh → _notifyAllSubscribers, que lo espera con Promise.all,
    // todo dentro de _initialize), y getCurrentAdmin() → getSession() arranca con
    // `await initializePromise`, que solo resuelve cuando este callback termina.
    // Cada uno espera al otro: se traba PARA SIEMPRE, no es un timeout. Y como cada
    // from()/rpc() pide el token con getSession(), el cliente entero queda muerto y
    // NINGUNA consulta sale a la red — por eso el login moría en su techo de 15s sin
    // que el pedido llegara nunca al servidor. Reintentar no servía: lo único que
    // destrababa era el F5.
    // Solo pasa en la PRIMERA carga del día: auth-js refresca el token únicamente si
    // vence dentro de los próximos 90s, y después de recargar ya quedó fresco.
    // El setTimeout devuelve el control a auth-js en el acto y rompe el ciclo.
    const mio = ++generacion;
    const email = session?.user?.email;
    setTimeout(async () => {
      if (!vivo || mio !== generacion) return;
      // Sin sesión en el evento: cortar sin consultar. En SIGNED_OUT evita la
      // carrera de re-preguntar con una sesión cacheada (dejaba el panel "abierto").
      if (!email) { cb(null); return; }
      const admin = await getCurrentAdmin();
      // Llegó un evento más nuevo mientras consultábamos: no pisar su resultado.
      // Hace falta porque al diferir ya no los serializa auth-js.
      if (!vivo || mio !== generacion) return;
      cb(admin);
    }, 0);
  });
  return () => { vivo = false; subscription.unsubscribe(); };
}
