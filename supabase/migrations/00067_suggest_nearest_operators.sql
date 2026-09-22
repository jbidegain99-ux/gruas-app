-- =====================================================
-- 00067 — B-16: sugerir el operador más cercano (sin asignar a ciegas)
--
-- Ya existe `assign_nearest_operator`, pero ASIGNA de una: el despachador aprieta
-- y no ve a quién le tocó ni a qué distancia estaba. B-16 pide que el sistema
-- SUGIERA — que el despachador vea los candidatos más cercanos, con su distancia,
-- y elija. `suggest_nearest_operators` devuelve esa lista SIN tocar la solicitud.
--
-- Mismo criterio de elegibilidad que la asignación, para que lo que se muestra
-- sea exactamente lo que se puede asignar: operador OPERATOR, verificado, en
-- línea, con señal fresca (<5 min) y sin un servicio en curso. La distancia es la
-- haversine desde el punto de recogida (la misma fórmula que usa la asignación),
-- no la ruta real: para ordenar candidatos alcanza y no gasta una llamada por
-- cada uno.
-- =====================================================

CREATE OR REPLACE FUNCTION public.suggest_nearest_operators(
  p_request_id UUID,
  p_limit INT DEFAULT 3
)
RETURNS TABLE (
  operator_id   UUID,
  full_name     TEXT,
  provider_name TEXT,
  distance_km   NUMERIC,
  last_seen     TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver sugerencias de despacho';
  END IF;

  SELECT pickup_lat, pickup_lng INTO v_lat, v_lng
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
    AND NOT EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.operator_id = ol.operator_id
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  ORDER BY distance_km ASC
  LIMIT GREATEST(1, p_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.suggest_nearest_operators(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_nearest_operators(UUID, INT) TO authenticated;

COMMENT ON FUNCTION public.suggest_nearest_operators(UUID, INT) IS
  'B-16: candidatos más cercanos para despachar una solicitud (nombre, empresa, '
  'distancia haversine, última señal), SIN asignar. Mismo filtro de elegibilidad '
  'que assign_nearest_operator. Solo admin.';
