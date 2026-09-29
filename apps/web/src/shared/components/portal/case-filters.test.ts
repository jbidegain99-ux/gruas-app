import { describe, expect, it } from 'vitest';
import { defaultCaseFilters, filterCases, zoneOptions } from './case-filters';

const rows = [
  { folio: 'BUDI-000012', status: 'completed', service_type: 'tow', zone: 'San Salvador' },
  { folio: 'BUDI-000120', status: 'assigned', service_type: 'battery', zone: 'La Libertad' },
  { folio: null, status: 'initiated', service_type: 'tow', zone: null },
];
const base = defaultCaseFilters('2026-09-28');

describe('case-filters', () => {
  it('el rango por defecto es el mes en curso', () => {
    expect(base.from).toBe('2026-09-01');
    expect(base.to).toBe('2026-09-28');
  });

  it('filtra por estado, servicio y zona', () => {
    expect(filterCases(rows, { ...base, status: 'completed' }).map((r) => r.folio)).toEqual(['BUDI-000012']);
    expect(filterCases(rows, { ...base, service: 'tow' })).toHaveLength(2);
    expect(filterCases(rows, { ...base, zone: 'La Libertad' }).map((r) => r.folio)).toEqual(['BUDI-000120']);
  });

  it('busca por folio completo, parcial o solo el número', () => {
    expect(filterCases(rows, { ...base, q: 'budi-000012' }).map((r) => r.folio)).toEqual(['BUDI-000012']);
    expect(filterCases(rows, { ...base, q: '12' }).map((r) => r.folio)).toEqual(['BUDI-000012', 'BUDI-000120']);
    expect(filterCases(rows, { ...base, q: '000120' }).map((r) => r.folio)).toEqual(['BUDI-000120']);
  });

  it('las zonas salen de los datos, sin vacíos y en orden', () => {
    expect(zoneOptions(rows)).toEqual(['La Libertad', 'San Salvador']);
  });
});
