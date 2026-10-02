-- =====================================================
-- Un servicio en curso no se cancela desde la app (migr. 00164)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Con el servicio activo, el socio no lo suelta al pool.
--   B. Con el servicio activo, el Usuario no lo cancela.
--   C. Antes de empezar (asignado), los dos siguen pudiendo.
--   D. Soporte sí puede cancelar uno activo.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre, 'role', rol), now(), now()
  FROM (VALUES ('c5c5c5c5-0000-4000-8000-000000000001', 'ca.socio@budi.invalid', 'Socio', 'OPERATOR'),
               ('c5c5c5c5-0000-4000-8000-000000000002', 'ca.usuario@budi.invalid', 'Usuario', 'USER'),
               ('c5c5c5c5-0000-4000-8000-000000000003', 'ca.soporte@budi.invalid', 'Soporte', 'USER'),
               ('c5c5c5c5-0000-4000-8000-000000000004', 'ca.usuario2@budi.invalid', 'Usuario 2', 'USER'),
               ('c5c5c5c5-0000-4000-8000-000000000005', 'ca.usuario3@budi.invalid', 'Usuario 3', 'USER'),
               ('c5c5c5c5-0000-4000-8000-000000000006', 'ca.usuario4@budi.invalid', 'Usuario 4', 'USER')) AS x(id, email, nombre, rol);
UPDATE profiles SET verification_status = 'approved', provider_id = '11111111-1111-1111-1111-111111111111'
 WHERE id = 'c5c5c5c5-0000-4000-8000-000000000001';
UPDATE profiles SET role = 'SUPPORT' WHERE id = 'c5c5c5c5-0000-4000-8000-000000000003';

-- Cuatro servicios del mismo socio, cada uno de un Usuario distinto (un
-- Usuario tiene un solo servicio abierto): tres activos y uno asignado. Se
-- insertan directo; el guardián de estados solo vigila a los clientes.
CREATE TEMP TABLE s ON COMMIT DROP AS
WITH ins AS (
  INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type)
  SELECT u::uuid, 'c5c5c5c5-0000-4000-8000-000000000001', st::request_status, 'tow', 'light', 'x',
         13.69, -89.24, nombre, 13.68, -89.28, 'Destino', 'Vehículo varado'
    FROM (VALUES ('c5c5c5c5-0000-4000-8000-000000000004', 'active', 'A'),
                 ('c5c5c5c5-0000-4000-8000-000000000002', 'active', 'B'),
                 ('c5c5c5c5-0000-4000-8000-000000000005', 'assigned', 'C'),
                 ('c5c5c5c5-0000-4000-8000-000000000006', 'active', 'D')) v(u, st, nombre)
  RETURNING id, pickup_address AS caso
)
SELECT id, caso FROM ins;
GRANT SELECT ON s TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como('c5c5c5c5-0000-4000-8000-000000000001');
DO $$ DECLARE r JSONB; BEGIN
  r := cancel_service_request((SELECT id FROM s WHERE caso = 'A'), 'me voy');
  ASSERT NOT (r->>'success')::boolean, 'A: el socio soltó un servicio activo: ' || r::text;
  ASSERT r->>'error' LIKE '%soporte%', 'A: el error no lo manda a soporte: ' || r::text;
  RAISE NOTICE 'A. el socio no suelta un servicio en curso: OK';
END $$;

SELECT pg_temp.como('c5c5c5c5-0000-4000-8000-000000000002');
DO $$ DECLARE r JSONB; BEGIN
  r := cancel_service_request((SELECT id FROM s WHERE caso = 'B'), 'ya no');
  ASSERT NOT (r->>'success')::boolean, 'B: el Usuario canceló un servicio activo: ' || r::text;
  RAISE NOTICE 'B. el Usuario no cancela un servicio en curso: OK';
END $$;
SELECT pg_temp.como('c5c5c5c5-0000-4000-8000-000000000005');
DO $$ DECLARE r JSONB; BEGIN
  r := cancel_service_request((SELECT id FROM s WHERE caso = 'C'), 'ya no');
  ASSERT (r->>'success')::boolean, 'C: el Usuario no pudo cancelar uno asignado: ' || r::text;
  RAISE NOTICE 'C. antes de empezar se sigue pudiendo: OK';
END $$;

SELECT pg_temp.como('c5c5c5c5-0000-4000-8000-000000000003');
DO $$ DECLARE r JSONB; BEGIN
  r := cancel_service_request((SELECT id FROM s WHERE caso = 'D'), 'lo resolvió soporte');
  ASSERT (r->>'success')::boolean, 'D: soporte no pudo cancelar uno activo: ' || r::text;
  RAISE NOTICE 'D. soporte sí puede: OK';
END $$;
RESET ROLE;

DO $$ BEGIN
  ASSERT (SELECT status FROM service_requests WHERE id = (SELECT id FROM s WHERE caso = 'A')) = 'active', 'A2: cambió de estado';
  ASSERT (SELECT status FROM service_requests WHERE id = (SELECT id FROM s WHERE caso = 'B')) = 'active', 'B2: cambió de estado';
END $$;

ROLLBACK;
