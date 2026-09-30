-- =====================================================
-- Km por GPS: sin recorrido es "sin dato", no 0
--
-- Recorrido 2026-09-30: una grúa de 14.1 km (distancia declarada) sin puntos
-- de GPS salía con "0.0 km" de arrastre en el estado de cuenta y en Km por
-- grúa. compute_case_km guardaba el 0 de trail_km sobre un recorrido vacío.
-- Ahora queda NULL (las pantallas muestran "—") y se corrigen los casos ya
-- guardados así. Los estados de cuenta emitidos conservan su copia congelada.
-- =====================================================

CREATE OR REPLACE FUNCTION public.compute_case_km(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sr service_requests;
  v_vehicle operator_vehicles;
  v_points INT;
BEGIN
  SELECT * INTO v_sr FROM service_requests WHERE id = p_request_id;
  IF v_sr.id IS NULL OR v_sr.status <> 'completed' THEN
    RETURN;
  END IF;

  SELECT * INTO v_vehicle FROM operator_vehicles
   WHERE operator_id = v_sr.operator_id AND is_active
   LIMIT 1;

  SELECT count(*) INTO v_points FROM service_location_trail WHERE request_id = v_sr.id;

  UPDATE cases
     -- 00150: sin un solo punto de GPS no hay medición: NULL, no 0 (la pantalla
     -- decía "0.0 km" de arrastre en una grúa de 14 km sin recorrido).
     SET approach_km    = CASE WHEN v_points = 0 THEN NULL
                               ELSE trail_km(v_sr.id, v_sr.assigned_at, COALESCE(v_sr.activated_at, v_sr.completed_at)) END,
         tow_km         = CASE WHEN v_points = 0 THEN NULL
                               WHEN v_sr.activated_at IS NULL THEN 0
                               ELSE trail_km(v_sr.id, v_sr.activated_at, v_sr.completed_at) END,
         declared_km    = v_sr.distance_pickup_to_dropoff_km,
         trail_points   = v_points,
         -- La unidad se fija una vez: recalcular los km no la cambia si el
         -- socio cambio de grua despues.
         vehicle_id     = COALESCE(vehicle_id, v_vehicle.id),
         vehicle_plate  = COALESCE(vehicle_plate, v_vehicle.plate),
         km_computed_at = now()
   WHERE request_id = v_sr.id;
END;
$$;

-- Casos ya calculados sin recorrido.
UPDATE public.cases
   SET approach_km = NULL, tow_km = NULL
 WHERE COALESCE(trail_points, 0) = 0
   AND (approach_km IS NOT NULL OR tow_km IS NOT NULL);
