-- Enable required extensions

-- Enable pgcrypto for PIN hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enable PostGIS for spatial queries (optional, for advanced location features)
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- Function to hash PIN
CREATE OR REPLACE FUNCTION hash_pin(p_pin TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN crypt(p_pin, gen_salt('bf', 10));
END;
$$ LANGUAGE plpgsql;

-- Function to verify PIN
CREATE OR REPLACE FUNCTION verify_pin(p_pin TEXT, p_hash TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN p_hash = crypt(p_pin, p_hash);
END;
$$ LANGUAGE plpgsql;
