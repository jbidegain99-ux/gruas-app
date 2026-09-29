import { describe, expect, it } from 'vitest';
import { auditColumnLabel, auditTableLabel, formatAuditValue } from './audit-format';

describe('formatAuditValue', () => {
  it('"sin valor" se muestra como guion, no como 0', () => {
    expect(formatAuditValue(null)).toBe('—');
    expect(formatAuditValue(undefined)).toBe('—');
    // Un 0 real sí es un valor: no se confunde con el vacío.
    expect(formatAuditValue(0)).toBe('0');
  });

  it('booleanos en español', () => {
    expect(formatAuditValue(true)).toBe('Sí');
    expect(formatAuditValue(false)).toBe('No');
  });

  it('rol y verificación en español, solo en su columna', () => {
    expect(formatAuditValue('ADMIN', 'role')).toBe('Administrador');
    expect(formatAuditValue('pending', 'verification_status')).toBe('En revisión');
    // En otra columna el mismo texto no se traduce.
    expect(formatAuditValue('ADMIN', 'name')).toBe('ADMIN');
  });

  it('objetos como JSON', () => {
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('etiquetas', () => {
  it('traduce las conocidas y deja pasar las nuevas tal cual', () => {
    expect(auditTableLabel('pricing_rules')).toBe('Tarifas');
    expect(auditTableLabel('tabla_nueva')).toBe('tabla_nueva');
    expect(auditColumnLabel('role')).toBe('Rol');
    expect(auditColumnLabel('columna_nueva')).toBe('columna_nueva');
  });
});
