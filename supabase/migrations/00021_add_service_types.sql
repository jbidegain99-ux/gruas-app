-- Migration: Add service type support
-- Adds 5 service types: tow, battery, tire, fuel, locksmith
-- Each with distinct pricing and workflow

-- ============================================================
-- 1A. New columns on service_requests
-- ============================================================
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'tow';
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS service_details JSONB DEFAULT '{}';

-- Constraint for valid service types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_service_type'
  ) THEN
    ALTER TABLE service_requests ADD CONSTRAINT chk_service_type
      CHECK (service_type IN ('tow', 'battery', 'tire', 'fuel', 'locksmith'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_requests_service_type ON service_requests(service_type);

-- ============================================================
-- 1B. New table: service_type_pricing
-- ============================================================
CREATE TABLE IF NOT EXISTS service_type_pricing (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  service_type TEXT NOT NULL CHECK (service_type IN ('tow', 'battery', 'tire', 'fuel', 'locksmith')),
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  base_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  extra_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  extra_fee_label TEXT DEFAULT NULL,
  requires_destination BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one active row per service_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_type_pricing_active
  ON service_type_pricing(service_type) WHERE is_active = true;

-- RLS
ALTER TABLE service_type_pricing ENABLE ROW LEVEL SECURITY;

-- Everyone can read active pricing
CREATE POLICY "Anyone can read active service pricing"
  ON service_type_pricing FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Admins full CRUD
CREATE POLICY "Admins can manage service pricing"
  ON service_type_pricing FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN')
  );

-- Seed pricing data
INSERT INTO service_type_pricing (service_type, display_name, description, icon, base_price, extra_fee, extra_fee_label, requires_destination, sort_order)
VALUES
  ('tow',       'Grua',        'Remolque de vehiculo',          '🚛', 60.00,  0,    NULL,                  true,  1),
  ('battery',   'Bateria',     'Carga o cambio de bateria',     '🔋', 25.00,  0,    NULL,                  false, 2),
  ('tire',      'Llanta',      'Cambio de llanta ponchada',     '🛞', 30.00, 15.00, 'Sin repuesto (+$15)', false, 3),
  ('fuel',      'Combustible', 'Entrega de combustible',        '⛽', 20.00,  4.50, 'Por galon extra',     false, 4),
  ('locksmith', 'Cerrajeria',  'Apertura de vehiculo cerrado',  '🔑', 35.00,  0,    NULL,                  false, 5)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 1C. Update create_service_request() RPC
-- ============================================================
-- Drop old signature
DROP FUNCTION IF EXISTS create_service_request(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, tow_type, TEXT, TEXT, TEXT);

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

  -- For non-tow services, force tow_type to 'light' (placeholder)
  IF p_service_type != 'tow' THEN
    v_actual_tow_type := 'light';
  ELSE
    v_actual_tow_type := p_tow_type;
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

GRANT EXECUTE ON FUNCTION create_service_request(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, TEXT, tow_type, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 1D. Update get_available_requests_for_operator()
-- ============================================================
CREATE OR REPLACE FUNCTION get_available_requests_for_operator()
RETURNS JSONB AS $$
DECLARE
  v_requests JSONB;
BEGIN
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
      'user_phone', p.phone,
      'vehicle_photo_url', sr.vehicle_photo_url,
      'notes', sr.notes,
      'service_type', sr.service_type,
      'service_details', sr.service_details
    ) ORDER BY sr.created_at ASC
  ) INTO v_requests
  FROM service_requests sr
  JOIN profiles p ON p.id = sr.user_id
  WHERE sr.status = 'initiated';

  RETURN COALESCE(v_requests, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_available_requests_for_operator() TO authenticated;

-- ============================================================
-- 1E. Update complete_service_request()
-- ============================================================
CREATE OR REPLACE FUNCTION complete_service_request(
  p_request_id UUID,
  p_distance_pickup_to_dropoff NUMERIC
)
RETURNS service_requests AS $$
DECLARE
  v_request service_requests;
  v_price_breakdown JSONB;
  v_total_distance NUMERIC;
  v_stp service_type_pricing;
  v_total NUMERIC;
  v_extra NUMERIC;
BEGIN
  SELECT * INTO v_request FROM service_requests
  WHERE id = p_request_id AND operator_id = auth.uid();

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found or not assigned to you';
  END IF;

  IF v_request.status != 'active' THEN
    RAISE EXCEPTION 'Request is not in active state';
  END IF;

  IF v_request.service_type = 'tow' THEN
    -- Tow: use existing calculate_price()
    v_total_distance := COALESCE(v_request.distance_operator_to_pickup_km, 0) + p_distance_pickup_to_dropoff;
    v_price_breakdown := calculate_price(v_total_distance, v_request.tow_type);
  ELSE
    -- Non-tow: flat fee from service_type_pricing + extras
    SELECT * INTO v_stp FROM service_type_pricing
    WHERE service_type = v_request.service_type AND is_active = true
    LIMIT 1;

    v_extra := 0;

    -- Tire: +extra_fee if no spare
    IF v_request.service_type = 'tire' AND v_stp.extra_fee > 0 THEN
      IF (v_request.service_details->>'has_spare')::boolean IS DISTINCT FROM true THEN
        v_extra := v_stp.extra_fee;
      END IF;
    END IF;

    -- Fuel: extra_fee per gallon (beyond 1 included)
    IF v_request.service_type = 'fuel' AND v_stp.extra_fee > 0 THEN
      DECLARE
        v_gallons NUMERIC;
      BEGIN
        v_gallons := COALESCE((v_request.service_details->>'gallons')::numeric, 1);
        IF v_gallons > 1 THEN
          v_extra := v_stp.extra_fee * (v_gallons - 1);
        END IF;
      END;
    END IF;

    v_total := v_stp.base_price + v_extra;

    v_price_breakdown := jsonb_build_object(
      'base_price', v_stp.base_price,
      'extra_fee', v_extra,
      'extra_fee_label', v_stp.extra_fee_label,
      'total', v_total,
      'currency', v_stp.currency,
      'service_type', v_request.service_type
    );
  END IF;

  UPDATE service_requests
  SET
    status = 'completed',
    distance_pickup_to_dropoff_km = p_distance_pickup_to_dropoff,
    price_breakdown = v_price_breakdown,
    total_price = (v_price_breakdown->>'total')::NUMERIC,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
