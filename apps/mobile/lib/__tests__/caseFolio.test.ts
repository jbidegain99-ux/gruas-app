import { describe, expect, it } from 'vitest';
import { caseFolio } from '../caseFolio';

describe('caseFolio', () => {
  it('lee el folio del embed como objeto (relación uno a uno)', () => {
    expect(caseFolio({ folio: 'BUDI-000279' })).toBe('BUDI-000279');
  });

  it('y como arreglo', () => {
    expect(caseFolio([{ folio: 'BUDI-000280' }])).toBe('BUDI-000280');
  });

  it('null si el caso todavía no existe o viene vacío', () => {
    expect(caseFolio(null)).toBeNull();
    expect(caseFolio(undefined)).toBeNull();
    expect(caseFolio([])).toBeNull();
    expect(caseFolio({ folio: null })).toBeNull();
  });
});
