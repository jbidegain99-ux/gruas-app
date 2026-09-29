-- =====================================================
-- Reporte mensual MOPT (migr. 00134, backlog MOPT-06)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte (el correo encolado en pg_net
-- se descarta con el ROLLBACK: nunca sale).
--
--   A. El job genera la foto del mes anterior: resumen, costo y anexo sin
--      datos del Usuario.
--   B. Correo: sin configurar queda "sin enviar"; configurado se encola a
--      dueño y administradores con el enlace al reporte.
--   C. El job no reenvía un mes ya enviado.
--   D. Portal: cada programa ve solo lo suyo; la foto no cambia si después se
--      corrige un dato; el mes en curso se calcula en vivo.
--   E. Solo el admin regenera.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal2') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('b8b8b8b8-0000-4000-8000-000000000001', 'rm.admin@budi.invalid',    'Admin'),
    ('b8b8b8b8-0000-4000-8000-000000000002', 'rm.dueno@budi.invalid',    'Dueña MOPT'),
    ('b8b8b8b8-0000-4000-8000-000000000003', 'rm.analista@budi.invalid', 'Analista MOPT'),
    ('b8b8b8b8-0000-4000-8000-000000000004', 'rm.socio@budi.invalid',    'Socio MOPT'),
    ('b8b8b8b8-0000-4000-8000-000000000005', 'rm.usuario@budi.invalid',  'Juana Pérez'),
    ('b8b8b8b8-0000-4000-8000-000000000006', 'rm.otro@budi.invalid',     'Analista de otro programa')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'ADMIN' WHERE id = 'b8b8b8b8-0000-4000-8000-000000000001';
UPDATE profiles SET role = 'OPERATOR' WHERE id = 'b8b8b8b8-0000-4000-8000-000000000004';

CREATE TEMP TABLE t (org UUID, prov UUID, org2 UUID, mes DATE, req UUID) ON COMMIT DROP;
INSERT INTO t (mes) VALUES ((date_trunc('month', sv_today()) - interval '1 month')::date);
GRANT ALL ON t TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como('b8b8b8b8-0000-4000-8000-000000000001');
UPDATE t SET org = admin_create_institution('MOPT', 'MOPT Reportes (prueba)', NULL, NULL, NULL, NULL),
             org2 = admin_create_institution('MOPT', 'MOPT Otro (prueba)', NULL, NULL, NULL, NULL);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE t SET prov = (SELECT provider_id FROM organizations WHERE id = t.org);

INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT o, p::uuid, r, 'active' FROM t, LATERAL (VALUES
  (t.org,  'b8b8b8b8-0000-4000-8000-000000000002', 'owner'),
  (t.org,  'b8b8b8b8-0000-4000-8000-000000000003', 'analyst'),
  (t.org2, 'b8b8b8b8-0000-4000-8000-000000000006', 'analyst')) AS x(o, p, r);
INSERT INTO mopt_zones (provider_id, name, polygon, service_types, is_active)
SELECT prov, 'Tramo de prueba', '[[13.20,-87.90],[13.20,-87.80],[13.30,-87.80],[13.30,-87.90]]'::jsonb, NULL, true FROM t;

-- Dos servicios del mes anterior (uno a tiempo, otro tarde) y uno de este mes.
CREATE OR REPLACE FUNCTION pg_temp.caso(p_done TIMESTAMPTZ, p_asig_min INT, p_price NUMERIC) RETURNS UUID LANGUAGE sql AS $$
  INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng,
                                pickup_address, dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price,
                                vehicle_plate, created_at, assigned_at, activated_at, completed_at, mopt_provider_id)
  VALUES ('b8b8b8b8-0000-4000-8000-000000000005', 'b8b8b8b8-0000-4000-8000-000000000004', 'completed', 'tow', 'light', 'x',
          13.25, -87.85, 'Km 12', 13.26, -87.86, 'Plantel', 'Vehículo varado', p_price, 'P123-456',
          p_done - interval '90 minutes', p_done - interval '90 minutes' + make_interval(mins => p_asig_min),
          p_done - interval '40 minutes', p_done, (SELECT prov FROM t))
  RETURNING id;
$$;
UPDATE t SET req = pg_temp.caso(sv_day_start(t.mes) + interval '5 days', 5, 100);
SELECT pg_temp.caso(sv_day_start(t.mes) + interval '12 days', 25, 80) FROM t;
SELECT pg_temp.caso(now() - interval '1 hour', 5, 60);

-- ---------------------------------------------------------------
-- A/B. Job sin correo configurado
-- ---------------------------------------------------------------
SELECT mopt_monthly_reports_job();
DO $$
DECLARE
  r JSONB := (SELECT report FROM mopt_reports WHERE provider_id = (SELECT prov FROM t) AND month = (SELECT mes FROM t));
