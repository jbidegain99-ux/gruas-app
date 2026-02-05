-- Migration: Add vehicle photo support
-- 1. Add column to service_requests
-- 2. Create storage bucket for service photos
-- 3. Update create_service_request RPC to accept photo URL

-- Add vehicle_photo_url column
ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS vehicle_photo_url TEXT DEFAULT NULL;

-- Create storage bucket for service photos (public for easy access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('service-photos', 'service-photos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for service-photos bucket
-- Allow authenticated users to upload their own photos
CREATE POLICY "Users can upload service photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'service-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow anyone to read service photos (bucket is public)
CREATE POLICY "Anyone can view service photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'service-photos');

-- Allow users to delete their own photos
CREATE POLICY "Users can delete their service photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'service-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Drop old function signature and recreate with new parameter
DROP FUNCTION IF EXISTS create_service_request(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, tow_type, TEXT, TEXT);

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
    vehicle_photo_url,
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
    p_vehicle_photo_url,
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
      'incident_type', p_incident_type,
      'has_photo', p_vehicle_photo_url IS NOT NULL
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
GRANT EXECUTE ON FUNCTION create_service_request(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, tow_type, TEXT, TEXT, TEXT) TO authenticated;

-- Update get_available_requests_for_operator to include vehicle_photo_url
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
      'user_phone', p.phone,
      'vehicle_photo_url', sr.vehicle_photo_url,
      'notes', sr.notes
    ) ORDER BY sr.created_at ASC
  ) INTO v_requests
  FROM service_requests sr
  JOIN profiles p ON p.id = sr.user_id
  WHERE sr.status = 'initiated';

  RETURN COALESCE(v_requests, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_available_requests_for_operator() TO authenticated;
