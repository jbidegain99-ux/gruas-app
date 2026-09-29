import { describe, expect, it } from 'vitest';
import { elapsedLabel, stepLink, stepTitle } from './onboarding';

const insurer = { id: 'o1', type: 'INSURER' as const, name: 'X', status: 'active', insurer_id: 'i1', provider_id: null };
const mopt = { id: 'o2', type: 'MOPT' as const, name: 'Y', status: 'active', insurer_id: null, provider_id: 'p1' };

describe('onboarding', () => {
  it('nombra el paso de contrato según el tipo de cliente', () => {
    expect(stepTitle('contract', 'MOPT')).toBe('Contrato y tarifa de Budi');
    expect(stepTitle('contract', 'INSURER')).toBe('Contrato y SLA');
  });

  it('manda cada paso a la página donde se completa', () => {
    expect(stepLink('members', insurer)).toBe('/admin/insurers/i1');
    expect(stepLink('zones', mopt)).toBe('/admin/mopt');
    expect(stepLink('owner', insurer)).toBeNull();
    expect(stepLink('test', mopt)).toBeNull();
  });

  it('muestra el tiempo del alta en horas o días', () => {
    expect(elapsedLabel(0.4)).toBe('menos de 1 h');
    expect(elapsedLabel(5.2)).toBe('5 h');
    expect(elapsedLabel(24)).toBe('1 día');
    expect(elapsedLabel(50)).toBe('2 días 2 h');
  });
});
