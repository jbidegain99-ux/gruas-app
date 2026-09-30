-- =====================================================
-- Siniestralidad trimestral para reaseguradoras (migr. 00136, backlog REA-03)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Frecuencia por 1 000 expuestos, severidad y costo por afiliado de Q2
--      contra Q1, con la variación.
--   B. Una cedente con menos de 5 servicios se suprime y su variación no se
--      publica; el total no la incluye.
--   C. Sin autorización no aparece; nadie más que la reaseguradora lo pide.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- 00153: el interruptor de aseguradoras viene apagado; estas pruebas las ejercitan.
UPDATE platform_features SET insurers_enabled = true;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal1') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('d0d0d0d0-0000-4000-8000-000000000001', 'rl.admin@budi.invalid',    'Admin'),
    ('d0d0d0d0-0000-4000-8000-000000000002', 'rl.analista@budi.invalid', 'Analista Rea'),
    ('d0d0d0d0-0000-4000-8000-000000000003', 'rl.usuario@budi.invalid',  'Usuario')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'ADMIN' WHERE id = 'd0d0d0d0-0000-4000-8000-000000000001';

CREATE TEMP TABLE t (rea UUID, org_a UUID, org_b UUID, org_c UUID) ON COMMIT DROP;
INSERT INTO t DEFAULT VALUES;
GRANT ALL ON t TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como('d0d0d0d0-0000-4000-8000-000000000001', 'aal2');
UPDATE t SET rea   = admin_create_institution('REINSURER', 'Rea Siniestralidad', NULL, NULL, NULL, NULL),
             org_a = admin_create_institution('INSURER', 'Siniestros A (prueba)', NULL, NULL, NULL, NULL),
             org_b = admin_create_institution('INSURER', 'Siniestros B (prueba)', NULL, NULL, NULL, NULL),
             org_c = admin_create_institution('INSURER', 'Siniestros C sin permiso (prueba)', NULL, NULL, NULL, NULL);
SELECT admin_set_reinsurer_link(rea, o, '2025-01-01', NULL) FROM t, LATERAL unnest(ARRAY[org_a, org_b, org_c]) o;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE reinsurer_cedents SET consent_status = 'granted'
 WHERE reinsurer_org_id = (SELECT rea FROM t) AND insurer_org_id IN ((SELECT org_a FROM t), (SELECT org_b FROM t));
INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT rea, 'd0d0d0d0-0000-4000-8000-000000000002', 'analyst', 'active' FROM t;

-- Padrón: A con 10 afiliados (uno solo usa los servicios), B y C con 2.
CREATE TEMP TABLE afi (member_id UUID, insurer_id UUID) ON COMMIT DROP;
WITH ins AS (
  SELECT o.insurer_id, x.n FROM t, LATERAL (VALUES (t.org_a, 10), (t.org_b, 2), (t.org_c, 2)) AS x(org, n)
  JOIN organizations o ON o.id = x.org
), plan AS (
  INSERT INTO coverage_plans (insurer_id, code, name) SELECT insurer_id, 'RL', 'Plan RL' FROM ins RETURNING id, insurer_id
), regla AS (
  INSERT INTO coverage_rules (plan_id, service_type, rule_key, rule_value) SELECT id, NULL, 'covered', 1 FROM plan RETURNING plan_id
), pol AS (
  INSERT INTO policies (insurer_id, plan_id, policy_number, holder_name, starts_on, status)
  SELECT p.insurer_id, p.id, 'POL-RL-' || p.id, 'Titular', '2026-01-01', 'active' FROM plan p JOIN regla r ON r.plan_id = p.id
  RETURNING id, insurer_id
), mem AS (
  INSERT INTO members (policy_id, document_number, full_name, relationship, starts_on, is_active)
  SELECT pol.id, '0' || lpad((row_number() OVER ())::text, 8, '0'), 'Afiliado', 'holder', '2026-01-01', true
    FROM pol JOIN ins ON ins.insurer_id = pol.insurer_id, generate_series(1, ins.n)
  RETURNING id, policy_id
)
INSERT INTO afi SELECT mem.id, pol.insurer_id FROM mem JOIN pol ON pol.id = mem.policy_id;

