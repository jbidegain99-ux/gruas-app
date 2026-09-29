-- =====================================================
-- Capacitación del socio e insignia de verificado (migr. 00137, AGT-05)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Solo un socio operador registra su guía y su práctica; la práctica no
--      crea servicios.
--   B. La insignia la ve el Usuario de ese servicio; nadie ajeno.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('e1e1e1e1-0000-4000-8000-000000000001', 'cap.socio@budi.invalid',   'Socio Nuevo'),
    ('e1e1e1e1-0000-4000-8000-000000000002', 'cap.usuario@budi.invalid', 'Usuaria'),
    ('e1e1e1e1-0000-4000-8000-000000000003', 'cap.otro@budi.invalid',    'Otra persona')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'OPERATOR', verification_status = 'approved' WHERE id = 'e1e1e1e1-0000-4000-8000-000000000001';

CREATE TEMP TABLE t (req UUID, n INT) ON COMMIT DROP;
INSERT INTO t (n) SELECT count(*) FROM service_requests;
GRANT ALL ON t TO PUBLIC;
INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng,
                              pickup_address, dropoff_lat, dropoff_lng, dropoff_address, incident_type, assigned_at)
VALUES ('e1e1e1e1-0000-4000-8000-000000000002', 'e1e1e1e1-0000-4000-8000-000000000001', 'assigned', 'tow', 'light', 'x',
        13.7, -89.2, 'Zona', 13.71, -89.21, 'Destino', 'Varado', now());
UPDATE t SET req = (SELECT id FROM service_requests WHERE user_id = 'e1e1e1e1-0000-4000-8000-000000000002');
UPDATE t SET n = n + 1;

SET LOCAL ROLE authenticated;

DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  -- A. El Usuario no es socio.
  PERFORM pg_temp.como('e1e1e1e1-0000-4000-8000-000000000002');
  BEGIN PERFORM complete_partner_practice(); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: un Usuario registró práctica de socio';

  PERFORM pg_temp.como('e1e1e1e1-0000-4000-8000-000000000001');
  ASSERT my_partner_training()->>'guide_seen_at' IS NULL, 'A: guía vista sin verla';
  PERFORM mark_partner_guide_seen();
  PERFORM complete_partner_practice();
  ASSERT my_partner_training()->>'guide_seen_at' IS NOT NULL AND my_partner_training()->>'practice_done_at' IS NOT NULL,
         'A: no quedó registrada la capacitación';
  RAISE NOTICE 'A. solo el socio registra guía y práctica: OK';

  -- B. Insignia.
  PERFORM pg_temp.como('e1e1e1e1-0000-4000-8000-000000000002');
  ASSERT (request_operator_badge((SELECT req FROM t))->>'verified')::boolean, 'B: la Usuaria no ve la insignia';
  PERFORM pg_temp.como('e1e1e1e1-0000-4000-8000-000000000003');
  ASSERT request_operator_badge((SELECT req FROM t)) IS NULL, 'B: una persona ajena vio la insignia';
  RAISE NOTICE 'B. insignia solo para el Usuario del servicio: OK';
END $$;

RESET ROLE;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM service_requests) = (SELECT n FROM t), 'A: la práctica creó servicios';
END $$;

ROLLBACK;
