// Pagos que recibe el socio operador (migr. 00125, backlog LAN-08).
// Interpreta la respuesta de `my_payouts()`; cualquier rareza cae a vacío.

export type PayoutService = { folio: string | null; completed_at: string; service_type: string; amount: number };
export type Payout = { id: string; paid_on: string; amount: number; reference: string | null; payer: string; services: PayoutService[] };
// `program`: el socio es de la flota de un programa MOPT y le paga el programa (00154).
export type MyPayouts = { company: string | null; program: string | null; pending: number; payments: Payout[] };

const EMPTY: MyPayouts = { company: null, program: null, pending: 0, payments: [] };

export function parseMyPayouts(data: unknown): MyPayouts {
  if (!data || typeof data !== 'object') return EMPTY;
  const d = data as Record<string, unknown>;
  const payments = Array.isArray(d.payments) ? (d.payments as Payout[]) : [];
  return {
    company: typeof d.company === 'string' ? d.company : null,
    program: typeof d.program === 'string' ? d.program : null,
    pending: Number(d.pending ?? 0) || 0,
    payments: payments.map((p) => ({
      ...p,
      amount: Number(p.amount) || 0,
      services: Array.isArray(p.services) ? p.services.map((s) => ({ ...s, amount: Number(s.amount) || 0 })) : [],
    })),
  };
}

/** Total cobrado en el año calendario de `year`. */
export function paidInYear(p: MyPayouts, year: number): number {
  return p.payments.filter((x) => x.paid_on?.startsWith(String(year))).reduce((a, x) => a + x.amount, 0);
}
