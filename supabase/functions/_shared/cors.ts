// CORS helper for Edge Functions. Resolves Access-Control-Allow-Origin
// from the ALLOWED_ORIGINS env var instead of hardcoding `*`.
//
// Configure in production by setting (Supabase Dashboard -> Edge Functions
// -> Secrets, or via `supabase secrets set`):
//
//   ALLOWED_ORIGINS=https://app.budi.sv,https://admin.budi.sv
//
// Default (when unset): `*` so local dev keeps working. The mobile app
// does not send an Origin header — CORS doesn't apply to it — so
// restricting Origin only affects browser callers.

const RAW_ALLOWED_ORIGINS = Deno.env.get('ALLOWED_ORIGINS');

const ALLOWED = (RAW_ALLOWED_ORIGINS ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// An empty list (unset, or set to "" / "," to "disable" the allowlist) means
// allow-all — NOT a literal 'null' origin that would block every browser. The
// only way to restrict is to name real origins.
const ALLOW_ALL = ALLOWED.length === 0 || ALLOWED.includes('*');

// Fail loud, not silent: if the wildcard is in effect because the secret
// was never set (or left empty), surface it in the function logs so a prod
// deploy that forgot to configure ALLOWED_ORIGINS is obvious, not quietly open.
if (ALLOW_ALL) {
  console.warn(
    ALLOWED.includes('*')
      ? '[cors] ALLOWED_ORIGINS includes "*"; all origins are allowed.'
      : '[cors] ALLOWED_ORIGINS is not set or empty; defaulting to "*" (all ' +
          'origins). Set it to your real origins (e.g. https://app.budi.sv) before production.',
  );
}

/**
 * Build the standard CORS header set for an incoming request.
 *
 * - If ALLOWED_ORIGINS contains `*`, echo the request Origin (or `*` when
 *   missing). Browsers refuse `*` together with credentials; echoing the
 *   actual Origin keeps credentialed fetches working in dev.
 * - Otherwise echo the Origin only if it's in the allowlist. If the
 *   browser sent a disallowed Origin we fall back to the first allowed
 *   one — the browser will block the response anyway, but we don't leak
 *   that the disallowed Origin "passed".
 * - Always emit Vary: Origin so caches don't mix responses per-Origin.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');

  let allowOrigin: string;
  if (ALLOW_ALL) {
    allowOrigin = origin ?? '*';
  } else if (origin && ALLOWED.includes(origin)) {
    allowOrigin = origin;
  } else {
    allowOrigin = ALLOWED[0] ?? 'null';
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

/**
 * Convenience handler for OPTIONS preflight requests. Returns null when
 * the request is not a preflight, so the caller can keep its `if` flat:
 *
 *   const preflight = handlePreflight(req);
 *   if (preflight) return preflight;
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response('ok', { headers: corsHeaders(req) });
}
