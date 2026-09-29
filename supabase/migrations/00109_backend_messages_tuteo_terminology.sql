-- =====================================================
-- 00109 — Mensajes de la base en tuteo y con la terminologia del backlog
--
-- Backlog de lanzamiento, "Reglas que no cambian" y VID-01: tuteo en toda la
-- app, notificaciones y mensajes SQL; la persona que pide ayuda es el
-- **Usuario**, quien presta el servicio el **Socio operador**, y el codigo de
-- 4 digitos el **PIN de confirmacion**. Las apps ya se ajustaron; esto cubre lo
-- que sale de la base: push, avisos in-app, linea de tiempo del caso y errores
-- que llegan a la pantalla. De paso, tildes que faltaban.
--
-- Cada funcion se reescribe desde su definicion vigente cambiando SOLO esos
-- literales; la logica no se toca.
-- =====================================================

-- notify_service_status_change
CREATE OR REPLACE FUNCTION public.notify_service_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  notification_title TEXT;
  notification_body TEXT;
  notification_data JSONB;
  target_user_id UUID;
  target_role TEXT;
  edge_function_url TEXT;
BEGIN
  -- Only trigger on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Get the Edge Function URL from environment or use default
  edge_function_url := current_setting('app.settings.edge_function_url', true);
  IF edge_function_url IS NULL THEN
    edge_function_url := 'http://localhost:54321/functions/v1';
  END IF;

  -- Determine notification content based on status change
  CASE NEW.status
    WHEN 'assigned' THEN
      -- Notify user that operator was assigned
      target_user_id := NEW.user_id;
      target_role := 'user';
      notification_title := '¡Grúa Asignada!';
      notification_body := 'Un socio operador fue asignado a tu solicitud. Pronto estará en camino.';
      notification_data := jsonb_build_object(
        'type', 'service_assigned',
        'service_request_id', NEW.id,
        'operator_id', NEW.operator_id,
        'role', 'user'
      );

    WHEN 'en_route' THEN
      -- Notify user that operator is on the way
      target_user_id := NEW.user_id;
      target_role := 'user';
      notification_title := 'Socio operador en camino';
      notification_body := 'El socio operador está en camino a tu ubicación.';
      notification_data := jsonb_build_object(
        'type', 'service_status_update',
        'service_request_id', NEW.id,
        'status', 'en_route',
        'role', 'user'
      );

    WHEN 'active' THEN
      -- Notify user that service has started
      target_user_id := NEW.user_id;
      target_role := 'user';
      notification_title := 'Servicio Iniciado';
      notification_body := 'El socio operador llegó y el servicio comenzó.';
      notification_data := jsonb_build_object(
        'type', 'service_status_update',
        'service_request_id', NEW.id,
        'status', 'active',
        'role', 'user'
      );

    WHEN 'completed' THEN
      -- Notify user that service is complete
      target_user_id := NEW.user_id;
      target_role := 'user';
      notification_title := 'Servicio Completado';
      notification_body := '¡Tu servicio ha sido completado! Gracias por usar GruasApp.';
      notification_data := jsonb_build_object(
        'type', 'service_status_update',
        'service_request_id', NEW.id,
        'status', 'completed',
        'role', 'user'
      );

    WHEN 'cancelled' THEN
      -- Notify the other party about cancellation
      IF NEW.cancelled_by = NEW.user_id THEN
        -- User cancelled, notify operator
        target_user_id := NEW.operator_id;
        target_role := 'operator';
        notification_title := 'Servicio Cancelado';
        notification_body := 'El usuario canceló el servicio.';
      ELSE
        -- Operator/admin cancelled, notify user
        target_user_id := NEW.user_id;
        target_role := 'user';
        notification_title := 'Servicio Cancelado';
        notification_body := 'Tu servicio ha sido cancelado.';
      END IF;
      notification_data := jsonb_build_object(
        'type', 'service_cancelled',
        'service_request_id', NEW.id,
        'reason', NEW.cancellation_reason,
        'role', target_role
      );

    ELSE
      -- No notification for other status changes
      RETURN NEW;
  END CASE;

  -- Skip if no target user
  IF target_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert notification into queue table for async processing
  INSERT INTO notification_queue (user_id, title, body, data, created_at)
  VALUES (target_user_id, notification_title, notification_body, notification_data, NOW());

  RETURN NEW;
END;
$function$;

