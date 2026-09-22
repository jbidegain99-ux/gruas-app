-- 00029_assign_nearest_operator.sql
-- Auto-despacho: asigna una solicitud al operador EN LÍNEA más cercano a la
-- recogida (haversine en SQL, sin extensiones), que tenga ubicación fresca y no
-- esté en otro servicio. Reutiliza el modelo de disponibilidad (operator_locations.is_online).

CREATE OR REPLACE FUNCTION public.assign_nearest_operator(p_request_id uuid)
RETURNS service_requests
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request service_requests;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_operator uuid;
  v_provider uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can auto-assign requests';
  END IF;

  SELECT pickup_lat, pickup_lng
    INTO v_pickup_lat, v_pickup_lng
  FROM service_requests
  WHERE id = p_request_id AND status = 'initiated';

  IF v_pickup_lat IS NULL THEN
    RAISE EXCEPTION 'Request not found or not available';
  END IF;

  -- Operador en línea más cercano: ubicación fresca (< 5 min), sin servicio
  -- activo, ordenado por distancia haversine a la recogida.
  SELECT ol.operator_id, p.provider_id
    INTO v_operator, v_provider
  FROM operator_locations ol
  JOIN profiles p ON p.id = ol.operator_id AND p.role = 'OPERATOR'
  WHERE ol.is_online = true
    AND ol.updated_at > NOW() - INTERVAL '5 minutes'
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
$$;

GRANT EXECUTE ON FUNCTION public.assign_nearest_operator(uuid) TO authenticated;
