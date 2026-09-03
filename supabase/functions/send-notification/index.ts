import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handlePreflight } from '../_shared/cors.ts';

interface NotificationRequest {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channel_id?: string;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  badge?: number;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const cors = corsHeaders(req);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Create Supabase client with service role for admin access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { user_id, title, body, data, channel_id } = await req.json() as NotificationRequest;

    // Validate required fields
    if (!user_id || !title || !body) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: user_id, title, body' }),
        {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      );
    }

    // user_id tiene que ser un UUID: mas abajo va interpolado en un filtro
    // PostgREST `.or(...)`, asi que un valor con comas/parentesis podria alterar
    // el filtro. Validarlo aqui cierra esa inyeccion.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(user_id)) {
      return new Response(
        JSON.stringify({ error: 'user_id invalido' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // --- Autorizacion (00061) --------------------------------------------
    // Esta funcion corre con service_role (salta RLS) y aceptaba cualquier JWT
    // valido: un usuario autenticado podia mandar una push arbitraria (titulo,
    // cuerpo y `data` de deep-link) a CUALQUIER user_id -> spam / phishing. Se
    // exige que el llamador tenga un servicio EN CURSO con el destinatario, o
    // que sea el sistema (service_role, que drena notificaciones legitimas).
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isSystem = bearer.length > 0 && bearer === supabaseServiceKey;

    if (!isSystem) {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: caller } } = await callerClient.auth.getUser();
      if (!caller) {
        return new Response(
          JSON.stringify({ error: 'No autorizado' }),
          { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      // Debe existir un servicio entre el llamador y el destinatario, en
      // cualquiera de los dos sentidos (operador->cliente o cliente->operador).
      // Se incluye 'completed' porque la app manda la push de cierre DESPUES de
      // pasar el servicio a completed; pero solo dentro de una ventana corta,
      // para que un operador no pueda notificar a un ex-cliente para siempre.
      const RECENT_MS = 24 * 60 * 60 * 1000;
      const { data: rel } = await supabase
        .from('service_requests')
        .select('id, status, completed_at')
        .or(
          `and(operator_id.eq.${caller.id},user_id.eq.${user_id}),` +
          `and(user_id.eq.${caller.id},operator_id.eq.${user_id})`
        )
        .in('status', ['assigned', 'en_route', 'active', 'completed'])
        .order('created_at', { ascending: false })
        .limit(1);

      const authorized = !!rel && rel.length > 0 && (
        rel[0].status !== 'completed' ||
        (!!rel[0].completed_at &&
          Date.now() - new Date(rel[0].completed_at as string).getTime() < RECENT_MS)
      );

      if (!authorized) {
        return new Response(
          JSON.stringify({ error: 'No autorizado para notificar a este usuario' }),
          { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }
    }
    // ---------------------------------------------------------------------

    // Get user's active device tokens
    const { data: tokens, error: tokensError } = await supabase
      .from('device_tokens')
      .select('expo_push_token, device_type')
      .eq('user_id', user_id)
      .eq('is_active', true);

    if (tokensError) {
      console.error('Error fetching device tokens:', tokensError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch device tokens' }),
        {
          status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!tokens || tokens.length === 0) {
      console.log(`No active device tokens found for user ${user_id}`);
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No active device tokens',
          sent: 0,
        }),
        {
          status: 200,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      );
    }

    // Build Expo push messages
    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token.expo_push_token,
      title,
      body,
      data: data || {},
      sound: 'default',
      channelId: channel_id || 'service_updates',
      priority: 'high',
    }));

    // Send to Expo Push API
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Expo Push API error:', result);
      return new Response(
        JSON.stringify({ error: 'Failed to send push notification', details: result }),
        {
          status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      );
    }

    // Check for individual ticket errors
    const tickets = result.data as ExpoPushTicket[];
    const errors: string[] = [];

    tickets.forEach((ticket, index) => {
      if (ticket.status === 'error') {
        console.error(`Push notification error for token ${index}:`, ticket.message);
        errors.push(ticket.message || 'Unknown error');

        // Handle invalid token - mark as inactive
        if (ticket.details?.error === 'DeviceNotRegistered') {
          const tokenToDeactivate = tokens[index].expo_push_token;
          supabase
            .from('device_tokens')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('expo_push_token', tokenToDeactivate)
            .then(({ error }) => {
              if (error) {
                console.error('Error deactivating invalid token:', error);
              } else {
                console.log('Deactivated invalid token:', tokenToDeactivate);
              }
            });
        }
      }
    });

    const successCount = tickets.filter((t) => t.status === 'ok').length;

    console.log(`Sent ${successCount}/${tokens.length} notifications to user ${user_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        sent: successCount,
        total: tokens.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Exception in send-notification:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    );
  }
});
