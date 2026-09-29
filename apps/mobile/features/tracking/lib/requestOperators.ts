import { supabase } from '@/lib/supabase';

/**
 * Nombre (y teléfono mientras el servicio está en curso) del socio asignado a
 * los servicios del Usuario — migr. 00138. El embed a `profiles` no sirve: RLS
 * no deja al Usuario leer el perfil de su socio, así que siempre volvía null.
 */
export async function fetchRequestOperators(
  ids: string[],
): Promise<Map<string, { name: string | null; phone: string | null }>> {
  const out = new Map<string, { name: string | null; phone: string | null }>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.rpc('my_request_operators', { p_request_ids: ids });
  if (error || !Array.isArray(data)) return out;
  for (const r of data) out.set(r.request_id, { name: r.operator_name ?? null, phone: r.operator_phone ?? null });
  return out;
}
