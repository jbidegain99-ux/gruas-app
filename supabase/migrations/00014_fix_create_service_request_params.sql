-- Migration: Fix create_service_request function parameter order
-- Supabase client sends parameters in alphabetical order
-- This migration recreates the function with parameters in alphabetical order

DROP FUNCTION IF EXISTS create_service_request(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, tow_type, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION create_service_request(
  p_dropoff_address TEXT,
  p_dropoff_lat DOUBLE PRECISION,
  p_dropoff_lng DOUBLE PRECISION,
  p_incident_type TEXT,
  p_notes TEXT DEFAULT NULL,
  p_pickup_address TEXT DEFAULT NULL,
  p_pickup_lat DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng DOUBLE PRECISION DEFAULT NULL,
  p_tow_type tow_type DEFAULT 'light',
  p_vehicle_doc_path TEXT DEFAULT NULL,
  p_vehicle_plate TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_pin TEXT;
  v_pin_hash TEXT;
  v_request_id UUID;
  v_request service_requests;
BEGIN
  v_user_id := auth.uid();

  -- Verify user is authenticated
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Generate 4-digit PIN
  v_pin := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  v_pin_hash := crypt(v_pin, gen_salt('bf'));

  -- Create the request
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
    notes,
    pin_hash,
    status
  ) VALUES (
    v_user_id,
    COALESCE(p_pickup_lat, 13.6929),
    COALESCE(p_pickup_lng, -89.2182),
    COALESCE(p_pickup_address, 'San Salvador'),
    p_dropoff_lat,
    p_dropoff_lng,
    p_dropoff_address,
    p_tow_type,
    p_incident_type,
    p_vehicle_plate,
    p_vehicle_doc_path,
    p_notes,
    v_pin_hash,
    'initiated'
  ) RETURNING * INTO v_request;

  v_request_id := v_request.id;

  -- Create audit event
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    v_request_id,
    v_user_id,
    'USER',
    'REQUEST_CREATED',
    jsonb_build_object(
      'pickup_address', p_pickup_address,
      'dropoff_address', p_dropoff_address,
      'tow_type', p_tow_type,
      'incident_type', p_incident_type
    )
  );

  -- Return request info with PIN (PIN is only returned once at creation)
  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'pin', v_pin,
    'status', 'initiated',
    'message', 'Guarda este PIN. Lo necesitarás cuando llegue la grúa.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_service_request(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, tow_type, TEXT, TEXT) TO authenticated;
