import { describe, expect, it } from 'vitest';
import { normalizeSvPhone, SV_DEPARTMENTS } from './partner-options';

describe('partner-options', () => {
  it('normaliza teléfonos salvadoreños', () => {
    expect(normalizeSvPhone('7012-3456')).toBe('+50370123456');
    expect(normalizeSvPhone('+503 2222 3333')).toBe('+50322223333');
    expect(normalizeSvPhone('503 6123 4567')).toBe('+50361234567');
  });

  it('rechaza lo que no es un número de El Salvador', () => {
    expect(normalizeSvPhone('1234')).toBeNull();
    expect(normalizeSvPhone('5012-3456')).toBeNull();
    expect(normalizeSvPhone('+1 305 555 1234')).toBeNull();
  });

  it('tiene los 14 departamentos', () => {
    expect(SV_DEPARTMENTS).toHaveLength(14);
  });
});
