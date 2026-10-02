-- =====================================================
-- Un socio, un servicio a la vez (migr. 00163)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Con un servicio en curso, aceptar otro del pool se rechaza.
--   B. Al terminar (o cancelarse) el primero, puede aceptar el siguiente.
--   C. El despacho (admin_assign_request) sí puede forzar: es a propósito.
--
-- La carrera (dos aceptaciones al mismo tiempo) no se puede probar dentro de
-- una transacción; la cubre el advisory lock por socio de la función.
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
  FROM (VALUES ('c3c3c3c3-0000-4000-8000-000000000001', 'uno.socio@budi.invalid', 'Socio', 'OPERATOR'),
               ('c3c3c3c3-0000-4000-8000-000000000002', 'uno.usuario@budi.invalid', 'Usuario', 'USER'),
               ('c3c3c3c3-0000-4000-8000-000000000003', 'uno.otro@budi.invalid', 'Otro', 'USER'),
               ('c3c3c3c3-0000-4000-8000-000000000004', 'uno.admin@budi.invalid', 'Admin', 'USER')) AS x(id, email, nombre, rol);
-- Socio aprobado de una empresa que remolca; sin empresa no pasaría operator_can_serve.
UPDATE profiles SET verification_status = 'approved', provider_id = '11111111-1111-1111-1111-111111111111'
 WHERE id = 'c3c3c3c3-0000-4000-8000-000000000001';
UPDATE profiles SET role = 'ADMIN' WHERE id = 'c3c3c3c3-0000-4000-8000-000000000004';

CREATE TEMP TABLE r ON COMMIT DROP AS
WITH ins AS (
  INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type)
  SELECT u::uuid, 'initiated', 'tow', 'light', 'x', 13.69, -89.24, 'Prueba', 13.68, -89.28, 'Destino', 'Vehículo varado'
    FROM (VALUES ('c3c3c3c3-0000-4000-8000-000000000002'), ('c3c3c3c3-0000-4000-8000-000000000003')) v(u)
  RETURNING id, user_id
)
SELECT id, user_id FROM ins;
GRANT SELECT ON r TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como('c3c3c3c3-0000-4000-8000-000000000001');
DO $$
DECLARE a UUID := (SELECT id FROM r WHERE user_id = 'c3c3c3c3-0000-4000-8000-000000000002');
        b UUID := (SELECT id FROM r WHERE user_id = 'c3c3c3c3-0000-4000-8000-000000000003');
        ok BOOLEAN := false; msg TEXT;
BEGIN
  PERFORM accept_service_request(a);
  BEGIN PERFORM accept_service_request(b); EXCEPTION WHEN OTHERS THEN ok := true; msg := SQLERRM; END;
  ASSERT ok, 'A: aceptó un segundo servicio teniendo uno en curso';
  ASSERT msg LIKE 'Ya tienes un servicio en curso%', 'A: mensaje inesperado: ' || msg;
  RAISE NOTICE 'A. con un servicio en curso no acepta otro: OK';
END $$;
RESET ROLE;

-- B. El primero se cancela (lo hace el despacho) y ya puede tomar el segundo.
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('c3c3c3c3-0000-4000-8000-000000000004');
SELECT admin_cancel_request((SELECT id FROM r WHERE user_id = 'c3c3c3c3-0000-4000-8000-000000000002'), 'prueba');
SELECT pg_temp.como('c3c3c3c3-0000-4000-8000-000000000001');
DO $$ BEGIN
  PERFORM accept_service_request((SELECT id FROM r WHERE user_id = 'c3c3c3c3-0000-4000-8000-000000000003'));
  RAISE NOTICE 'B. libre otra vez, acepta el siguiente: OK';
END $$;
RESET ROLE;

-- C. El despacho puede asignarle otro aunque tenga uno en curso (00074).
INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                              dropoff_lat, dropoff_lng, dropoff_address, incident_type)
VALUES ('c3c3c3c3-0000-4000-8000-000000000002', 'initiated', 'tow', 'light', 'x', 13.69, -89.24, 'Prueba C', 13.68, -89.28, 'Destino', 'Vehículo varado');
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('c3c3c3c3-0000-4000-8000-000000000004');
DO $$ BEGIN
  PERFORM admin_assign_request(
    (SELECT id FROM service_requests WHERE pickup_address = 'Prueba C' AND user_id = 'c3c3c3c3-0000-4000-8000-000000000002'),
    'c3c3c3c3-0000-4000-8000-000000000001');
  RAISE NOTICE 'C. el despacho puede forzar la asignación: OK';
END $$;
RESET ROLE;

ROLLBACK;
