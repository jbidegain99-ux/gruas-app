-- 00157: el vehículo del pedido llega a las columnas del servicio.
--
-- La app manda el vehículo como texto en las notas ("Vehículo: Toyota Corolla
-- Blanco · P123-456", el mismo rótulo que arma lib/vehicles.ts), pero el
-- portal del MOPT y el admin leen vehicle_make/model/color/plate, que nadie
-- llenaba: el MOPT veía siempre "Vehículo —" y ninguna placa, aunque es lo
-- que necesita para auditar a quién atendió.
--
-- Del lado de la base, para que sirva también con las apps ya instaladas:
--   * si el rótulo coincide con un vehículo guardado del Usuario, se copian
--     marca, modelo, color y placa;
--   * si es texto libre, se rescata la placa si trae una.
-- Y el detalle del MOPT muestra el texto de la nota cuando no hay más.

-- Mismo rótulo que vehicleLabel() de la app.
CREATE OR REPLACE FUNCTION public.vehicle_label(p_make TEXT, p_model TEXT, p_color TEXT, p_plate TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(NULLIF(concat_ws(' · ', NULLIF(concat_ws(' ', NULLIF(p_make, ''), NULLIF(p_model, ''), NULLIF(p_color, '')), ''),
                                   NULLIF(p_plate, '')), ''), 'Vehículo');
$$;

-- "Vehículo: …" de las notas del pedido (primera línea que lo trae).
CREATE OR REPLACE FUNCTION public.request_vehicle_note(p_notes TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(btrim(substring(p_notes FROM 'Vehículo:\s*([^\n]+)')), '');
$$;

CREATE OR REPLACE FUNCTION public.fill_request_vehicle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_label TEXT;
  v RECORD;
BEGIN
  IF NEW.vehicle_plate IS NOT NULL OR NEW.vehicle_make IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_label := request_vehicle_note(NEW.notes);
  IF v_label IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT make, model, color, plate INTO v
    FROM vehicles
   WHERE user_id = NEW.user_id
     AND lower(vehicle_label(make, model, color, plate)) = lower(v_label)
   ORDER BY is_default DESC, created_at
   LIMIT 1;
  IF FOUND THEN
    NEW.vehicle_make  := v.make;
    NEW.vehicle_model := v.model;
    NEW.vehicle_color := v.color;
    NEW.vehicle_plate := upper(v.plate);
  ELSE
    -- Texto libre: si trae una placa (P123-456, C 752301…), se rescata.
    NEW.vehicle_plate := upper(replace(substring(v_label FROM '\m([A-Za-z]{1,3}\s?-?\d{3}-?\d{3})\M'), ' ', ''));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fill_request_vehicle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS fill_request_vehicle_trigger ON public.service_requests;
CREATE TRIGGER fill_request_vehicle_trigger
  BEFORE INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.fill_request_vehicle();

-- Detalle del MOPT: sin marca/modelo, el rótulo que escribió el Usuario.
CREATE OR REPLACE FUNCTION public.mopt_service_detail(p_request_id UUID)
RETURNS JSONB
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
           -- 00157: sin marca/modelo guardados, el rótulo de la nota del pedido.
           'vehicle', COALESCE(NULLIF(concat_ws(' ', sr.vehicle_make, sr.vehicle_model, sr.vehicle_color), ''),
                               request_vehicle_note(sr.notes)),
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
