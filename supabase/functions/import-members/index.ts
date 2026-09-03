// Edge Function: carga de padron de afiliados por la aseguradora  (B-10)
//
// La aseguradora no tiene cuenta en la plataforma —su portal es B-17— asi que
// no puede autenticarse con un JWT de Supabase. Se autentica con una clave de
// API propia, emitida desde el panel de administracion.
//
// Por eso esta funcion corre con `verify_jwt = false` en config.toml: el
// gateway no puede validar la credencial, la valida esta funcion. La clave
// viaja en `Authorization: Bearer budi_...` y se compara contra el SHA-256
// guardado (`verify_insurer_api_key`); el valor en claro no existe en la base.
//
// El alcance lo pone la base, no este archivo: `import_members_for_insurer`
// comprueba que la poliza pertenezca a la aseguradora de la clave, de modo que
// una credencial filtrada nunca alcanza el padron de otra aseguradora.
//
// Contrato documentado en docs/API_AFILIADOS.md.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handlePreflight } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Tope por peticion. Un padron grande se sube por paginas: evita peticiones que
// agoten el tiempo de la funcion y deja un error claro en vez de un timeout.
const MAX_MEMBERS = 1000;

type Payload = {
  policy_number?: string;
  members?: unknown;
};

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const cors = corsHeaders(req);

  if (req.method !== 'POST') {
    return json({ error: 'Use POST' }, 405, cors);
  }

  try {
    const auth = req.headers.get('Authorization') ?? '';
    const apiKey = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

    if (!apiKey) {
      return json({ error: 'Falta la cabecera Authorization: Bearer <clave>' }, 401, cors);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: insurerId, error: keyError } = await supabase.rpc('verify_insurer_api_key', {
      p_key: apiKey,
    });

    if (keyError) {
      console.error('Error validando la clave:', keyError);
      return json({ error: 'No se pudo validar la credencial' }, 500, cors);
    }
    // Mismo mensaje para clave inexistente, revocada o de aseguradora inactiva:
    // distinguirlos le diria a quien prueba claves cuales existen.
    if (!insurerId) {
      return json({ error: 'Credencial invalida o revocada' }, 401, cors);
    }

    let payload: Payload;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'El cuerpo debe ser JSON valido' }, 400, cors);
    }

    const policyNumber = typeof payload.policy_number === 'string' ? payload.policy_number.trim() : '';
    if (!policyNumber) {
      return json({ error: 'Falta policy_number' }, 400, cors);
    }
    if (!Array.isArray(payload.members)) {
      return json({ error: 'members debe ser un arreglo' }, 400, cors);
    }
    if (payload.members.length === 0) {
      return json({ error: 'members esta vacio' }, 400, cors);
    }
    if (payload.members.length > MAX_MEMBERS) {
      return json(
        { error: `Maximo ${MAX_MEMBERS} afiliados por peticion; envie el padron por paginas` },
        413,
        cors
      );
    }

    const { data, error } = await supabase.rpc('import_members_for_insurer', {
      p_insurer_id: insurerId,
      p_policy_number: policyNumber,
      p_members: payload.members,
    });

    if (error) {
      // El caso habitual es una poliza que no existe o que no es de esta
      // aseguradora: es un error del que llama, no del servidor.
      const noEsSuya = /No existe la poliza/i.test(error.message ?? '');
      console.error('Error importando afiliados:', error);
      return json({ error: error.message }, noEsSuya ? 404 : 500, cors);
    }

    return json({ policy_number: policyNumber, ...data }, 200, cors);
  } catch (err) {
    console.error('Error inesperado en import-members:', err);
    return json({ error: 'Error interno' }, 500, cors);
  }
});
