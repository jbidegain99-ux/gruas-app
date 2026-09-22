-- Migration: Follow-up hardening for the PIN flow (review of 00025).
--
-- Fixes three issues found reviewing 00025:
--   1. TOCTOU in verify_request_pin: the failed-attempt count was read
--      and the decision made *before* the attempt was inserted, with no
--      lock in between. Concurrent calls all read "< 5 failures" and all
--      proceed, so the 5-attempts/15-min lockout could be bypassed by
--      firing requests in parallel. We now take a per-request advisory
--      transaction lock so attempts on the same request serialize.
--   2. Mutable search_path on SECURITY DEFINER functions (Supabase
--      "Function Search Path Mutable" lint). We pin
--      search_path = public, extensions, pg_temp on all three. `extensions`
--      is included because pgcrypto (crypt/gen_salt/gen_random_bytes) lives
--      there on Supabase.
--   3. pin_attempts grew unbounded. verify_request_pin now opportunistically
--      prunes rows older than 1 hour for the request it touches (the
--      lockout window is 15 min, so 1 h is always safe to drop).

-- ============================================================
-- 1. generate_secure_pin: pin search_path
-- ============================================================
CREATE OR REPLACE FUNCTION generate_secure_pin()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_int INTEGER;
BEGIN
  -- gen_random_bytes is provided by pgcrypto (enabled in 00011).
  -- Take 4 bytes, interpret as a signed int, then map to 0..9999.
  -- We deliberately avoid abs(): abs(-2147483648) overflows int. Modulo
  -- of a negative is safe (|result| < divisor), so we normalise the sign.
  v_int := (('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int % 10000 + 10000) % 10000;
  RETURN lpad(v_int::text, 4, '0');
END;
$$;

-- ============================================================
-- 2. verify_request_pin: advisory lock + search_path + pruning
-- ============================================================
DROP FUNCTION IF EXISTS verify_request_pin(UUID, TEXT);

CREATE OR REPLACE FUNCTION verify_request_pin(
  p_request_id UUID,
  p_pin TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id        UUID;
  v_request          service_requests;
  v_pin_hash         TEXT;
  v_recent_failures  INTEGER;
  v_last_failure_at  TIMESTAMPTZ;
  v_retry_after_s    INTEGER;
  v_is_valid         BOOLEAN;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Not authenticated');
  END IF;

  -- Serialize all verification attempts for this request. xact-scoped, so
  -- it releases when the RPC transaction ends. This closes the TOCTOU
  -- where parallel calls each read "< 5 failures" before any INSERT lands.
  PERFORM pg_advisory_xact_lock(hashtext(p_request_id::text));

  -- 1. Resolve and authorize.
  SELECT * INTO v_request FROM service_requests WHERE id = p_request_id;
  IF v_request.id IS NULL THEN
    -- Generic message — don't leak which IDs exist.
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid request');
  END IF;

  -- Only the assigned operator can verify. ADMIN passes for ops debugging.
  IF v_request.operator_id IS DISTINCT FROM v_caller_id
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_caller_id AND role = 'ADMIN') THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Not the assigned operator');
  END IF;

  -- Opportunistic retention: drop attempts for this request older than the
  -- lockout window by a wide margin. Bounded by request_id, uses the
  -- (request_id, attempted_at DESC) index.
  DELETE FROM pin_attempts
   WHERE request_id = p_request_id
     AND attempted_at < NOW() - INTERVAL '1 hour';

  -- 2. Lockout check. Count failed attempts in the last 15 minutes.
  SELECT COUNT(*), MAX(attempted_at)
    INTO v_recent_failures, v_last_failure_at
    FROM pin_attempts
   WHERE request_id = p_request_id
     AND success = false
     AND attempted_at > NOW() - INTERVAL '15 minutes';

  IF v_recent_failures >= 5 THEN
    v_retry_after_s := GREATEST(
      1,
      EXTRACT(EPOCH FROM (v_last_failure_at + INTERVAL '15 minutes' - NOW()))::INTEGER
    );
    -- Record this as a failed attempt too so the lockout extends if the
    -- operator keeps hammering.
    INSERT INTO pin_attempts (request_id, operator_id, success)
    VALUES (p_request_id, v_caller_id, false);
    RETURN jsonb_build_object(
      'valid', false,
      'locked', true,
      'retry_after_seconds', v_retry_after_s,
      'error', 'Too many failed attempts; try again later'
    );
  END IF;

  -- 3. Verify the PIN.
  v_pin_hash := v_request.pin_hash;
  IF v_pin_hash IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Request has no PIN');
  END IF;

  v_is_valid := (v_pin_hash = crypt(p_pin, v_pin_hash));

  -- 4. Record the attempt.
  INSERT INTO pin_attempts (request_id, operator_id, success)
  VALUES (p_request_id, v_caller_id, v_is_valid);

  IF v_is_valid THEN
    RETURN jsonb_build_object('valid', true);
  END IF;

  RETURN jsonb_build_object(
    'valid', false,
    'attempts_remaining', GREATEST(0, 5 - (v_recent_failures + 1)),
    'error', 'Incorrect PIN'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION verify_request_pin(UUID, TEXT) TO authenticated;

-- ============================================================
-- 3. create_service_request: pin search_path
-- ============================================================
-- Same body as 00025 (which switched PIN generation to generate_secure_pin);
-- this revision only adds the pinned search_path. Any future schema change
-- to this RPC must keep 00021 / 00025 / 00026 in sync.
CREATE OR REPLACE FUNCTION create_service_request(
  p_dropoff_address TEXT,
  p_dropoff_lat DOUBLE PRECISION,
  p_dropoff_lng DOUBLE PRECISION,
  p_incident_type TEXT,
  p_notes TEXT DEFAULT NULL,
  p_pickup_address TEXT DEFAULT NULL,
  p_pickup_lat DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng DOUBLE PRECISION DEFAULT NULL,
  p_service_details JSONB DEFAULT '{}',
  p_service_type TEXT DEFAULT 'tow',
  p_tow_type tow_type DEFAULT 'light',
  p_vehicle_doc_path TEXT DEFAULT NULL,
  p_vehicle_photo_url TEXT DEFAULT NULL,
  p_vehicle_plate TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_pin TEXT;
  v_pin_hash TEXT;
  v_request_id UUID;
  v_request service_requests;
  v_actual_tow_type tow_type;
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
    service_details
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
    COALESCE(p_service_details, '{}'::jsonb)
  ) RETURNING * INTO v_request;

  v_request_id := v_request.id;

  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    v_request_id,
    v_user_id,
    'USER',
    'REQUEST_CREATED',
    jsonb_build_object(
      'pickup_address', p_pickup_address,
      'dropoff_address', p_dropoff_address,
      'tow_type', v_actual_tow_type,
      'incident_type', p_incident_type,
      'service_type', p_service_type,
      'has_photo', p_vehicle_photo_url IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'pin', v_pin,
    'status', 'initiated',
    'message', 'Guarda este PIN. Lo necesitaras cuando llegue el operador.'
  );
END;
$$;
