import { describe, expect, it } from 'vitest';
import { canUpload, DOCS, formatDui, formatNit, stepStatus, uploadPath, type PartnerApplication } from './partner-application';

const base: PartnerApplication = {
  state: 'draft',
  rejection_reason: null,
  can_edit: true,
  independent: true,
  identity: { full_name: null, phone: null, dui: null, nit: null },
  services: [],
  bank: null,
  vehicle: null,
  documents: {},
  missing: ['identidad', 'unidad', 'servicios', 'cuenta_bancaria', 'documento:dui_front'],
};

describe('partner-application', () => {
  it('formatea DUI y NIT, y rechaza longitudes incorrectas', () => {
    expect(formatDui('012345678')).toBe('01234567-8');
    expect(formatDui('1234')).toBeNull();
    expect(formatNit('06140101901011')).toBe('0614-010190-101-1');
    expect(formatNit('0614')).toBeNull();
  });

  it('los pasos siguen lo que la base dice que falta', () => {
    const s = stepStatus(base);
    expect(s).toEqual({ identity: false, vehicle: false, services: false, bank: false, documents: false, contract: true });
    expect(stepStatus({ ...base, terms_pending: true }).contract).toBe(false);
    const empresa = stepStatus({ ...base, independent: false, missing: ['documento:nit'] });
    expect(empresa.services && empresa.bank && empresa.identity && empresa.vehicle).toBe(true);
    expect(empresa.documents).toBe(false);
  });

  it('solo deja renovar un documento que vence cuando la cuenta está aprobada', () => {
    const aprobada = { ...base, can_edit: false, state: 'approved' as const };
    const doc = { path: 'x', bucket: 'x', uploaded_at: '', expires_on: '2026-10-01', review_status: 'approved' as const, review_note: null, expired: false, expiring_soon: false };
    expect(canUpload(aprobada, doc)).toBe(false);
    expect(canUpload(aprobada, { ...doc, expiring_soon: true })).toBe(true);
    expect(canUpload(base, undefined)).toBe(true);
  });

  it('cada subida tiene una ruta única dentro de la carpeta del socio', () => {
    expect(uploadPath('u1', 'license', 'Foto Licencia.JPG', 123)).toBe('u1/license-123.jpg');
    expect(uploadPath('u1', 'nit', 'sin-extension', 5)).toBe('u1/nit-5.jpg');
  });

  it('los buckets coinciden con los que exige la base', () => {
    const id = DOCS.filter((d) => d.bucket === 'id-documents').map((d) => d.type);
    expect(id).toEqual(['dui_front', 'dui_back', 'license', 'nit']);
    expect(DOCS.filter((d) => d.expires).map((d) => d.type)).toEqual(['license', 'circulation', 'insurance']);
  });
});
