// Supabase Edge Function: Get ETA with Traffic
// Returns estimated time of arrival considering real-time traffic conditions
// Uses Google Directions API with departure_time=now

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface GoogleDirectionsResponse {
  status: string;
  routes: Array<{
    legs: Array<{
      distance: { value: number; text: string };
      duration: { value: number; text: string };
      duration_in_traffic?: { value: number; text: string };
    }>;
    overview_polyline?: { points: string };
  }>;
  error_message?: string;
}

// Haversine formula for fallback calculation
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1.3; // 1.3 factor to approximate road distance
}

function calculateFallback(opLat: number, opLng: number, destLat: number, destLng: number) {
  const distanceKm = haversineDistance(opLat, opLng, destLat, destLng);
  const etaMinutes = Math.max(1, Math.round((distanceKm / 25) * 60));
  return {
    success: true,
    eta_minutes: etaMinutes,
    eta_text: `~${etaMinutes} min`,
    distance_km: Math.round(distanceKm * 10) / 10,
    distance_text: `~${Math.round(distanceKm)} km`,
    is_fallback: true,
  };
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    !isNaN(lat) && !isNaN(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

/**
 * Parse coordinates from multiple input formats:
 * 1. { operator_lat, operator_lng, destination_lat, destination_lng }
 * 2. { operator: "lat,lng", destination: "lat,lng" }
 */
function parseCoordinates(payload: Record<string, unknown>): {
  operator_lat: number; operator_lng: number;
  destination_lat: number; destination_lng: number;
} | null {
  // Format 1: explicit lat/lng fields
  if (typeof payload.operator_lat === 'number' && typeof payload.operator_lng === 'number' &&
      typeof payload.destination_lat === 'number' && typeof payload.destination_lng === 'number') {
    return {
      operator_lat: payload.operator_lat,
      operator_lng: payload.operator_lng,
      destination_lat: payload.destination_lat,
      destination_lng: payload.destination_lng,
    };
  }

  // Format 2: "lat,lng" strings
  if (typeof payload.operator === 'string' && typeof payload.destination === 'string') {
    const opParts = payload.operator.split(',').map(Number);
    const destParts = payload.destination.split(',').map(Number);
    if (opParts.length === 2 && destParts.length === 2 &&
        opParts.every(n => !isNaN(n)) && destParts.every(n => !isNaN(n))) {
      return {
        operator_lat: opParts[0],
        operator_lng: opParts[1],
        destination_lat: destParts[0],
        destination_lng: destParts[1],
      };
    }
  }

  return null;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request body
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      console.error('[get-eta] Failed to parse request body');
      return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
    }

    console.log('[get-eta] Request received:', JSON.stringify(payload));

    // Parse coordinates (supports both formats)
    const coords = parseCoordinates(payload);
    if (!coords) {
      console.error('[get-eta] Could not parse coordinates from payload');
      return jsonResponse({
        success: false,
        error: 'Invalid coordinates. Send {operator_lat, operator_lng, destination_lat, destination_lng} or {operator: "lat,lng", destination: "lat,lng"}',
      }, 400);
    }

    const { operator_lat, operator_lng, destination_lat, destination_lng } = coords;

    // Validate coordinate ranges
    if (!isValidCoordinate(operator_lat, operator_lng)) {
      return jsonResponse({ success: false, error: 'Invalid operator coordinates' }, 400);
    }
    if (!isValidCoordinate(destination_lat, destination_lng)) {
      return jsonResponse({ success: false, error: 'Invalid destination coordinates' }, 400);
    }

    // Check if API key is configured
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('[get-eta] GOOGLE_MAPS_API_KEY not configured — returning fallback (NO polyline)');
      return jsonResponse(calculateFallback(operator_lat, operator_lng, destination_lat, destination_lng));
    }

    console.log('[get-eta] Calling Google Directions API:', {
      origin: `${operator_lat},${operator_lng}`,
      destination: `${destination_lat},${destination_lng}`,
      apiKeyPrefix: GOOGLE_MAPS_API_KEY.substring(0, 12) + '...',
    });

    // Call Google Directions API
    const apiUrl = new URL('https://maps.googleapis.com/maps/api/directions/json');
    apiUrl.searchParams.set('origin', `${operator_lat},${operator_lng}`);
    apiUrl.searchParams.set('destination', `${destination_lat},${destination_lng}`);
    apiUrl.searchParams.set('mode', 'driving');
    apiUrl.searchParams.set('departure_time', 'now');
    apiUrl.searchParams.set('traffic_model', 'best_guess');
    apiUrl.searchParams.set('language', 'es');
    apiUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let googleResponse: Response;
    try {
      googleResponse = await fetch(apiUrl.toString(), { signal: controller.signal });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.error('[get-eta] Google API fetch error:', String(fetchError));
      return jsonResponse(calculateFallback(operator_lat, operator_lng, destination_lat, destination_lng));
    }
    clearTimeout(timeoutId);

    if (!googleResponse.ok) {
      console.error('[get-eta] Google API HTTP error:', googleResponse.status, googleResponse.statusText);
      return jsonResponse(calculateFallback(operator_lat, operator_lng, destination_lat, destination_lng));
    }

    let data: GoogleDirectionsResponse;
    try {
      data = await googleResponse.json();
    } catch {
      console.error('[get-eta] Failed to parse Google API response');
      return jsonResponse(calculateFallback(operator_lat, operator_lng, destination_lat, destination_lng));
    }

    console.log('[get-eta] Google Directions status:', data.status,
      data.error_message ? `(${data.error_message})` : '');

    if (data.status !== 'OK' || !data.routes?.length) {
      console.error('[get-eta] Google API error:', data.status, data.error_message);
      return jsonResponse(calculateFallback(operator_lat, operator_lng, destination_lat, destination_lng));
    }

    const leg = data.routes[0]?.legs[0];
    if (!leg) {
      console.error('[get-eta] No route leg found');
      return jsonResponse(calculateFallback(operator_lat, operator_lng, destination_lat, destination_lng));
    }

    const duration = leg.duration_in_traffic || leg.duration;
    const etaMinutes = Math.ceil(duration.value / 60);
    const distanceKm = leg.distance.value / 1000;
    const overviewPolyline = data.routes[0]?.overview_polyline?.points;

    const result = {
      success: true,
      eta_minutes: etaMinutes,
      eta_text: duration.text,
      distance_km: Math.round(distanceKm * 10) / 10,
      distance_text: leg.distance.text,
      is_fallback: false,
      overview_polyline: overviewPolyline || null,
    };

    console.log('[get-eta] Success:', {
      eta: result.eta_text,
      distance: result.distance_text,
      has_polyline: !!overviewPolyline,
      polyline_length: overviewPolyline?.length || 0,
    });

    return jsonResponse(result);

  } catch (error) {
    console.error('[get-eta] Unhandled error:', String(error), error instanceof Error ? error.stack : '');
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
});
