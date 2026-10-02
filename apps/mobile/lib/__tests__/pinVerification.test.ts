import { describe, expect, it } from 'vitest';
import { PIN_GENERIC_ERROR, pinErrorMessage } from '../pinVerification';

describe('pinErrorMessage', () => {
  it('traduce los códigos del servidor', () => {
    expect(pinErrorMessage('Not the assigned operator')).toBe('Este servicio ya no está asignado a ti. Vuelve a tus solicitudes.');
    expect(pinErrorMessage('Not authenticated')).toMatch(/sesión venció/);
  });

  it('nunca muestra un código desconocido en inglés', () => {
    expect(pinErrorMessage('Something else')).toBe(PIN_GENERIC_ERROR);
    expect(pinErrorMessage(undefined)).toBe(PIN_GENERIC_ERROR);
  });
});
