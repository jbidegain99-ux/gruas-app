-- Create pricing_rules table for dynamic pricing

CREATE TABLE pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Default',
  base_exit_fee NUMERIC(10, 2) NOT NULL DEFAULT 60.00,
  included_km NUMERIC(10, 2) NOT NULL DEFAULT 25.00,
  price_per_km_light NUMERIC(10, 2) NOT NULL DEFAULT 2.50,
  price_per_km_heavy NUMERIC(10, 2) NOT NULL DEFAULT 4.00,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure only one active pricing rule at a time
CREATE UNIQUE INDEX idx_pricing_rules_active ON pricing_rules(is_active) WHERE is_active = true;

-- Enable Row Level Security
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Admins can manage pricing rules
CREATE POLICY "Admins can manage pricing rules"
  ON pricing_rules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- Everyone can view active pricing rules
CREATE POLICY "Everyone can view active pricing rules"
  ON pricing_rules FOR SELECT
  USING (is_active = true);

-- MOP can view all pricing rules
CREATE POLICY "MOP can view all pricing rules"
  ON pricing_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'MOP'
    )
  );

-- Function to get active pricing rule
CREATE OR REPLACE FUNCTION get_active_pricing_rule()
RETURNS pricing_rules AS $$
DECLARE
  result pricing_rules;
BEGIN
  SELECT * INTO result FROM pricing_rules WHERE is_active = true LIMIT 1;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate price
CREATE OR REPLACE FUNCTION calculate_price(
  p_distance_km NUMERIC,
  p_tow_type tow_type
)
RETURNS JSONB AS $$
DECLARE
  v_rule pricing_rules;
  v_extra_km NUMERIC;
  v_price_per_km NUMERIC;
  v_extra_km_charge NUMERIC;
  v_total NUMERIC;
BEGIN
  -- Get active pricing rule
  SELECT * INTO v_rule FROM pricing_rules WHERE is_active = true LIMIT 1;

  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'No active pricing rule found';
  END IF;

  -- Calculate extra km beyond included
  v_extra_km := GREATEST(0, p_distance_km - v_rule.included_km);

  -- Get price per km based on tow type
  v_price_per_km := CASE
    WHEN p_tow_type = 'light' THEN v_rule.price_per_km_light
    ELSE v_rule.price_per_km_heavy
  END;

  -- Calculate extra km charge
  v_extra_km_charge := v_extra_km * v_price_per_km;

  -- Calculate total
  v_total := v_rule.base_exit_fee + v_extra_km_charge;

  RETURN jsonb_build_object(
    'base_exit_fee', v_rule.base_exit_fee,
    'included_km', v_rule.included_km,
    'extra_km', v_extra_km,
    'price_per_km', v_price_per_km,
    'extra_km_charge', v_extra_km_charge,
    'total', v_total,
    'currency', v_rule.currency,
    'tow_type', p_tow_type,
    'total_distance_km', p_distance_km
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for updated_at
CREATE TRIGGER update_pricing_rules_updated_at
  BEFORE UPDATE ON pricing_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default pricing rule
INSERT INTO pricing_rules (
  name,
  base_exit_fee,
  included_km,
  price_per_km_light,
  price_per_km_heavy,
  currency,
  is_active,
  description
) VALUES (
  'Tarifa Estándar El Salvador',
  60.00,
  25.00,
  2.50,
  4.00,
  'USD',
  true,
  'Tarifa base: $60 incluye primeros 25km. Grúa liviana: $2.50/km adicional. Grúa pesada: $4.00/km adicional.'
);
