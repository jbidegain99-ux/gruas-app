// Eliminar la cuenta del usuario que llama (migr. 00101).
//
// Dos pasos, en este orden:
//   1. anonymize_account(): suprime los datos personales y deja el login
//      inservible. Tiene las guardas (rol, servicio en curso): si alguna
//      falla, no se toca nada.
//   2. Borra los archivos del usuario en Storage. Desde SQL no se puede (borrar
//      la fila de storage.objects deja el archivo), por eso esta funcion existe.
//
// Si el paso 2 falla, la cuenta YA quedo eliminada y `files_removed_at` queda
// NULL en account_deletions. La persona no puede reintentar (su login quedo
// bloqueado): los pendientes los ve el admin en esa tabla.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handlePreflight } from '../_shared/cors.ts';
import { AuthError, requireUser } from '../_shared/auth.ts';

// Todos guardan los archivos bajo `<user_id>/...` (verification.tsx, request.tsx).
const BUCKETS = ['id-documents', 'vehicle-documents', 'service-photos'];

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') return json({ success: false, error: 'Método no permitido' }, 405);

  let userId: string;
  try {
    ({ userId } = await requireUser(req));
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401;
    return json({ success: false, error: 'Sesión no válida' }, status);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Datos personales y login.
  const { error: rpcError } = await admin.rpc('anonymize_account', { p_user_id: userId });
  if (rpcError) {
    // Los mensajes de las guardas estan escritos para la persona ("Tenes un
    // servicio en curso..."): se devuelven tal cual.
    return json({ success: false, error: rpcError.message }, 409);
  }

  // 2. Archivos.
  const fileErrors: string[] = [];
  for (const bucket of BUCKETS) {
    const { data: files, error: listError } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
    if (listError) {
      fileErrors.push(`${bucket}: ${listError.message}`);
      continue;
    }
    const paths = (files ?? []).map((f) => `${userId}/${f.name}`);
    if (paths.length === 0) continue;
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) fileErrors.push(`${bucket}: ${removeError.message}`);
  }

  if (fileErrors.length === 0) {
    await admin.from('account_deletions').update({ files_removed_at: new Date().toISOString() }).eq('user_id', userId);
  } else {
    console.error('delete-account: archivos pendientes', userId, fileErrors);
  }

  // Para la persona la cuenta ya no existe, aunque queden archivos por borrar:
  // eso es trabajo pendiente de Budi, no algo que ella pueda resolver.
  return json({ success: true });
});