BEGIN
  ASSERT r IS NOT NULL, 'A: el job no generó el reporte del mes anterior';
  ASSERT (r->'compliance'->>'completed')::int = 2, 'A: servicios del mes: ' || (r->'compliance')::text;
  ASSERT (r->'compliance'->>'assignment_met_pct')::numeric = 50, 'A: SLA de asignación (1 de 2): ' || (r->'compliance')::text;
  ASSERT (r->'cost'->>'services')::numeric = 180, 'A: costo de servicios: ' || (r->'cost')::text;
  ASSERT jsonb_array_length(r->'annex') = 2 AND r->'annex'->0->>'zone' = 'Tramo de prueba', 'A: anexo: ' || (r->'annex')::text;
  ASSERT NOT (r::text ~* 'Juana|P123|rm\.usuario|phone|pickup_address'), 'A: el reporte trae datos del Usuario: ' || r::text;
  ASSERT (SELECT email_status FROM mopt_reports WHERE provider_id = (SELECT prov FROM t) AND month = (SELECT mes FROM t))
         LIKE 'sin enviar: falta configurar el correo%', 'B: sin correo configurado no dice que falta';
  RAISE NOTICE 'A. foto del mes anterior con resumen, costo y anexo sin datos del Usuario: OK';
END $$;

-- ---------------------------------------------------------------
-- B/C. Con correo configurado
-- ---------------------------------------------------------------
SELECT vault.create_secret('re_prueba_no_real', 'resend_api_key'),
       vault.create_secret('reportes@budi.invalid', 'report_from_email'),
       vault.create_secret('https://portal.budi.invalid', 'app_base_url');
SELECT mopt_monthly_reports_job();
DO $$
DECLARE
  q RECORD;
  n INT;
BEGIN
  ASSERT (SELECT email_status FROM mopt_reports WHERE provider_id = (SELECT prov FROM t) AND month = (SELECT mes FROM t)) = 'enviado',
         'B: no se envió con el correo configurado';
  SELECT * INTO q FROM net.http_request_queue WHERE url = 'https://api.resend.com/emails'
     AND convert_from(body, 'UTF8') LIKE '%MOPT Reportes (prueba)%' ORDER BY id DESC LIMIT 1;
  ASSERT q.id IS NOT NULL, 'B: no se encoló el correo';
  ASSERT convert_from(q.body, 'UTF8') LIKE '%rm.dueno@budi.invalid%' AND convert_from(q.body, 'UTF8') NOT LIKE '%rm.analista%',
         'B: destinatarios (solo dueño/admin): ' || convert_from(q.body, 'UTF8');
  ASSERT convert_from(q.body, 'UTF8') LIKE '%https://portal.budi.invalid/mopt/reportes/' || to_char((SELECT mes FROM t), 'YYYY-MM') || '%',
         'B: el correo no trae el enlace al reporte';
  -- C. Otra corrida no reenvía.
  SELECT count(*) INTO n FROM net.http_request_queue WHERE url = 'https://api.resend.com/emails';
  PERFORM mopt_monthly_reports_job();
  ASSERT (SELECT count(*) FROM net.http_request_queue WHERE url = 'https://api.resend.com/emails'
            AND convert_from(body, 'UTF8') LIKE '%MOPT Reportes (prueba)%') = 1, 'C: reenvió un mes ya enviado';
  RAISE NOTICE 'B/C. correo a dueño/admin con enlace, sin reenvíos: OK';
END $$;

-- ---------------------------------------------------------------
-- D. Portal
-- ---------------------------------------------------------------
UPDATE service_requests SET total_price = 999 WHERE id = (SELECT req FROM t);  -- corrección posterior
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('b8b8b8b8-0000-4000-8000-000000000003', 'aal1');  -- analista del programa
DO $$
DECLARE
  r JSONB := mopt_report(to_char((SELECT mes FROM t), 'YYYY-MM'));
  hoy JSONB := mopt_report(to_char(sv_today(), 'YYYY-MM'));
BEGIN
  ASSERT (r->>'snapshot')::boolean AND (r->'cost'->>'services')::numeric = 180, 'D: la foto cambió tras corregir un dato: ' || (r->'cost')::text;
  ASSERT NOT (hoy->>'snapshot')::boolean AND (hoy->'compliance'->>'completed')::int = 1, 'D: el mes en curso no se calcula en vivo';
  ASSERT (SELECT count(*) FROM mopt_reports_list() WHERE month = to_char((SELECT mes FROM t), 'YYYY-MM') AND email_status = 'enviado') = 1,
         'D: la lista no muestra el mes enviado';
END $$;
SELECT pg_temp.como('b8b8b8b8-0000-4000-8000-000000000006', 'aal1');  -- de otro programa
DO $$
BEGIN
  ASSERT (mopt_report(to_char((SELECT mes FROM t), 'YYYY-MM'))->'compliance'->>'completed')::int = 0,
         'D: un programa vio los servicios de otro';
  RAISE NOTICE 'D. foto inmutable, mes en curso en vivo, aislamiento entre programas: OK';
END $$;

-- ---------------------------------------------------------------
-- E. Solo el admin regenera
-- ---------------------------------------------------------------
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN PERFORM admin_generate_mopt_report((SELECT prov FROM t), '2026-01', false); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'E: un miembro del portal regeneró un reporte';
END $$;
SELECT pg_temp.como('b8b8b8b8-0000-4000-8000-000000000001');
SELECT admin_generate_mopt_report((SELECT prov FROM t), to_char((SELECT mes FROM t), 'YYYY-MM'), false);
RESET ROLE;
DO $$
BEGIN
  ASSERT (SELECT (report->'cost'->>'services')::numeric FROM mopt_reports
           WHERE provider_id = (SELECT prov FROM t) AND month = (SELECT mes FROM t)) = 1079, 'E: regenerar no tomó la corrección';
  RAISE NOTICE 'E. el admin regenera con la corrección: OK';
END $$;

ROLLBACK;
