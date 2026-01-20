-- Create operator_locations table for real-time tracking

CREATE TABLE operator_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION, -- Direction in degrees
  speed DOUBLE PRECISION, -- Speed in km/h
  accuracy DOUBLE PRECISION, -- GPS accuracy in meters
  is_online BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each operator has only one location record
  CONSTRAINT unique_operator_location UNIQUE (operator_id)
);

-- Create indexes for spatial queries
CREATE INDEX idx_operator_locations_lat_lng ON operator_locations(lat, lng);
CREATE INDEX idx_operator_locations_online ON operator_locations(is_online);

-- Enable Row Level Security
ALTER TABLE operator_locations ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Operators can update their own location
CREATE POLICY "Operators can update own location"
  ON operator_locations FOR ALL
  USING (operator_id = auth.uid())
  WITH CHECK (operator_id = auth.uid());

-- Users can view online operator locations (for tracking assigned operator)
CREATE POLICY "Users can view operator locations"
  ON operator_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('USER', 'ADMIN', 'MOP')
    )
    OR
    -- Or if user has an active request with this operator
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.operator_id = operator_locations.operator_id
        AND sr.user_id = auth.uid()
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  );

-- Admins can view all locations
CREATE POLICY "Admins can view all locations"
  ON operator_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- Function to upsert operator location
CREATE OR REPLACE FUNCTION upsert_operator_location(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_heading DOUBLE PRECISION DEFAULT NULL,
  p_speed DOUBLE PRECISION DEFAULT NULL,
  p_accuracy DOUBLE PRECISION DEFAULT NULL
)
RETURNS operator_locations AS $$
DECLARE
  result operator_locations;
BEGIN
  INSERT INTO operator_locations (operator_id, lat, lng, heading, speed, accuracy, is_online, updated_at)
  VALUES (auth.uid(), p_lat, p_lng, p_heading, p_speed, p_accuracy, true, NOW())
  ON CONFLICT (operator_id)
  DO UPDATE SET
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    heading = EXCLUDED.heading,
    speed = EXCLUDED.speed,
    accuracy = EXCLUDED.accuracy,
    is_online = true,
    updated_at = NOW()
  RETURNING * INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for updated_at
CREATE TRIGGER update_operator_locations_updated_at
  BEFORE UPDATE ON operator_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
