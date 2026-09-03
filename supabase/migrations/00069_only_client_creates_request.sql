-- =====================================================
-- 00069 — Solo un cliente (rol USER) crea una solicitud de servicio
--
-- create_service_request solo exigía estar autenticado, no un rol. Cualquier
-- cuenta —un operador, y desde B-17 una cuenta de aseguradora— podía crear una
-- solicitud de grúa. Verificado: una cuenta INSURER creó una con éxito. No es un
-- exploit grave (el guard de "una a la vez" la limita y no lleva cobertura), pero
-- es incoherente: un portal de aseguradora no pide servicios.
--
-- Se agrega el chequeo de rol. Reconstruida por SUSTITUCIÓN EXACTA: solo se suma
-- la validación tras el chequeo de autenticación.
-- =====================================================

CREATE OR REPLACE FUNCTION public.create_service_request(p_dropoff_address text, p_dropoff_lat double precision, p_dropoff_lng double precision, p_incident_type text, p_notes text DEFAULT NULL::text, p_pickup_address text DEFAULT NULL::text, p_pickup_lat double precision DEFAULT NULL::double precision, p_pickup_lng double precision DEFAULT NULL::double precision, p_service_details jsonb DEFAULT '{}'::jsonb, p_service_type text DEFAULT 'tow'::text, p_tow_type tow_type DEFAULT 'light'::tow_type, p_vehicle_doc_path text DEFAULT NULL::text, p_vehicle_photo_url text DEFAULT NULL::text, p_vehicle_plate text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_pin TEXT;
  v_pin_hash TEXT;
  v_request_id UUID;
  v_request service_requests;
  v_actual_tow_type tow_type;
  v_coverage JSONB;
  v_coverage_status TEXT;
  v_coverage_error TEXT;
  v_role user_role;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- 00069: solo un CLIENTE pide servicios. create_service_request no validaba el
  -- rol, asi que cualquier cuenta autenticada (operador, y desde B-17 tambien una
  -- aseguradora) podia crear solicitudes. Un portal de aseguradora no pide gruas.
  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role IS DISTINCT FROM 'USER' THEN
    RAISE EXCEPTION 'Solo un cliente puede solicitar un servicio';
  END IF;

  -- 00063: un usuario tiene UNA sola solicitud en curso a la vez. La app ya lo
  -- asume (activeRequest en singular); sin este freno, un doble-tap o un
  -- reintento de red creaba solicitudes duplicadas, cada una con su PIN, su push
  -- a los operadores y su entrada al pool. El indice unico parcial (creado en la
  -- misma migracion) es la garantia dura a prueba de concurrencia; este chequeo
  -- da el mensaje claro en el caso normal.
  IF EXISTS (
    SELECT 1 FROM service_requests
     WHERE user_id = v_user_id
       AND status IN ('initiated','assigned','en_route','active')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ya tenes un servicio en curso. Espera a que termine o cancelalo antes de pedir otro.'
    );
  END IF;

  -- 00064: sanidad geografica de las coordenadas. El destino es obligatorio;
  -- la recogida puede venir NULL (cae a San Salvador por el COALESCE del
  -- INSERT), pero si viene, tiene que ser real. Fuera de los limites de El
  -- Salvador —o un valor absurdo tipo 999— el operador no podria ubicar al
  -- cliente y los calculos de distancia se rompen. Mismos limites que usa la
  -- Edge Function calculate-distance.
  IF p_dropoff_lat NOT BETWEEN 13.0 AND 14.5 OR p_dropoff_lng NOT BETWEEN -90.2 AND -87.5 THEN
    RETURN jsonb_build_object('success', false,
      'error', 'La ubicacion de destino esta fuera del area de cobertura.');
  END IF;
  IF (p_pickup_lat IS NOT NULL AND p_pickup_lat NOT BETWEEN 13.0 AND 14.5)
     OR (p_pickup_lng IS NOT NULL AND p_pickup_lng NOT BETWEEN -90.2 AND -87.5) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'La ubicacion de recogida esta fuera del area de cobertura.');
  END IF;

  IF p_service_type != 'tow' THEN
    v_actual_tow_type := 'light';
  ELSE
    v_actual_tow_type := p_tow_type;
  END IF;

  -- Cryptographically-secure PIN (was RANDOM() — see 00025).
  v_pin := generate_secure_pin();
  v_pin_hash := crypt(v_pin, gen_salt('bf'));

  -- --- B-11: verificacion de cobertura ---------------------------------
  -- Va ANTES del INSERT para que `coverage_status` se escriba de una y no
  -- exista una ventana en que la solicitud vive sin estado de cobertura.
  -- El EXCEPTION es el nucleo del ticket: convierte cualquier fallo en un
  -- estado explicito y auditable en vez de tumbar la solicitud (falla cerrada
  -- en silencio) o dejarla pasar como si no hubiera cobertura (falla abierta
  -- en silencio, que le cobraria de mas a un afiliado legitimo).
  BEGIN
    v_coverage := check_member_coverage();
    v_coverage_status := v_coverage->>'status';
    IF v_coverage_status NOT IN ('covered', 'none', 'inactive') THEN
      v_coverage_error := 'Estado inesperado: ' || COALESCE(v_coverage_status, 'NULL');
      v_coverage_status := 'error';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_coverage_status := 'error';
    v_coverage_error  := SQLSTATE || ': ' || SQLERRM;
    v_coverage        := jsonb_build_object('status', 'error', 'reason', v_coverage_error);
  END;

  INSERT INTO service_requests (
    user_id,
    pickup_lat,
    pickup_lng,
    pickup_address,
    dropoff_lat,
    dropoff_lng,
    dropoff_address,
    tow_type,
    incident_type,
    vehicle_plate,
    vehicle_doc_path,
    vehicle_photo_url,
    notes,
    pin_hash,
    status,
    service_type,
    service_details,
    coverage_status
  ) VALUES (
    v_user_id,
    COALESCE(p_pickup_lat, 13.6929),
    COALESCE(p_pickup_lng, -89.2182),
    COALESCE(p_pickup_address, 'San Salvador'),
    p_dropoff_lat,
    p_dropoff_lng,
    p_dropoff_address,
    v_actual_tow_type,
    p_incident_type,
    p_vehicle_plate,
    p_vehicle_doc_path,
    p_vehicle_photo_url,
    p_notes,
    v_pin_hash,
    'initiated',
    p_service_type,
    COALESCE(p_service_details, '{}'::jsonb),
    v_coverage_status
  ) RETURNING * INTO v_request;

  v_request_id := v_request.id;

  -- Rastro de la verificacion: sin esto "fallo la cobertura" no seria
  -- investigable despues. Se guarda el motivo tal cual (SQLSTATE + SQLERRM).
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    v_request_id,
    v_user_id,
    'USER',
    'COVERAGE_CHECKED',
    jsonb_build_object(
      'coverage_status', v_coverage_status,
      'member_id',       v_coverage->>'member_id',
      'policy_number',   v_coverage->>'policy_number',
      'insurer_name',    v_coverage->>'insurer_name',
      'plan_name',       v_coverage->>'plan_name',
      'reason',          COALESCE(v_coverage_error, v_coverage->>'reason')
    )
  );

  -- Vinculo servicio↔afiliado. Los montos quedan en 0: los calcula B-12/B-13.
  -- Si esto fallara, la solicitud NO se pierde — se degrada a 'error' igual que
  -- arriba, por la misma razon.
  IF v_coverage_status = 'covered' THEN
    BEGIN
      INSERT INTO coverage_usage (member_id, request_id, service_type)
      VALUES ((v_coverage->>'member_id')::UUID, v_request_id, p_service_type);
    EXCEPTION WHEN OTHERS THEN
      UPDATE service_requests SET coverage_status = 'error' WHERE id = v_request_id;
      INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
      VALUES (v_request_id, v_user_id, 'USER', 'COVERAGE_CHECKED',
              jsonb_build_object(
                'coverage_status', 'error',
                'reason', 'No se pudo registrar el consumo: ' || SQLSTATE || ': ' || SQLERRM
              ));
      v_coverage_status := 'error';
      v_coverage := jsonb_build_object('status', 'error', 'reason', 'No se pudo registrar el consumo');
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'pin', v_pin,
    'status', 'initiated',
    -- El cliente DEBE mostrar esto. Que la solicitud se cree igual no significa
    -- que el usuario no tenga que enterarse de en que condicion quedo.
    'coverage', v_coverage,
    'message', 'Guarda este PIN. Lo necesitaras cuando llegue el operador.'
  );
END;
$function$

;
