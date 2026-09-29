import { describe, expect, it } from 'vitest';
import { assignableRoles, invitationUrl, requiresMfa, safeNext } from './org-links';

describe('org-links', () => {
  it('safeNext solo acepta rutas internas (sin redirección abierta)', () => {
    expect(safeNext('/portal')).toBe('/portal');
    expect(safeNext('/mopt/equipo')).toBe('/mopt/equipo');
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext('/\\evil.com')).toBe('/');
    expect(safeNext(null, '/portal')).toBe('/portal');
  });

  it('el enlace de invitación codifica el token', () => {
    expect(invitationUrl('http://localhost:3000', 'ab+cd')).toBe('http://localhost:3000/invitacion?token=ab%2Bcd');
  });

  it('un administrador solo asigna analistas y lectores', () => {
    expect(assignableRoles('owner')).toContain('owner');
    expect(assignableRoles('admin')).toEqual(['analyst', 'viewer']);
  });

  it('dueño y administrador necesitan 2FA', () => {
    expect(requiresMfa('owner')).toBe(true);
    expect(requiresMfa('admin')).toBe(true);
    expect(requiresMfa('analyst')).toBe(false);
    expect(requiresMfa('viewer')).toBe(false);
  });
});
