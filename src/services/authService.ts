import { supabase, isSupabaseConnected } from './supabaseClient';

export interface AdminUser {
  email: string;
  name: string | null;
  role: 'owner' | 'admin';
}

/**
 * Send a magic link to the user's email. Only emails present in the `admins`
 * table will be able to access /admin after authentication (RLS enforces this).
 */
export async function sendMagicLink(email: string): Promise<{ success: boolean; error?: string }> {
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
  const { data: { subscription } } = supabase.auth.onAuthStateChange(async () => {
    const admin = await getCurrentAdmin();
    cb(admin);
  });
  return () => subscription.unsubscribe();
}
