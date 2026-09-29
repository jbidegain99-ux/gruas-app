// Edge Function: Get ETA with traffic.
// Returns estimated time of arrival from operator coords to destination,
// using Google Directions API with departure_time=now. Falls back to a
// Haversine estimate when the API key is unset or Google fails.
//
// Authorization model (since 2026-05-25):
//   1. The Supabase runtime verifies the JWT (config.toml has
//      [functions.get-eta] verify_jwt = true).
//   2. We additionally require the caller to be the USER or the assigned
//      OPERATOR of the request_id in the payload (ADMIN also allowed).
//      This closes the prior leak where any anon caller with a request_id
//      could pull the operator's live coordinates.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handlePreflight } from '../_shared/cors.ts';
import { AuthError, requireRequestParticipant, requireUser } from '../_shared/auth.ts';
import { osrmRoute } from '../_shared/routing.ts';
import { tooManyRequests, withinRateLimit } from '../_shared/rateLimit.ts';

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
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

// Ruta real por carretera (OSRM, gratis) -> devuelve tambien la polyline para
// dibujar la ruta en el mapa. Si OSRM falla, cae a haversine (sin polyline).
async function resolveEtaWithRoute(opLat: number, opLng: number, destLat: number, destLng: number) {
  const route = await osrmRoute(opLat, opLng, destLat, destLng);
  if (route) {
    return {
      success: true,
      eta_minutes: route.duration_minutes,
      eta_text: `~${route.duration_minutes} min`,
      distance_km: route.distance_km,
      distance_text: `${route.distance_km} km`,
      is_fallback: false,
      overview_polyline: route.polyline,
    };
  }
  return calculateFallback(opLat, opLng, destLat, destLng);
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
  if (typeof payload.operator_lat === 'number' && typeof payload.operator_lng === 'number' &&
      typeof payload.destination_lat === 'number' && typeof payload.destination_lng === 'number') {
    return {
      operator_lat: payload.operator_lat,
      operator_lng: payload.operator_lng,
      destination_lat: payload.destination_lat,
      destination_lng: payload.destination_lng,
    };
  }

  if (typeof payload.operator === 'string' && typeof payload.destination === 'string') {
    const opParts = payload.operator.split(',').map(Number);
    const destParts = payload.destination.split(',').map(Number);
    if (opParts.length === 2 && destParts.length === 2 &&
        opParts.every((n) => !isNaN(n)) && destParts.every((n) => !isNaN(n))) {
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
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    // 1. Authenticate the caller.
    const auth = await requireUser(req);

    // La app la llama 1 vez por minuto por servicio; 60/min por persona deja
    // holgura para reintentos y corta el abuso de la API de Google.
    if (!(await withinRateLimit(auth.client, 'get-eta', 60, 60))) {
      return tooManyRequests(corsHeaders(req), 60);
    }

    // 2. Parse payload.
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse(req, { success: false, error: 'Invalid JSON body' }, 400);
    }

    // 3. Require request_id and authorize the caller against it.
    const requestId = typeof payload.request_id === 'string' ? payload.request_id : null;
    if (!requestId) {
      return jsonResponse(req, {
        success: false,
        error: 'Missing request_id. Pass the service_requests row this ETA is for.',
      }, 400);
    }
    await requireRequestParticipant(auth, requestId);

    // 4. Parse coordinates.
    const coords = parseCoordinates(payload);
    if (!coords) {
      return jsonResponse(req, {
        success: false,
        error: 'Invalid coordinates. Send {operator_lat, operator_lng, destination_lat, destination_lng} or {operator: "lat,lng", destination: "lat,lng"}',
      }, 400);
    }

    const { operator_lat, operator_lng, destination_lat, destination_lng } = coords;

    if (!isValidCoordinate(operator_lat, operator_lng)) {
      return jsonResponse(req, { success: false, error: 'Invalid operator coordinates' }, 400);
    }
    if (!isValidCoordinate(destination_lat, destination_lng)) {
      return jsonResponse(req, { success: false, error: 'Invalid destination coordinates' }, 400);
    }

    // 5. Resolve ETA. Fall back to Haversine on any failure path.
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('[get-eta] GOOGLE_MAPS_API_KEY not configured — returning fallback (NO polyline)');
      return jsonResponse(req, await resolveEtaWithRoute(operator_lat, operator_lng, destination_lat, destination_lng));
    }

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
      return jsonResponse(req, await resolveEtaWithRoute(operator_lat, operator_lng, destination_lat, destination_lng));
    }
    clearTimeout(timeoutId);

    if (!googleResponse.ok) {
      console.error('[get-eta] Google API HTTP error:', googleResponse.status, googleResponse.statusText);
      return jsonResponse(req, await resolveEtaWithRoute(operator_lat, operator_lng, destination_lat, destination_lng));
    }

    let data: GoogleDirectionsResponse;
    try {
      data = await googleResponse.json();
    } catch {
      console.error('[get-eta] Failed to parse Google API response');
      return jsonResponse(req, await resolveEtaWithRoute(operator_lat, operator_lng, destination_lat, destination_lng));
    }

    if (data.status !== 'OK' || !data.routes?.length) {
      console.error('[get-eta] Google API error:', data.status, data.error_message);
      return jsonResponse(req, await resolveEtaWithRoute(operator_lat, operator_lng, destination_lat, destination_lng));
    }

    const leg = data.routes[0]?.legs[0];
    if (!leg) {
      return jsonResponse(req, await resolveEtaWithRoute(operator_lat, operator_lng, destination_lat, destination_lng));
    }

    const duration = leg.duration_in_traffic || leg.duration;
    const etaMinutes = Math.ceil(duration.value / 60);
    const distanceKm = leg.distance.value / 1000;
    const overviewPolyline = data.routes[0]?.overview_polyline?.points;

    return jsonResponse(req, {
      success: true,
      eta_minutes: etaMinutes,
      eta_text: duration.text,
      distance_km: Math.round(distanceKm * 10) / 10,
      distance_text: leg.distance.text,
      is_fallback: false,
      overview_polyline: overviewPolyline || null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse(req, { success: false, error: error.message }, error.status);
    }
    console.error('[get-eta] Unhandled error:', String(error), error instanceof Error ? error.stack : '');
    return jsonResponse(req, { success: false, error: 'Internal server error' }, 500);
  }
});
