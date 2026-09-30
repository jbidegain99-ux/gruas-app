// Estados de cuenta (migr. 00123, backlog MOPT-03/04 y ASE-03): tipos y
// reglas de presentación, compartidos por el admin y los dos portales.

export type StatementStatus = 'draft' | 'issued' | 'approved' | 'paid' | 'void';
export type ObservationStatus = 'open' | 'confirmed' | 'adjusted';

export type StatementTotals = {
  services: number;
  amount: number;
  fee: number;
  copay: number;
  total: number;
  observed_open: number;
  observed_open_amount: number;
  approvable: number;
  // 00149: lo aprobable partido (servicios / tarifa).
  approvable_amount?: number;
  approvable_fee?: number;
};

export type StatementSummary = {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_type: 'MOPT' | 'INSURER';
  number: string | null;
  period_from: string;
  period_to: string;
  status: StatementStatus;
  issued_at: string | null;
  approved_at: string | null;
  approved_amount: number | null;
  paid_at: string | null;
  paid_reference: string | null;
  totals: StatementTotals;
};

export type ObservationEvent = {
  side: 'client' | 'budi';
  kind: 'opened' | 'reply' | 'confirmed' | 'adjusted' | 'reopened';
  body: string;
  amount: number | null;
  author: string;
  at: string;
};

export type StatementLine = {
  request_id: string;
  folio: string | null;
  completed_at: string;
  service_type: string;
  provider_name: string | null;
  tow_km: number | null;
  total_km: number | null;
  amount: number;
  fee: number;
  copay: number | null;
  observation: { id: string; status: ObservationStatus; adjusted_amount: number | null; events: ObservationEvent[] } | null;
};

export type StatementDetail = {
  id: string;
  number: string | null;
  status: StatementStatus;
  period_from: string;
  period_to: string;
  organization: { id: string; name: string; type: 'MOPT' | 'INSURER' };
  issued_at: string | null;
  approved_at: string | null;
  approved_amount: number | null;
  approved_by: string | null;
  paid_at: string | null;
  paid_reference: string | null;
  void_reason: string | null;
  viewer: 'budi' | 'client';
  can_approve: boolean;
  can_observe: boolean;
  totals: StatementTotals;
  lines: StatementLine[];
  // provider_id / provider_kind llegan desde 00141; antes solo el nombre (que puede repetirse).
  by_provider: { provider_id?: string | null; provider_kind?: string | null; provider_name: string; services: number; amount: number; tow_km: number | null; approved_amount?: number }[];
};

export const STATUS_LABEL: Record<StatementStatus, string> = {
  draft: 'Borrador',
  issued: 'Emitido',
  approved: 'Aprobado',
  paid: 'Pagado',
  void: 'Anulado',
};

export const STATUS_STYLE: Record<StatementStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  issued: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  approved: 'bg-budi-primary-50 text-budi-primary-700 dark:bg-budi-primary-900/40 dark:text-budi-primary-300',
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200',
  void: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export const OBSERVATION_LABEL: Record<ObservationStatus, string> = {
  open: 'Observado',
  confirmed: 'Confirmado por Budi',
  adjusted: 'Ajustado por Budi',
};

export const EVENT_LABEL: Record<ObservationEvent['kind'], string> = {
  opened: 'Observó',
  reply: 'Respondió',
  confirmed: 'Confirmó el monto',
  adjusted: 'Ajustó el monto',
  reopened: 'Reabrió la observación',
};

/** "Septiembre 2026" si el período es un mes calendario; si no, "1 sept – 15 sept 2026". */
export function periodLabel(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  if (f.getDate() === 1 && t.getDate() === lastDay && f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
    const m = f.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  const d = (x: Date, y: boolean) => x.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}) });
  return `${d(f, false)} – ${d(t, true)}`;
}

/** Primer y último día de un mes "YYYY-MM". */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Monto que cuenta de una línea: el ajustado si Budi lo ajustó. */
export function effectiveAmount(l: StatementLine): number {
  return l.observation?.status === 'adjusted' && l.observation.adjusted_amount != null
    ? Number(l.observation.adjusted_amount)
    : Number(l.amount);
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Tarifa que cuenta de una línea. Mismo cálculo que `statement_totals` (00123):
 * si Budi ajustó el monto, la tarifa se recalcula en proporción, redondeada a
 * centavos por línea.
 */
export function effectiveFee(l: StatementLine): number {
  const ob = l.observation;
  if (ob?.status === 'adjusted' && ob.adjusted_amount != null) {
    const amount = Number(l.amount);
    return amount > 0 ? round2((Number(l.fee) * Number(ob.adjusted_amount)) / amount) : 0;
  }
  return Number(l.fee);
}

/**
 * Lo que la línea aporta al "Total a aprobar" (`approvable`): monto + tarifa
 * que cuentan; 0 mientras está observada. La suma de todas las líneas da el total.
 */
export function countedTotal(l: StatementLine): number {
  if (l.observation?.status === 'open') return 0;
  return round2(effectiveAmount(l) + effectiveFee(l));
}
