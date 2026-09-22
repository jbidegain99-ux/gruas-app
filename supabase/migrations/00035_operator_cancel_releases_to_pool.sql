-- Migration: cancelacion del OPERADOR devuelve la solicitud al pool
--
-- Antes: cancel_service_request marcaba status='cancelled' de forma terminal
-- sin importar quien cancelaba. Si el operador cancelaba, el usuario tenia que
-- crear una solicitud NUEVA desde cero (perdia PIN, historial del flujo, etc.).
--
-- Ahora, segun el rol de quien cancela:
--   - OPERATOR  -> la solicitud se LIBERA: vuelve a 'initiated' con operator_id
--                  NULL, reaparece en el pool (get_available_requests_for_operator)
--                  y otro operador puede aceptarla. Se notifica al usuario.
--   - USER/ADMIN -> cancelacion terminal (comportamiento anterior, sin cambios).
--
-- Ademas, get_available_requests_for_operator excluye las solicitudes que el
-- propio operador ya cancelo antes (evita ping-pong tomar/soltar del mismo
-- operador; queda auditado en request_events con event_type OPERATOR_CANCELLED).

CREATE OR REPLACE FUNCTION cancel_service_request(
  p_request_id UUID,
  p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_request service_requests;
  v_user_id UUID;
  v_user_role user_role;
  v_event_type event_type;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cancel_service_request(UUID, TEXT) TO authenticated;

-- ==========================================================
-- Pool: no volver a ofrecer la solicitud a un operador que ya la cancelo
-- ==========================================================
CREATE OR REPLACE FUNCTION get_available_requests_for_operator()
RETURNS JSONB AS $$
DECLARE
  v_requests JSONB;
BEGIN
  -- Verify caller is operator
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'OPERATOR'
  ) THEN
    RAISE EXCEPTION 'Only operators can view available requests';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', sr.id,
      'pickup_lat', sr.pickup_lat,
      'pickup_lng', sr.pickup_lng,
      'pickup_address', sr.pickup_address,
      'dropoff_lat', sr.dropoff_lat,
      'dropoff_lng', sr.dropoff_lng,
      'dropoff_address', sr.dropoff_address,
      'tow_type', sr.tow_type,
      'incident_type', sr.incident_type,
      'created_at', sr.created_at,
      'user_name', p.full_name,
      'user_phone', p.phone
    ) ORDER BY sr.created_at ASC
  ) INTO v_requests
  FROM service_requests sr
  JOIN profiles p ON p.id = sr.user_id
  WHERE sr.status = 'initiated'
    AND NOT EXISTS (
      SELECT 1 FROM request_events re
      WHERE re.request_id = sr.id
        AND re.actor_id = auth.uid()
        AND re.event_type = 'OPERATOR_CANCELLED'
    );

  RETURN COALESCE(v_requests, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