-- create_service_request
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
  v_mopt UUID;  -- 00098: programa MOPT que paga, si aplica
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
    RAISE EXCEPTION 'Solo un usuario puede solicitar un servicio';
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
      'error', 'Ya tienes un servicio en curso. Espera a que termine o cancélalo antes de pedir otro.'
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

  -- 00098: ¿lo paga un programa MOPT? Regla unica en mopt_payer_for: si la
  -- poliza cubre ESTE servicio sigue por la aseguradora; si no (sin seguro, o
  -- servicio excluido del plan) y el punto cae en una zona MOPT, paga el MOPT.
  v_mopt := mopt_payer_for(v_coverage,
                           COALESCE(p_pickup_lat, 13.6929), COALESCE(p_pickup_lng, -89.2182),
                           p_service_type);

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
    coverage_status,
    mopt_provider_id
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
    v_coverage_status,
    v_mopt
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
      'reason',          COALESCE(v_coverage_error, v_coverage->>'reason'),
      'mopt_provider_id', v_mopt
    )
  );

  -- Vinculo servicio↔afiliado. Los montos quedan en 0: los calcula B-12/B-13.
  -- Si esto fallara, la solicitud NO se pierde — se degrada a 'error' igual que
  -- arriba, por la misma razon.
  -- 00098: si paga el MOPT no hay consumo de poliza (el plan excluia el
  -- servicio): sin esto la finanza lo contaria como copago total del afiliado.
  IF v_coverage_status = 'covered' AND v_mopt IS NULL THEN
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
    -- 00098: si paga el MOPT, el usuario no paga nada y la app lo tiene que decir.
    'mopt', CASE WHEN v_mopt IS NULL THEN NULL ELSE jsonb_build_object(
             'program_name', (SELECT name FROM providers WHERE id = v_mopt)) END,
    'message', 'Guarda este PIN de confirmación. Lo necesitarás cuando llegue el socio operador.'
  );
END;
$function$;

-- cancel_service_request
CREATE OR REPLACE FUNCTION public.cancel_service_request(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
  v_user_id UUID;
  v_user_role user_role;
  v_event_type event_type;
BEGIN
  -- 00059: testigo para el guardian de la maquina de estados.
  PERFORM set_config('app.sr_rpc', p_request_id::text, true);
  v_user_id := auth.uid();

  -- Get user role
  SELECT role INTO v_user_role FROM profiles WHERE id = v_user_id;

  IF v_user_id IS NULL OR v_user_role IS NULL
     OR v_user_role::text NOT IN ('USER', 'OPERATOR', 'ADMIN', 'SUPPORT') THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

  -- Get the request
  SELECT * INTO v_request FROM service_requests WHERE id = p_request_id;

  IF v_request IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitud no encontrada');
  END IF;

  -- Check if request can be cancelled
  IF v_request.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta solicitud ya no puede ser cancelada');
  END IF;

  -- Verify user has permission to cancel
  IF v_user_role = 'USER' AND v_request.user_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

  IF v_user_role = 'OPERATOR' AND v_request.operator_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

  -- ==========================================================
  -- OPERADOR cancela -> liberar la solicitud de vuelta al pool
  -- ==========================================================
  IF v_user_role = 'OPERATOR' THEN
    -- Auditoria PRIMERO: queda constancia de quien la solto y por que.
    -- Debe ir ANTES del UPDATE porque el trigger de 00037
    -- (notify_operators_pool_request) dispara en ese UPDATE y consulta este
    -- evento para NO re-ofrecerle la solicitud al operador que la acaba de
    -- soltar. Tambien la usa get_available_requests_for_operator.
    INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
    VALUES (
      p_request_id,
      v_user_id,
      v_user_role,
      'OPERATOR_CANCELLED'::event_type,
      jsonb_build_object('reason', p_reason, 'released_to_pool', true)
    );

    UPDATE service_requests
    SET
      status = 'initiated',
      operator_id = NULL,
      assigned_at = NULL,
      activated_at = NULL,
      route_polyline = NULL,      -- la ruta era del operador saliente
      updated_at = NOW()
    WHERE id = p_request_id;

    -- El trigger de notificaciones (00018) no cubre 'cancelled'->'initiated',
    -- asi que encolamos la push al usuario directamente aqui.
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      v_request.user_id,
      'Buscando otro socio operador',
      'El socio operador no pudo atender tu servicio. Tu solicitud sigue activa y estamos buscando otro socio operador.',
      jsonb_build_object(
        'type', 'service_reassigning',
        'service_request_id', p_request_id,
        'role', 'user'
      ),
      NOW()
    );

    RETURN jsonb_build_object(
      'success', true,
      'released', true,
      'message', 'Servicio liberado. La solicitud volverá a ofrecerse a otros socios operadores.'
    );
  END IF;

  -- ==========================================================
  -- USER / ADMIN cancelan -> cancelacion terminal (como antes)
  -- ==========================================================
  v_event_type := CASE
    WHEN v_user_role::text IN ('ADMIN', 'SUPPORT') THEN 'ADMIN_CANCELLED'::event_type
    ELSE 'USER_CANCELLED'::event_type
  END;

  UPDATE service_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = v_user_id,
    cancellation_reason = p_reason
  WHERE id = p_request_id;

  -- Sin INSERT de auditoria: lo emite el trigger log_service_request_changes al
  -- ver el cambio a 'cancelled', ya con el motivo. El INSERT que habia aca
  -- duplicaba ese evento. `v_event_type` se conserva porque el trigger resuelve
  -- el mismo tipo (USER_/ADMIN_CANCELLED) desde el rol de quien llama.

  RETURN jsonb_build_object('success', true, 'message', 'Solicitud cancelada exitosamente');
