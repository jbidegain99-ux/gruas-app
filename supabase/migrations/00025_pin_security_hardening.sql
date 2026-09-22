-- Migration: Harden PIN flow against brute force.
--
-- Closes DIAGNOSTIC.md §1.1 / CHECKLIST A.1. Before this:
--   1. PINs were generated with RANDOM() (Postgres' non-cryptographic
--      PRNG), seeded per backend connection.
--   2. verify_request_pin had no rate limit and didn't verify the
--      caller was the assigned operator — any authenticated user with
--      a request_id could try all 10 000 combinations in seconds.
--
-- After this:
--   1. generate_secure_pin() uses pgcrypto's gen_random_bytes
--      (CSPRNG). create_service_request switches to it.
--   2. verify_request_pin records every attempt in pin_attempts,
--      locks the request for 15 min after 5 failed attempts, and
--      refuses callers that aren't the assigned operator.

-- ============================================================
-- 1. pin_attempts audit table
-- ============================================================
CREATE TABLE IF NOT EXISTS pin_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  operator_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success       BOOLEAN NOT NULL
);

-- Hot path: count recent failed attempts for a request. DESC index so
-- the planner can stop early once it crosses the 15-min window.
CREATE INDEX IF NOT EXISTS pin_attempts_request_attempted_idx
  ON pin_attempts (request_id, attempted_at DESC);

ALTER TABLE pin_attempts ENABLE ROW LEVEL SECURITY;

-- Writes happen via the SECURITY DEFINER function below. Reads are for
-- forensics — let an operator see attempts on their own assignment, and
-- ADMIN see everything.
CREATE POLICY "Operators read their own attempts"
  ON pin_attempts FOR SELECT
  USING (operator_id = auth.uid());

CREATE POLICY "Admins read all attempts"
  ON pin_attempts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN')
  );

-- ============================================================
-- 2. Cryptographically-secure PIN generation
-- ============================================================
CREATE OR REPLACE FUNCTION generate_secure_pin()
RETURNS TEXT AS $$
DECLARE
  v_int INTEGER;
BEGIN
  -- gen_random_bytes is provided by pgcrypto (already enabled in 00011).
  -- Take 4 bytes, interpret as a signed int, then map to 0..9999.
  -- We deliberately avoid abs(): abs(-2147483648) overflows int (that
  -- exact value appears 1/2^32 of the time). Modulo of a negative is
  -- safe (|result| < divisor), so we just normalise the sign afterwards.
  v_int := (('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int % 10000 + 10000) % 10000;
  RETURN lpad(v_int::text, 4, '0');
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION generate_secure_pin() IS
  'Returns a 4-digit PIN as TEXT using pgcrypto CSPRNG. Use this instead of LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, ''0'').';

-- ============================================================
-- 3. Hardened verify_request_pin
-- ============================================================
-- Constants embedded in the function body. Change here, not in clients.
--   MAX_FAILED_ATTEMPTS   = 5    failures in the window
--   LOCKOUT_WINDOW        = 15 minutes
DROP FUNCTION IF EXISTS verify_request_pin(UUID, TEXT);

CREATE OR REPLACE FUNCTION verify_request_pin(
  p_request_id UUID,
  p_pin TEXT
) RETURNS JSONB AS $$
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

  -- 2. Lockout check. Count failed attempts in the last 15 minutes.
  --    We count from now backwards — once an attempt scrolls off the
  --    window it stops counting, so cooldown is automatic.
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
    -- Record this as a failed attempt too so the lockout extends if
    -- the operator keeps hammering.
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION verify_request_pin(UUID, TEXT) TO authenticated;

-- ============================================================
-- 4. Switch create_service_request to the secure PIN generator
-- ============================================================
-- This recreates the latest signature (last set by 00021) but replaces
-- the LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0') line with a call to
-- generate_secure_pin(). Everything else is verbatim from 00021 — any
-- future schema change to this RPC must update both the 00021 version
-- and this override.
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
RETURNS JSONB AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
