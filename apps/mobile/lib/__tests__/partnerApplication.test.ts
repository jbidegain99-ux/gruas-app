import { describe, it, expect } from 'vitest';
import {
  formatDui,
  formatNit,
  normalizeSvPhone,
  displaySvPhone,
  parseDmy,
  formatIsoAsDmy,
  maskDmy,
  isFutureIso,
  docDisplayStatus,
  missingLabel,
  pauseInfo,
  rpcErrorMessage,
  partnerStateFromProfile,
  type PartnerDocument,
} from '../partnerApplication';

const doc = (over: Partial<PartnerDocument> = {}): PartnerDocument => ({
  path: 'uid/x.jpg',
  bucket: 'id-documents',
  uploaded_at: '2026-09-01T00:00:00Z',
  expires_on: null,
  review_status: 'pending',
  review_note: null,
  expired: false,
  expiring_soon: false,
  ...over,
});

describe('DUI / NIT / teléfono', () => {
  it('formatea el DUI con 9 dígitos y rechaza otros largos', () => {
    expect(formatDui('012345678')).toBe('01234567-8');
    expect(formatDui('01234567-8')).toBe('01234567-8');
    expect(formatDui('1234')).toBeNull();
  });

  it('formatea el NIT con 14 dígitos', () => {
    expect(formatNit('06141234561234')).toBe('0614-123456-123-4');
    expect(formatNit('0614-123456-123-4')).toBe('0614-123456-123-4');
    expect(formatNit('0614')).toBeNull();
  });

  it('acepta teléfonos SV con o sin +503', () => {
    expect(normalizeSvPhone('7000-1234')).toBe('70001234');
    expect(normalizeSvPhone('+503 7000 1234')).toBe('70001234');
    expect(normalizeSvPhone('50001234')).toBeNull();
    expect(displaySvPhone('+50370001234')).toBe('7000-1234');
  });
});

describe('fechas DD/MM/AAAA', () => {
  it('convierte a ISO y valida que la fecha exista', () => {
    expect(parseDmy('01/12/2027')).toBe('2027-12-01');
    expect(parseDmy('1-2-2027')).toBe('2027-02-01');
    expect(parseDmy('31/02/2027')).toBeNull();
    expect(parseDmy('2027-12-01')).toBeNull();
  });

  it('ida y vuelta con formatIsoAsDmy y la máscara', () => {
    expect(formatIsoAsDmy('2027-12-01')).toBe('01/12/2027');
    expect(formatIsoAsDmy(null)).toBe('');
    expect(maskDmy('01122027')).toBe('01/12/2027');
    expect(maskDmy('011')).toBe('01/1');
  });

  it('isFutureIso compara contra hoy', () => {
    const today = new Date(2026, 8, 28);
    expect(isFutureIso('2026-09-29', today)).toBe(true);
    expect(isFutureIso('2026-09-28', today)).toBe(false);
  });
});

describe('estado de documentos', () => {
  it('prioriza vencido > rechazado > por vencer', () => {
    expect(docDisplayStatus(undefined)).toBe('missing');
    expect(docDisplayStatus(doc())).toBe('pending');
    expect(docDisplayStatus(doc({ review_status: 'approved' }))).toBe('approved');
    expect(docDisplayStatus(doc({ review_status: 'rejected' }))).toBe('rejected');
    expect(docDisplayStatus(doc({ review_status: 'approved', expiring_soon: true }))).toBe('expiring');
    expect(docDisplayStatus(doc({ review_status: 'rejected', expired: true, expiring_soon: true }))).toBe('expired');
  });
});

describe('mensajes', () => {
  it('traduce las claves de missing', () => {
    expect(missingLabel('identidad')).toBe('Datos personales');
    expect(missingLabel('documento:nit')).toBe('NIT');
  });

  it('muestra tal cual las excepciones de la base y traduce "Falta completar"', () => {
    expect(rpcErrorMessage({ code: 'P0001', message: 'Placa inválida' }, 'x')).toBe('Placa inválida');
    expect(
      rpcErrorMessage({ code: 'P0001', message: 'Falta completar: unidad, documento:license' }, 'x'),
    ).toBe('Falta completar: Tu unidad, Licencia de conducir');
    expect(rpcErrorMessage({ code: '42501', message: 'permission denied' }, 'Fallback')).toBe('Fallback');
  });
});

describe('partnerStateFromProfile', () => {
  it('distingue borrador de en revisión y respeta los estados finales', () => {
    expect(partnerStateFromProfile('pending', null)).toBe('draft');
    expect(partnerStateFromProfile(null, null)).toBe('draft');
    expect(partnerStateFromProfile('pending', '2026-09-01T00:00:00Z')).toBe('in_review');
    expect(partnerStateFromProfile('approved', null)).toBe('approved');
    expect(partnerStateFromProfile('rejected', '2026-09-01T00:00:00Z')).toBe('rejected');
    expect(partnerStateFromProfile('suspended', null)).toBe('suspended');
  });
});

describe('pauseInfo', () => {
  it('documento vencido: se resuelve subiendo la renovación', () => {
    const p = pauseInfo('Documento vencido: licencia de conducir');
    expect(p.byDocuments).toBe(true);
    expect(p.cta).toBe('Subir la renovación');
  });

  it('pausa de Budi: se resuelve con soporte, no con documentos', () => {
    const p = pauseInfo('Reportes de cobros por fuera de la app.');
    expect(p.byDocuments).toBe(false);
    expect(p.cta).toBe('Contactar a soporte');
    expect(p.text).not.toMatch(/document/i);
  });

  it('sin motivo cuenta como pausa de Budi', () => {
    expect(pauseInfo(null).byDocuments).toBe(false);
  });
});
