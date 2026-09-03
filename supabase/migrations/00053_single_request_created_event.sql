-- =====================================================
-- 00053 — Un solo evento REQUEST_CREATED
--
-- EL PROBLEMA
-- Cada solicitud dejaba DOS filas `REQUEST_CREATED` en `request_events`: una la
-- pone el trigger `log_new_service_request_trigger` (AFTER INSERT, migr. 00007)
-- y otra un INSERT explicito dentro de `create_service_request` (arrastrado
-- desde 00013 y recopiado en cada version posterior, hasta 00047).
--
-- Hoy no lo ve nadie —ninguna pantalla consulta `request_events`, verificado—
-- pero es la tabla de auditoria: si algun dia hay que reconstruir que paso con
-- un servicio, un evento repetido con dos payloads distintos es exactamente el
-- ruido que no se quiere encontrar.
--
-- CUAL DE LOS DOS SOBREVIVE: EL TRIGGER
-- Es el unico punto por el que pasan TODAS las escrituras. Hoy da igual —
-- `create_service_request` es el unico camino que inserta en `service_requests`,
-- comprobado en las migraciones y en las dos apps— pero mañana un alta hecha
-- desde el panel o un arreglo por SQL tambien tiene que quedar registrada, y con
-- el INSERT dentro de la funcion no quedaria.
--
-- El payload del trigger se enriquece para no perder nada: se le suman
-- `service_type` y `has_photo`, que solo tenia la version de la funcion.
-- Ademas queda MAS fiel: la funcion registraba `p_pickup_address` (el parametro
-- crudo, que puede venir NULL) y el trigger registra `NEW.pickup_address`, que
-- es lo que de verdad se guardo tras el COALESCE a 'San Salvador'.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. El trigger pasa a ser el unico emisor, con el payload completo
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_new_service_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    NEW.id,
    NEW.user_id,
    'USER',
    'REQUEST_CREATED',
    jsonb_build_object(
      'pickup_address',  NEW.pickup_address,
      'dropoff_address', NEW.dropoff_address,
      'tow_type',        NEW.tow_type,
      'incident_type',   NEW.incident_type,
      'service_type',    NEW.service_type,
      'has_photo',       NEW.vehicle_photo_url IS NOT NULL
    )
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_new_service_request() IS
  'Unico emisor de REQUEST_CREATED (00053). No agregar un INSERT de este evento '
  'dentro de create_service_request: se duplicaria, que es el bug que arreglo 00053.';

-- ---------------------------------------------------------------
-- 2. `create_service_request` deja de emitirlo
-- ---------------------------------------------------------------
-- Reconstruida por SUSTITUCION EXACTA sobre `pg_get_functiondef`, no reescrita a
-- mano: el unico cambio respecto a lo que corria es que desaparece el bloque
-- `INSERT INTO request_events (... 'REQUEST_CREATED' ...)`. Todo lo demas
-- —B-11, el manejo de errores de cobertura, el alta en `coverage_usage`— queda
-- byte a byte igual.
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
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
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
