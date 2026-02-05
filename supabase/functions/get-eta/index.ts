// Supabase Edge Function: Get ETA with Traffic
// Returns estimated time of arrival considering real-time traffic conditions
// Uses Google Directions API with departure_time=now

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');

interface ETARequest {
  operator_lat: number;
  operator_lng: number;
  destination_lat: number;
  destination_lng: number;
}

interface ETAResponse {
  success: boolean;
  eta_minutes: number;
  eta_text: string;
  distance_km: number;
  distance_text: string;
  is_fallback?: boolean;
  error?: string;
}

interface GoogleDirectionsResponse {
  status: string;
  routes: Array<{
    legs: Array<{
      distance: {
        value: number;
        text: string;
      };
      duration: {
        value: number;
        text: string;
      };
      duration_in_traffic?: {
        value: number;
        text: string;
      };
    }>;
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

function calculateFallback(
  operatorLat: number,
  operatorLng: number,
  destLat: number,
  destLng: number
): ETAResponse {
  const distanceKm = haversineDistance(operatorLat, operatorLng, destLat, destLng);
  // Estimate: 25 km/h average in urban traffic
  const etaMinutes = Math.round((distanceKm / 25) * 60);

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
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: ETARequest = await req.json();
    const { operator_lat, operator_lng, destination_lat, destination_lng } = payload;

    // Validate coordinates
    if (!isValidCoordinate(operator_lat, operator_lng)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Coordenadas del operador invalidas',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isValidCoordinate(destination_lat, destination_lng)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Coordenadas de destino invalidas',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if API key is configured
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('GOOGLE_MAPS_API_KEY not configured, using fallback');
      const fallbackResult = calculateFallback(operator_lat, operator_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Google Directions API with traffic data
    const apiUrl = new URL('https://maps.googleapis.com/maps/api/directions/json');
    apiUrl.searchParams.set('origin', `${operator_lat},${operator_lng}`);
    apiUrl.searchParams.set('destination', `${destination_lat},${destination_lng}`);
    apiUrl.searchParams.set('mode', 'driving');
    apiUrl.searchParams.set('departure_time', 'now'); // Required for duration_in_traffic
    apiUrl.searchParams.set('traffic_model', 'best_guess');
    apiUrl.searchParams.set('language', 'es');
    apiUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let googleResponse: Response;
    try {
      googleResponse = await fetch(apiUrl.toString(), {
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.error('Google API fetch error:', fetchError);
      const fallbackResult = calculateFallback(operator_lat, operator_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    clearTimeout(timeoutId);

    const data: GoogleDirectionsResponse = await googleResponse.json();

    if (data.status !== 'OK') {
      console.error('Google API error:', data.status, data.error_message);
      const fallbackResult = calculateFallback(operator_lat, operator_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const leg = data.routes[0]?.legs[0];
    if (!leg) {
      console.error('No route found');
      const fallbackResult = calculateFallback(operator_lat, operator_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use duration_in_traffic if available, otherwise fall back to regular duration
    const duration = leg.duration_in_traffic || leg.duration;
    const etaMinutes = Math.ceil(duration.value / 60);
    const distanceKm = leg.distance.value / 1000;

    const result: ETAResponse = {
      success: true,
      eta_minutes: etaMinutes,
      eta_text: duration.text,
      distance_km: Math.round(distanceKm * 10) / 10,
      distance_text: leg.distance.text,
      is_fallback: false,
    };

    console.log('ETA calculated:', result);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error calculating ETA:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Error interno del servidor',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
