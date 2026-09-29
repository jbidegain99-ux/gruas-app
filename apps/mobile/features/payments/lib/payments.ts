// Llamadas de pagos (migr. 00133, LAN-07). Tipos y textos en lib/servicePayments.
import { supabase } from '@/lib/supabase';
import { parseServicePayment, type PendingItem, type ServicePayment } from '@/lib/servicePayments';

export * from '@/lib/servicePayments';

export async function fetchServicePayment(requestId: string): Promise<ServicePayment | null> {
  const { data, error } = await supabase.rpc('service_payment', { p_request: requestId });
  if (error) throw error;
  return parseServicePayment(data);
}

export async function confirmCash(requestId: string): Promise<ServicePayment | null> {
  const { data, error } = await supabase.rpc('operator_confirm_cash', { p_request: requestId });
  if (error) throw error;
  return parseServicePayment(data);
}

export async function fetchOperatorPendingCash(): Promise<PendingItem[]> {
  const { data, error } = await supabase.rpc('operator_pending_cash');
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => ({ ...r, amount: Number(r.amount) || 0 })) as PendingItem[];
}

export async function fetchMyPendingPayments(): Promise<PendingItem[]> {
  const { data, error } = await supabase.rpc('my_pending_payments');
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => ({ ...r, amount: Number(r.amount) || 0 })) as PendingItem[];
}
