import { supabase, isSupabaseConnected } from './supabaseClient';
import { conLimite } from '../utils/arranque';

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
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email?.toLowerCase();
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
 * Subscribe to auth state changes. Returns an unsubscribe function.
 */
export function onAuthStateChange(cb: (admin: AdminUser | null) => void): () => void {
  if (!supabase) return () => {};
  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
    // Usar la sesión del evento: en SIGNED_OUT llega null y evita la carrera
    // de re-consultar con una sesión cacheada (dejaba el panel "abierto").
    if (!session?.user?.email) {
      cb(null);
      return;
    }
    const admin = await getCurrentAdmin();
    cb(admin);
  });
  return () => subscription.unsubscribe();
}
