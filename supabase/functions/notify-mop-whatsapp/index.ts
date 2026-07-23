// Supabase Edge Function: Notify MOP via WhatsApp
// This function sends a WhatsApp notification to MOP when a service request is created or completed

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handlePreflight } from '../_shared/cors.ts';

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_TOKEN');
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
const MOP_WHATSAPP_TO = Deno.env.get('MOP_WHATSAPP_TO');

interface RequestPayload {
  event_type: 'REQUEST_CREATED' | 'REQUEST_COMPLETED';
  request_id: string;
  incident_type: string;
  pickup_address: string;
  dropoff_address: string;
  tow_type: 'light' | 'heavy';
  user_name?: string;
  operator_name?: string;
  total_price?: number;
  created_at: string;
  completed_at?: string;
}

serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const cors = corsHeaders(req);

  try {
    // Validate environment variables
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !MOP_WHATSAPP_TO) {
      console.error('Missing WhatsApp configuration');
      return new Response(
        JSON.stringify({ error: 'WhatsApp not configured' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const payload: RequestPayload = await req.json();

    // Build message based on event type
    let message = '';

    if (payload.event_type === 'REQUEST_CREATED') {
      message = `🚗 *Nueva Solicitud de Grúa*

📋 *ID:* ${payload.request_id.substring(0, 8)}
🔧 *Tipo:* ${payload.incident_type}
🚚 *Grúa:* ${payload.tow_type === 'light' ? 'Liviana' : 'Pesada'}

📍 *Origen:* ${payload.pickup_address}
🎯 *Destino:* ${payload.dropoff_address}

👤 *Usuario:* ${payload.user_name || 'N/A'}
🕐 *Fecha:* ${new Date(payload.created_at).toLocaleString('es-SV')}

_Grúas App - El Salvador_`;
    } else if (payload.event_type === 'REQUEST_COMPLETED') {
      message = `✅ *Servicio Completado*

📋 *ID:* ${payload.request_id.substring(0, 8)}
🔧 *Tipo:* ${payload.incident_type}
🚚 *Grúa:* ${payload.tow_type === 'light' ? 'Liviana' : 'Pesada'}

📍 *Origen:* ${payload.pickup_address}
🎯 *Destino:* ${payload.dropoff_address}

👤 *Usuario:* ${payload.user_name || 'N/A'}
👷 *Operador:* ${payload.operator_name || 'N/A'}
💰 *Total:* $${payload.total_price || 'N/A'}

🕐 *Creado:* ${new Date(payload.created_at).toLocaleString('es-SV')}
🕑 *Completado:* ${payload.completed_at ? new Date(payload.completed_at).toLocaleString('es-SV') : 'N/A'}

_Grúas App - El Salvador_`;
    }

    // Send WhatsApp message via Cloud API
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: MOP_WHATSAPP_TO,
          type: 'text',
          text: {
            preview_url: false,
            body: message,
          },
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('WhatsApp API error:', result);
      return new Response(
        JSON.stringify({ error: 'Failed to send WhatsApp message', details: result }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    console.log('WhatsApp notification sent:', result);

    return new Response(
      JSON.stringify({ success: true, message_id: result.messages?.[0]?.id }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending WhatsApp notification:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
