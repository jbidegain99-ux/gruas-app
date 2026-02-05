-- Migration: Fix Missing RPCs for Phase 2 Features
-- This migration creates/recreates the RPCs that the frontend expects
-- Run this in Supabase SQL Editor if the RPCs are missing

-- ============================================
-- TASK 1: rate_service RPC
-- ============================================

-- Ensure ratings table exists
CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  rater_user_id UUID NOT NULL REFERENCES profiles(id),
  rated_operator_id UUID NOT NULL REFERENCES profiles(id),
  stars INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_rating_per_request UNIQUE (request_id)
);

-- Enable RLS on ratings if not already enabled
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can rate completed requests" ON ratings;
DROP POLICY IF EXISTS "Users can view own ratings" ON ratings;
DROP POLICY IF EXISTS "Operators can view their ratings" ON ratings;
DROP POLICY IF EXISTS "Admins can view all ratings" ON ratings;

-- Create RLS policies for ratings
CREATE POLICY "Users can rate completed requests"
  ON ratings FOR INSERT
  WITH CHECK (
    rater_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = ratings.request_id
        AND sr.user_id = auth.uid()
        AND sr.status = 'completed'
    )
  );

CREATE POLICY "Users can view own ratings"
  ON ratings FOR SELECT
  USING (rater_user_id = auth.uid());

CREATE POLICY "Operators can view their ratings"
  ON ratings FOR SELECT
  USING (rated_operator_id = auth.uid());

CREATE POLICY "Admins can view all ratings"
  ON ratings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- Create/Replace rate_service function
-- Parameters expected by frontend: p_request_id, p_stars, p_comment
CREATE OR REPLACE FUNCTION rate_service(
  p_request_id UUID,
  p_stars INTEGER,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_rating ratings;
  v_request service_requests;
BEGIN
  -- Get request and verify ownership
  SELECT * INTO v_request FROM service_requests
  WHERE id = p_request_id AND user_id = auth.uid() AND status = 'completed';

  IF v_request IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Request not found or not eligible for rating');
  END IF;

  IF v_request.operator_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No operator assigned to this request');
  END IF;

  -- Create or update rating
  INSERT INTO ratings (request_id, rater_user_id, rated_operator_id, stars, comment)
  VALUES (p_request_id, auth.uid(), v_request.operator_id, p_stars, p_comment)
  ON CONFLICT (request_id)
  DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment
  RETURNING * INTO v_rating;

  RETURN json_build_object('success', true, 'rating_id', v_rating.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- TASK 2: send_message RPC
-- ============================================

-- Ensure request_messages table exists
CREATE TABLE IF NOT EXISTS request_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id),
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes if not exist
CREATE INDEX IF NOT EXISTS idx_request_messages_request ON request_messages(request_id);
CREATE INDEX IF NOT EXISTS idx_request_messages_created ON request_messages(created_at DESC);

-- Enable RLS
ALTER TABLE request_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view own request messages" ON request_messages;
DROP POLICY IF EXISTS "Users can send messages to own requests" ON request_messages;
DROP POLICY IF EXISTS "Operators can view assigned request messages" ON request_messages;
DROP POLICY IF EXISTS "Operators can send messages to assigned requests" ON request_messages;

-- Create RLS policies for request_messages
CREATE POLICY "Users can view own request messages"
  ON request_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_messages.request_id
        AND sr.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can send messages to own requests"
  ON request_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_messages.request_id
        AND sr.user_id = auth.uid()
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  );

CREATE POLICY "Operators can view assigned request messages"
  ON request_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_messages.request_id
        AND sr.operator_id = auth.uid()
    )
  );

CREATE POLICY "Operators can send messages to assigned requests"
  ON request_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_messages.request_id
        AND sr.operator_id = auth.uid()
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  );

-- Create/Replace send_message function
-- Parameters expected by frontend: p_request_id, p_message
CREATE OR REPLACE FUNCTION send_message(
  p_request_id UUID,
  p_message TEXT
)
RETURNS JSON AS $$
DECLARE
  v_message request_messages;
  v_request service_requests;
BEGIN
  -- Verify user is participant
  SELECT * INTO v_request FROM service_requests
  WHERE id = p_request_id
    AND (user_id = auth.uid() OR operator_id = auth.uid())
    AND status IN ('assigned', 'en_route', 'active');

  IF v_request IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Request not found or not active');
  END IF;

  -- Insert message
  INSERT INTO request_messages (request_id, sender_id, message)
  VALUES (p_request_id, auth.uid(), p_message)
  RETURNING * INTO v_message;

  RETURN json_build_object('success', true, 'message_id', v_message.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable realtime for messages (safe to run multiple times)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE request_messages;
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- Table already in publication
END $$;

-- ============================================
-- TASK 3: upsert_operator_location RPC
-- ============================================

-- Ensure operator_locations table exists
CREATE TABLE IF NOT EXISTS operator_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  is_online BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_operator_location UNIQUE (operator_id)
);

-- Create indexes if not exist
CREATE INDEX IF NOT EXISTS idx_operator_locations_lat_lng ON operator_locations(lat, lng);
CREATE INDEX IF NOT EXISTS idx_operator_locations_online ON operator_locations(is_online);

-- Enable RLS
ALTER TABLE operator_locations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Operators can update own location" ON operator_locations;
DROP POLICY IF EXISTS "Users can view operator locations" ON operator_locations;

-- Create RLS policies for operator_locations
CREATE POLICY "Operators can update own location"
  ON operator_locations FOR ALL
  USING (operator_id = auth.uid())
  WITH CHECK (operator_id = auth.uid());

CREATE POLICY "Users can view operator locations"
  ON operator_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.operator_id = operator_locations.operator_id
        AND sr.user_id = auth.uid()
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  );

-- Create/Replace upsert_operator_location function
-- Parameters expected by frontend: p_lat, p_lng, p_is_online
CREATE OR REPLACE FUNCTION upsert_operator_location(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_is_online BOOLEAN DEFAULT TRUE
)
RETURNS JSON AS $$
DECLARE
  v_location operator_locations;
BEGIN
  INSERT INTO operator_locations (operator_id, lat, lng, is_online, updated_at)
  VALUES (auth.uid(), p_lat, p_lng, p_is_online, NOW())
  ON CONFLICT (operator_id)
  DO UPDATE SET
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    is_online = EXCLUDED.is_online,
    updated_at = NOW()
  RETURNING * INTO v_location;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable realtime for operator_locations
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE operator_locations;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- ============================================
-- VERIFICATION: Check all functions exist
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'Migration completed. Verifying functions...';

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rate_service') THEN
    RAISE NOTICE '✓ rate_service exists';
  ELSE
    RAISE EXCEPTION '✗ rate_service NOT created';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'send_message') THEN
    RAISE NOTICE '✓ send_message exists';
  ELSE
    RAISE EXCEPTION '✗ send_message NOT created';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'upsert_operator_location') THEN
    RAISE NOTICE '✓ upsert_operator_location exists';
  ELSE
    RAISE EXCEPTION '✗ upsert_operator_location NOT created';
  END IF;

  RAISE NOTICE 'All RPCs created successfully!';
END $$;