END;
$function$;

-- alert_stale_pool_requests
CREATE OR REPLACE FUNCTION public.alert_stale_pool_requests()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_threshold CONSTANT INTERVAL := INTERVAL '10 minutes';
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, user_id, updated_at
    FROM service_requests
    WHERE status = 'initiated'
      AND updated_at < NOW() - v_threshold
      AND (pool_alerted_at IS NULL OR pool_alerted_at < updated_at)
  LOOP
    -- Aviso al usuario que sigue esperando
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      r.user_id,
      'Seguimos buscando un socio operador',
      'Tu solicitud está tardando más de lo normal. Seguimos buscando un socio operador disponible; también puedes cancelar sin costo si lo prefieres.',
      jsonb_build_object(
        'type', 'stale_request',
        'service_request_id', r.id,
        'role', 'user'
      ),
      NOW()
    );

    -- Aviso a todos los ADMIN para que intervengan (asignacion manual)
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    SELECT
      p.id,
      'Solicitud sin atender',
      'Una solicitud lleva más de 10 minutos sin que ningún socio operador la acepte. Revisa el panel para asignarla manualmente.',
      jsonb_build_object(
        'type', 'stale_request',
        'service_request_id', r.id,
        'role', 'admin'
      ),
      NOW()
    FROM profiles p
    WHERE p.role = 'ADMIN';

    UPDATE service_requests SET pool_alerted_at = NOW() WHERE id = r.id;
  END LOOP;
END;
$function$;

-- submit_operator_verification
CREATE OR REPLACE FUNCTION public.submit_operator_verification()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_required text[] := ARRAY['dui_front','dui_back','license','circulation'];
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM unnest(v_required) rt
  WHERE NOT EXISTS (
    SELECT 1 FROM public.operator_documents d
    WHERE d.operator_id = auth.uid() AND d.doc_type = rt
  );

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Faltan documentos obligatorios';
  END IF;

  UPDATE public.profiles
  SET verification_status = 'pending',
      verification_submitted_at = now(),
      verification_rejection_reason = NULL
  WHERE id = auth.uid() AND role = 'OPERATOR';

  -- Aviso a los administradores (best-effort: solo llega a quien tenga la app).
  INSERT INTO notification_queue (user_id, title, body, data, created_at)
  SELECT
    p.id,
    'Nuevo socio operador por verificar',
    'Un socio operador envió sus documentos para revisión.',
    jsonb_build_object('type', 'verification_submitted', 'role', 'admin'),
    now()
  FROM public.profiles p
  WHERE p.role = 'ADMIN';
END;
$function$;

-- preview_my_coverage
CREATE OR REPLACE FUNCTION public.preview_my_coverage(p_service_type text, p_total numeric, p_km numeric DEFAULT NULL::numeric, p_tow_type tow_type DEFAULT 'light'::tow_type)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cobertura JSONB;
  v_member_id UUID;
BEGIN
  v_cobertura := check_member_coverage();

  IF v_cobertura->>'status' <> 'covered' THEN
    -- Se devuelve el estado tal cual (none / inactive / error) para que la UI
    -- diga lo mismo que ya dice el banner de B-11, en vez de inventar otro texto.
    RETURN jsonb_build_object(
      'covered', false,
      'coverage_status', v_cobertura->>'status',
      'reason', COALESCE(v_cobertura->>'reason', 'No tienes una cobertura vigente'),
      'amount_total', p_total, 'amount_covered', 0, 'amount_copay', p_total
    );
  END IF;

  v_member_id := (v_cobertura->>'member_id')::UUID;
  RETURN evaluate_coverage(v_member_id, p_service_type, p_total, p_km, p_tow_type, NULL)
         || jsonb_build_object('coverage_status', 'covered');
END;
$function$;

