// Alertas operativas del panel (migr. 00117, backlog LAN-03): convierte el
// resumen de `staff_ops_alerts()` en avisos con texto y a dónde ir.

export type OpsAlertsSummary = {
  stale_pool: number;
  oldest_pool_minutes: number | null;
  late_arrivals: number;
  pending_verifications: number;
  stuck_notifications: number;
  /** null para SUPPORT: es un dato técnico, solo lo ve ADMIN. */
  failed_jobs: number | null;
  /** 00123: casos que un cliente observó en su estado de cuenta (solo ADMIN). */
  open_observations?: number | null;
  /** 00124: clientes al 80 % o más de su tope mensual (solo ADMIN). */
  budgets_at_risk?: number | null;
};

export type OpsAlert = {
  key: keyof OpsAlertsSummary;
  level: 'urgent' | 'warning';
  text: string;
  href?: string;
};

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** Avisos a mostrar, los urgentes primero. Vacío si no hay nada que atender. */
export function opsAlerts(s: OpsAlertsSummary | null): OpsAlert[] {
  if (!s) return [];
  const out: OpsAlert[] = [];

  if (s.stale_pool > 0) {
    const minutos = s.oldest_pool_minutes ? ` (la más antigua, hace ${s.oldest_pool_minutes} min)` : '';
    out.push({
      key: 'stale_pool',
      level: 'urgent',
      text: `${s.stale_pool} ${plural(s.stale_pool, 'solicitud lleva', 'solicitudes llevan')} más de 10 min sin socio operador${minutos}. Asígnala a mano.`,
      href: '/admin/requests',
    });
  }
  if (s.late_arrivals > 0) {
    out.push({
      key: 'late_arrivals',
      level: 'urgent',
      text: `${s.late_arrivals} ${plural(s.late_arrivals, 'servicio asignado', 'servicios asignados')} hace más de 45 min sin llegada confirmada. Llama al socio operador.`,
      href: '/admin/requests',
    });
  }
  if (s.failed_jobs) {
    out.push({
      key: 'failed_jobs',
      level: 'urgent',
      text: `${s.failed_jobs} ${plural(s.failed_jobs, 'tarea programada falló', 'tareas programadas fallaron')} en la última hora. Revisa el runbook (P8).`,
    });
  }
  if (s.stuck_notifications > 0) {
    out.push({
      key: 'stuck_notifications',
      level: 'warning',
      text: `${s.stuck_notifications} ${plural(s.stuck_notifications, 'notificación push no ha salido', 'notificaciones push no han salido')} en más de 10 min.`,
    });
  }
  if (s.open_observations) {
    out.push({
      key: 'open_observations',
      level: 'warning',
      text: `${s.open_observations} ${plural(s.open_observations, 'caso observado por un cliente espera', 'casos observados por clientes esperan')} respuesta de Budi.`,
      href: '/admin/estados-de-cuenta',
    });
  }
  if (s.budgets_at_risk) {
    out.push({
      key: 'budgets_at_risk',
      level: 'warning',
      text: `${s.budgets_at_risk} ${plural(s.budgets_at_risk, 'cliente pasó', 'clientes pasaron')} el 80 % de su tope mensual.`,
      href: '/admin/mopt',
    });
  }
  if (s.pending_verifications > 0) {
    out.push({
      key: 'pending_verifications',
      level: 'warning',
      text: `${s.pending_verifications} ${plural(s.pending_verifications, 'socio espera', 'socios esperan')} revisión de documentos.`,
      href: '/admin/verifications',
    });
  }
  return out;
}

/** Cuántos avisos urgentes hay: va en el título de la pestaña. */
export function urgentCount(alerts: OpsAlert[]): number {
  return alerts.filter((a) => a.level === 'urgent').length;
}
