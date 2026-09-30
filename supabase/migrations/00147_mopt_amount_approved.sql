-- =====================================================
-- Portal MOPT: el monto de cada servicio es el que el MOPT aprobó
--
-- Recorrido 2026-09-30: BUDI-001243 se ajustó de $61.00 a $50.00 en el estado
-- de cuenta aprobado. El libro, la página de socios y la app del socio decían
-- $50 (00143, 00146), pero el detalle y la lista de Servicios del portal
-- seguían en $61.00 (y el total y el Excel de la lista sumaban el original).
--
-- statement_adjustment(): una sola definición del ajuste aprobado, para no
-- repetir el mismo JOIN en cada pantalla.
-- =====================================================

CREATE OR REPLACE FUNCTION public.statement_adjustment(p_request_id uuid)
RETURNS TABLE(amount numeric, statement_number text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ob.adjusted_amount, s.number
    FROM account_statement_lines l
    JOIN account_statements s      ON s.id = l.statement_id AND s.status IN ('approved', 'paid')
    JOIN statement_observations ob ON ob.statement_id = l.statement_id AND ob.request_id = l.request_id
                                  AND ob.status = 'adjusted'
   WHERE l.request_id = p_request_id
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.statement_adjustment(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mopt_service_detail(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
  v JSONB;
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;

  SELECT jsonb_build_object(
           'id', sr.id,
           'folio', c.folio,
           'status', sr.status,
           'service_type', COALESCE(sr.service_type, 'tow'),
           'incident_type', sr.incident_type,
           'client_name', cli.full_name,
           'vehicle_plate', sr.vehicle_plate,
           'vehicle', NULLIF(concat_ws(' ', sr.vehicle_make, sr.vehicle_model, sr.vehicle_color), ''),
           'operator_name', ope.full_name,
           'pickup_address', sr.pickup_address,
           'pickup_lat', sr.pickup_lat,
           'pickup_lng', sr.pickup_lng,
           'dropoff_address', sr.dropoff_address,
           'dropoff_lat', sr.dropoff_lat,
           'dropoff_lng', sr.dropoff_lng,
           'created_at', sr.created_at,
           'assigned_at', sr.assigned_at,
           'activated_at', sr.activated_at,
           'completed_at', sr.completed_at,
           'cancelled_at', sr.cancelled_at,
           'distance_km', sr.distance_pickup_to_dropoff_km,
           'total_price', sr.total_price,
           -- 00147: lo que el MOPT aprobó (ajustado en su estado de cuenta) y
           -- de dónde salió el ajuste, para no mostrar el monto original.
           'amount_due', COALESCE(adj.amount, sr.total_price),
           'adjusted_in', adj.statement_number,
           -- Recorrido real del operador (lo que grabo la app durante el servicio).
           'trail', COALESCE((
             SELECT jsonb_agg(jsonb_build_array(t.lat, t.lng) ORDER BY t.recorded_at)
               FROM service_location_trail t
              WHERE t.request_id = sr.id
           ), '[]'::jsonb)
         )
    INTO v
    FROM service_requests sr
    LEFT JOIN cases c      ON c.request_id = sr.id
    LEFT JOIN profiles cli ON cli.id = sr.user_id
    LEFT JOIN profiles ope ON ope.id = sr.operator_id
    LEFT JOIN LATERAL statement_adjustment(sr.id) adj ON true
   WHERE sr.id = p_request_id
     AND sr.mopt_provider_id = v_mopt;

  IF v IS NULL THEN
    RAISE EXCEPTION 'Servicio no encontrado';
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.mopt_list_services(p_from date, p_to date)
RETURNS TABLE(id uuid, folio text, status text, service_type text, client_name text, vehicle_plate text, pickup_address text, pickup_lat double precision, pickup_lng double precision, operator_name text, created_at timestamp with time zone, completed_at timestamp with time zone, total_price numeric, zone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;

  RETURN QUERY
  SELECT sr.id, c.folio, sr.status::text, COALESCE(sr.service_type, 'tow'),
         cli.full_name, sr.vehicle_plate,
         sr.pickup_address, sr.pickup_lat, sr.pickup_lng,
         -- 00147: monto que cuenta para el MOPT (el aprobado, si hubo ajuste).
         ope.full_name, sr.created_at, sr.completed_at, COALESCE((SELECT a.amount FROM statement_adjustment(sr.id) a), sr.total_price),
         COALESCE(
           -- 00141: la zona más antigua, como mopt_compliance y el reporte.
           (SELECT z.name FROM mopt_zones z
             WHERE z.provider_id = v_mopt
               AND point_in_polygon(sr.pickup_lat, sr.pickup_lng, z.polygon)
             ORDER BY z.created_at, z.id LIMIT 1),
           sv_department(sr.pickup_lat, sr.pickup_lng))
    FROM service_requests sr
    LEFT JOIN cases c      ON c.request_id = sr.id
    LEFT JOIN profiles cli ON cli.id = sr.user_id
    LEFT JOIN profiles ope ON ope.id = sr.operator_id
   WHERE sr.mopt_provider_id = v_mopt
     -- 00141: por fecha de cierre (la del reporte y el estado de cuenta); lo
     -- que no ha cerrado, por fecha de pedido.
     AND COALESCE(sr.completed_at, sr.created_at) >= sv_day_start(p_from)
     AND COALESCE(sr.completed_at, sr.created_at) <  sv_day_start(p_to + 1)
   ORDER BY sr.created_at DESC;
END;
$$;
