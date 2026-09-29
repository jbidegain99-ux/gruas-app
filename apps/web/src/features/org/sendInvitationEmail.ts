import { createClient } from '@supabase/supabase-js';
import { invitationUrl } from './org-links';

/**
 * Manda el correo de invitación (migr. 00113, POR-02) con el enlace de acceso
 * de Supabase Auth: si la persona no tiene cuenta, se crea; al abrirlo entra y
 * cae en /invitacion con el token.
 *
 * Se usa un cliente APARTE, con flujo `implicit` y sin guardar sesión:
 *   * el cliente normal de la web usa PKCE, y un enlace PKCE solo funciona en el
 *     navegador que lo pidió (el del dueño), no en el del invitado;
 *   * sin persistir sesión, pedir el enlace no toca la sesión de quien invita.
 */
export async function sendInvitationEmail(email: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const mailer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await mailer.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: invitationUrl(window.location.origin, token) },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
