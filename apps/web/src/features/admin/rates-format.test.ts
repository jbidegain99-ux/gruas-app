import { describe, expect, it } from 'vitest';
import { formatRate, formatValidFrom, hoySV } from './rates-format';

describe('rates-format', () => {
  it('una tasa NULL es "volver al default", salvo en el MOPT donde es 0%', () => {
    expect(formatRate(null, 'provider')).toBe('Default');
    expect(formatRate(null, 'operator')).toBe('Default');
    expect(formatRate(null, 'mopt_fee')).toBe('0%');
    expect(formatRate(15, 'provider')).toBe('15%');
    expect(formatRate(12.5, 'platform_default')).toBe('12.5%');
  });

  it('un cambio programado (00:00 SV = 06:00 UTC) se muestra en su día de SV', () => {
    // 2026-10-08 00:00 en El Salvador
    expect(formatValidFrom('2026-10-08T06:00:00+00:00')).toMatch(/8/);
    expect(formatValidFrom('2026-10-08T06:00:00+00:00')).not.toMatch(/7/);
  });

  it('la versión inicial no tiene fecha', () => {
    expect(formatValidFrom('-infinity')).toBe('inicio');
  });

  it('hoy se mide en El Salvador, no en UTC', () => {
    // 2026-09-29 03:00 UTC = 2026-09-28 21:00 en SV
    expect(hoySV(new Date('2026-09-29T03:00:00Z'))).toBe('2026-09-28');
  });
});
