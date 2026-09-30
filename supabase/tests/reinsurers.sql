-- =====================================================
-- Reaseguradoras (migr. 00131, backlog REA-01 / REA-02)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Sin autorización de la aseguradora, la reaseguradora no ve nada de ella.
--   B. Solo el dueño de la aseguradora (con 2FA) autoriza; queda la evidencia.
--   C. Agregados: celdas con menos de 5 casos suprimidas; el total suma solo lo
--      publicado; por servicio y por mes con la misma regla.
--   D. Ningún camino da casos individuales a la reaseguradora.
--   E. La vigencia del vínculo recorta los datos.
--   F. Revocar exige motivo y corta al instante; la evidencia no se edita.
--   G. La reaseguradora se da de alta en el checklist de VEN-03.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- 00153: el interruptor de aseguradoras viene apagado; estas pruebas las ejercitan.
UPDATE platform_features SET insurers_enabled = true;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal2') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('f6f6f6f6-0000-4000-8000-000000000001', 're.admin@budi.invalid',     'Admin'),
    ('f6f6f6f6-0000-4000-8000-000000000002', 're.dueno@budi.invalid',     'Dueño Rea'),
    ('f6f6f6f6-0000-4000-8000-000000000003', 're.analista@budi.invalid',  'Analista Rea'),
    ('f6f6f6f6-0000-4000-8000-000000000004', 'ase.a.dueno@budi.invalid',  'Dueño A'),
    ('f6f6f6f6-0000-4000-8000-000000000005', 'ase.a.admin@budi.invalid',  'Admin A'),
    ('f6f6f6f6-0000-4000-8000-000000000006', 'ase.b.dueno@budi.invalid',  'Dueño B'),
    ('f6f6f6f6-0000-4000-8000-000000000007', 're.usuario@budi.invalid',   'Usuario')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'ADMIN' WHERE id = 'f6f6f6f6-0000-4000-8000-000000000001';

CREATE TEMP TABLE t (rea UUID, org_a UUID, org_b UUID, org_c UUID, link_a UUID, link_b UUID, link_c UUID) ON COMMIT DROP;
INSERT INTO t DEFAULT VALUES;
GRANT ALL ON t TO PUBLIC;

-- Alta de todo por el admin.
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000001');
UPDATE t SET rea   = admin_create_institution('REINSURER', 'Reaseguros Prueba', NULL, NULL, NULL, NULL),
             org_a = admin_create_institution('INSURER', 'Cedente A (prueba)', NULL, NULL, NULL, NULL),
             org_b = admin_create_institution('INSURER', 'Cedente B (prueba)', NULL, NULL, NULL, NULL),
             org_c = admin_create_institution('INSURER', 'No cedente C (prueba)', NULL, NULL, NULL, NULL);
UPDATE t SET link_a = admin_set_reinsurer_link(rea, org_a, sv_today() - 60, NULL),
             link_b = admin_set_reinsurer_link(rea, org_b, sv_today() - 60, NULL),
             link_c = admin_set_reinsurer_link(rea, org_c, sv_today() - 60, NULL);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT o, p::uuid, r, 'active' FROM t, LATERAL (VALUES
  (t.rea,   'f6f6f6f6-0000-4000-8000-000000000002', 'owner'),
  (t.rea,   'f6f6f6f6-0000-4000-8000-000000000003', 'analyst'),
  (t.org_a, 'f6f6f6f6-0000-4000-8000-000000000004', 'owner'),
  (t.org_a, 'f6f6f6f6-0000-4000-8000-000000000005', 'admin'),
  (t.org_b, 'f6f6f6f6-0000-4000-8000-000000000006', 'owner')) AS x(o, p, r);

