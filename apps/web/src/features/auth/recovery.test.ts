import { describe, expect, it } from 'vitest';
import { authErrorMessage, isRecoveryHash, readRecoveryLink } from './recovery';

describe('readRecoveryLink', () => {
  it('lee la sesión del fragmento (enlace pedido desde la app)', () => {
    const l = readRecoveryLink('https://budi.sv/recuperar#access_token=a&refresh_token=r&type=recovery');
    expect(l).toEqual({ kind: 'tokens', accessToken: 'a', refreshToken: 'r' });
  });

  it('lee el código (enlace pedido desde el navegador)', () => {
    expect(readRecoveryLink('https://budi.sv/recuperar?code=xyz')).toEqual({ kind: 'code', code: 'xyz' });
  });

  it('enlace vencido', () => {
    const l = readRecoveryLink('https://budi.sv/recuperar#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
    expect(l.kind).toBe('error');
  });

  it('sin enlace: hay que pedir el correo', () => {
    expect(readRecoveryLink('https://budi.sv/recuperar').kind).toBe('none');
  });
});

describe('isRecoveryHash', () => {
  it('reconoce el enlace de recuperación que cayó en la raíz', () => {
    expect(isRecoveryHash('#access_token=a&refresh_token=r&type=recovery')).toBe(true);
    expect(isRecoveryHash('#error=access_denied&error_code=otp_expired')).toBe(true);
    expect(isRecoveryHash('#seccion-precios')).toBe(false);
  });
});

describe('authErrorMessage', () => {
  it('traduce y nunca muestra el texto crudo', () => {
    expect(authErrorMessage('Invalid login credentials')).toBe('Email o contraseña incorrectos.');
    expect(authErrorMessage('Something weird')).toBe('No se pudo completar. Intenta de nuevo.');
  });
});
