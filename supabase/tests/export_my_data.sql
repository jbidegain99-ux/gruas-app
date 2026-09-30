-- =====================================================
-- Exportar mis datos (migr. 00139, backlog LAN-01 / Decreto 144)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. El Usuario recibe sus datos: perfil, DUI, vehículos, servicios con su
--      pago, mensajes y calificaciones que dio.
--   B. Nada de otras personas: del socio solo el nombre (sin teléfono ni
--      correo); de quien calificó al socio, nada.
--   C. El socio recibe además su registro, unidades, documentos (sin archivo)
--      y servicios prestados.
--   D. Sin sesión no hay exportación.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- 00153: el interruptor de aseguradoras viene apagado; estas pruebas las ejercitan.
UPDATE platform_features SET insurers_enabled = true;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('f2f2f2f2-0000-4000-8000-000000000001', 'ex.usuaria@budi.invalid', 'Usuaria Exporta'),
    ('f2f2f2f2-0000-4000-8000-000000000002', 'ex.socio@budi.invalid',   'Socio Exporta')
  ) AS x(id, email, nombre);
UPDATE profiles SET phone = '7000-1111' WHERE id = 'f2f2f2f2-0000-4000-8000-000000000001';
UPDATE profiles SET role = 'OPERATOR', phone = '7999-8888' WHERE id = 'f2f2f2f2-0000-4000-8000-000000000002';
INSERT INTO profile_sensitive (profile_id, dui_number) VALUES ('f2f2f2f2-0000-4000-8000-000000000001', '01234567-8')
ON CONFLICT (profile_id) DO UPDATE SET dui_number = EXCLUDED.dui_number;
INSERT INTO vehicles (user_id, make, model, plate, color, is_default)
VALUES ('f2f2f2f2-0000-4000-8000-000000000001', 'Toyota', 'Yaris', 'P555-111', 'Rojo', true);
INSERT INTO operator_profiles (operator_id, dui_number, nit, service_types)
VALUES ('f2f2f2f2-0000-4000-8000-000000000002', '09876543-2', '0614-010190-101-1', ARRAY['tow'])
ON CONFLICT (operator_id) DO NOTHING;
INSERT INTO operator_vehicles (operator_id, plate, vehicle_type) VALUES ('f2f2f2f2-0000-4000-8000-000000000002', 'C123-456', 'tow_light');

INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng,
                              pickup_address, dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price,
                              assigned_at, activated_at, completed_at)
VALUES ('f2f2f2f2-0000-4000-8000-000000000001', 'f2f2f2f2-0000-4000-8000-000000000002', 'completed', 'tow', 'light', 'x',
        13.7, -89.2, 'Col. Escalón', 13.71, -89.21, 'Taller', 'Varado', 40, now(), now(), now());
INSERT INTO request_messages (request_id, sender_id, message)
SELECT id, 'f2f2f2f2-0000-4000-8000-000000000001', 'Ya casi llego al punto' FROM service_requests
 WHERE user_id = 'f2f2f2f2-0000-4000-8000-000000000001';
INSERT INTO ratings (request_id, rater_user_id, rated_operator_id, stars, comment)
SELECT id, 'f2f2f2f2-0000-4000-8000-000000000001', 'f2f2f2f2-0000-4000-8000-000000000002', 5, 'Muy amable'
  FROM service_requests WHERE user_id = 'f2f2f2f2-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
DO $$
DECLARE d JSONB;
BEGIN
  PERFORM pg_temp.como('f2f2f2f2-0000-4000-8000-000000000001');
  d := export_my_data();
  ASSERT d->'profile'->>'email' = 'ex.usuaria@budi.invalid' AND d->'identity_document'->>'dui_number' = '01234567-8',
         'A: perfil/DUI: ' || (d->'profile')::text;
  ASSERT d->'vehicles'->0->>'plate' = 'P555-111', 'A: vehículos';
  ASSERT jsonb_array_length(d->'services_requested') = 1 AND d->'services_requested'->0->>'operator_name' = 'Socio Exporta',
         'A: servicios: ' || (d->'services_requested')::text;
  ASSERT d->'messages_sent'->0->>'message' = 'Ya casi llego al punto' AND (d->'ratings_given'->0->>'stars')::int = 5,
         'A: mensajes/calificaciones';
  ASSERT d->'as_partner' IS NULL OR d->'as_partner' = 'null'::jsonb, 'A: una Usuaria recibió sección de socio';
  -- B. Nada del socio más que su nombre.
  ASSERT NOT (d::text LIKE '%7999-8888%' OR d::text LIKE '%ex.socio@%' OR d::text LIKE '%09876543%' OR d::text LIKE '%C123-456%'),
         'B: la exportación de la Usuaria trae datos del socio';
  RAISE NOTICE 'A/B. la Usuaria recibe lo suyo y nada de terceros: OK';

  PERFORM pg_temp.como('f2f2f2f2-0000-4000-8000-000000000002');
  d := export_my_data();
  ASSERT d->'as_partner'->'registration'->>'dui_number' = '09876543-2' AND d->'as_partner'->'vehicles'->0->>'plate' = 'C123-456',
         'C: registro de socio: ' || (d->'as_partner')::text;
  ASSERT jsonb_array_length(d->'as_partner'->'services_provided') = 1
     AND (d->'as_partner'->'ratings_received'->0->>'stars')::int = 5, 'C: servicios/calificaciones recibidas';
  ASSERT NOT (d::text LIKE '%7000-1111%' OR d::text LIKE '%01234567%' OR d::text LIKE '%P555-111%' OR d::text LIKE '%ex.usuaria@%'),
         'B: la exportación del socio trae datos de la Usuaria';
  RAISE NOTICE 'C. el socio recibe su sección, sin datos de la Usuaria: OK';
END $$;

SELECT set_config('request.jwt.claims', '', true);
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN PERFORM export_my_data(); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'D: exportó sin sesión';
  RAISE NOTICE 'D. sin sesión no hay exportación: OK';
END $$;

ROLLBACK;