-- Padrón y casos: A con 6 grúas + 2 baterías, B con 3 grúas, C con 7 grúas.
CREATE TEMP TABLE afi (member_id UUID, insurer_id UUID) ON COMMIT DROP;
WITH ins AS (
  SELECT o.insurer_id, x.doc FROM t, LATERAL (VALUES (t.org_a, '0A'), (t.org_b, '0B'), (t.org_c, '0C')) AS x(org, doc)
  JOIN organizations o ON o.id = x.org
), plan AS (
  INSERT INTO coverage_plans (insurer_id, code, name) SELECT insurer_id, 'P' || doc, 'Plan ' || doc FROM ins RETURNING id, insurer_id
), regla AS (
  INSERT INTO coverage_rules (plan_id, service_type, rule_key, rule_value) SELECT id, NULL, 'covered', 1 FROM plan RETURNING plan_id
), pol AS (
  INSERT INTO policies (insurer_id, plan_id, policy_number, holder_name, starts_on, status)
  SELECT p.insurer_id, p.id, 'POL-REA-' || p.id, 'Titular', sv_today() - 90, 'active' FROM plan p JOIN regla r ON r.plan_id = p.id
  RETURNING id, insurer_id
), mem AS (
  INSERT INTO members (policy_id, document_number, full_name, relationship, starts_on, is_active)
  SELECT id, '09' || substr(md5(id::text), 1, 7), 'Afiliado', 'holder', sv_today() - 90, true FROM pol
  RETURNING id, policy_id
)
INSERT INTO afi SELECT mem.id, pol.insurer_id FROM mem JOIN pol ON pol.id = mem.policy_id;

-- Un servicio completado y cubierto, asignado 5 min después de pedirlo.
CREATE OR REPLACE FUNCTION pg_temp.caso(p_insurer UUID, p_service TEXT, p_covered NUMERIC) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_req UUID;
BEGIN
  INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price, completed_at,
                                created_at, assigned_at, activated_at, coverage_status)
  VALUES ('f6f6f6f6-0000-4000-8000-000000000007', 'completed', p_service, 'light', 'x', 13.70, -89.20, 'Zona',
          13.71, -89.21, 'Destino', 'Vehículo varado', p_covered, now(),
          now() - interval '60 minutes', now() - interval '55 minutes', now() - interval '30 minutes', 'covered')
  RETURNING id INTO v_req;
  INSERT INTO coverage_usage (member_id, request_id, service_type, used_on, amount_covered, amount_copay)
  SELECT member_id, v_req, p_service, sv_today(), p_covered, 0 FROM afi WHERE insurer_id = p_insurer;
END;
$$;
SELECT pg_temp.caso((SELECT insurer_id FROM organizations WHERE id = (SELECT org_a FROM t)), 'tow', 100) FROM generate_series(1, 6);
SELECT pg_temp.caso((SELECT insurer_id FROM organizations WHERE id = (SELECT org_a FROM t)), 'battery', 40) FROM generate_series(1, 2);
SELECT pg_temp.caso((SELECT insurer_id FROM organizations WHERE id = (SELECT org_b FROM t)), 'tow', 80) FROM generate_series(1, 3);
SELECT pg_temp.caso((SELECT insurer_id FROM organizations WHERE id = (SELECT org_c FROM t)), 'tow', 90) FROM generate_series(1, 7);

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------
-- A. Sin autorización no ve nada
-- ---------------------------------------------------------------
SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000003', 'aal1');  -- analista de la reaseguradora
DO $$
DECLARE d JSONB := reinsurer_dashboard(sv_today() - 30, sv_today());
BEGIN
  ASSERT jsonb_array_length(d->'cedents') = 3, 'A: no lista sus cedentes';
  ASSERT jsonb_array_length(d->'by_insurer') = 0, 'A: ve cifras sin autorización: ' || (d->'by_insurer')::text;
  ASSERT (d->'total'->>'services')::int = 0 AND jsonb_array_length(d->'by_service') = 0
     AND jsonb_array_length(d->'by_month') = 0, 'A: totales sin autorización';
END $$;

