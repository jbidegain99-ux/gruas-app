-- =====================================================
-- GRUAS APP - Seed Data for Testing
-- Run this after migrations to populate test data
-- =====================================================

-- =====================================================
-- PROVIDERS (3 test providers)
-- =====================================================
INSERT INTO providers (id, name, tow_type_supported, is_active, contact_phone, contact_email, address) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Grúas El Salvador S.A. de C.V.', 'both', true, '+503 2222-3333', 'contacto@gruaselsal.com', 'San Salvador, El Salvador'),
  ('22222222-2222-2222-2222-222222222222', 'Servicios de Grúas Rápidas', 'light', true, '+503 2444-5555', 'info@gruasrapidas.sv', 'Santa Tecla, El Salvador'),
  ('33333333-3333-3333-3333-333333333333', 'Grúas Pesadas del Pacífico', 'heavy', true, '+503 2666-7777', 'ventas@gruaspesadas.sv', 'San Miguel, El Salvador')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  tow_type_supported = EXCLUDED.tow_type_supported,
  is_active = EXCLUDED.is_active,
  contact_phone = EXCLUDED.contact_phone,
  contact_email = EXCLUDED.contact_email,
  address = EXCLUDED.address;

-- =====================================================
-- PRICING RULES (2 rules for testing activation)
-- =====================================================
-- Deactivate any existing active rules first
UPDATE pricing_rules SET is_active = false WHERE is_active = true;

-- Insert/update pricing rules
INSERT INTO pricing_rules (id, name, base_exit_fee, included_km, price_per_km_light, price_per_km_heavy, currency, is_active, description) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tarifa Estándar El Salvador', 60.00, 25.00, 2.50, 4.00, 'USD', true, 'Tarifa base: $60 incluye primeros 25km. Grúa liviana: $2.50/km adicional. Grúa pesada: $4.00/km adicional.'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tarifa Nocturna (22:00-06:00)', 75.00, 20.00, 3.00, 5.00, 'USD', false, 'Tarifa nocturna con recargo. Base: $75, incluye 20km. Aplica de 10pm a 6am.')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  base_exit_fee = EXCLUDED.base_exit_fee,
  included_km = EXCLUDED.included_km,
  price_per_km_light = EXCLUDED.price_per_km_light,
  price_per_km_heavy = EXCLUDED.price_per_km_heavy,
  is_active = EXCLUDED.is_active,
  description = EXCLUDED.description;

-- =====================================================
-- INCIDENT TYPES REFERENCE
-- =====================================================
COMMENT ON COLUMN service_requests.incident_type IS 'Examples: Avería mecánica, Accidente de tránsito, Vehículo varado, Llantas ponchadas, Sin combustible, Batería descargada, Llaves dentro del vehículo';

-- =====================================================
-- TEST USERS SETUP INSTRUCTIONS
-- =====================================================
-- Users must be created through Supabase Auth (Dashboard or API)
--
-- STEP 1: Create users in Supabase Dashboard > Authentication > Users
-- Email: admin@gruas.sv / Password: Admin123!
-- Email: mop@gruas.sv / Password: Mop123!
-- Email: operador1@gruas.sv / Password: Op123!
-- Email: operador2@gruas.sv / Password: Op123!
-- Email: usuario1@gruas.sv / Password: User123!
-- Email: usuario2@gruas.sv / Password: User123!
--
-- STEP 2: After users are created, run these commands to set roles:
-- (Replace UUIDs with actual user IDs from auth.users)
/*
-- Get user IDs
SELECT id, email FROM auth.users;

-- Set admin role
UPDATE profiles SET role = 'ADMIN', full_name = 'Administrador Sistema'
WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@gruas.sv');

-- Set MOP role
UPDATE profiles SET role = 'MOP', full_name = 'Supervisor MOP'
WHERE id = (SELECT id FROM auth.users WHERE email = 'mop@gruas.sv');

-- Set operator roles with provider assignment
UPDATE profiles SET role = 'OPERATOR', full_name = 'Juan Operador', provider_id = '11111111-1111-1111-1111-111111111111'
WHERE id = (SELECT id FROM auth.users WHERE email = 'operador1@gruas.sv');

UPDATE profiles SET role = 'OPERATOR', full_name = 'María Operadora', provider_id = '22222222-2222-2222-2222-222222222222'
WHERE id = (SELECT id FROM auth.users WHERE email = 'operador2@gruas.sv');

-- Users keep default role, just update names
UPDATE profiles SET full_name = 'Carlos Usuario', phone = '+503 7777-1111'
WHERE id = (SELECT id FROM auth.users WHERE email = 'usuario1@gruas.sv');

UPDATE profiles SET full_name = 'Ana Usuaria', phone = '+503 7777-2222'
WHERE id = (SELECT id FROM auth.users WHERE email = 'usuario2@gruas.sv');
*/

-- =====================================================
-- QUICK SETUP FOR EXISTING USER
-- If you already have a user (like jbidegain@republicode.com)
-- =====================================================
/*
-- Make existing user an admin
UPDATE profiles SET role = 'ADMIN', full_name = 'Jose Bidegain'
WHERE id = (SELECT id FROM auth.users WHERE email = 'jbidegain@republicode.com');
*/

-- =====================================================
-- Verify seed data
-- =====================================================
DO $$
DECLARE
  v_providers INTEGER;
  v_pricing INTEGER;
  v_active_pricing TEXT;
BEGIN
  SELECT COUNT(*) INTO v_providers FROM providers WHERE is_active = true;
  SELECT COUNT(*) INTO v_pricing FROM pricing_rules;
  SELECT name INTO v_active_pricing FROM pricing_rules WHERE is_active = true LIMIT 1;

  RAISE NOTICE '==========================================';
  RAISE NOTICE 'SEED DATA VERIFICATION';
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'Active Providers: %', v_providers;
  RAISE NOTICE 'Total Pricing Rules: %', v_pricing;
  RAISE NOTICE 'Active Pricing Rule: %', COALESCE(v_active_pricing, 'NONE');
  RAISE NOTICE '==========================================';
END $$;
