import { describe, expect, it } from 'vitest';
import { friendlyError } from '../errorMessages';

describe('friendlyError', () => {
  it('sin señal: la llamada cortada por tiempo se explica en español', () => {
    expect(friendlyError({ message: 'AbortError: Aborted' })).toBe('El servidor no respondió. Revisa tu señal e intenta de nuevo.');
    expect(friendlyError({ message: 'Network request failed' })).toMatch(/Sin conexión/);
  });

  it('nunca muestra un error técnico desconocido', () => {
    expect(friendlyError({ message: 'violates check constraint "sr_status"' }, 'No se pudo.')).toBe('No se pudo.');
  });
});
