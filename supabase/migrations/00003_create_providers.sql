-- Create providers table (tow truck companies)

CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  tow_type_supported TEXT NOT NULL CHECK (tow_type_supported IN ('light', 'heavy', 'both')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  contact_phone TEXT,
  contact_email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index
CREATE INDEX idx_providers_active ON providers(is_active);

-- Enable Row Level Security
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Admins can do everything
CREATE POLICY "Admins can manage providers"
  ON providers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- Operators can view active providers
CREATE POLICY "Operators can view active providers"
  ON providers FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'OPERATOR'
    )
  );

-- MOP can view all providers
CREATE POLICY "MOP can view providers"
  ON providers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'MOP'
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_providers_updated_at
  BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
