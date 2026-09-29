-- =====================================================
-- Faltantes del runbook de operación (migr. 00119/00120)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte: no deja datos.
--
--   A. PIN perdido: solo el Usuario genera uno nuevo (máx. 3); el viejo deja
--      de servir y al socio le llega el aviso.
--   B. PIN bloqueado: soporte ve el bloqueo y lo levanta con una nota.
--   C. Notas internas: solo el personal, sin editar ni borrar.
--   D. Soporte lee chat y recorrido.
--   E. 2FA: solo ADMIN lo restablece, con motivo, nunca el propio; cierra
--      sesiones y queda en la bitácora.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

-- Personas nuevas: Usuario, otro Usuario, socio aprobado, soporte, dos admins.
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('6b6b6b6b-0000-4000-8000-000000000001', 'rb.usuario@budi.invalid',  'Usuario runbook'),
    ('6b6b6b6b-0000-4000-8000-000000000002', 'rb.otro@budi.invalid',     'Otro usuario'),
    ('6b6b6b6b-0000-4000-8000-000000000003', 'rb.socio@budi.invalid',    'Socio runbook'),
    ('6b6b6b6b-0000-4000-8000-000000000004', 'rb.soporte@budi.invalid',  'Soporte runbook'),
    ('6b6b6b6b-0000-4000-8000-000000000005', 'rb.admin@budi.invalid',    'Admin runbook'),
    ('6b6b6b6b-0000-4000-8000-000000000006', 'rb.portal@budi.invalid',   'Persona de portal')
  ) AS x(id, email, nombre);

UPDATE profiles SET role = 'OPERATOR', verification_status = 'approved' WHERE id = '6b6b6b6b-0000-4000-8000-000000000003';
UPDATE profiles SET role = 'SUPPORT' WHERE id = '6b6b6b6b-0000-4000-8000-000000000004';
UPDATE profiles SET role = 'ADMIN'   WHERE id = '6b6b6b6b-0000-4000-8000-000000000005';

CREATE TEMP TABLE t ON COMMIT DROP AS SELECT
  '6b6b6b6b-0000-4000-8000-000000000001'::uuid AS usuario,
  '6b6b6b6b-0000-4000-8000-000000000002'::uuid AS otro,
  '6b6b6b6b-0000-4000-8000-000000000003'::uuid AS socio,
  '6b6b6b6b-0000-4000-8000-000000000004'::uuid AS soporte,
  '6b6b6b6b-0000-4000-8000-000000000005'::uuid AS admin,
  '6b6b6b6b-0000-4000-8000-000000000006'::uuid AS portal,
  NULL::uuid AS req;
GRANT SELECT ON t TO PUBLIC;

-- Un servicio asignado al socio, con PIN 1234.
WITH r AS (
  INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash,
                                pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type, assigned_at)
  VALUES ((SELECT usuario FROM t), (SELECT socio FROM t), 'assigned', 'tow', 'light', crypt('1234', gen_salt('bf')),
          13.69, -89.21, 'Punto de prueba', 13.70, -89.22, 'Destino de prueba', 'Vehículo varado', now())
  RETURNING id
)
UPDATE t SET req = (SELECT id FROM r);

INSERT INTO request_messages (request_id, sender_id, message)
VALUES ((SELECT req FROM t), (SELECT usuario FROM t), 'Estoy frente a la gasolinera');
INSERT INTO service_location_trail (request_id, lat, lng)
VALUES ((SELECT req FROM t), 13.695, -89.215);

-- Un 2FA y una sesión abierta de la persona de portal.
INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
VALUES (gen_random_uuid(), '6b6b6b6b-0000-4000-8000-000000000006', 'Teléfono', 'totp', 'verified', now(), now(), 'X');
INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal)
VALUES (gen_random_uuid(), '6b6b6b6b-0000-4000-8000-000000000006', now(), now(), 'aal2');

