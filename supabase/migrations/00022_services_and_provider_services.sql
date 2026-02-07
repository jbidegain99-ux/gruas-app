-- Migration 00022: services catalog + provider_services junction table
-- Adds dynamic service catalog and provider-service assignment

-- ============================================================
-- 1. services table (dynamic catalog)
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name_es         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  description_es  TEXT DEFAULT '',
  description_en  TEXT DEFAULT '',
  icon            TEXT DEFAULT 'wrench',
  base_price      NUMERIC(10,2) DEFAULT 0,
  extra_fee       NUMERIC(10,2) DEFAULT 0,
  extra_fee_label TEXT DEFAULT NULL,
  requires_destination BOOLEAN DEFAULT false,
  sort_order      INT DEFAULT 0,
  is_active       BOOLEAN DEFAULT true,
  currency        TEXT DEFAULT 'USD',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for services
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read active services
CREATE POLICY "Authenticated users read active services"
  ON services FOR SELECT
  TO authenticated
  USING (is_active = true);

-- ADMIN full CRUD
CREATE POLICY "Admin full access to services"
  ON services FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN')
  );

-- MOP can read all (including inactive)
CREATE POLICY "MOP read all services"
  ON services FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'MOP')
  );

-- ============================================================
-- 2. Seed 7 services
-- ============================================================
INSERT INTO services (slug, name_es, name_en, icon, base_price, extra_fee, extra_fee_label, requires_destination, sort_order) VALUES
  ('tow',       'Grua',        'Tow Truck',  'truck',      60.00, 0,    NULL,            true,  1),
  ('battery',   'Bateria',     'Battery',     'battery',    25.00, 0,    NULL,            false, 2),
  ('tire',      'Llanta',      'Tire',        'circle-dot', 30.00, 0,    NULL,            false, 3),
  ('fuel',      'Combustible', 'Fuel',        'fuel',       20.00, 0,    NULL,            false, 4),
  ('locksmith', 'Cerrajeria',  'Locksmith',   'key-round',  35.00, 0,    NULL,            false, 5),
  ('mechanic',  'Mecanico',    'Mechanic',    'wrench',     40.00, 0,    NULL,            false, 6),
  ('winch',     'Winche',      'Winch',       'cable-car',  50.00, 0,    NULL,            true,  7)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 3. Expand CHECK constraints for service_requests and service_type_pricing
-- ============================================================

-- Drop and recreate the CHECK constraint on service_requests
ALTER TABLE service_requests DROP CONSTRAINT IF EXISTS chk_service_type;
ALTER TABLE service_requests ADD CONSTRAINT chk_service_type
  CHECK (service_type IN ('tow', 'battery', 'tire', 'fuel', 'locksmith', 'mechanic', 'winch'));

-- Drop and recreate the CHECK constraint on service_type_pricing
ALTER TABLE service_type_pricing DROP CONSTRAINT IF EXISTS service_type_pricing_service_type_check;
ALTER TABLE service_type_pricing ADD CONSTRAINT service_type_pricing_service_type_check
  CHECK (service_type IN ('tow', 'battery', 'tire', 'fuel', 'locksmith', 'mechanic', 'winch'));

-- Insert pricing rows for new service types
INSERT INTO service_type_pricing (service_type, display_name, description, icon, base_price, extra_fee, extra_fee_label, requires_destination, sort_order) VALUES
  ('mechanic',  'Mecanico',  'Servicio de mecanica en sitio',  'wrench',    40.00, 0, NULL, false, 6),
  ('winch',     'Winche',    'Servicio de winche',             'cable-car', 50.00, 0, NULL, true,  7)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. provider_services junction table
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_services (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  is_available BOOLEAN DEFAULT true,
  custom_price NUMERIC(10,2) DEFAULT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_id, service_id)
);

-- RLS for provider_services
ALTER TABLE provider_services ENABLE ROW LEVEL SECURITY;

-- ADMIN full CRUD
CREATE POLICY "Admin full access to provider_services"
  ON provider_services FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ADMIN')
  );

-- OPERATOR can read own provider's services
CREATE POLICY "Operator read own provider services"
  ON provider_services FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'OPERATOR'
        AND provider_id = provider_services.provider_id
    )
  );

-- MOP can read all
CREATE POLICY "MOP read all provider_services"
  ON provider_services FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'MOP')
  );

-- ============================================================
-- 5. Seed: assign original 5 services to all existing providers
-- ============================================================
INSERT INTO provider_services (provider_id, service_id)
SELECT p.id, s.id
FROM providers p
CROSS JOIN services s
WHERE s.slug IN ('tow', 'battery', 'tire', 'fuel', 'locksmith')
ON CONFLICT (provider_id, service_id) DO NOTHING;
