/**
 * fetch con tiempo máximo, para el cliente de Supabase.
 *
 * Sin esto, con el teléfono en una zona sin señal (la conexión queda abierta
 * pero no responde) un toque en "Completar servicio" dejaba el botón girando
 * para siempre, sin mensaje ni forma de reintentar. Con el tope, la llamada
 * falla y la pantalla muestra su error de siempre. Reintentar es seguro: las
 * RPC del servicio no duplican si la primera sí había llegado (ver la prueba de
 * simultaneidad de 2026-10-02).
 *
 * Las subidas a Storage (fotos de documentos) tienen más margen.
 */
export const API_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 60_000;

export function timeoutFor(url: string): number {
  return url.includes('/storage/v1/') ? UPLOAD_TIMEOUT_MS : API_TIMEOUT_MS;
}

type Fetch = typeof fetch;

export function fetchWithTimeout(baseFetch: Fetch, pick: (url: string) => number = timeoutFor): Fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const controller = new AbortController();
    // Respeta una cancelación del que llama (p. ej. supabase-js).
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const timer = setTimeout(() => controller.abort(), pick(url));
    return baseFetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}