-- ---------------------------------------------------------------
-- B. Solo el dueño autoriza
-- ---------------------------------------------------------------
DO $$
DECLARE ok BOOLEAN;
BEGIN
  PERFORM pg_temp.como('f6f6f6f6-0000-4000-8000-000000000005');  -- administrador de A
  ok := false;
  BEGIN PERFORM portal_set_reinsurer_consent((SELECT link_a FROM t), true); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: el administrador (no dueño) autorizó';
  ASSERT jsonb_array_length(portal_reinsurer_links()->'links') = 1, 'B: el administrador de A no ve su vínculo';

  PERFORM pg_temp.como('f6f6f6f6-0000-4000-8000-000000000004', 'aal1');  -- dueño sin 2FA
  ok := false;
  BEGIN PERFORM portal_set_reinsurer_consent((SELECT link_a FROM t), true); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: el dueño autorizó sin 2FA';

  PERFORM pg_temp.como('f6f6f6f6-0000-4000-8000-000000000006');  -- dueño de B sobre el vínculo de A
  ok := false;
  BEGIN PERFORM portal_set_reinsurer_consent((SELECT link_a FROM t), true); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: una aseguradora autorizó por otra';
END $$;

SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000004');
SELECT portal_set_reinsurer_consent((SELECT link_a FROM t), true);
SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000006');
SELECT portal_set_reinsurer_consent((SELECT link_b FROM t), true);

DO $$
DECLARE h JSONB := portal_reinsurer_links()->'links'->0->'history';
BEGIN
  ASSERT h->0->>'action' = 'granted' AND h->0->>'actor_name' = 'Dueño B', 'B: sin evidencia del permiso: ' || h::text;
END $$;

-- ---------------------------------------------------------------
-- C. Agregados con supresión
-- ---------------------------------------------------------------
SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000003', 'aal1');
DO $$
DECLARE
  d JSONB := reinsurer_dashboard(sv_today() - 30, sv_today());
  a JSONB;
  b JSONB;
  tow JSONB;
  bat JSONB;
BEGIN
  SELECT e INTO a FROM jsonb_array_elements(d->'by_insurer') e WHERE e->>'insurer' = 'Cedente A (prueba)';
  SELECT e INTO b FROM jsonb_array_elements(d->'by_insurer') e WHERE e->>'insurer' = 'Cedente B (prueba)';
  ASSERT jsonb_array_length(d->'by_insurer') = 2, 'C: aparece la aseguradora que no autorizó';
  ASSERT (a->>'services')::int = 8 AND (a->>'cost')::numeric = 680 AND (a->>'avg_cost')::numeric = 85,
         'C: cifras de A: ' || a::text;
  ASSERT (a->>'per_1000_members')::numeric = 8000, 'C: frecuencia de A (8 servicios / 1 afiliado): ' || a::text;
  ASSERT (a->>'assignment_on_time_pct')::numeric = 100, 'C: SLA de A: ' || a::text;
  ASSERT (b->>'suppressed')::boolean AND b->'services' IS NULL AND b->'cost' IS NULL, 'C: B (3 casos) no se suprimió: ' || b::text;
  ASSERT (d->'total'->>'services')::int = 8 AND (d->'total'->>'suppressed_insurers')::int = 1,
         'C: el total incluye la celda suprimida: ' || (d->'total')::text;

  SELECT e INTO tow FROM jsonb_array_elements(d->'by_service') e WHERE e->>'service_type' = 'tow';
  SELECT e INTO bat FROM jsonb_array_elements(d->'by_service') e WHERE e->>'service_type' = 'battery';
  ASSERT (tow->>'services')::int = 9, 'C: grúas de A+B (sin C): ' || tow::text;
  ASSERT (bat->>'suppressed')::boolean AND bat->'cost' IS NULL, 'C: baterías (2) sin suprimir: ' || bat::text;
  ASSERT (d->'by_month'->0->>'services')::int = 11, 'C: mes: ' || (d->'by_month')::text;

  -- Ninguna llave de caso individual en todo el tablero.
  ASSERT NOT (d::text ~* 'folio|BUDI-|document|full_name|request_id|pickup|"id"'),
         'C: el tablero trae datos de casos: ' || d::text;
  RAISE NOTICE 'C. agregados con supresión (<5), total sin la celda suprimida, por servicio y por mes: OK';
END $$;

-- ---------------------------------------------------------------
-- D. Nada individual por ningún camino
-- ---------------------------------------------------------------
DO $$
DECLARE
  n INT;
  ok BOOLEAN;
