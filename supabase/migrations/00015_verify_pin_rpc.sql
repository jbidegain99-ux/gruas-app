-- Migration: Add PIN verification RPC function
-- This function allows operators to verify the client's PIN

CREATE OR REPLACE FUNCTION verify_request_pin(
  p_request_id UUID,
  p_pin TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_pin_hash TEXT;
  v_is_valid BOOLEAN;
BEGIN
  -- Get the stored PIN hash
  SELECT pin_hash INTO v_pin_hash
  FROM service_requests
  WHERE id = p_request_id;

  IF v_pin_hash IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Request not found');
  END IF;

  -- Verify the PIN against the hash
  v_is_valid := (v_pin_hash = crypt(p_pin, v_pin_hash));

  RETURN jsonb_build_object('valid', v_is_valid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION verify_request_pin(UUID, TEXT) TO authenticated;
