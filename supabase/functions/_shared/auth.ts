// JWT/auth helpers for Edge Functions. Use when a function needs to
// know *which* user is calling and verify they're allowed to touch a
// specific resource (not just "they have a valid token").
//
// Note: when supabase/config.toml sets `verify_jwt = true` for a function
// (the platform default), the runtime already rejects requests without a
// bearer token before our handler runs. These helpers go further by
// pulling the user identity out of that token and checking it against
// the row the caller is asking about.

import {
  createClient,
  SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

export interface AuthContext {
  userId: string;
  client: SupabaseClient;
}

/**
 * Resolve the calling user from the Authorization header.
 *
 * Throws on missing/invalid JWT. Returns both the userId and a Supabase
 * client that carries the caller's JWT, so subsequent .from() / .rpc()
 * calls are subject to RLS as that user — *not* as service_role.
 */
export async function requireUser(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header', 401);
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new AuthError('Invalid or expired session', 401);
  }

  return { userId: data.user.id, client };
}

/**
 * Verify the caller is either the requester (user_id) or the assigned
 * operator (operator_id) for a given service_request. ADMIN is allowed
 * unconditionally because they need to debug/intervene.
 *
 * Throws AuthError on any deny. Returns silently on allow.
 */
export async function requireRequestParticipant(
  ctx: AuthContext,
  requestId: string,
): Promise<void> {
  // Use the user-scoped client so RLS prevents enumerating requests
  // that don't belong to the caller — the .single() fails if RLS
  // hides the row, giving the same "not found" error either way.
  const { data: request, error } = await ctx.client
    .from('service_requests')
    .select('user_id, operator_id')
    .eq('id', requestId)
    .maybeSingle();

  if (error) {
    throw new AuthError(`Failed to load request: ${error.message}`, 500);
  }
  if (!request) {
    throw new AuthError('Request not found or access denied', 404);
  }

  const isUser = request.user_id === ctx.userId;
  const isOperator = request.operator_id === ctx.userId;

  if (isUser || isOperator) return;

  // Last check: admin override. Read the role via the user-scoped client
  // (profiles RLS already lets a user read their own row). Surface a read
  // failure as 500 instead of swallowing it — otherwise a transient error or
  // an RLS regression would silently demote a real ADMIN to a 403.
  const { data: profile, error: profileError } = await ctx.client
    .from('profiles')
    .select('role')
    .eq('id', ctx.userId)
    .maybeSingle();

  if (profileError) {
    throw new AuthError(`Failed to verify admin role: ${profileError.message}`, 500);
  }
  if (profile?.role === 'ADMIN') return;

  throw new AuthError('Not a participant of this request', 403);
}

export class AuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'AuthError';
  }
}
