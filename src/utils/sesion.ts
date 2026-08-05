// ¿El access token ya venció? expiresAt viene en SEGUNDOS de epoch (formato
// de supabase-js session.expires_at); margen de 30s para no pisar el borde.
export function tokenVencido(expiresAt: number | null | undefined, ahoraMs: number): boolean {
  if (!expiresAt) return false; // sin dato no afirmamos nada
  return ahoraMs >= (expiresAt - 30) * 1000;
}
