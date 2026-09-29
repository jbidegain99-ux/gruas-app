import { describe, expect, it } from 'vitest';
import { bankFileRows, batchTotals, type PayoutItem } from './payout-file';

const item = (over: Partial<PayoutItem>): PayoutItem => ({
  payee_kind: 'operator', payee_id: 'x', payee_name: 'Socio', amount: 50, bank_name: 'Banco Agrícola',
  account_type: 'ahorro', account_number: '3001234567', holder: 'Socio Uno', services: [], ledger_payment_id: null,
  ...over,
});

describe('payout-file', () => {
  it('el archivo solo lleva a quien tiene cuenta, con el monto a dos decimales', () => {
    const rows = bankFileRows({ cutoff: '2026-09-30' }, [item({ amount: 48.456 }), item({ payee_id: 'y', account_number: null })]);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe('Banco');
    expect(rows[1]).toEqual(['Banco Agrícola', 'Ahorro', '3001234567', 'Socio Uno', '48.46', 'Budi servicios al 2026-09-30']);
  });

  it('totales separan lo que se paga de lo retenido por falta de cuenta', () => {
    const t = batchTotals([item({ amount: 50 }), item({ payee_id: 'y', account_number: null, amount: 20 })]);
    expect(t).toEqual({ payees: 2, payable: 1, missingBank: 1, total: 50, withheld: 20 });
  });
});
