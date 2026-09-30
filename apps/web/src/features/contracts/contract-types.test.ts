import { describe, expect, it } from 'vitest';
import { budgetBar, budgetMessage, type ContractStatus } from './contract-types';

const base: ContractStatus = {
  organization: { id: 'o', name: 'MOPT', type: 'MOPT' },
  has_contract: true, reference: 'CT-1', valid_from: '2026-01-01', valid_to: null, active: true,
  monthly_cap: 1000, on_cap: 'keep_courtesy', tariff_notes: null, sla_assignment_minutes: 10, sla_arrival_minutes: 45,
  platform_fee_pct: 5, month: '2026-09', consumed: 500, consumed_pct: 50, level: 'ok', courtesy_now: true,
};

describe('contract-types', () => {
  it('la barra se limita a 0–100', () => {
    expect(budgetBar({ consumed_pct: 130, level: 'reached' })).toEqual({ width: 100, tone: 'reached' });
    expect(budgetBar({ consumed_pct: null, level: 'none' })).toEqual({ width: 0, tone: 'none' });
  });

  it('el mensaje dice qué pasa según la política del contrato', () => {
    expect(budgetMessage(base)).toBeNull();
    expect(budgetMessage({ ...base, level: 'warning', consumed_pct: 85 })).toContain('80 %');
    expect(budgetMessage({ ...base, level: 'reached' })).toContain('siguen sin costo');
    expect(budgetMessage({ ...base, level: 'reached', on_cap: 'charge_user' })).toContain('los paga el Usuario');
    expect(budgetMessage({ ...base, active: false })).toContain('no está vigente');
    expect(budgetMessage({ ...base, has_contract: false })).toBeNull();
  });

  it('en el admin habla del cliente, no al cliente', () => {
    expect(budgetMessage({ ...base, level: 'reached' }, true)).toMatch(/^Llegó al tope/);
    expect(budgetMessage({ ...base, level: 'warning', consumed_pct: 85 }, true)).toMatch(/^Va por encima/);
  });
});
