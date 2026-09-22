-- =====================================================
-- 00074 — El despacho tambien respeta lo que la empresa presta
--
-- La 00073 hizo que `provider_services` mandara sobre el pool del operador y
-- sobre `accept_service_request`, pero dejo sin tocar el otro camino por el que
-- una solicitud llega a un operador: el despacho desde el panel. Quedo una
-- incoherencia — la app nunca le ofrece una cerrajeria a una gruera, pero el
-- panel se la puede sugerir y asignar, y el operador termina con un servicio
-- activo que su propia app no le habria mostrado.
--
-- Se alinean los dos que eligen operador por su cuenta:
--
--   * `suggest_nearest_operators` (B-16) propone candidatos al despachador. Una
--     sugerencia es una recomendacion: proponer a quien no presta el servicio es
--     lisa y llanamente una mala sugerencia.
--   * `assign_nearest_operator` asigna sola, sin criterio humano en el medio.
--     Con mas razon.
--
-- `admin_assign_request` NO se toca a proposito: que un admin pueda forzar una
-- asignacion es legitimo —sabe cosas que el sistema no— y bloquearlo le sacaria
-- la ultima salida manual a un despachador con un cliente varado al telefono. El
-- aviso va en el panel, que es donde esta la persona decidiendo.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. La sugerencia del panel
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suggest_nearest_operators(p_request_id uuid, p_limit integer DEFAULT 3)
 RETURNS TABLE(operator_id uuid, full_name text, provider_name text, distance_km numeric, last_seen timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_service_type TEXT;
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver sugerencias de despacho';
  END IF;

  SELECT pickup_lat, pickup_lng, service_type INTO v_lat, v_lng, v_service_type
    FROM service_requests WHERE id = p_request_id;

  IF v_lat IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada o sin ubicación';
  END IF;

  RETURN QUERY
  SELECT
    ol.operator_id,
    p.full_name,
    prov.name AS provider_name,
    ROUND((6371 * acos(LEAST(1, GREATEST(-1,
      cos(radians(v_lat)) * cos(radians(ol.lat)) *
        cos(radians(ol.lng) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(ol.lat))
    ))))::numeric, 2) AS distance_km,
    ol.updated_at AS last_seen
  FROM operator_locations ol
  JOIN profiles p ON p.id = ol.operator_id
    AND p.role = 'OPERATOR'
    AND p.verification_status = 'approved'
  LEFT JOIN providers prov ON prov.id = p.provider_id
  WHERE ol.is_online = true
    AND ol.updated_at > NOW() - INTERVAL '5 minutes'
    -- 00074: no proponer a quien no presta este servicio.
    AND operator_can_serve(ol.operator_id, v_service_type)
    AND NOT EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.operator_id = ol.operator_id
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  ORDER BY distance_km ASC
  LIMIT GREATEST(1, p_limit);
END;
$function$;

-- ---------------------------------------------------------------
-- 2. La asignacion automatica
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_nearest_operator(p_request_id uuid)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_service_type TEXT;
  v_request service_requests;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_operator uuid;
  v_provider uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can auto-assign requests';
  END IF;

  SELECT pickup_lat, pickup_lng, service_type
    INTO v_pickup_lat, v_pickup_lng, v_service_type
  FROM service_requests
  WHERE id = p_request_id AND status = 'initiated';

  IF v_pickup_lat IS NULL THEN
    RAISE EXCEPTION 'Request not found or not available';
  END IF;

  SELECT ol.operator_id, p.provider_id
    INTO v_operator, v_provider
  FROM operator_locations ol
  JOIN profiles p ON p.id = ol.operator_id
    AND p.role = 'OPERATOR'
    AND p.verification_status = 'approved'
  WHERE ol.is_online = true
    AND ol.updated_at > NOW() - INTERVAL '5 minutes'
    -- 00074: asigna sola, sin criterio humano detras; con mas razon tiene que
    -- respetar lo que la empresa declara prestar.
    AND operator_can_serve(ol.operator_id, v_service_type)
    AND NOT EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.operator_id = ol.operator_id
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  ORDER BY (
    6371 * acos(
      least(1, greatest(-1,
        cos(radians(v_pickup_lat)) * cos(radians(ol.lat)) *
          cos(radians(ol.lng) - radians(v_pickup_lng)) +
        sin(radians(v_pickup_lat)) * sin(radians(ol.lat))
      ))
    )
  ) ASC
  LIMIT 1;

  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'No hay operadores en línea disponibles';
  END IF;

  UPDATE service_requests
  SET operator_id = v_operator,
      provider_id = v_provider,
      status = 'assigned',
      assigned_at = NOW(),
      updated_at = NOW()
  WHERE id = p_request_id AND status = 'initiated'
  RETURNING * INTO v_request;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request no longer available';
  END IF;

  RETURN v_request;
END;
$function$;
