// Contrato y presupuesto del cliente institucional (migr. 00124, MOPT-05).

export type ContractStatus = {
  organization: { id: string; name: string; type: 'MOPT' | 'INSURER' };
  has_contract: boolean;
  reference: string | null;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
  monthly_cap: number | null;
  on_cap: 'keep_courtesy' | 'charge_user' | null;
  tariff_notes: string | null;
  sla_assignment_minutes: number | null;
  sla_arrival_minutes: number | null;
  platform_fee_pct: number | null;
  month: string;
  consumed: number | null;
  consumed_pct: number | null;
  level: 'none' | 'ok' | 'warning' | 'reached';
  courtesy_now: boolean | null;
};

export const ON_CAP_LABEL: Record<'keep_courtesy' | 'charge_user', string> = {
  keep_courtesy: 'El servicio sigue sin costo para el Usuario y se factura aparte',
  charge_user: 'Se corta la cortesía: el Usuario paga hasta el mes siguiente',
};

/** Ancho de la barra (0–100) y su color según el nivel. */
export function budgetBar(s: Pick<ContractStatus, 'consumed_pct' | 'level'>): { width: number; tone: 'ok' | 'warning' | 'reached' | 'none' } {
  const pct = s.consumed_pct == null ? 0 : Math.max(0, Math.min(100, Number(s.consumed_pct)));
  return { width: pct, tone: s.level };
}

/** Mensaje de estado para el cliente. */
export function budgetMessage(s: ContractStatus): string | null {
  if (!s.has_contract) return null;
  if (!s.active)
    return s.organization?.type === 'INSURER'
      ? 'El contrato no está vigente hoy.'
      : 'El contrato no está vigente hoy: los servicios nuevos no tienen cortesía MOPT.';
  if (s.level === 'reached')
    return s.on_cap === 'charge_user'
      ? 'Llegaste al tope del mes: los servicios nuevos los paga el Usuario hasta el mes siguiente.'
      : 'Llegaste al tope del mes: los servicios siguen sin costo para el Usuario y se facturan aparte.';
  if (s.level === 'warning') return 'Vas por encima del 80 % del tope de este mes.';
  return null;
}
