-- =====================================================
-- Interruptor de aseguradoras (migr. 00153)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Apagado: un afiliado no tiene cobertura (el pedido va como particular
--      o cortesía MOPT) y la miembro de una aseguradora no entra a su portal.
--   B. Solo ADMIN lo prende y lo apaga; prendido, todo vuelve.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

UPDATE platform_features SET insurers_enabled = false;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal2') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated', x.email,
       jsonb_build_object('full_name', x.nombre), now(), now()
  FROM (VALUES
    ('5a5a5a5a-0000-4000-8000-000000000001'::uuid, 'sw.afiliado@budi.invalid', 'Afiliado interruptor'),
    ('5a5a5a5a-0000-4000-8000-000000000002'::uuid, 'sw.analista@budi.invalid', 'Analista interruptor'),
    ('5a5a5a5a-0000-4000-8000-000000000003'::uuid, 'sw.admin@budi.invalid',    'Admin interruptor')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'ADMIN' WHERE id = '5a5a5a5a-0000-4000-8000-000000000003';

-- Afiliado con plan que cubre todo, en la aseguradora del seed.
WITH plan AS (
  INSERT INTO coverage_plans (insurer_id, code, name)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'SW-1', 'Plan interruptor') RETURNING id
), r AS (
  INSERT INTO coverage_rules (plan_id, service_type, rule_key, rule_value) SELECT id, NULL, 'covered', 1 FROM plan RETURNING plan_id
), pol AS (
  INSERT INTO policies (insurer_id, plan_id, policy_number, holder_name, starts_on, status)
  SELECT 'a0000000-0000-0000-0000-000000000001', id, 'POL-SW-1', 'Titular', sv_today() - 30, 'active'
    FROM plan WHERE EXISTS (SELECT 1 FROM r) RETURNING id
)
INSERT INTO members (policy_id, document_number, full_name, relationship, starts_on, is_active, profile_id)
SELECT id, '088888888', 'Afiliado interruptor', 'holder', sv_today() - 30, true, '5a5a5a5a-0000-4000-8000-000000000001' FROM pol;

INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT id, '5a5a5a5a-0000-4000-8000-000000000002', 'analyst', 'active'
  FROM organizations WHERE insurer_id = 'a0000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;

SELECT pg_temp.como('5a5a5a5a-0000-4000-8000-000000000001', 'aal1');
DO $$
BEGIN
  ASSERT NOT (platform_features()->>'insurers')::boolean, 'A0: el interruptor no viene apagado';
  ASSERT check_member_coverage()->>'status' = 'none', 'A1: apagado, el afiliado sigue teniendo cobertura';
END $$;

SELECT pg_temp.como('5a5a5a5a-0000-4000-8000-000000000002', 'aal1');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  ASSERT my_organization() IS NULL, 'A2: apagado, la analista entra a su portal de aseguradora';
  BEGIN
    PERFORM set_insurers_ok FROM (SELECT admin_set_insurers_enabled(true) AS set_insurers_ok) q;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Solo un administrador%';
  END;
  ASSERT ok, 'B1: alguien que no es ADMIN prendio las aseguradoras';
  RAISE NOTICE 'A. apagado: sin cobertura y sin portal de aseguradora: OK';
END $$;

SELECT pg_temp.como('5a5a5a5a-0000-4000-8000-000000000003');
SELECT admin_set_insurers_enabled(true);

SELECT pg_temp.como('5a5a5a5a-0000-4000-8000-000000000001', 'aal1');
DO $$
BEGIN
  ASSERT check_member_coverage()->>'status' = 'covered', 'B2: prendido, el afiliado no recupera su cobertura';
END $$;
SELECT pg_temp.como('5a5a5a5a-0000-4000-8000-000000000002', 'aal1');
DO $$
BEGIN
  ASSERT my_organization()->>'type' = 'INSURER', 'B2: prendido, la analista no vuelve a su portal';
  RAISE NOTICE 'B. solo ADMIN lo cambia; prendido todo vuelve: OK';
END $$;

RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'TODO VERDE'; END $$;
ROLLBACK;
