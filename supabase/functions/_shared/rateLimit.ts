// Límite de frecuencia para Edge Functions (migr. 00116, backlog LAN-02).
//
// La cuenta la lleva la base (`rate_limit_hit`). Con el cliente de una sesión
// el sujeto es siempre esa persona; con service_role hay que pasar `subject`
// (la IP, la aseguradora...).
//
// Falla abierta: si la base no responde, la llamada sigue. Un tope caído no
// debe tumbar el cálculo de ETA en medio de un servicio.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function withinRateLimit(
  client: SupabaseClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
  subject?: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('rate_limit_hit', {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
    p_subject: subject ?? null,
  });
  if (error) {
    console.error(`[rate-limit] ${bucket}: ${error.message}`);
    return true;
  }
  return data === true;
}

/** IP del cliente según el proxy del gateway (primera de X-Forwarded-For). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'desconocida';
}

export function tooManyRequests(cors: Record<string, string>, retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ success: false, error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' }),
    {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) },
    },
  );
}
