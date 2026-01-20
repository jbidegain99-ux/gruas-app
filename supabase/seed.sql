-- Seed data for Gruas App

-- Note: The default pricing rule is already created in migration 00005

-- Create some sample providers
INSERT INTO providers (name, tow_type_supported, is_active, contact_phone, contact_email, address) VALUES
  ('Grúas El Salvador S.A. de C.V.', 'both', true, '+503 2222-3333', 'contacto@gruaselsal.com', 'San Salvador, El Salvador'),
  ('Servicios de Grúas Rápidas', 'light', true, '+503 2444-5555', 'info@gruasrapidas.sv', 'Santa Tecla, El Salvador'),
  ('Grúas Pesadas del Pacífico', 'heavy', true, '+503 2666-7777', 'ventas@gruaspesadas.sv', 'San Miguel, El Salvador');

-- Note: Sample users must be created through Supabase Auth
-- After creating users through auth, you can insert test profiles like:

/*
-- Example: Create test admin user (must be done after auth signup)
UPDATE profiles
SET role = 'ADMIN'
WHERE id = 'admin-user-uuid-here';

-- Example: Create test MOP user
UPDATE profiles
SET role = 'MOP'
WHERE id = 'mop-user-uuid-here';

-- Example: Create test operator user
UPDATE profiles
SET role = 'OPERATOR'
WHERE id = 'operator-user-uuid-here';
*/

-- Create some incident type examples (for reference)
COMMENT ON COLUMN service_requests.incident_type IS 'Examples: Avería mecánica, Accidente de tránsito, Vehículo varado, Llantas ponchadas, Sin combustible, Batería descargada';
