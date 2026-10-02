-- =====================================================
-- Un solo formato de teléfono en los perfiles (migr. 00161)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. El alta (handle_new_user) guarda "+503XXXXXXXX" aunque se escriba
--      "7555-1234".
--   B. Editar el perfil también normaliza.
--   C. Otro país y vacío se dejan como vinieron.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', 'b4b4b4b4-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'tel.prueba@budi.invalid', jsonb_build_object('full_name', 'Tel Prueba', 'phone', '7555-1234', 'role', 'USER'), now(), now());

DO $$
DECLARE v TEXT;
BEGIN
  SELECT phone INTO v FROM profiles WHERE id = 'b4b4b4b4-0000-4000-8000-000000000001';
  ASSERT v = '+50375551234', 'A: el alta guardó ' || COALESCE(v, 'NULL');
  RAISE NOTICE 'A. el alta normaliza: OK';

  UPDATE profiles SET phone = '+503 6123 4567' WHERE id = 'b4b4b4b4-0000-4000-8000-000000000001';
  ASSERT (SELECT phone FROM profiles WHERE id = 'b4b4b4b4-0000-4000-8000-000000000001') = '+50361234567', 'B: editar no normalizó';
  RAISE NOTICE 'B. editar normaliza: OK';

  UPDATE profiles SET phone = ' +1 305 555 0100 ' WHERE id = 'b4b4b4b4-0000-4000-8000-000000000001';
  ASSERT (SELECT phone FROM profiles WHERE id = 'b4b4b4b4-0000-4000-8000-000000000001') = '+1 305 555 0100', 'C: tocó un número de otro país';
  UPDATE profiles SET phone = '' WHERE id = 'b4b4b4b4-0000-4000-8000-000000000001';
  ASSERT (SELECT phone FROM profiles WHERE id = 'b4b4b4b4-0000-4000-8000-000000000001') = '', 'C: el vacío no quedó vacío';
  RAISE NOTICE 'C. otro país y vacío se respetan: OK';
END $$;

ROLLBACK;
