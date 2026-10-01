import { describe, expect, it } from 'vitest';
import { paidInYear, parseMyPayouts } from '../payouts';

describe('payouts', () => {
  it('interpreta la respuesta y convierte los montos a número', () => {
    const p = parseMyPayouts({
      company: null,
      pending: '12.50',
      payments: [{ id: 'a', paid_on: '2026-09-30', amount: '64.00', reference: 'TRF-1', payer: 'Budi',
                   services: [{ folio: 'BUDI-000001', completed_at: '2026-09-29T10:00:00Z', service_type: 'tow', amount: '64.00' }] }],
    });
    expect(p.pending).toBe(12.5);
    expect(p.payments[0].amount).toBe(64);
    expect(p.payments[0].services[0].amount).toBe(64);
  });

  it('sin respuesta, vacío', () => {
    expect(parseMyPayouts(null)).toEqual({ company: null, program: null, pending: 0, payments: [] });
  });

  it('socio de la flota MOPT: dice qué programa le paga', () => {
    expect(parseMyPayouts({ company: null, program: 'MOPT — Asistencia Vial', pending: 0, payments: [] }).program).toBe('MOPT — Asistencia Vial');
  });

  it('suma lo cobrado en el año', () => {
    const p = parseMyPayouts({ payments: [
      { id: 'a', paid_on: '2026-01-15', amount: 10, payer: 'Budi', services: [] },
      { id: 'b', paid_on: '2025-12-31', amount: 99, payer: 'Budi', services: [] },
      { id: 'c', paid_on: '2026-09-30', amount: 5.5, payer: 'MOPT', services: [] },
    ] });
    expect(paidInYear(p, 2026)).toBe(15.5);
  });
});
