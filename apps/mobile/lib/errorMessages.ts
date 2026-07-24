// Traduce errores crudos (Supabase Auth / Postgres / edge functions), que a
// menudo llegan en inglés y con jerga técnica, a mensajes en español aptos para
// mostrarle al usuario final. Si no reconoce el error, devuelve un fallback
// genérico en vez de exponer el texto interno.
//
// Uso:
//   const { error } = await supabase.auth.signInWithPassword(...);
//   if (error) Alert.alert('Error', friendlyError(error));

interface MaybeError {
  message?: string;
  code?: string;
}

// Coincidencias por substring (case-insensitive) sobre el message crudo.
const PATTERNS: { match: string; message: string }[] = [
  { match: 'invalid login credentials', message: 'Email o contraseña incorrectos.' },
  { match: 'email not confirmed', message: 'Tu email aún no está confirmado. Revisa tu correo.' },
  { match: 'user already registered', message: 'Ya existe una cuenta con ese email.' },
  { match: 'already registered', message: 'Ya existe una cuenta con ese email.' },
  { match: 'password should be at least', message: 'La contraseña debe tener al menos 6 caracteres.' },
  { match: 'unable to validate email address', message: 'El email no tiene un formato válido.' },
  { match: 'invalid email', message: 'El email no tiene un formato válido.' },
  { match: 'for security purposes', message: 'Espera unos segundos antes de volver a intentar.' },
  { match: 'email rate limit exceeded', message: 'Demasiados intentos. Espera un momento e intenta de nuevo.' },
  { match: 'over_email_send_rate_limit', message: 'Demasiados intentos. Espera un momento e intenta de nuevo.' },
  { match: 'network request failed', message: 'Sin conexión. Revisa tu internet e intenta de nuevo.' },
  { match: 'failed to fetch', message: 'Sin conexión. Revisa tu internet e intenta de nuevo.' },
  { match: 'non-2xx', message: 'No se pudo completar la operación. Intenta de nuevo.' },
];

/**
 * @param error   El error crudo (objeto con `message`/`code`, o string).
 * @param fallback Mensaje a mostrar si el error no se reconoce.
 */
export function friendlyError(
  error: MaybeError | string | null | undefined,
  fallback = 'Ocurrió un error. Intenta de nuevo.',
): string {
  const raw = (typeof error === 'string' ? error : error?.message) || '';
  const lower = raw.toLowerCase();

  for (const p of PATTERNS) {
    if (lower.includes(p.match)) return p.message;
  }

  return fallback;
}
