-- Add route_polyline column to service_requests
-- Stores the Google Maps encoded polyline from operator to user pickup location.
-- Used for demo mode GPS simulation and historical route display.

ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS route_polyline TEXT;

COMMENT ON COLUMN service_requests.route_polyline IS
  'Encoded Google Maps polyline from operator to user pickup location. Saved on request acceptance.';
