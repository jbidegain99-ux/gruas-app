-- Create service_requests table

CREATE TABLE service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  operator_id UUID REFERENCES profiles(id),
  provider_id UUID REFERENCES providers(id),
  tow_type tow_type NOT NULL DEFAULT 'light',
  status request_status NOT NULL DEFAULT 'initiated',

  -- Pickup location
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  pickup_address TEXT NOT NULL,

  -- Dropoff location
  dropoff_lat DOUBLE PRECISION NOT NULL,
  dropoff_lng DOUBLE PRECISION NOT NULL,
  dropoff_address TEXT NOT NULL,

  -- Incident details
  incident_type TEXT NOT NULL,
  incident_description TEXT,

  -- Vehicle details
  vehicle_plate TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  vehicle_doc_path TEXT, -- Storage path for vehicle document

  -- PIN for activation (stored as hash)
  pin_hash TEXT NOT NULL,

  -- Distance calculations (in km)
  distance_operator_to_pickup_km NUMERIC(10, 2),
  distance_pickup_to_dropoff_km NUMERIC(10, 2),

  -- Pricing
  price_breakdown JSONB,
  total_price NUMERIC(10, 2),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_service_requests_user ON service_requests(user_id);
CREATE INDEX idx_service_requests_operator ON service_requests(operator_id);
CREATE INDEX idx_service_requests_status ON service_requests(status);
CREATE INDEX idx_service_requests_created ON service_requests(created_at DESC);
CREATE INDEX idx_service_requests_pickup_location ON service_requests(pickup_lat, pickup_lng);

-- Enable Row Level Security
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can create requests
CREATE POLICY "Users can create requests"
  ON service_requests FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'USER'
    )
  );

-- Users can view their own requests
CREATE POLICY "Users can view own requests"
  ON service_requests FOR SELECT
  USING (user_id = auth.uid());

-- Users can update their own requests (limited fields)
CREATE POLICY "Users can update own requests"
  ON service_requests FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Operators can view available requests (initiated status)
CREATE POLICY "Operators can view available requests"
  ON service_requests FOR SELECT
  USING (
    status = 'initiated'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'OPERATOR'
    )
  );

-- Operators can view their assigned requests
CREATE POLICY "Operators can view assigned requests"
  ON service_requests FOR SELECT
  USING (operator_id = auth.uid());

-- Operators can update their assigned requests
CREATE POLICY "Operators can update assigned requests"
  ON service_requests FOR UPDATE
  USING (operator_id = auth.uid());

-- Admins can do everything
CREATE POLICY "Admins can manage all requests"
  ON service_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- MOP can view all requests
CREATE POLICY "MOP can view all requests"
  ON service_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'MOP'
    )
  );

-- Function to accept a request (for operators)
CREATE OR REPLACE FUNCTION accept_service_request(p_request_id UUID)
RETURNS service_requests AS $$
DECLARE
  v_request service_requests;
  v_operator_role user_role;
BEGIN
  -- Verify operator role
  SELECT role INTO v_operator_role FROM profiles WHERE id = auth.uid();
  IF v_operator_role != 'OPERATOR' THEN
    RAISE EXCEPTION 'Only operators can accept requests';
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to verify PIN and activate service
CREATE OR REPLACE FUNCTION verify_pin_and_activate(
  p_request_id UUID,
  p_pin TEXT
)
RETURNS service_requests AS $$
DECLARE
  v_request service_requests;
  v_stored_hash TEXT;
BEGIN
  -- Get request and verify operator
  SELECT * INTO v_request FROM service_requests
  WHERE id = p_request_id AND operator_id = auth.uid();

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found or not assigned to you';
  END IF;

  IF v_request.status NOT IN ('assigned', 'en_route') THEN
    RAISE EXCEPTION 'Request is not in a valid state for activation';
  END IF;

  -- Verify PIN using crypt (assuming PIN is hashed with crypt)
  IF v_request.pin_hash != crypt(p_pin, v_request.pin_hash) THEN
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  -- Activate service
  UPDATE service_requests
  SET
    status = 'active',
    activated_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to complete service
CREATE OR REPLACE FUNCTION complete_service_request(
  p_request_id UUID,
  p_distance_pickup_to_dropoff NUMERIC
)
RETURNS service_requests AS $$
DECLARE
  v_request service_requests;
  v_price_breakdown JSONB;
  v_total_distance NUMERIC;
BEGIN
  -- Get request and verify operator
  SELECT * INTO v_request FROM service_requests
  WHERE id = p_request_id AND operator_id = auth.uid();

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found or not assigned to you';
  END IF;

  IF v_request.status != 'active' THEN
    RAISE EXCEPTION 'Request is not in active state';
  END IF;

  -- Calculate total distance (operator to pickup + pickup to dropoff)
  v_total_distance := COALESCE(v_request.distance_operator_to_pickup_km, 0) + p_distance_pickup_to_dropoff;

  -- Calculate price
  v_price_breakdown := calculate_price(v_total_distance, v_request.tow_type);

  -- Complete service
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

-- Function to cancel request (operator)
CREATE OR REPLACE FUNCTION operator_cancel_request(p_request_id UUID)
RETURNS service_requests AS $$
DECLARE
  v_request service_requests;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cancel request (admin)
CREATE OR REPLACE FUNCTION admin_cancel_request(p_request_id UUID)
RETURNS service_requests AS $$
DECLARE
  v_request service_requests;
  v_admin_role user_role;
BEGIN
  -- Verify admin role
  SELECT role INTO v_admin_role FROM profiles WHERE id = auth.uid();
  IF v_admin_role != 'ADMIN' THEN
    RAISE EXCEPTION 'Only admins can force cancel requests';
  END IF;

  -- Cancel request
  UPDATE service_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  RETURN v_request;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for updated_at
CREATE TRIGGER update_service_requests_updated_at
  BEFORE UPDATE ON service_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
