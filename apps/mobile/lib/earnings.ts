/**
 * Ganancias del operador por periodo.
 *
 * Se calcula sobre `service_requests.completed_at` (no `created_at`): lo que
 * cuenta para el operador es cuándo cerró el servicio, que es cuando
 * `complete_service_request` fija el `total_price`.
 */
import { supabase } from '@/lib/supabase';

export type EarningsSummary = {
  todayAmount: number;
  todayCount: number;
  weekAmount: number;
  weekCount: number;
};

export const EMPTY_EARNINGS: EarningsSummary = {
  todayAmount: 0,
  todayCount: 0,
  weekAmount: 0,
  weekCount: 0,
};

/** Medianoche de hoy, hora local. */
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Lunes 00:00 de la semana en curso (la semana en El Salvador arranca en lunes). */
export function startOfWeek(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Resume los servicios completados del operador desde el lunes hasta hoy. */
export async function fetchOperatorEarnings(operatorId: string): Promise<EarningsSummary> {
  const weekStart = startOfWeek();
  const todayIso = startOfToday().toISOString();

  const { data, error } = await supabase
    .from('service_requests')
    .select('total_price, completed_at')
    .eq('operator_id', operatorId)
    .eq('status', 'completed')
    .gte('completed_at', weekStart.toISOString());

  if (error || !data) return EMPTY_EARNINGS;

  return data.reduce<EarningsSummary>((acc, r) => {
    const amount = r.total_price || 0;
    acc.weekAmount += amount;
    acc.weekCount += 1;
    if (r.completed_at && r.completed_at >= todayIso) {
      acc.todayAmount += amount;
      acc.todayCount += 1;
    }
    return acc;
  }, { ...EMPTY_EARNINGS });
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}
