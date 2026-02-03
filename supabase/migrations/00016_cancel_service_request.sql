-- Migration: Add cancellation columns and RPC function

-- Add columns for cancellation tracking
ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT NULL;

ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES profiles(id) DEFAULT NULL;

-- RPC: cancel_service_request
-- Allows users and operators to cancel a request with a reason
CREATE OR REPLACE FUNCTION cancel_service_request(
  p_request_id UUID,
  p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_request service_requests;
  v_user_id UUID;
  v_user_role user_role;
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

  -- Cancel the request
  UPDATE service_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = v_user_id,
    cancellation_reason = p_reason
  WHERE id = p_request_id;

  -- Create audit event
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    p_request_id,
    v_user_id,
    v_user_role::TEXT,
    'REQUEST_CANCELLED',
    jsonb_build_object('reason', p_reason, 'cancelled_by_role', v_user_role)
  );

  RETURN jsonb_build_object('success', true, 'message', 'Solicitud cancelada exitosamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION cancel_service_request(UUID, TEXT) TO authenticated;
