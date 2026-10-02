import { describe, expect, it } from 'vitest';
import { formatPhone, phoneMatches, svPhoneDigits } from '@gruas-app/shared';

// La regla vive en @gruas-app/shared (la usan web y app); se prueba acá
// porque el paquete no tiene runner propio.
describe('teléfonos de El Salvador', () => {
  it('acepta las formas en que la gente los escribe', () => {
    for (const raw of ['7123-4567', '71234567', '+50371234567', '+503 7123-4567', '503 7123 4567']) {
      expect(svPhoneDigits(raw)).toBe('71234567');
      expect(formatPhone(raw)).toBe('+503 7123-4567');
    }
  });

  it('fijos (2) y otros móviles (6)', () => {
    expect(formatPhone('2222-3333')).toBe('+503 2222-3333');
    expect(formatPhone('6123 4567')).toBe('+503 6123-4567');
  });

  it('un número de otro país o incompleto se deja como vino', () => {
    expect(svPhoneDigits('+1 305 555 0100')).toBeNull();
    expect(formatPhone('+1 305 555 0100')).toBe('+1 305 555 0100');
    expect(formatPhone('7123')).toBe('7123');
    expect(formatPhone(null)).toBe('');
  });
});

describe('phoneMatches', () => {
  it('encuentra el número sin importar cómo se escriba', () => {
    expect(phoneMatches('+50370000001', '7000-0001')).toBe(true);
    expect(phoneMatches('+50370000001', '+503 7000 0001')).toBe(true);
    expect(phoneMatches('+50370000001', '0001')).toBe(true);
  });

  it('no busca por menos de 4 dígitos ni por texto', () => {
    expect(phoneMatches('+50370000001', '7')).toBe(false);
    expect(phoneMatches('+50370000001', 'Usuario')).toBe(false);
  });
});
