import { describe, expect, it } from 'vitest';
import { accountUrl, ledgerPartyUrl, monthLabel, pct, pctChange, periodRange, todaySV } from './account-360';

describe('account-360', () => {
  it('los enlaces del libro solo llevan a ficha para empresa, aseguradora y MOPT', () => {
    expect(accountUrl('insurer', 'abc')).toBe('/admin/cuentas/insurer/abc');
    expect(ledgerPartyUrl('provider', 'x')).toBe('/admin/cuentas/provider/x');
    expect(ledgerPartyUrl('operator', 'x')).toBeNull();
    expect(ledgerPartyUrl('budi', null)).toBeNull();
  });

  it('los periodos se cortan en días de El Salvador, no de UTC', () => {
    // 2026-10-01 03:00 UTC = 2026-09-30 21:00 en SV: todavía es septiembre.
    const now = new Date('2026-10-01T03:00:00Z');
    expect(todaySV(now)).toBe('2026-09-30');
    expect(periodRange('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('30d', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('year', now)).toEqual({ from: '2026-01-01', to: '2026-09-30' });
  });

  it('el mes del eje no se corre por zona horaria', () => {
    expect(monthLabel('2026-09-01')).toMatch(/^sep/);
    expect(monthLabel('2026-01-01', true)).toMatch(/2026/);
  });

  it('sin base no hay variación, y un porcentaje ausente es "—"', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(15, 10)).toBe(50);
    expect(pctChange(5, 10)).toBe(-50);
    expect(pct(null)).toBe('—');
    expect(pct(85.7)).toBe('85.7%');
  });
});
