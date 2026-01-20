-- Additional RPCs and improvements for Gruas App MVP

-- =====================================================
-- RPC: set_active_pricing_rule
-- Atomically activates a pricing rule (deactivates others)
-- =====================================================
CREATE OR REPLACE FUNCTION set_active_pricing_rule(p_rule_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_rule pricing_rules;
BEGIN
  -- Verify caller is admin
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only admins can activate pricing rules';
  END IF;

  -- Verify rule exists
  SELECT * INTO v_rule FROM pricing_rules WHERE id = p_rule_id;
  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'Pricing rule not found';
  END IF;

  -- Deactivate all rules first (within transaction)
  UPDATE pricing_rules SET is_active = false WHERE is_active = true;

  -- Activate the requested rule
  UPDATE pricing_rules SET is_active = true, updated_at = NOW() WHERE id = p_rule_id;

  RETURN jsonb_build_object(
    'success', true,
    'activated_rule_id', p_rule_id,
    'rule_name', v_rule.name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- RPC: admin_update_user_role
-- Allows admin to change user roles
-- =====================================================
CREATE OR REPLACE FUNCTION admin_update_user_role(
  p_user_id UUID,
  p_new_role user_role
)
RETURNS JSONB AS $$
DECLARE
  v_profile profiles;
BEGIN
  -- Verify caller is admin
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only admins can update user roles';
  END IF;

  -- Prevent admin from changing own role
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;

  -- Update the role
  UPDATE profiles
  SET role = p_new_role, updated_at = NOW()
  WHERE id = p_user_id
  RETURNING * INTO v_profile;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'new_role', p_new_role,
    'full_name', v_profile.full_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- RPC: get_admin_dashboard_stats
-- Returns dashboard statistics for admin
-- =====================================================
CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()
RETURNS JSONB AS $$
DECLARE
  v_stats JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_requests', (SELECT COUNT(*) FROM service_requests),
    'pending_requests', (SELECT COUNT(*) FROM service_requests WHERE status = 'initiated'),
    'active_requests', (SELECT COUNT(*) FROM service_requests WHERE status IN ('assigned', 'en_route', 'active')),
    'completed_requests', (SELECT COUNT(*) FROM service_requests WHERE status = 'completed'),
    'cancelled_requests', (SELECT COUNT(*) FROM service_requests WHERE status = 'cancelled'),
    'total_users', (SELECT COUNT(*) FROM profiles WHERE role = 'USER'),
    'total_operators', (SELECT COUNT(*) FROM profiles WHERE role = 'OPERATOR'),
    'active_providers', (SELECT COUNT(*) FROM providers WHERE is_active = true),
    'total_revenue', (SELECT COALESCE(SUM(total_price), 0) FROM service_requests WHERE status = 'completed'),
    'avg_rating', (SELECT COALESCE(AVG(stars), 0) FROM ratings),
    'requests_today', (SELECT COUNT(*) FROM service_requests WHERE created_at >= CURRENT_DATE),
    'requests_this_week', (SELECT COUNT(*) FROM service_requests WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'),
    'requests_this_month', (SELECT COUNT(*) FROM service_requests WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')
  ) INTO v_stats;

  RETURN v_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- RPC: get_request_audit_trail
-- Returns full audit trail for a request (for MOP/Admin)
-- =====================================================
CREATE OR REPLACE FUNCTION get_request_audit_trail(p_request_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_events JSONB;
BEGIN
  -- Verify caller is admin or MOP
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('ADMIN', 'MOP')
  ) THEN
    RAISE EXCEPTION 'Only admins and MOP can view audit trails';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', re.id,
      'event_type', re.event_type,
      'actor_id', re.actor_id,
      'actor_role', re.actor_role,
      'actor_name', p.full_name,
      'payload', re.payload,
      'created_at', re.created_at
    ) ORDER BY re.created_at ASC
  ) INTO v_events
  FROM request_events re
  LEFT JOIN profiles p ON p.id = re.actor_id
  WHERE re.request_id = p_request_id;

  RETURN COALESCE(v_events, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- RPC: create_service_request
-- Creates a new service request with PIN generation
-- =====================================================
CREATE OR REPLACE FUNCTION create_service_request(
  p_pickup_lat DOUBLE PRECISION,
  p_pickup_lng DOUBLE PRECISION,
  p_pickup_address TEXT,
  p_dropoff_lat DOUBLE PRECISION,
  p_dropoff_lng DOUBLE PRECISION,
  p_dropoff_address TEXT,
  p_tow_type tow_type,
  p_incident_type TEXT,
  p_vehicle_plate TEXT DEFAULT NULL,
  p_vehicle_doc_path TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
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
    p_pickup_lat,
    p_pickup_lng,
    p_pickup_address,
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

-- =====================================================
-- RPC: get_available_requests_for_operator
-- Returns pending requests for operators to accept
-- =====================================================
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
  WHERE sr.status = 'initiated';

  RETURN COALESCE(v_requests, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Fix: Add provider_id column to profiles for operators
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'provider_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN provider_id UUID REFERENCES providers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =====================================================
-- Fix: Add notes column to service_requests if missing
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'service_requests' AND column_name = 'notes'
  ) THEN
    ALTER TABLE service_requests ADD COLUMN notes TEXT;
  END IF;
END $$;

-- =====================================================
-- Grant execute permissions
-- =====================================================
GRANT EXECUTE ON FUNCTION set_active_pricing_rule(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_request_audit_trail(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_service_request(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, tow_type, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_available_requests_for_operator() TO authenticated;
