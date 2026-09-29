import { describe, expect, it } from 'vitest';
import { opsAlerts, urgentCount, type OpsAlertsSummary } from './ops-alerts';

const vacio: OpsAlertsSummary = {
  stale_pool: 0,
  oldest_pool_minutes: null,
  late_arrivals: 0,
  pending_verifications: 0,
  stuck_notifications: 0,
  failed_jobs: 0,
};

describe('ops-alerts', () => {
  it('sin nada pendiente no hay avisos', () => {
    expect(opsAlerts(vacio)).toEqual([]);
    expect(opsAlerts(null)).toEqual([]);
  });

  it('los urgentes van primero y llevan a donde se resuelven', () => {
    const a = opsAlerts({ ...vacio, pending_verifications: 2, stale_pool: 1, oldest_pool_minutes: 14 });
    expect(a.map((x) => x.key)).toEqual(['stale_pool', 'pending_verifications']);
    expect(a[0].text).toBe('1 solicitud lleva más de 10 min sin socio operador (la más antigua, hace 14 min). Asígnala a mano.');
    expect(a[0].href).toBe('/admin/requests');
    expect(a[1].text).toBe('2 socios esperan revisión de documentos.');
    expect(urgentCount(a)).toBe(1);
  });

  it('las observaciones de clientes llevan a estados de cuenta', () => {
    const a = opsAlerts({ ...vacio, open_observations: 2 });
    expect(a[0].text).toBe('2 casos observados por clientes esperan respuesta de Budi.');
    expect(a[0].href).toBe('/admin/estados-de-cuenta');
    expect(opsAlerts({ ...vacio, open_observations: null })).toEqual([]);
  });

  it('soporte no recibe el aviso técnico de tareas programadas', () => {
    expect(opsAlerts({ ...vacio, failed_jobs: null })).toEqual([]);
    expect(opsAlerts({ ...vacio, failed_jobs: 3 })[0].key).toBe('failed_jobs');
  });
});
