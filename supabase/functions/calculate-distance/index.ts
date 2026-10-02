// Supabase Edge Function: Calculate Distance using Google Distance Matrix API
// Returns real driving distance and duration between two points

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handlePreflight } from '../_shared/cors.ts';
import { osrmRoute } from '../_shared/routing.ts';
import { AuthError, requireUser } from '../_shared/auth.ts';
import { tooManyRequests, withinRateLimit } from '../_shared/rateLimit.ts';

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
  // Por carretera siempre es más que en línea recta: ×1.3 es la relación
  // típica en El Salvador (8.7 km por la Carretera al Puerto contra 4.6 km en
  // recta). Sin el factor, cuando OSRM no respondía, el Usuario veía bastante
  // menos distancia que el socio. Queda muy debajo del tope de 4× del servidor
  // (00060).
  const distanceKm = haversineDistance(originLat, originLng, destLat, destLng) * 1.3;
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

// Intenta ruta real por carretera (OSRM, gratis) y si no, cae a haversine.
async function calculateRoadDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<DistanceResponse> {
  const route = await osrmRoute(originLat, originLng, destLat, destLng);
  if (route) {
    return {
      success: true,
      distance_km: route.distance_km,
      distance_text: `${route.distance_km} km`,
      duration_minutes: route.duration_minutes,
      duration_text: `~${route.duration_minutes} min`,
      is_fallback: false, // es ruta real por carretera, no aproximacion
    };
  }
  return calculateFallback(originLat, originLng, destLat, destLng);
}

serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const cors = corsHeaders(req);

  try {
    // 1. Autenticar ANTES de mirar el payload.
    //
    // Esta funcion no tenia ninguna verificacion: alcanzaba la publishable key
    // —que es publica, va dentro del bundle de la app y del JS de la web— para
    // que cualquiera la usara como proxy de ruteo gratis. Con GOOGLE_MAPS_API_KEY
    // configurada eso es la Distance Matrix API facturandose a nuestra cuenta.
    //
    // `verify_jwt` del gateway NO alcanza para esto: da por buena la anon key,
    // que es justamente la que tiene cualquiera. Por eso la comprobacion va aca
    // adentro, igual que en get-eta.
    const auth = await requireUser(req);
    if (!(await withinRateLimit(auth.client, 'calculate-distance', 30, 60))) {
      return tooManyRequests(cors, 60);
    }

    // 2. Recien ahora, el payload.
    const payload: DistanceRequest = await req.json();
    const { origin_lat, origin_lng, destination_lat, destination_lng } = payload;

    // Validate coordinates
    if (!isValidCoordinate(origin_lat, origin_lng)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Coordenadas de origen invalidas o fuera de El Salvador',
        }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    if (!isValidCoordinate(destination_lat, destination_lng)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Coordenadas de destino invalidas o fuera de El Salvador',
        }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
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
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // Check if API key is configured
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('GOOGLE_MAPS_API_KEY not configured, using fallback');
      const fallbackResult = await calculateRoadDistance(origin_lat, origin_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
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
      const fallbackResult = await calculateRoadDistance(origin_lat, origin_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    clearTimeout(timeoutId);

    const data: GoogleDistanceMatrixResponse = await googleResponse.json();

    // Check API response status
    if (data.status !== 'OK') {
      console.error('Google API error:', data.status, data.error_message);
      // Use fallback on API error
      const fallbackResult = await calculateRoadDistance(origin_lat, origin_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const element = data.rows[0]?.elements[0];
    if (!element || element.status !== 'OK') {
      console.error('Google API element error:', element?.status);
      // Use fallback
      const fallbackResult = await calculateRoadDistance(origin_lat, origin_lng, destination_lat, destination_lng);
      return new Response(
        JSON.stringify(fallbackResult),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
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
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: error.status, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    console.error('Error calculating distance:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Error interno del servidor',
      }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
