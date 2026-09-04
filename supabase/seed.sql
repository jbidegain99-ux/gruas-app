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
-- =====================================================
-- ASEGURADORAS, PLANES Y COBERTURA  (B-08, Fase 1)
-- =====================================================
-- Padron de demostracion para desarrollo. Las reglas van como FILAS en
-- coverage_rules, no como columnas: ver el encabezado de la migracion 00044.
-- `members.profile_id` se resuelve por email para que el afiliado quede
-- vinculado a la cuenta de prueba usuario1@gruas.sv si existe.

INSERT INTO insurers (id, name, tax_id, contact_name, contact_email, contact_phone) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Seguros Demo, S.A. de C.V.', '0614-010101-001-1', 'Contacto Demo', 'contacto@segurosdemo.sv', '+503 2200-1000')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tax_id = EXCLUDED.tax_id;

INSERT INTO coverage_plans (id, insurer_id, code, name, description) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ORO',    'Plan Oro',    'Cobertura amplia: grua con 25 km incluidos y 4 eventos al anio.'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'BASICO', 'Plan Basico', 'Cobertura minima: 2 eventos al anio y 10 km de arrastre.')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- Plan Oro: todo cubierto salvo cerrajeria; grua 4/anio con 61 km.
--
-- Los 61 km no son un numero redondo por casualidad. Lo que asume la aseguradora
-- sale de `base + (km_del_plan - km_de_la_tarifa) * precio_por_km`, y por lo
-- tanto NO depende de la distancia del servicio: con la tarifa vigente (base
-- $60, 25 km incluidos, $2.50/km liviana) son 60 + 36*2.50 = $150 exactos, que
-- es el `max_covered_amount`. Con los 25 km que habia antes daba $60 y el tope
-- no llegaba a aplicarse nunca: era configuracion muerta.
INSERT INTO coverage_rules (plan_id, service_type, rule_key, rule_value) VALUES
  ('b0000000-0000-0000-0000-000000000001', NULL,        'covered',            1),
  ('b0000000-0000-0000-0000-000000000001', 'tow',       'services_per_year',  4),
  ('b0000000-0000-0000-0000-000000000001', 'tow',       'included_km',       61),
  ('b0000000-0000-0000-0000-000000000001', 'tow',       'max_covered_amount', 150),
  ('b0000000-0000-0000-0000-000000000001', 'locksmith', 'covered',            0)
ON CONFLICT (plan_id, COALESCE(service_type, '*'), rule_key) DO UPDATE SET rule_value = EXCLUDED.rule_value;

-- Plan Basico: solo grua y bateria, con topes mas bajos.
INSERT INTO coverage_rules (plan_id, service_type, rule_key, rule_value) VALUES
  ('b0000000-0000-0000-0000-000000000002', NULL,      'covered',            0),
  ('b0000000-0000-0000-0000-000000000002', 'tow',     'covered',            1),
  ('b0000000-0000-0000-0000-000000000002', 'tow',     'services_per_year',  2),
  ('b0000000-0000-0000-0000-000000000002', 'tow',     'included_km',       10),
  ('b0000000-0000-0000-0000-000000000002', 'battery', 'covered',            1)
ON CONFLICT (plan_id, COALESCE(service_type, '*'), rule_key) DO UPDATE SET rule_value = EXCLUDED.rule_value;

INSERT INTO policies (id, insurer_id, plan_id, policy_number, holder_name, starts_on, ends_on) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'POL-2026-0001', 'Usuario Uno',  '2026-01-01', '2026-12-31'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'POL-2026-0002', 'Maria Ramirez', '2026-03-01', '2027-02-28')
ON CONFLICT (id) DO UPDATE SET holder_name = EXCLUDED.holder_name;

-- Titular vinculado a la cuenta de prueba (si existe) + un beneficiario sin cuenta.
INSERT INTO members (id, policy_id, profile_id, document_number, full_name, phone, relationship)
SELECT 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
       (SELECT id FROM profiles WHERE email = 'usuario1@gruas.sv'),
       '01234567-8', 'Usuario Uno', '+503 7000-0001', 'holder'
ON CONFLICT (id) DO UPDATE SET profile_id = EXCLUDED.profile_id;

INSERT INTO members (id, policy_id, profile_id, document_number, full_name, phone, relationship) VALUES
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', NULL, '02345678-9', 'Ana Uno',       '+503 7000-0002', 'beneficiary'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', NULL, '03456789-0', 'Maria Ramirez', '+503 7000-0003', 'holder')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;

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
  RAISE NOTICE 'Insurers: %  Plans: %  Rules: %  Policies: %  Members: %',
    (SELECT COUNT(*) FROM insurers), (SELECT COUNT(*) FROM coverage_plans),
    (SELECT COUNT(*) FROM coverage_rules), (SELECT COUNT(*) FROM policies),
    (SELECT COUNT(*) FROM members);
  RAISE NOTICE '==========================================';
END $$;
