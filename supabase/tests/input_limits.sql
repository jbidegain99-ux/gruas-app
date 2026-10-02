-- =====================================================
-- Entradas: ubicaciones solo de socios, foto propia y largos (migr. 00165)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Un Usuario no escribe en operator_locations; un socio sí.
--   B. La foto del vehículo tiene que ser un archivo propio de service-photos.
--   C. Largos máximos: notas, dirección (no vacía), comentario, mensaje, nombre.
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
  FROM (VALUES ('c6c6c6c6-0000-4000-8000-000000000001', 'il.socio@budi.invalid', 'Socio', 'OPERATOR'),
               ('c6c6c6c6-0000-4000-8000-000000000002', 'il.usuario@budi.invalid', 'Usuario', 'USER'),
               ('c6c6c6c6-0000-4000-8000-000000000003', 'il.otro@budi.invalid', 'Otro', 'USER')) AS x(id, email, nombre, rol);
-- Una foto propia y una ajena en service-photos.
INSERT INTO storage.objects (bucket_id, name, owner, metadata)
VALUES ('service-photos', 'c6c6c6c6-0000-4000-8000-000000000002/propia.jpg', 'c6c6c6c6-0000-4000-8000-000000000002', '{}'),
       ('service-photos', 'c6c6c6c6-0000-4000-8000-000000000003/ajena.jpg', 'c6c6c6c6-0000-4000-8000-000000000003', '{}');

SET LOCAL ROLE authenticated;

-- A. Ubicaciones
SELECT pg_temp.como('c6c6c6c6-0000-4000-8000-000000000002');
DO $$ DECLARE ok BOOLEAN := false; BEGIN
  BEGIN
    INSERT INTO operator_locations (operator_id, lat, lng, is_online, updated_at)
    VALUES ('c6c6c6c6-0000-4000-8000-000000000002', 13.7, -89.2, true, now());
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: un Usuario se publicó en operator_locations';
END $$;
SELECT pg_temp.como('c6c6c6c6-0000-4000-8000-000000000001');
INSERT INTO operator_locations (operator_id, lat, lng, is_online, updated_at)
VALUES ('c6c6c6c6-0000-4000-8000-000000000001', 13.7, -89.2, true, now());
DO $$ BEGIN RAISE NOTICE 'A. solo un socio escribe su ubicación: OK'; END $$;

-- B. Foto del vehículo
SELECT pg_temp.como('c6c6c6c6-0000-4000-8000-000000000002');
DO $$
DECLARE ok BOOLEAN; url TEXT;
  base TEXT := 'http://127.0.0.1:54321/storage/v1/object/public/service-photos/';
BEGIN
  FOREACH url IN ARRAY ARRAY['https://evil.example/x.jpg',
                             base || 'c6c6c6c6-0000-4000-8000-000000000003/ajena.jpg',
                             base || 'c6c6c6c6-0000-4000-8000-000000000002/no-existe.jpg'] LOOP
    ok := false;
    BEGIN
      PERFORM create_service_request(p_dropoff_address => 'Destino', p_dropoff_lat => 13.6769, p_dropoff_lng => -89.2797,
        p_incident_type => 'x', p_pickup_address => 'Recogida', p_pickup_lat => 13.6935, p_pickup_lng => -89.2410,
        p_vehicle_photo_url => url);
    EXCEPTION WHEN OTHERS THEN ok := true; END;
    ASSERT ok, 'B: aceptó la foto ' || url;
  END LOOP;
  PERFORM create_service_request(p_dropoff_address => 'Destino', p_dropoff_lat => 13.6769, p_dropoff_lng => -89.2797,
    p_incident_type => 'x', p_pickup_address => 'Recogida', p_pickup_lat => 13.6935, p_pickup_lng => -89.2410,
    p_vehicle_photo_url => base || 'c6c6c6c6-0000-4000-8000-000000000002/propia.jpg');
  RAISE NOTICE 'B. solo la foto propia subida a Budi: OK';
END $$;
RESET ROLE;

-- C. Largos máximos (directo sobre las tablas: son CHECK)
DO $$
DECLARE ok BOOLEAN; sentencia TEXT;
BEGIN
  FOREACH sentencia IN ARRAY ARRAY[
    $q$UPDATE service_requests SET notes = repeat('x', 1001) WHERE user_id = 'c6c6c6c6-0000-4000-8000-000000000002'$q$,
    $q$UPDATE service_requests SET pickup_address = '   ' WHERE user_id = 'c6c6c6c6-0000-4000-8000-000000000002'$q$,
    $q$UPDATE service_requests SET dropoff_address = repeat('x', 301) WHERE user_id = 'c6c6c6c6-0000-4000-8000-000000000002'$q$,
    $q$UPDATE profiles SET full_name = repeat('x', 121) WHERE id = 'c6c6c6c6-0000-4000-8000-000000000002'$q$,
    $q$INSERT INTO request_messages (request_id, sender_id, message) SELECT id, user_id, repeat('x', 2001) FROM service_requests WHERE user_id = 'c6c6c6c6-0000-4000-8000-000000000002'$q$
  ] LOOP
    ok := false;
    BEGIN EXECUTE sentencia; EXCEPTION WHEN check_violation THEN ok := true; END;
    ASSERT ok, 'C: no frenó: ' || sentencia;
  END LOOP;
  ASSERT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ratings_comment_len'), 'C: falta el límite del comentario';
  RAISE NOTICE 'C. largos máximos y dirección no vacía: OK';
END $$;

ROLLBACK;
