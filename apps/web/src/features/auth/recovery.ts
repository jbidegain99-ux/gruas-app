// Lectura del enlace de recuperación de contraseña y mensajes de Auth en
// español. Separado de la página para probarlo sin montar React.

export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

/**
 * El enlace del correo vuelve con la sesión en el fragmento
 * (#access_token=…&refresh_token=…&type=recovery, flujo implícito: la app) o
 * con ?code=… (flujo PKCE: el navegador). Si venció, trae #error=….
 */
export function readRecoveryLink(href: string): RecoveryLink {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const err = hash.get('error_description') || hash.get('error') || url.searchParams.get('error_description');
  if (err) return { kind: 'error', message: err };
  const access = hash.get('access_token');
  const refresh = hash.get('refresh_token');
  if (access && refresh && hash.get('type') === 'recovery') return { kind: 'tokens', accessToken: access, refreshToken: refresh };
  const code = url.searchParams.get('code');
  if (code) return { kind: 'code', code };
  return { kind: 'none' };
}

/** ¿Es un enlace de recuperación que cayó en otra página (p. ej. la raíz)? */
export function isRecoveryHash(hash: string): boolean {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  return p.get('type') === 'recovery' || (p.has('error') && /otp|expired|invalid/i.test(p.get('error_code') ?? p.get('error') ?? ''));
}

const MENSAJES: [RegExp, string][] = [
  [/invalid login credentials/i, 'Email o contraseña incorrectos.'],
  [/email not confirmed/i, 'Tu email aún no está confirmado. Revisa tu correo.'],
  [/already registered|already been registered/i, 'Ya existe una cuenta con ese email.'],
  [/invalid email|unable to validate email/i, 'El email no tiene un formato válido.'],
  [/should be different/i, 'La contraseña nueva tiene que ser distinta de la anterior.'],
  [/password should be at least/i, 'La contraseña es muy corta.'],
  [/rate limit|security purposes/i, 'Demasiados intentos. Espera un momento e intenta de nuevo.'],
  [/network|failed to fetch/i, 'Sin conexión. Revisa tu internet e intenta de nuevo.'],
];

/** Mensaje de Supabase Auth en español; uno desconocido no se muestra crudo. */
export function authErrorMessage(raw: string | null | undefined): string {
  for (const [re, msg] of MENSAJES) if (re.test(raw ?? '')) return msg;
  return 'No se pudo completar. Intenta de nuevo.';
}
