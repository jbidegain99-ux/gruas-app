-- =====================================================
-- 00059 — La maquina de estados no se salta con un UPDATE
--
-- EL BUG
-- 00054 le dejo al cliente el GRANT UPDATE (status) sobre service_requests, y su
-- guardian solo protegia DOS transiciones (active y completed, las que valen
-- dinero/PIN). El resto de la maquina de estados quedaba abierta a un UPDATE
-- directo. Verificado:
--   · Un operador hace `UPDATE ... SET status='cancelled'` y la solicitud queda
--     cancelada PERO con `operator_id` intacto: no vuelve al pool, sin razon,
--     sin evento, sin la push al usuario. Toda la logica de `cancel_service_request`
--     (liberar al pool — migr. 00035, avisar "buscando otro operador") evadida.
--     En asistencia vial: el cliente varado se queda esperando a alguien que ya
--     se fue, y nadie mas puede tomar el servicio.
--   · El usuario dueño empuja su propia solicitud a 'en_route' sin operador.
--   · Se podian revertir estados (deshacer una activacion, reabrir una cerrada).
--
-- EL ARREGLO — testigo unico + maquina de estados en el guardian
-- Cada RPC que mueve el estado deja un testigo transaccion-local con el id de la
-- solicitud. El guardian permite el cambio si viene con testigo (RPC autorizada)
-- y, si es un UPDATE directo del cliente, solo deja la UNICA transicion directa
-- que la app hace de verdad: el operador asignado marcando 'en_route'. Todo lo
-- demas exige pasar por la RPC correspondiente.
--
-- Por que testigo y no validar la maquina entera en el trigger: las transiciones
-- legitimas (accept -> assigned, cancel -> initiated/cancelled) las hacen RPC
-- con el `auth.uid` del cliente, indistinguibles en el trigger de un UPDATE
-- directo malicioso al mismo estado. El testigo es lo que las separa.
--
-- No toca la app: su unico UPDATE directo de status es a 'en_route'
-- (active.tsx), que sigue permitido; cancelar y aceptar ya van por RPC.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Guardian con la maquina de estados
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_privileged_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Sin cambio de estado no hay nada que vigilar (deja pasar updates de otras
  -- columnas: route_polyline, etc.).
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- El admin conserva la valvula manual.
  IF is_admin() THEN
    RETURN NEW;
  END IF;

  -- Sesion directa / servidor (psql, cron, service_role): no es una peticion de
  -- cliente. Una peticion de PostgREST sin JWT llega como `anon`, que no casa
  -- con ninguna politica de esta tabla, asi que no alcanza ninguna fila.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Viene de una RPC autorizada: dejo su testigo con el id de ESTA fila. Se
  -- aceptan los tres testigos: el generico de las RPC de estado (00059) y los
  -- dos especificos que 00054 ya usaba para active/completed.
  IF NEW.id::text IN (
        COALESCE(current_setting('app.sr_rpc', true), ''),
        COALESCE(current_setting('app.pin_verified', true), ''),
        COALESCE(current_setting('app.service_completed', true), '')
     ) THEN
    RETURN NEW;
  END IF;

  -- --- A partir de aca es un UPDATE DIRECTO del cliente ---------------------
  -- La unica transicion directa que hace la app es el operador asignado marcando
  -- que va en camino. Cualquier otra —cancelar (evadiendo la liberacion al
  -- pool), activar/cerrar (dinero/PIN), revertir un estado, o que el usuario
  -- empuje el estado— tiene que pasar por su RPC.
  IF NEW.status = 'en_route'
     AND OLD.status IN ('assigned', 'en_route')
     AND NEW.operator_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Transicion de estado % -> % no permitida por escritura directa; usa la RPC correspondiente',
    OLD.status, NEW.status;
END;
$$;

COMMENT ON FUNCTION public.guard_privileged_status_change() IS
  'Maquina de estados de service_requests (00059). Un UPDATE directo del cliente '
  'solo puede marcar en_route (operador asignado); el resto exige la RPC, que '
  'deja un testigo transaccion-local (app.sr_rpc / app.pin_verified / app.service_completed).';

-- ---------------------------------------------------------------
-- 2. Las RPC de estado dejan el testigo generico
-- ---------------------------------------------------------------
-- accept (-> assigned), cancel (-> initiated/cancelled) y la legacy
-- operator_cancel (-> initiated). verify_request_pin y complete_service_request
-- NO se tocan: ya dejan sus testigos propios (app.pin_verified /
-- app.service_completed), que el guardian sigue aceptando. admin_* pasan por
-- is_admin(); assign_nearest_operator la usa el admin (is_admin) y un no-admin
-- que la invoque queda, con razon, frenado por el guardian; alert_stale corre
-- como cron (auth.uid NULL). Reconstruidas por SUSTITUCION EXACTA: lo unico que
-- se agrega es la linea del testigo tras BEGIN.

-- --- accept_service_request ---
CREATE OR REPLACE FUNCTION public.accept_service_request(p_request_id uuid)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    RAISE EXCEPTION 'Tu cuenta de operador todavia no esta verificada';
  END IF;

  -- Update request
  UPDATE service_requests
  SET
    operator_id = auth.uid(),
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

  RETURN v_request;
END;
$function$

;

-- --- cancel_service_request ---
CREATE OR REPLACE FUNCTION public.cancel_service_request(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
      'Buscando otro operador',
      'El operador no pudo atender tu servicio. Tu solicitud sigue activa y estamos buscando otro operador.',
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
      'message', 'Servicio liberado. La solicitud volvera a ofrecerse a otros operadores.'
    );
  END IF;

  -- ==========================================================
  -- USER / ADMIN cancelan -> cancelacion terminal (como antes)
  -- ==========================================================
  v_event_type := CASE v_user_role
    WHEN 'ADMIN' THEN 'ADMIN_CANCELLED'::event_type
    ELSE 'USER_CANCELLED'::event_type
  END;

  UPDATE service_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = v_user_id,
    cancellation_reason = p_reason
  WHERE id = p_request_id;

  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    p_request_id,
    v_user_id,
    v_user_role,
    v_event_type,
    jsonb_build_object('reason', p_reason, 'cancelled_by_role', v_user_role)
  );

  RETURN jsonb_build_object('success', true, 'message', 'Solicitud cancelada exitosamente');
END;
$function$

;

-- --- operator_cancel_request ---
CREATE OR REPLACE FUNCTION public.operator_cancel_request(p_request_id uuid)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_request service_requests;
BEGIN
  -- 00059: testigo para el guardian de la maquina de estados.
  PERFORM set_config('app.sr_rpc', p_request_id::text, true);
  -- Get request and verify operator
  SELECT * INTO v_request FROM service_requests
  WHERE id = p_request_id AND operator_id = auth.uid();

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found or not assigned to you';
  END IF;

  IF v_request.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Request cannot be cancelled';
  END IF;

  -- Reset request to initiated (re-queue)
  UPDATE service_requests
  SET
    operator_id = NULL,
    status = 'initiated',
    assigned_at = NULL,
    updated_at = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$function$

;
