-- Create device_tokens table for push notifications

CREATE TABLE device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('ios', 'android')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each device token should be unique per user
  CONSTRAINT unique_user_token UNIQUE (user_id, expo_push_token)
);

-- Index for efficient lookups
CREATE INDEX idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX idx_device_tokens_active ON device_tokens(is_active) WHERE is_active = true;

-- Enable Row Level Security
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can manage their own device tokens
CREATE POLICY "Users can manage own device tokens"
  ON device_tokens FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admins can view all device tokens (for debugging)
CREATE POLICY "Admins can view all device tokens"
  ON device_tokens FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- Function to register/update device token
CREATE OR REPLACE FUNCTION register_device_token(
  p_expo_push_token TEXT,
  p_device_type TEXT
)
RETURNS device_tokens AS $$
DECLARE
  result device_tokens;
BEGIN
  -- Validate device type
  IF p_device_type NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Invalid device type. Must be ios or android';
  END IF;

  -- Upsert the token
  INSERT INTO device_tokens (user_id, expo_push_token, device_type, is_active, updated_at)
  VALUES (auth.uid(), p_expo_push_token, p_device_type, true, NOW())
  ON CONFLICT (user_id, expo_push_token)
  DO UPDATE SET
    is_active = true,
    device_type = EXCLUDED.device_type,
    updated_at = NOW()
  RETURNING * INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to unregister device token
CREATE OR REPLACE FUNCTION unregister_device_token(
  p_expo_push_token TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE device_tokens
  SET is_active = false, updated_at = NOW()
  WHERE user_id = auth.uid() AND expo_push_token = p_expo_push_token;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active device tokens for a user (used by Edge Functions)
CREATE OR REPLACE FUNCTION get_user_device_tokens(
  p_user_id UUID
)
RETURNS TABLE (expo_push_token TEXT, device_type TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT dt.expo_push_token, dt.device_type
  FROM device_tokens dt
  WHERE dt.user_id = p_user_id AND dt.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for updated_at
CREATE TRIGGER update_device_tokens_updated_at
  BEFORE UPDATE ON device_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
