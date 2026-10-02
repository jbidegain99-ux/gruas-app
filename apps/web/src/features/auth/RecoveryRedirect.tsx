'use client';

import { useEffect } from 'react';
import { isRecoveryHash } from './recovery';

/**
 * Si el enlace de recuperación cae en la página de inicio (pasa cuando el
 * redirect no está permitido en Supabase y Auth vuelve al site_url), lo manda a
 * /recuperar con el mismo fragmento, donde se elige la contraseña nueva.
 */
export function RecoveryRedirect() {
  useEffect(() => {
    if (isRecoveryHash(window.location.hash)) window.location.replace(`/recuperar${window.location.hash}`);
  }, []);
  return null;
}
