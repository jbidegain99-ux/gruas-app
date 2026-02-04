import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

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
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Exception in send-notification:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
