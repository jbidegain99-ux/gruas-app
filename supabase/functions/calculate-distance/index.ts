// Supabase Edge Function: Calculate Distance using Google Distance Matrix API
// Returns real driving distance and duration between two points

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');

// El Salvador coordinate boundaries
const EL_SALVADOR_BOUNDS = {
  minLat: 13.0,
  maxLat: 14.5,
  minLng: -90.2,
  maxLng: -87.5,
};

interface DistanceRequest {
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
}

interface DistanceResponse {
  success: boolean;
  distance_km: number;
  distance_text: string;
  duration_minutes: number;
  duration_text: string;
  is_fallback?: boolean;
  error?: string;
}

interface GoogleDistanceMatrixResponse {
  status: string;
  rows: Array<{
    elements: Array<{
      status: string;
      distance: {
        value: number; // meters
        text: string;
      };
      duration: {
        value: number; // seconds
        text: string;
      };
    }>;
  }>;
  error_message?: string;
}

// Haversine formula for fallback distance calculation
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLineDistance = R * c;

  // Multiply by 1.3 to approximate road distance (roads are not straight)
  return straightLineDistance * 1.3;
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= EL_SALVADOR_BOUNDS.minLat &&
    lat <= EL_SALVADOR_BOUNDS.maxLat &&
    lng >= EL_SALVADOR_BOUNDS.minLng &&
    lng <= EL_SALVADOR_BOUNDS.maxLng
  );
}

function calculateFallback(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): DistanceResponse {
  const distanceKm = haversineDistance(originLat, originLng, destLat, destLng);
  // Estimate duration: average 30 km/h in urban El Salvador
  const durationMinutes = Math.round((distanceKm / 30) * 60);

  return {
    success: true,
    distance_km: Math.round(distanceKm * 10) / 10,
    distance_text: `~${Math.round(distanceKm)} km`,
    duration_minutes: durationMinutes,
    duration_text: `~${durationMinutes} min`,
    is_fallback: true,
  };
}

serve(async (req: Request) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: DistanceRequest = await req.json();
    const { origin_lat, origin_lng, destination_lat, destination_lng } = payload;

    // Validate coordinates
    if (!isValidCoordinate(origin_lat, origin_lng)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Coordenadas de origen invalidas o fuera de El Salvador',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isValidCoordinate(destination_lat, destination_lng)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Coordenadas de destino invalidas o fuera de El Salvador',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if points are too close (less than 500m)
    const quickDistance = haversineDistance(origin_lat, origin_lng, destination_lat, destination_lng);
    if (quickDistance < 0.5) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'El origen y destino estan muy cerca (menos de 500m)',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if API key is configured
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('GOOGLE_MAPS_API_KEY not configured, using fallback');
      const fallbackResult = calculateFallback(origin_lat, origin_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Google Distance Matrix API
    const apiUrl = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    apiUrl.searchParams.set('origins', `${origin_lat},${origin_lng}`);
    apiUrl.searchParams.set('destinations', `${destination_lat},${destination_lng}`);
    apiUrl.searchParams.set('mode', 'driving');
    apiUrl.searchParams.set('units', 'metric');
    apiUrl.searchParams.set('language', 'es');
    apiUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    let googleResponse: Response;
    try {
      googleResponse = await fetch(apiUrl.toString(), {
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.error('Google API fetch error:', fetchError);
      // Use fallback on network error
      const fallbackResult = calculateFallback(origin_lat, origin_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    clearTimeout(timeoutId);

    const data: GoogleDistanceMatrixResponse = await googleResponse.json();

    // Check API response status
    if (data.status !== 'OK') {
      console.error('Google API error:', data.status, data.error_message);
      // Use fallback on API error
      const fallbackResult = calculateFallback(origin_lat, origin_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const element = data.rows[0]?.elements[0];
    if (!element || element.status !== 'OK') {
      console.error('Google API element error:', element?.status);
      // Use fallback
      const fallbackResult = calculateFallback(origin_lat, origin_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract distance and duration
    const distanceKm = element.distance.value / 1000; // Convert meters to km
    const durationMinutes = Math.round(element.duration.value / 60); // Convert seconds to minutes

    const result: DistanceResponse = {
      success: true,
      distance_km: Math.round(distanceKm * 10) / 10,
      distance_text: element.distance.text,
      duration_minutes: durationMinutes,
      duration_text: element.duration.text,
      is_fallback: false,
    };

    console.log('Distance calculated:', result);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error calculating distance:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Error interno del servidor',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