CREATE TEMP TABLE t_pin (pin TEXT) ON COMMIT DROP;
GRANT ALL ON t_pin TO PUBLIC;

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------
-- A. PIN perdido
-- ---------------------------------------------------------------
SELECT pg_temp.como((SELECT otro FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM regenerate_my_request_pin((SELECT req FROM t));
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'Solicitud no encontrada';
  END;
  ASSERT ok, 'A1: otra persona genero un PIN para un servicio ajeno';
END $$;

SELECT pg_temp.como((SELECT usuario FROM t));
DO $$
DECLARE r JSONB; ok BOOLEAN := false;
BEGIN
  r := regenerate_my_request_pin((SELECT req FROM t));
  ASSERT r->>'pin' ~ '^\d{4}$', 'A2: el PIN nuevo no tiene 4 digitos';
  ASSERT (r->>'remaining')::int = 2, 'A2: no descuenta el cupo';
  INSERT INTO t_pin VALUES (r->>'pin');
  PERFORM regenerate_my_request_pin((SELECT req FROM t));
  r := regenerate_my_request_pin((SELECT req FROM t));
  DELETE FROM t_pin; INSERT INTO t_pin VALUES (r->>'pin');
  BEGIN
    PERFORM regenerate_my_request_pin((SELECT req FROM t));
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Ya generaste 3 PIN%';
  END;
  ASSERT ok, 'A3: se pudo generar un cuarto PIN';
  RAISE NOTICE 'A. PIN nuevo solo del Usuario y con tope: OK';
END $$;

RESET ROLE;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM notification_queue WHERE user_id = (SELECT socio FROM t)
            AND data->>'type' = 'pin_regenerated') = 3, 'A4: al socio no le llego el aviso';
  ASSERT (SELECT label FROM get_case_timeline((SELECT folio FROM cases WHERE request_id = (SELECT req FROM t)))
           WHERE event_type = 'PIN_REGENERATED' LIMIT 1) = 'El Usuario generó un PIN de confirmación nuevo',
         'A5: la linea de tiempo no nombra el evento';
END $$;
SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------
-- B. PIN bloqueado: 5 fallos del socio, soporte lo levanta
-- ---------------------------------------------------------------
SELECT pg_temp.como((SELECT socio FROM t));
DO $$
DECLARE r JSONB;
BEGIN
  r := verify_request_pin((SELECT req FROM t), '1234');   -- el viejo ya no sirve
  ASSERT (r->>'valid')::boolean IS NOT TRUE, 'B1: el PIN viejo sigue sirviendo';
  FOR i IN 1..4 LOOP PERFORM verify_request_pin((SELECT req FROM t), '0000'); END LOOP;
  r := verify_request_pin((SELECT req FROM t), (SELECT pin FROM t_pin));
  ASSERT (r->>'locked')::boolean, 'B2: tras 5 fallos no quedo bloqueado';
END $$;

SELECT pg_temp.como((SELECT soporte FROM t));
DO $$
DECLARE s JSONB; ok BOOLEAN := false;
BEGIN
  s := staff_pin_status((SELECT req FROM t));
  ASSERT (s->>'locked')::boolean AND (s->>'regenerated')::int = 3, 'B3: soporte no ve el bloqueo: ' || s::text;
  BEGIN
    PERFORM staff_reset_pin_lockout((SELECT req FROM t), '  ');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Anota%';
  END;
  ASSERT ok, 'B4: se desbloqueo sin nota';
  ASSERT staff_reset_pin_lockout((SELECT req FROM t), 'Hablé con el Usuario: está con el socio') >= 5, 'B5: no borro los fallos';
  ASSERT NOT (staff_pin_status((SELECT req FROM t))->>'locked')::boolean, 'B5: sigue bloqueado';
END $$;

SELECT pg_temp.como((SELECT socio FROM t));
DO $$
BEGIN
  ASSERT (verify_request_pin((SELECT req FROM t), (SELECT pin FROM t_pin))->>'valid')::boolean,
         'B6: con el PIN nuevo y desbloqueado no arranca';
  RAISE NOTICE 'B. bloqueo visible y desbloqueo con nota: OK';
END $$;

-- ---------------------------------------------------------------
-- C. Notas internas
-- ---------------------------------------------------------------
SELECT pg_temp.como((SELECT usuario FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM staff_request_notes((SELECT req FROM t));
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'C1: el Usuario leyo las notas internas';
  ok := false;
  BEGIN
    PERFORM count(*) FROM request_notes;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'C1: la tabla de notas es legible';
END $$;

SELECT pg_temp.como((SELECT soporte FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  PERFORM staff_add_request_note((SELECT req FROM t), 'Llamó el Usuario: el socio va con 10 min de retraso');
  BEGIN
    PERFORM staff_add_request_note((SELECT req FROM t), '   ');
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'C2: se guardo una nota vacia';
  ASSERT (SELECT author_role FROM staff_request_notes((SELECT req FROM t))) = 'SUPPORT', 'C3: la nota no dice quien la escribio';
  ok := false;
  BEGIN
    UPDATE request_notes SET body = 'otra cosa';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'C4: una nota se pudo editar';
  RAISE NOTICE 'C. notas internas: OK';
END $$;

-- ---------------------------------------------------------------
-- D. Soporte ve chat y recorrido
-- ---------------------------------------------------------------
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM request_messages WHERE request_id = (SELECT req FROM t)) = 1, 'D1: soporte no ve el chat';
  ASSERT (SELECT count(*) FROM service_location_trail WHERE request_id = (SELECT req FROM t)) = 1, 'D2: soporte no ve el recorrido';
  RAISE NOTICE 'D. chat y recorrido para soporte: OK';
END $$;

-- ---------------------------------------------------------------
-- E. 2FA
-- ---------------------------------------------------------------
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_reset_mfa((SELECT portal FROM t), 'soporte lo intenta');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Solo un administrador%';
  END;
  ASSERT ok, 'E1: soporte restablecio un 2FA';
END $$;

SELECT pg_temp.como((SELECT admin FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_reset_mfa((SELECT portal FROM t), '');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Indica%';
  END;
  ASSERT ok, 'E2: se restablecio sin motivo';
  ok := false;
  BEGIN
    PERFORM admin_reset_mfa((SELECT admin FROM t), 'el mio');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'No puedes%';
  END;
  ASSERT ok, 'E3: un admin restablecio su propio 2FA';
  ASSERT admin_reset_mfa((SELECT portal FROM t), 'Videollamada con su DUI') = 1, 'E4: no borro el factor';
END $$;

RESET ROLE;
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = (SELECT portal FROM t)), 'E5: el factor sigue';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = (SELECT portal FROM t)), 'E5: la sesion aal2 sigue abierta';
  ASSERT EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'mfa_factors' AND record_id = (SELECT portal FROM t)::text
                   AND actor_id = (SELECT admin FROM t)), 'E6: no quedo en la bitacora';
  RAISE NOTICE 'E. 2FA restablecido por ADMIN, con motivo y bitacora: OK';
END $$;

ROLLBACK;
