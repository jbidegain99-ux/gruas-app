-- Create ratings table

CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  rater_user_id UUID NOT NULL REFERENCES profiles(id),
  rated_operator_id UUID NOT NULL REFERENCES profiles(id),
  stars INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One rating per request
  CONSTRAINT unique_rating_per_request UNIQUE (request_id)
);

-- Indexes
CREATE INDEX idx_ratings_operator ON ratings(rated_operator_id);
CREATE INDEX idx_ratings_user ON ratings(rater_user_id);
CREATE INDEX idx_ratings_stars ON ratings(stars);

-- Enable Row Level Security
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can create ratings for their completed requests
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

-- Users can view their own ratings
CREATE POLICY "Users can view own ratings"
  ON ratings FOR SELECT
  USING (rater_user_id = auth.uid());

-- Operators can view their ratings
CREATE POLICY "Operators can view their ratings"
  ON ratings FOR SELECT
  USING (rated_operator_id = auth.uid());

-- Admins can view all ratings
CREATE POLICY "Admins can view all ratings"
  ON ratings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- MOP can view all ratings
CREATE POLICY "MOP can view all ratings"
  ON ratings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'MOP'
    )
  );

-- Function to rate a service
CREATE OR REPLACE FUNCTION rate_service(
  p_request_id UUID,
  p_stars INTEGER,
  p_comment TEXT DEFAULT NULL
)
RETURNS ratings AS $$
DECLARE
  v_rating ratings;
  v_request service_requests;
BEGIN
  -- Get request
  SELECT * INTO v_request FROM service_requests
  WHERE id = p_request_id AND user_id = auth.uid() AND status = 'completed';

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found or not eligible for rating';
  END IF;

  IF v_request.operator_id IS NULL THEN
    RAISE EXCEPTION 'No operator assigned to this request';
  END IF;

  -- Create rating
  INSERT INTO ratings (request_id, rater_user_id, rated_operator_id, stars, comment)
  VALUES (p_request_id, auth.uid(), v_request.operator_id, p_stars, p_comment)
  ON CONFLICT (request_id)
  DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment
  RETURNING * INTO v_rating;

  -- Create audit event
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    p_request_id,
    auth.uid(),
    'USER',
    'RATING_SUBMITTED',
    jsonb_build_object('stars', p_stars, 'comment', p_comment)
  );

  RETURN v_rating;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View for operator statistics
CREATE OR REPLACE VIEW operator_stats AS
SELECT
  p.id AS operator_id,
  p.full_name,
  COUNT(DISTINCT sr.id) AS total_services,
  COUNT(DISTINCT sr.id) FILTER (WHERE sr.status = 'completed') AS completed_services,
  COUNT(DISTINCT sr.id) FILTER (WHERE sr.status = 'cancelled') AS cancelled_services,
  COALESCE(AVG(r.stars), 0)::NUMERIC(3, 2) AS average_rating,
  COUNT(r.id) AS total_ratings
FROM profiles p
LEFT JOIN service_requests sr ON sr.operator_id = p.id
LEFT JOIN ratings r ON r.rated_operator_id = p.id
WHERE p.role = 'OPERATOR'
GROUP BY p.id, p.full_name;