BEGIN
  SELECT count(*) INTO n FROM service_requests;  ASSERT n = 0, 'D: la reaseguradora lee service_requests';
  SELECT count(*) INTO n FROM cases;             ASSERT n = 0, 'D: la reaseguradora lee cases';
  SELECT count(*) INTO n FROM members;           ASSERT n = 0, 'D: la reaseguradora lee members';
  BEGIN
    SELECT count(*) INTO n FROM coverage_usage;
    ASSERT n = 0, 'D: la reaseguradora lee coverage_usage';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ok := false;
  BEGIN SELECT count(*) INTO n FROM reinsurer_cedents; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'D: la tabla de vínculos es legible directo';
  ok := false;
  BEGIN PERFORM portal_insurer_cases(sv_today() - 30, sv_today()); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'D: la reaseguradora usa el listado de casos de aseguradoras';
  -- Una aseguradora no usa el tablero de reaseguradoras.
  PERFORM pg_temp.como('f6f6f6f6-0000-4000-8000-000000000004');
  ok := false;
  BEGIN PERFORM reinsurer_dashboard(sv_today() - 30, sv_today()); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'D: una aseguradora vio el tablero de reaseguro';
  RAISE NOTICE 'D. sin casos individuales para la reaseguradora: OK';
END $$;

-- ---------------------------------------------------------------
-- E. La vigencia recorta
-- ---------------------------------------------------------------
SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000001');
SELECT admin_set_reinsurer_link((SELECT rea FROM t), (SELECT org_a FROM t), sv_today() + 1, NULL);
SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000002');  -- dueño de la reaseguradora (aal2)
DO $$
DECLARE a JSONB;
BEGIN
  SELECT e INTO a FROM jsonb_array_elements(reinsurer_dashboard(sv_today() - 30, sv_today())->'by_insurer') e
   WHERE e->>'insurer' = 'Cedente A (prueba)';
  ASSERT (a->>'suppressed')::boolean, 'E: casos fuera de la vigencia siguen contando: ' || a::text;
END $$;
SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000001');
SELECT admin_set_reinsurer_link((SELECT rea FROM t), (SELECT org_a FROM t), sv_today() - 60, NULL);

-- ---------------------------------------------------------------
-- F. Revocar
-- ---------------------------------------------------------------
SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000004');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN PERFORM portal_set_reinsurer_consent((SELECT link_a FROM t), false, ''); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F: revocó sin motivo';
END $$;
SELECT portal_set_reinsurer_consent((SELECT link_a FROM t), false, 'Fin del contrato de reaseguro');
SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000003', 'aal1');
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(reinsurer_dashboard(sv_today() - 30, sv_today())->'by_insurer') e
                      WHERE e->>'insurer' = 'Cedente A (prueba)'), 'F: A sigue visible tras revocar';
END $$;
RESET ROLE;
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  ASSERT (SELECT count(*) FROM reinsurer_consent_events WHERE link_id = (SELECT link_a FROM t)) = 2, 'F: falta evidencia';
  BEGIN
    UPDATE reinsurer_consent_events SET reason = 'x' WHERE link_id = (SELECT link_a FROM t);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'F: la evidencia se pudo editar';
  RAISE NOTICE 'F. revocación con motivo, corte inmediato y evidencia inmutable: OK';
END $$;

-- ---------------------------------------------------------------
-- G. Checklist de alta
-- ---------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('f6f6f6f6-0000-4000-8000-000000000001');
DO $$
DECLARE s JSONB := admin_onboarding_status((SELECT rea FROM t));
BEGIN
  ASSERT jsonb_array_length(s->'steps') = 3 AND s->'steps'->2->>'key' = 'cedents', 'G: pasos de reaseguradora: ' || (s->'steps')::text;
  ASSERT (s->>'ready')::boolean, 'G: dueño + B autorizada y no queda lista: ' || (s->'steps')::text;
  ASSERT (SELECT steps_total FROM admin_onboarding_overview() WHERE organization_id = (SELECT rea FROM t)) = 3,
         'G: el resumen no incluye la reaseguradora';
  RAISE NOTICE 'G. alta de reaseguradora en el checklist: OK';
END $$;

ROLLBACK;
