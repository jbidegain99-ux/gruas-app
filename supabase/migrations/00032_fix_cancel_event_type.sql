-- Migration: fix cancel_service_request audit event_type
--
-- El RPC original (00016) insertaba un evento de auditoria con
-- event_type = 'REQUEST_CANCELLED', pero ese valor NO existe en el enum
-- event_type (definido en 00001). El enum si tiene USER_CANCELLED /
-- OPERATOR_CANCELLED / ADMIN_CANCELLED. Por eso cualquier intento de cancelar
-- fallaba con: invalid input value for enum event_type: "REQUEST_CANCELLED".
--
-- Aqui recreamos la funcion eligiendo el event_type segun el rol de quien cancela.

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

  -- Map role -> valid event_type enum value
  v_event_type := CASE v_user_role
    WHEN 'OPERATOR' THEN 'OPERATOR_CANCELLED'::event_type
    WHEN 'ADMIN'    THEN 'ADMIN_CANCELLED'::event_type
    ELSE 'USER_CANCELLED'::event_type
  END;

  -- Cancel the request
  UPDATE service_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = v_user_id,
    cancellation_reason = p_reason
  WHERE id = p_request_id;

  -- Create audit event (usa el enum correcto)
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
