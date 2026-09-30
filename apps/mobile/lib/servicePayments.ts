// Pagos del Usuario por un servicio (migr. 00133, backlog LAN-07): efectivo al
// socio operador (lo confirma él) o tarjeta (cuando haya pasarela). El
// comprobante NO es factura: la factura electrónica es LAN-09.

export type PaymentStatus = 'pending' | 'paid' | 'void' | 'not_required' | 'not_yet';
export type PaymentMethod = 'cash' | 'card' | 'transfer';

export type ServicePayment = {
  request_id: string;
  folio: string | null;
  service_type: string;
  completed_at: string | null;
  operator_name: string | null;
  user_name: string | null;
  payer: 'user' | 'insurer' | 'mopt';
  total_price: number | null;
  covered: number | null;
  amount_due: number | null;
  status: PaymentStatus;
  method: PaymentMethod | null;
  paid_at: string | null;
  receipt_number: string | null;
  card_available: boolean;
};

export type PendingItem = {
  request_id: string;
  folio: string | null;
  service_type: string;
  completed_at: string;
  amount: number;
  user_name?: string | null;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function parseServicePayment(d: unknown): ServicePayment | null {
  if (!d || typeof d !== 'object') return null;
  const r = d as Record<string, unknown>;
  return {
    request_id: String(r.request_id),
    folio: (r.folio as string) ?? null,
    service_type: String(r.service_type ?? 'tow'),
    completed_at: (r.completed_at as string) ?? null,
    operator_name: (r.operator_name as string) ?? null,
    user_name: (r.user_name as string) ?? null,
    payer: (r.payer as ServicePayment['payer']) ?? 'user',
    total_price: num(r.total_price),
    covered: num(r.covered),
    amount_due: num(r.amount_due),
    status: (r.status as PaymentStatus) ?? 'not_yet',
    method: (r.method as PaymentMethod) ?? null,
    paid_at: (r.paid_at as string) ?? null,
    receipt_number: (r.receipt_number as string) ?? null,
    card_available: r.card_available === true,
  };
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

/** Texto del comprobante para compartir (WhatsApp, correo). Sin comisión de Budi. */
export function receiptText(
  p: ServicePayment,
  serviceName: string,
  when: string,
  /** 00153: con las aseguradoras apagadas no se menciona el seguro. */
  showInsurer = true,
): string {
  const lines = [
    `Budi · Comprobante de pago ${p.receipt_number ?? ''}`.trim(),
    p.folio ? `Caso ${p.folio}` : null,
    `Servicio: ${serviceName}`,
    p.operator_name ? `Socio operador: ${p.operator_name}` : null,
    p.total_price != null ? `Precio del servicio: $${p.total_price.toFixed(2)}` : null,
    showInsurer && p.payer === 'insurer' && p.covered != null ? `Cubrió tu seguro: $${p.covered.toFixed(2)}` : null,
    p.amount_due != null ? `Pagaste: $${p.amount_due.toFixed(2)}${p.method ? ` (${METHOD_LABEL[p.method]})` : ''}` : null,
    `Fecha: ${when}`,
    'Este comprobante no es una factura.',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Saldo del socio con Budi (my_payouts.pending). Desde 00133 puede ser negativo:
 * el socio cobró en efectivo más de lo que Budi le debía y le debe la comisión.
 */
export function balanceLabel(pending: number): { label: string; amount: number; owes: boolean } {
  return pending < 0
    ? { label: 'Le debes a Budi (comisión del efectivo)', amount: -pending, owes: true }
    : { label: 'Por cobrar', amount: pending, owes: false };
}