-- get_case_sla
CREATE OR REPLACE FUNCTION public.get_case_sla(p_folio text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sr  service_requests;
  v_sla RECORD;
BEGIN
  SELECT sr.* INTO v_sr
    FROM cases c JOIN service_requests sr ON sr.id = c.request_id
   WHERE c.folio = p_folio;

  IF v_sr.id IS NULL THEN
    RAISE EXCEPTION 'Caso no encontrado';
  END IF;

  IF NOT is_staff()
     AND auth.uid() IS DISTINCT FROM v_sr.user_id
     AND auth.uid() IS DISTINCT FROM v_sr.operator_id
     AND NOT request_belongs_to_my_insurer(v_sr.id)
     AND NOT request_belongs_to_my_mopt(v_sr.id) THEN  -- 00100
    RAISE EXCEPTION 'No tienes acceso a este caso';
  END IF;

  -- 00105: la cuenta vive en request_sla(), compartida con la ficha 360 y el
  -- dashboard de negocio.
  SELECT * INTO v_sla FROM request_sla(v_sr.id);

  RETURN jsonb_build_object(
    'folio', p_folio,
    'insurer_name', v_sla.insurer_name,
    'assignment_seconds', v_sla.assignment_seconds,
    'arrival_seconds',    v_sla.arrival_seconds,
    'service_seconds',    v_sla.service_seconds,
    'assignment_target_minutes', v_sla.assignment_target,
    'arrival_target_minutes',    v_sla.arrival_target,
    'assignment_met', CASE WHEN v_sla.assignment_seconds IS NULL THEN NULL
                           ELSE v_sla.assignment_seconds <= v_sla.assignment_target * 60 END,
    'arrival_met',    CASE WHEN v_sla.arrival_seconds IS NULL THEN NULL
                           ELSE v_sla.arrival_seconds <= v_sla.arrival_target * 60 END
  );
END;
$function$;

-- get_case_timeline
CREATE OR REPLACE FUNCTION public.get_case_timeline(p_folio text)
 RETURNS TABLE(at timestamp with time zone, event_type text, label text, actor_role text, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id UUID;
  v_user_id    UUID;
  v_operator   UUID;
BEGIN
  SELECT c.request_id, sr.user_id, sr.operator_id
    INTO v_request_id, v_user_id, v_operator
    FROM cases c JOIN service_requests sr ON sr.id = c.request_id
   WHERE c.folio = p_folio;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'Caso no encontrado';
  END IF;

  IF NOT is_staff()
     AND auth.uid() IS DISTINCT FROM v_user_id
     AND auth.uid() IS DISTINCT FROM v_operator
     AND NOT request_belongs_to_my_insurer(v_request_id)
     AND NOT request_belongs_to_my_mopt(v_request_id) THEN  -- 00100
    RAISE EXCEPTION 'No tienes acceso a este caso';
  END IF;

  RETURN QUERY
  SELECT
    re.created_at,
    re.event_type::text,
    CASE re.event_type
      WHEN 'REQUEST_CREATED'      THEN 'Solicitud creada'
      WHEN 'COVERAGE_CHECKED'     THEN 'Cobertura verificada'
      WHEN 'OPERATOR_ACCEPTED'    THEN 'Socio operador asignado'
      WHEN 'OPERATOR_EN_ROUTE'    THEN 'Socio operador en camino'
      WHEN 'PIN_VERIFIED'         THEN 'PIN de confirmación verificado (el socio llegó)'
      WHEN 'PRICE_COMPUTED'       THEN 'Precio calculado'
      WHEN 'PRICE_DISTANCE_CAPPED' THEN 'Distancia ajustada al máximo razonable'
      WHEN 'STATUS_CHANGED'       THEN 'Cambio de estado'
      WHEN 'MESSAGE_SENT'         THEN 'Mensaje en el chat'
      WHEN 'RATING_SUBMITTED'     THEN 'Calificación enviada'
      WHEN 'USER_CANCELLED'       THEN 'Cancelado por el usuario'
      WHEN 'OPERATOR_CANCELLED'   THEN 'El socio operador liberó el servicio'
      WHEN 'ADMIN_CANCELLED'      THEN 'Cancelado por Budi (soporte o administración)'
      ELSE re.event_type::text
    END AS label,
    re.actor_role::text,
    COALESCE(
      re.payload->>'reason',
      re.payload->>'new_status',
      CASE WHEN re.event_type = 'PRICE_COMPUTED' THEN
             CASE
               -- Se formatea solo si de verdad es un numero. El cast a secas
               -- lanzaba, y como esto es una funcion que devuelve la linea de
               -- tiempo entera, un payload malformado no se comia una fila: se
               -- comia el caso completo en el portal.
               WHEN re.payload->>'total' ~ '^-?[0-9]+(\.[0-9]+)?$'
                 THEN '$' || to_char((re.payload->>'total')::NUMERIC, 'FM999999990.00')
               -- Si no lo es, se muestra crudo antes que perderlo.
               ELSE COALESCE('$' || (re.payload->>'total'), '?')
             END
           END,
      CASE WHEN re.event_type = 'COVERAGE_CHECKED'
           THEN COALESCE(re.payload->>'coverage_status', re.payload->>'status') END
    ) AS detail
  FROM request_events re
  WHERE re.request_id = v_request_id
  ORDER BY re.created_at ASC,
    CASE re.event_type
      WHEN 'REQUEST_CREATED'       THEN 1
      WHEN 'COVERAGE_CHECKED'      THEN 2
      WHEN 'OPERATOR_ACCEPTED'     THEN 3
      WHEN 'OPERATOR_EN_ROUTE'     THEN 4
      WHEN 'PIN_VERIFIED'          THEN 5
      WHEN 'PRICE_DISTANCE_CAPPED' THEN 6
      WHEN 'PRICE_COMPUTED'        THEN 7
      WHEN 'STATUS_CHANGED'        THEN 8
      WHEN 'USER_CANCELLED'        THEN 9
      WHEN 'OPERATOR_CANCELLED'    THEN 9
      WHEN 'ADMIN_CANCELLED'       THEN 9
      WHEN 'RATING_SUBMITTED'      THEN 10
      ELSE 50
    END ASC,
    re.id ASC;
END;
$function$;

-- register_ledger_payment
CREATE OR REPLACE FUNCTION public.register_ledger_payment(p_payer_kind text, p_payer_id uuid, p_payee_kind text, p_payee_id uuid, p_amount numeric, p_paid_on date DEFAULT NULL::date, p_reference text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mopt     UUID := auth_mopt_id();
  v_saldo   NUMERIC;
  v_id      UUID;
  v_paid_on DATE := COALESCE(p_paid_on, sv_today());
BEGIN
  IF NOT is_admin() THEN
    IF v_mopt IS NULL THEN
      RAISE EXCEPTION 'No tienes permiso para registrar pagos';
    END IF;
    IF p_payer_kind <> 'mopt' OR p_payer_id IS DISTINCT FROM v_mopt OR p_payee_kind <> 'operator' THEN
      RAISE EXCEPTION 'Desde el portal MOPT solo se registran pagos del programa a sus socios operadores';
    END IF;
  END IF;

  IF (p_payer_kind, p_payee_kind) NOT IN (
       ('budi', 'provider'), ('budi', 'operator'),
       ('insurer', 'budi'), ('mopt', 'budi'), ('mopt', 'operator')) THEN
    RAISE EXCEPTION 'Ese tipo de pago no existe en el libro';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto tiene que ser mayor que cero';
  END IF;
  IF round(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'El monto admite hasta dos decimales';
  END IF;
  IF v_paid_on > sv_today() THEN
    RAISE EXCEPTION 'La fecha de pago no puede ser futura';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(
    'budi:ledger:' || p_payer_kind || ':' || COALESCE(p_payer_id::text, '') ||
    '->' || p_payee_kind || ':' || COALESCE(p_payee_id::text, '')));

  SELECT b.balance INTO v_saldo
    FROM ledger_balances_all() b
   WHERE b.debtor_kind = p_payer_kind
     AND b.debtor_id IS NOT DISTINCT FROM p_payer_id
     AND b.creditor_kind = p_payee_kind
     AND b.creditor_id IS NOT DISTINCT FROM p_payee_id;

  IF v_saldo IS NULL OR v_saldo <= 0 THEN
    RAISE EXCEPTION 'No hay saldo pendiente entre esas partes';
  END IF;
  IF p_amount > v_saldo THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo pendiente (%)', p_amount, v_saldo;
  END IF;

  INSERT INTO ledger_payments (
    payer_kind, payer_id, payee_kind, payee_id, amount, paid_on,
    reference, note, created_by
  ) VALUES (
    p_payer_kind, p_payer_id, p_payee_kind, p_payee_id, p_amount, v_paid_on,
    NULLIF(trim(p_reference), ''), NULLIF(trim(p_note), ''), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- accept_service_request
CREATE OR REPLACE FUNCTION public.accept_service_request(p_request_id uuid)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
  v_operator_role user_role;
  v_verif TEXT;
BEGIN
  -- 00059: testigo para el guardian de la maquina de estados.
  PERFORM set_config('app.sr_rpc', p_request_id::text, true);
  -- Verify operator role AND que este verificado. La puerta de verificacion
  -- (00038/00039) vivia SOLO en la UI (el boton se ocultaba con !verified),
  -- asi que un operador rechazado o sin enviar documentos podia aceptar
  -- servicios llamando esta RPC directo. En asistencia vial el operador va
  -- fisicamente donde un cliente varado: la identidad tiene que estar validada
  -- del lado del servidor, no del cliente.
  SELECT role, verification_status INTO v_operator_role, v_verif
    FROM profiles WHERE id = auth.uid();
  IF v_operator_role != 'OPERATOR' THEN
    RAISE EXCEPTION 'Only operators can accept requests';
  END IF;
  IF v_verif IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Tu cuenta de socio operador todavía no está verificada';
  END IF;

  -- 00073: y que su empresa preste este servicio. El pool ya no se lo muestra,
  -- pero filtrar solo la lista seria un guard de fachada: esta RPC se puede
  -- llamar con cualquier id. Mismo criterio que la verificacion de arriba, que
  -- vivia en la UI hasta que la 00058 la bajo al servidor.
  IF NOT operator_can_serve(
       auth.uid(),
       (SELECT service_type FROM service_requests WHERE id = p_request_id)) THEN
    RAISE EXCEPTION 'Tu empresa no presta este tipo de servicio';
  END IF;

  -- 00098: flota cerrada del MOPT. Mismo criterio: no alcanza con filtrar el pool.
  IF NOT operator_fits_program(
       auth.uid(),
       (SELECT mopt_provider_id FROM service_requests WHERE id = p_request_id)) THEN
    RAISE EXCEPTION 'Este servicio corresponde a otro programa';
  END IF;

  -- Update request
  UPDATE service_requests
  SET
    operator_id = auth.uid(),
    -- 00079: se guarda tambien la empresa del operador. `admin_assign_request`
    -- ya lo hacia; esta no, y como tomar del pool es el camino NORMAL, casi
    -- ningun servicio quedaba atribuido a su proveedor.
    provider_id = (SELECT provider_id FROM profiles WHERE id = auth.uid()),
    status = 'assigned',
    assigned_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id
    AND status = 'initiated'
    AND operator_id IS NULL
  RETURNING * INTO v_request;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not available or already assigned';
  END IF;

  v_request.pin_hash := NULL;  -- 00092: no filtrar el hash del PIN
  RETURN v_request;
END;
$function$;

-- assign_nearest_operator
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
    -- 00098: flota cerrada del MOPT.
    AND operator_fits_program(ol.operator_id, (SELECT mopt_provider_id FROM service_requests WHERE id = p_request_id))
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
    RAISE EXCEPTION 'No hay socios operadores en línea disponibles';
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

-- admin_settlement_detail
CREATE OR REPLACE FUNCTION public.admin_settlement_detail(p_from date, p_to date)
 RETURNS TABLE(folio text, completado timestamp with time zone, servicio text, destinatario text, operador text, comision_pct numeric, bruto numeric, comision numeric, a_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    c.folio,
    sr.completed_at,
    sr.service_type,
    COALESCE(pr.name, ope.full_name, 'Sin asignar'),
    COALESCE(ope.full_name, 'Sin socio operador'),
    cr.rate,
    COALESCE(sr.total_price, 0),
    ROUND(COALESCE(sr.total_price, 0) * cr.rate / 100, 2),
    COALESCE(sr.total_price, 0)
      - ROUND(COALESCE(sr.total_price, 0) * cr.rate / 100, 2)
  FROM service_requests sr
  LEFT JOIN cases c      ON c.request_id = sr.id
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  CROSS JOIN LATERAL (SELECT commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS rate) cr
  WHERE sr.status = 'completed'
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  ORDER BY sr.completed_at DESC;
END;
$function$;

-- anonymize_account
CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role::text INTO v_role FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'La cuenta no existe';
  END IF;

  -- Las cuentas de gestion (admin, aseguradora, MOPT) las da de alta y de baja
  -- Budi: no son cuentas de consumidor, y borrar una se lleva el acceso de una
  -- organizacion entera.
  IF v_role NOT IN ('USER', 'OPERATOR') THEN
    RAISE EXCEPTION 'Esta cuenta la administra Budi. Pedi la baja a soporte.';
  END IF;

  -- Con un servicio en curso, borrar la cuenta dejaria a alguien varado (o a un
  -- operador sin poder cerrar el servicio).
  IF EXISTS (
    SELECT 1 FROM service_requests
     WHERE (user_id = p_user_id OR operator_id = p_user_id)
       AND status IN ('initiated', 'assigned', 'en_route', 'active')
  ) THEN
    RAISE EXCEPTION 'Tienes un servicio en curso. Termínalo o cancélalo antes de eliminar tu cuenta.';
  END IF;

  -- Login: primero auth.users, porque el trigger on_auth_user_email_updated
  -- copia el email al perfil y lo pisaria si fuera al reves.
  UPDATE auth.users
     SET email = 'eliminada+' || p_user_id || '@cuentas.budi.invalid',
         phone = NULL,
         encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
         raw_user_meta_data = '{}'::jsonb,
         -- 100 anos y no 'infinity': GoTrue (Go) no sabe leer una fecha infinita
         -- y responde 500 a toda operacion sobre el usuario, incluido el logout.
         -- Es la misma duracion que usa la API admin de Supabase para banear.
         banned_until = now() + interval '100 years',
         updated_at = now()
   WHERE id = p_user_id;
  DELETE FROM auth.sessions        WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens  WHERE user_id = p_user_id::text;
  DELETE FROM auth.identities      WHERE user_id = p_user_id;
  DELETE FROM auth.mfa_factors     WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;

  -- Perfil. El rol se conserva: los registros historicos dicen "un cliente" o
  -- "un operador", no quien.
  UPDATE profiles
     SET full_name = 'Cuenta eliminada',
         phone = '',
         email = NULL,
         marketing_opt_in = false,
         provider_id = NULL,
         insurer_id = NULL,
         verification_status = CASE WHEN role = 'OPERATOR' THEN 'rejected' END,
         verification_rejection_reason = CASE WHEN role = 'OPERATOR' THEN 'Cuenta eliminada por su titular' END,
         updated_at = now()
   WHERE id = p_user_id;

  DELETE FROM profile_sensitive  WHERE profile_id = p_user_id;
  DELETE FROM vehicles           WHERE user_id = p_user_id;
  DELETE FROM device_tokens      WHERE user_id = p_user_id;
  DELETE FROM notification_queue WHERE user_id = p_user_id;
  DELETE FROM operator_documents WHERE operator_id = p_user_id;
  DELETE FROM operator_locations WHERE operator_id = p_user_id;
  DELETE FROM pin_attempts       WHERE operator_id = p_user_id;

  UPDATE members SET profile_id = NULL, updated_at = now() WHERE profile_id = p_user_id;

  -- En sus servicios queda el hecho (que, donde, cuanto), no el vehiculo.
  UPDATE service_requests
     SET vehicle_plate = NULL, vehicle_make = NULL, vehicle_model = NULL, vehicle_color = NULL,
         vehicle_photo_url = NULL, vehicle_doc_path = NULL, notes = NULL
   WHERE user_id = p_user_id;

  UPDATE request_messages SET message = '[mensaje eliminado]' WHERE sender_id = p_user_id;
  UPDATE ratings SET comment = NULL WHERE rater_user_id = p_user_id;

  INSERT INTO account_deletions (user_id, role) VALUES (p_user_id, v_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'role', v_role);
END;
$function$;

-- admin_settlement_by_operator
CREATE OR REPLACE FUNCTION public.admin_settlement_by_operator(p_from date, p_to date)
 RETURNS TABLE(operator_id uuid, operador text, empresa text, comision_pct numeric, servicios bigint, bruto numeric, comision numeric, a_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    ope.id,
    COALESCE(ope.full_name, 'Sin socio operador'),
    COALESCE(pr.name, 'Independiente'),
    CASE WHEN MIN(cr.rate) = MAX(cr.rate) THEN MIN(cr.rate) END,
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0)
  FROM service_requests sr
  LEFT JOIN profiles ope  ON ope.id = sr.operator_id
  LEFT JOIN providers pr  ON pr.id = sr.provider_id
  CROSS JOIN LATERAL (SELECT commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS rate) cr
  WHERE sr.status = 'completed'
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  GROUP BY ope.id, ope.full_name, pr.id, pr.name
  ORDER BY 8 DESC;
END;
$function$;

-- admin_schedule_rate
CREATE OR REPLACE FUNCTION public.admin_schedule_rate(p_kind text, p_subject uuid, p_rate numeric, p_effective date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from     TIMESTAMPTZ;
  v_prev     RECORD;
  v_is_mopt  BOOLEAN;
  v_role     user_role;
  v_provider UUID;
  v_id       UUID;
  v_actor    TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar tarifas';
  END IF;

  IF p_kind NOT IN ('platform_default', 'provider', 'operator', 'mopt_fee') THEN
    RAISE EXCEPTION 'Tipo de tarifa desconocido: %', p_kind;
  END IF;
  IF p_rate IS NOT NULL AND (p_rate < 0 OR p_rate > 100) THEN
    RAISE EXCEPTION 'La tarifa debe estar entre 0 y 100';
  END IF;
  IF p_rate IS NULL AND p_kind NOT IN ('provider', 'operator') THEN
    RAISE EXCEPTION 'Falta la tarifa';
  END IF;

  IF p_kind = 'platform_default' THEN
    IF p_subject IS NOT NULL THEN
      RAISE EXCEPTION 'El default de plataforma no lleva sujeto';
    END IF;
  ELSIF p_kind IN ('provider', 'mopt_fee') THEN
    SELECT is_mopt INTO v_is_mopt FROM providers WHERE id = p_subject;
    IF v_is_mopt IS NULL THEN
      RAISE EXCEPTION 'El proveedor no existe';
    END IF;
    IF p_kind = 'provider' AND v_is_mopt THEN
      RAISE EXCEPTION 'Es un programa MOPT: su tarifa se configura en Programas MOPT';
    END IF;
    IF p_kind = 'mopt_fee' AND NOT v_is_mopt THEN
      RAISE EXCEPTION 'El programa MOPT no existe';
    END IF;
  ELSE
    SELECT role, provider_id INTO v_role, v_provider FROM profiles WHERE id = p_subject;
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Usuario no encontrado';
    END IF;
    IF v_role <> 'OPERATOR' THEN
      RAISE EXCEPTION 'La comisión propia es de los socios operadores';
    END IF;
    IF v_provider IS NOT NULL AND p_rate IS NOT NULL THEN
      RAISE EXCEPTION 'Este socio operador pertenece a una empresa: la comisión se configura en la empresa';
    END IF;
  END IF;

  IF p_effective IS NULL OR p_effective = sv_today() THEN
    v_from := now();
  ELSIF p_effective < sv_today() THEN
    RAISE EXCEPTION 'Una tarifa no se cambia hacia atras: reescribiria lo que ya se liquido';
  ELSE
    v_from := sv_day_start(p_effective);
  END IF;

  -- Serializa los cambios del mismo sujeto: dos admins guardando a la vez no
  -- pueden leer el mismo "anterior" y dejar dos versiones.
  PERFORM pg_advisory_xact_lock(hashtext('rate_versions:' || p_kind || ':' || COALESCE(p_subject::text, '')));

  SELECT * INTO v_prev FROM rate_version_at(p_kind, p_subject, v_from);

  -- Sin cambio real y sin nada programado despues: no hay nada que versionar.
  IF COALESCE(v_prev.found, false)
     AND v_prev.rate IS NOT DISTINCT FROM p_rate
     AND NOT EXISTS (SELECT 1 FROM rate_versions
                      WHERE kind = p_kind AND subject_id IS NOT DISTINCT FROM p_subject
                        AND valid_from > v_from) THEN
    RETURN NULL;
  END IF;
  -- Nunca tuvo version propia y le piden "el default": tampoco hay cambio.
  IF NOT COALESCE(v_prev.found, false) AND p_rate IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM rate_versions
              WHERE kind = p_kind AND subject_id IS NOT DISTINCT FROM p_subject
                AND valid_from = v_from) THEN
    RAISE EXCEPTION 'Ya hay un cambio programado para ese día; cancélalo primero';
  END IF;

  SELECT full_name INTO v_actor FROM profiles WHERE id = auth.uid();

  INSERT INTO rate_versions (kind, subject_id, rate, valid_from, note, created_by, created_by_name)
  VALUES (p_kind, p_subject, p_rate, v_from, NULLIF(btrim(p_note), ''), auth.uid(), v_actor)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- admin_rate_overview
CREATE OR REPLACE FUNCTION public.admin_rate_overview()
 RETURNS TABLE(kind text, subject_id uuid, subject_name text, current_rate numeric, own_rate boolean, next_rate numeric, next_is_default boolean, next_from timestamp with time zone, versions bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las tarifas';
  END IF;

  RETURN QUERY
  WITH subjects AS (
    SELECT 'platform_default'::text AS kind, NULL::uuid AS subject_id, 'Default de plataforma'::text AS subject_name
    UNION ALL
    SELECT CASE WHEN p.is_mopt THEN 'mopt_fee' ELSE 'provider' END, p.id, p.name FROM providers p
    UNION ALL
    SELECT 'operator', pr.id, COALESCE(pr.full_name, 'Socio operador')
      FROM profiles pr
     WHERE (pr.role = 'OPERATOR' AND pr.provider_id IS NULL)
        OR EXISTS (SELECT 1 FROM rate_versions rv WHERE rv.kind = 'operator' AND rv.subject_id = pr.id)
  )
  SELECT s.kind, s.subject_id, s.subject_name,
         CASE s.kind
           WHEN 'platform_default' THEN platform_commission_at(now())
           WHEN 'mopt_fee'         THEN mopt_fee_rate_at(s.subject_id, now())
           WHEN 'provider'         THEN commission_rate_at(s.subject_id, NULL, now())
           ELSE commission_rate_at(NULL, s.subject_id, now())
         END,
         s.kind IN ('platform_default', 'mopt_fee')
           OR (SELECT v.rate FROM rate_version_at(s.kind, s.subject_id, now()) v) IS NOT NULL,
         nx.rate,
         nx.id IS NOT NULL AND nx.rate IS NULL,
         nx.valid_from,
         (SELECT count(*) FROM rate_versions rv
           WHERE rv.kind = s.kind AND rv.subject_id IS NOT DISTINCT FROM s.subject_id)
    FROM subjects s
    LEFT JOIN LATERAL (
      SELECT rv.id, rv.rate, rv.valid_from
        FROM rate_versions rv
       WHERE rv.kind = s.kind AND rv.subject_id IS NOT DISTINCT FROM s.subject_id
         AND rv.valid_from > now()
       ORDER BY rv.valid_from
       LIMIT 1
    ) nx ON true
   ORDER BY array_position(ARRAY['platform_default', 'provider', 'mopt_fee', 'operator'], s.kind), s.subject_name;
END;
$function$;

-- admin_assign_request
CREATE OR REPLACE FUNCTION public.admin_assign_request(p_request_id uuid, p_operator_id uuid)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
  v_operator_role user_role;
  v_operator_provider uuid;
BEGIN
  -- Solo un admin puede asignar
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Only admins can assign requests';
  END IF;

  -- El operador destino debe existir y tener rol OPERATOR
  SELECT role, provider_id INTO v_operator_role, v_operator_provider
  FROM profiles
  WHERE id = p_operator_id;

  IF v_operator_role IS NULL THEN
    RAISE EXCEPTION 'Operator not found';
  END IF;

  IF v_operator_role != 'OPERATOR' THEN
    RAISE EXCEPTION 'Target user is not an operator';
  END IF;

  -- 00098: ni el admin cruza la flota del MOPT con la privada.
  IF NOT operator_fits_program(
       p_operator_id,
       (SELECT mopt_provider_id FROM service_requests WHERE id = p_request_id)) THEN
    RAISE EXCEPTION 'Ese socio operador no pertenece al programa de este servicio';
  END IF;

  -- Asignar. Se permite reasignar mientras la solicitud no este activada,
  -- completada o cancelada (una vez activa hay un PIN verificado en curso).
  UPDATE service_requests
  SET
    operator_id = p_operator_id,
    provider_id = v_operator_provider,
    status = 'assigned',
    assigned_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id
    AND status IN ('initiated', 'assigned', 'en_route')
  RETURNING * INTO v_request;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found or not in an assignable state';
  END IF;

  RETURN v_request;
END;
$function$;
