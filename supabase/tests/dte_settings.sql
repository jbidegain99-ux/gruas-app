-- =====================================================
-- Datos fiscales del DTE (migr. 00140, base de LAN-09)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Solo el admin lee y guarda los datos fiscales (son de clientes).
--   B. Se guardan emisor y receptor; los códigos de establecimiento se
--      validan (4 caracteres).
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES ('a3a3a3a3-0000-4000-8000-000000000001', 'dte.admin@budi.invalid', 'Admin'),
               ('a3a3a3a3-0000-4000-8000-000000000002', 'dte.soporte@budi.invalid', 'Soporte'),
               ('a3a3a3a3-0000-4000-8000-000000000003', 'dte.dueno@budi.invalid', 'Dueño aseguradora')) AS x(id, email, nombre);
UPDATE profiles SET role = 'ADMIN' WHERE id = 'a3a3a3a3-0000-4000-8000-000000000001';
UPDATE profiles SET role = 'SUPPORT' WHERE id = 'a3a3a3a3-0000-4000-8000-000000000002';
INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT id, 'a3a3a3a3-0000-4000-8000-000000000003', 'owner', 'active' FROM organizations WHERE type = 'INSURER' ORDER BY created_at LIMIT 1;

CREATE TEMP TABLE t ON COMMIT DROP AS SELECT id AS org FROM organizations WHERE type = 'INSURER' ORDER BY created_at LIMIT 1;
GRANT SELECT ON t TO PUBLIC;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  p UUID;
  ok BOOLEAN;
  org UUID := (SELECT t.org FROM t);
BEGIN
  FOREACH p IN ARRAY ARRAY['a3a3a3a3-0000-4000-8000-000000000002', 'a3a3a3a3-0000-4000-8000-000000000003']::uuid[] LOOP
    PERFORM pg_temp.como(p);
    ok := false;
    BEGIN PERFORM admin_dte_settings(); EXCEPTION WHEN OTHERS THEN ok := true; END;
    ASSERT ok, 'A: alguien que no es admin leyó los datos fiscales';
    ok := false;
    BEGIN PERFORM admin_save_org_fiscal(org, '03', '{"nit":"1"}'); EXCEPTION WHEN OTHERS THEN ok := true; END;
    ASSERT ok, 'A: alguien que no es admin cambió datos fiscales';
    ok := false;
    BEGIN PERFORM 1 FROM organization_fiscal_data; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
    ASSERT ok, 'A: la tabla fiscal es legible directo';
  END LOOP;
  RAISE NOTICE 'A. solo el admin: OK';

  PERFORM pg_temp.como('a3a3a3a3-0000-4000-8000-000000000001');
  PERFORM admin_save_dte_settings('{"nit":"06142803901121","nombre":"Budi"}', '00', 'm001', 'p001', true);
  PERFORM admin_save_org_fiscal(org, '03', '{"nit":"06140101001234","nrc":"7654321"}');
  ASSERT (admin_dte_settings()->'settings'->>'cod_estable') = 'M001', 'B: el código no se normalizó a mayúsculas';
  ASSERT (SELECT c->'receptor'->>'nrc' FROM jsonb_array_elements(admin_dte_settings()->'clients') c
           WHERE (c->>'organization_id')::uuid = org) = '7654321', 'B: no se guardó el receptor';
  ok := false;
  BEGIN PERFORM admin_save_dte_settings('{}', '00', 'M01', 'P001', true); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: aceptó un código de establecimiento de 3 caracteres';
  RAISE NOTICE 'B. emisor y receptor se guardan y validan: OK';
END $$;

ROLLBACK;
