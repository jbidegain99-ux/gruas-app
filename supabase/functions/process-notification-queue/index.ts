import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationQueueItem {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
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

    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get unsent notifications (limit to 100 per batch)
    const { data: notifications, error: fetchError } = await supabase
      .from('notification_queue')
      .select('id, user_id, title, body, data')
      .eq('sent', false)
      .order('created_at', { ascending: true })
      .limit(100);

    if (fetchError) {
      console.error('Error fetching notification queue:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch notification queue' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!notifications || notifications.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No pending notifications' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Processing ${notifications.length} pending notifications`);

    let successCount = 0;
    let errorCount = 0;

    // Process each notification
    for (const notification of notifications as NotificationQueueItem[]) {
      try {
        // Get user's device tokens
        const { data: tokens, error: tokensError } = await supabase
          .from('device_tokens')
          .select('expo_push_token')
          .eq('user_id', notification.user_id)
          .eq('is_active', true);

        if (tokensError) {
          console.error(`Error fetching tokens for user ${notification.user_id}:`, tokensError);
          await markNotificationError(supabase, notification.id, 'Failed to fetch tokens');
          errorCount++;
          continue;
        }

        if (!tokens || tokens.length === 0) {
          // No tokens - mark as sent (nothing to do)
          await markNotificationSent(supabase, notification.id);
          successCount++;
          continue;
        }

        // Build messages
        const messages: ExpoPushMessage[] = tokens.map((token) => ({
          to: token.expo_push_token,
          title: notification.title,
          body: notification.body,
          data: notification.data,
          sound: 'default',
          channelId: 'service_updates',
          priority: 'high',
        }));

        // Send to Expo
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messages),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Expo API error:', errorText);
          await markNotificationError(supabase, notification.id, `Expo API error: ${response.status}`);
          errorCount++;
          continue;
        }

        const result = await response.json();
        const tickets = result.data as ExpoPushTicket[];

        // Handle invalid tokens
        for (let i = 0; i < tickets.length; i++) {
          if (tickets[i].details?.error === 'DeviceNotRegistered') {
            await supabase
              .from('device_tokens')
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq('expo_push_token', tokens[i].expo_push_token);
          }
        }

        // Mark notification as sent
        await markNotificationSent(supabase, notification.id);
        successCount++;

      } catch (err) {
        console.error(`Error processing notification ${notification.id}:`, err);
        await markNotificationError(supabase, notification.id, String(err));
        errorCount++;
      }
    }

    console.log(`Processed ${successCount} successfully, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: notifications.length,
        sent: successCount,
        errors: errorCount,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Exception in process-notification-queue:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function markNotificationSent(supabase: any, notificationId: string) {
  await supabase
    .from('notification_queue')
    .update({ sent: true, sent_at: new Date().toISOString() })
    .eq('id', notificationId);
}

async function markNotificationError(supabase: any, notificationId: string, error: string) {
  await supabase
    .from('notification_queue')
    .update({ error })
    .eq('id', notificationId);
}
