import { describe, expect, it } from 'vitest';
import { countedTotal, effectiveAmount, effectiveFee, monthRange, periodLabel, type StatementLine } from './statement-types';

const line: StatementLine = {
  request_id: 'r', folio: 'BUDI-000001', completed_at: '2026-09-02T10:00:00Z', service_type: 'tow',
  provider_name: null, tow_km: 5, total_km: 8, amount: 61, fee: 3.05, copay: 0, observation: null,
};

describe('statement-types', () => {
  it('un mes calendario se nombra por su mes', () => {
    expect(periodLabel('2026-09-01', '2026-09-30')).toBe('Septiembre de 2026');
    expect(periodLabel('2026-02-01', '2026-02-28')).toMatch(/^Febrero/);
  });

  it('un período parcial muestra las dos fechas', () => {
    expect(periodLabel('2026-09-01', '2026-09-15')).toContain('–');
  });

  it('rango de un mes, con años bisiestos', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('el monto ajustado reemplaza al original; confirmado u observado no', () => {
    expect(effectiveAmount(line)).toBe(61);
    expect(effectiveAmount({ ...line, observation: { id: 'o', status: 'adjusted', adjusted_amount: 30.5, events: [] } })).toBe(30.5);
    expect(effectiveAmount({ ...line, observation: { id: 'o', status: 'open', adjusted_amount: null, events: [] } })).toBe(61);
  });

  it('la tarifa ajustada va en proporción y las líneas suman el total a aprobar', () => {
    const adjusted = { ...line, observation: { id: 'o', status: 'adjusted' as const, adjusted_amount: 30.5, events: [] } };
    const open = { ...line, observation: { id: 'o', status: 'open' as const, adjusted_amount: null, events: [] } };
    expect(effectiveFee(line)).toBe(3.05);
    expect(effectiveFee(adjusted)).toBe(1.53); // 3.05 * 30.5 / 61 = 1.525 -> 1.53, como ROUND de Postgres
    expect(countedTotal(line)).toBe(64.05);
    expect(countedTotal(adjusted)).toBe(32.03);
    expect(countedTotal(open)).toBe(0);
  });
});