CREATE OR REPLACE FUNCTION pg_temp.caso(p_insurer UUID, p_when TIMESTAMPTZ, p_covered NUMERIC) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price, created_at,
                                assigned_at, activated_at, completed_at, coverage_status)
  VALUES ('d0d0d0d0-0000-4000-8000-000000000003', 'completed', 'tow', 'light', 'x', 13.7, -89.2, 'Zona', 13.71, -89.21,
          'Destino', 'Varado', p_covered, p_when, p_when + interval '5 minutes', p_when + interval '30 minutes',
          p_when + interval '60 minutes', 'covered')
  RETURNING id INTO v;
  INSERT INTO coverage_usage (member_id, request_id, service_type, used_on, amount_covered, amount_copay)
  SELECT member_id, v, 'tow', p_when::date, p_covered, 0 FROM afi WHERE insurer_id = p_insurer LIMIT 1;
END;
$$;
-- A: Q1 = 5 servicios de $100; Q2 = 6 servicios de $120. B: Q2 = 3. C: Q2 = 7 (sin permiso).
SELECT pg_temp.caso(o.insurer_id, '2026-02-10 15:00-06'::timestamptz + make_interval(days => g), 100)
  FROM t JOIN organizations o ON o.id = t.org_a, generate_series(1, 5) g;
SELECT pg_temp.caso(o.insurer_id, '2026-05-10 15:00-06'::timestamptz + make_interval(days => g), 120)
  FROM t JOIN organizations o ON o.id = t.org_a, generate_series(1, 6) g;
SELECT pg_temp.caso(o.insurer_id, '2026-05-10 15:00-06'::timestamptz + make_interval(days => g), 80)
  FROM t JOIN organizations o ON o.id = t.org_b, generate_series(1, 3) g;
SELECT pg_temp.caso(o.insurer_id, '2026-05-10 15:00-06'::timestamptz + make_interval(days => g), 90)
  FROM t JOIN organizations o ON o.id = t.org_c, generate_series(1, 7) g;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como('d0d0d0d0-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------
-- A/B/C
-- ---------------------------------------------------------------
DO $$
DECLARE
  r JSONB := reinsurer_loss_report(2026, 2);
  a JSONB;
  b JSONB;
BEGIN
  SELECT e INTO a FROM jsonb_array_elements(r->'by_insurer') e WHERE e->>'insurer' = 'Siniestros A (prueba)';
  SELECT e INTO b FROM jsonb_array_elements(r->'by_insurer') e WHERE e->>'insurer' = 'Siniestros B (prueba)';
  ASSERT r->'previous'->>'quarter' = '1' AND r->'quarter'->>'from' = '2026-04-01', 'A: trimestres: ' || (r->'quarter')::text;
  ASSERT (a->'current'->>'services')::int = 6 AND (a->'current'->>'exposure')::int = 10, 'A: cifras Q2: ' || (a->'current')::text;
  ASSERT (a->'current'->>'frequency_per_1000')::numeric = 600 AND (a->'current'->>'severity')::numeric = 120
     AND (a->'current'->>'cost_per_member')::numeric = 72, 'A: frecuencia/severidad/costo por afiliado: ' || (a->'current')::text;
  ASSERT (a->'previous'->>'severity')::numeric = 100, 'A: Q1: ' || (a->'previous')::text;
  ASSERT (a->'change_pct'->>'services')::numeric = 20 AND (a->'change_pct'->>'severity')::numeric = 20
     AND (a->'change_pct'->>'cost')::numeric = 44, 'A: variación: ' || (a->'change_pct')::text;
  RAISE NOTICE 'A. frecuencia, severidad, costo por afiliado y variación contra Q1: OK';

  ASSERT (b->'current'->>'suppressed')::boolean AND b->'current'->'services' IS NULL, 'B: B (3) no se suprimió: ' || b::text;
  ASSERT b->'change_pct'->>'services' IS NULL, 'B: variación publicada con una celda suprimida';
  ASSERT (r->'total'->>'services')::int = 6 AND (r->'total'->>'suppressed_insurers')::int = 1, 'B: total: ' || (r->'total')::text;
  RAISE NOTICE 'B. supresión <5 y total sin la celda suprimida: OK';

  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'by_insurer') e WHERE e->>'insurer' LIKE 'Siniestros C%'),
         'C: aparece una cedente que no autorizó';
END $$;

SELECT pg_temp.como('d0d0d0d0-0000-4000-8000-000000000003');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN PERFORM reinsurer_loss_report(2026, 2); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'C: un usuario cualquiera pidió el reporte';
  RAISE NOTICE 'C. solo la reaseguradora y solo cedentes autorizadas: OK';
END $$;

ROLLBACK;
