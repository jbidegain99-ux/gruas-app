-- =====================================================
-- API y webhooks de la aseguradora (migr. 00129, backlog ASE-04)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Roles: solo dueño/administrador con 2FA administran integraciones.
--   B. URL: https pública; nada de localhost ni IPs privadas (SSRF).
--   C. El secreto y las entregas no se leen por la API, ni siquiera el admin.
--   D. Aislamiento: nada de otra aseguradora se lee ni se toca.
--   E. Eventos: un caso cubierto genera created/assigned/arrived/completed,
--      firmados; un caso de otra aseguradora no genera nada.
--   F. Rotación de claves con gracia; revocada o vencida deja de valer.
--   G. Reintentos: un 500 reprograma; al 6.º intento, falla.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- 00153: el interruptor de aseguradoras viene apagado; estas pruebas las ejercitan.
UPDATE platform_features SET insurers_enabled = true;

-- Este test prueba la regla de producción, aunque la base local permita
-- destinos locales.
SELECT set_config('app.webhooks_allow_local', 'off', true);

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal2') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO insurers (id, name, is_active) VALUES
  ('c3c3c3c3-0000-4000-8000-000000000001', 'Aseguradora Hook Uno (prueba)', true),
  ('c3c3c3c3-0000-4000-8000-000000000002', 'Aseguradora Hook Dos (prueba)', true);
INSERT INTO organizations (type, name, insurer_id)
SELECT 'INSURER', name, id FROM insurers WHERE id IN ('c3c3c3c3-0000-4000-8000-000000000001', 'c3c3c3c3-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('d4d4d4d4-0000-4000-8000-000000000001', 'wh.dueno@budi.invalid',    'Dueño Uno'),
    ('d4d4d4d4-0000-4000-8000-000000000002', 'wh.analista@budi.invalid', 'Analista Uno'),
    ('d4d4d4d4-0000-4000-8000-000000000003', 'wh.otro@budi.invalid',     'Dueño Dos'),
    ('d4d4d4d4-0000-4000-8000-000000000004', 'wh.admin@budi.invalid',    'Admin Budi'),
    ('d4d4d4d4-0000-4000-8000-000000000005', 'wh.usuario@budi.invalid',  'Usuario')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'ADMIN' WHERE id = 'd4d4d4d4-0000-4000-8000-000000000004';

INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT o.id, x.p::uuid, x.r, 'active'
  FROM (VALUES ('c3c3c3c3-0000-4000-8000-000000000001', 'd4d4d4d4-0000-4000-8000-000000000001', 'owner'),
               ('c3c3c3c3-0000-4000-8000-000000000001', 'd4d4d4d4-0000-4000-8000-000000000002', 'analyst'),
               ('c3c3c3c3-0000-4000-8000-000000000002', 'd4d4d4d4-0000-4000-8000-000000000003', 'owner')) AS x(i, p, r)
  JOIN organizations o ON o.insurer_id = x.i::uuid AND o.type = 'INSURER';

-- Un plan que cubre todo, póliza y afiliado para cada aseguradora.
WITH plan AS (
  INSERT INTO coverage_plans (insurer_id, code, name)
  VALUES ('c3c3c3c3-0000-4000-8000-000000000001', 'WH1', 'Plan Uno'),
         ('c3c3c3c3-0000-4000-8000-000000000002', 'WH2', 'Plan Dos') RETURNING id, insurer_id
), regla AS (
  INSERT INTO coverage_rules (plan_id, service_type, rule_key, rule_value)
  SELECT id, NULL, 'covered', 1 FROM plan RETURNING plan_id
), pol AS (
  INSERT INTO policies (insurer_id, plan_id, policy_number, holder_name, starts_on, status)
  SELECT p.insurer_id, p.id, 'POL-' || p.insurer_id, 'Titular', sv_today() - 30, 'active'
    FROM plan p JOIN regla r ON r.plan_id = p.id RETURNING id, insurer_id
)
INSERT INTO members (policy_id, document_number, full_name, relationship, starts_on, is_active)
SELECT pol.id, CASE WHEN insurer_id = 'c3c3c3c3-0000-4000-8000-000000000001' THEN '011111111' ELSE '022222222' END,
       'Afiliado', 'holder', sv_today() - 30, true FROM pol;

CREATE TEMP TABLE t (hook UUID, hook2 UUID, secret TEXT, key1 TEXT, key1_id UUID, key2 TEXT, key2_id UUID, req UUID, req2 UUID) ON COMMIT DROP;
INSERT INTO t DEFAULT VALUES;
GRANT ALL ON t TO PUBLIC;

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------
-- A. Roles
-- ---------------------------------------------------------------
DO $$
DECLARE ok BOOLEAN;
BEGIN
  PERFORM pg_temp.como('d4d4d4d4-0000-4000-8000-000000000002');  -- analista
  ok := false;
  BEGIN PERFORM portal_integrations(); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: el analista vio las integraciones';

  PERFORM pg_temp.como('d4d4d4d4-0000-4000-8000-000000000001', 'aal1');  -- dueño sin 2FA
  ok := false;
  BEGIN PERFORM portal_create_api_key('x'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: el dueño creó una clave sin 2FA';

  PERFORM pg_temp.como('d4d4d4d4-0000-4000-8000-000000000005');  -- usuario cualquiera
  ok := false;
  BEGIN PERFORM portal_integrations(); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: un usuario sin organización vio integraciones';
END $$;

-- ---------------------------------------------------------------
-- B. Validación de URL (SSRF)
-- ---------------------------------------------------------------
SELECT pg_temp.como('d4d4d4d4-0000-4000-8000-000000000001');
DO $$
DECLARE
  u TEXT;
  ok BOOLEAN;
BEGIN
  FOREACH u IN ARRAY ARRAY['http://hooks.aseguradora.com/x', 'https://localhost/x', 'https://127.0.0.1/x',
                           'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://169.254.169.254/latest',
                           'https://host.docker.internal:4555/x', 'https://kong:8000/x', 'https://[::1]/x',
                           'https://user@hooks.aseguradora.com/x', 'https://intranet/x', 'ftp://hooks.aseguradora.com']
  LOOP
    ok := false;
    BEGIN
      PERFORM portal_save_webhook(NULL, u, ARRAY['case.created'], NULL, true);
    EXCEPTION WHEN OTHERS THEN ok := true;
    END;
    ASSERT ok, format('B: se aceptó la URL %s', u);
  END LOOP;

  ASSERT webhook_url_ok('https://hooks.aseguradora.com.sv/budi?x=1'), 'B: rechazó una URL pública válida';
  ASSERT webhook_url_ok('https://8.8.8.8:8443/hook'), 'B: rechazó una IP pública';

  ok := false;
  BEGIN PERFORM portal_save_webhook(NULL, 'https://hooks.aseguradora.com/x', ARRAY['case.inventado'], NULL, true);
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: aceptó un evento inexistente';
END $$;

-- Alta válida: el secreto sale una sola vez.
UPDATE t SET (hook, secret) = (SELECT (r->>'id')::uuid, r->>'secret'
  FROM portal_save_webhook(NULL, 'https://hooks.aseguradora.com/budi',
                           ARRAY['case.created', 'case.assigned', 'case.arrived', 'case.completed'], 'ERP', true) r);

DO $$
BEGIN
  ASSERT (SELECT secret FROM t) LIKE 'whsec_%', 'B: no devolvió el secreto';
  ASSERT NOT (portal_integrations()::text LIKE '%' || (SELECT secret FROM t) || '%'), 'B: el listado expone el secreto';
END $$;

-- ---------------------------------------------------------------
-- C. Tablas cerradas por la API
-- ---------------------------------------------------------------
DO $$
DECLARE
  p UUID;
  ok BOOLEAN;
BEGIN
  FOREACH p IN ARRAY ARRAY['d4d4d4d4-0000-4000-8000-000000000001', 'd4d4d4d4-0000-4000-8000-000000000004']::uuid[] LOOP
    PERFORM pg_temp.como(p);
    ok := false;
    BEGIN PERFORM secret FROM insurer_webhooks; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
    ASSERT ok, 'C: insurer_webhooks legible por la API';
    ok := false;
    BEGIN PERFORM payload FROM webhook_deliveries; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
    ASSERT ok, 'C: webhook_deliveries legible por la API';
  END LOOP;
  ok := false;
  BEGIN PERFORM process_webhook_deliveries(); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'C: authenticated puede correr el despachador';
END $$;

-- ---------------------------------------------------------------
-- D. Aislamiento
-- ---------------------------------------------------------------
SELECT pg_temp.como('d4d4d4d4-0000-4000-8000-000000000001');
UPDATE t SET (key1_id, key1) = (SELECT (r->>'id')::uuid, r->>'key' FROM portal_create_api_key('ERP producción') r);

SELECT pg_temp.como('d4d4d4d4-0000-4000-8000-000000000003');  -- dueño de la otra
DO $$
DECLARE ok BOOLEAN;
BEGIN
  ASSERT jsonb_array_length(portal_integrations()->'webhooks') = 0, 'D: la otra aseguradora ve webhooks ajenos';
  ASSERT jsonb_array_length(portal_integrations()->'api_keys') = 0, 'D: la otra aseguradora ve claves ajenas';
  ok := false;
  BEGIN PERFORM portal_save_webhook((SELECT hook FROM t), 'https://atacante.com/x', ARRAY['case.created'], NULL, true);
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'D: editó el webhook ajeno';
  ok := false;
  BEGIN PERFORM portal_rotate_webhook_secret((SELECT hook FROM t)); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'D: rotó el secreto ajeno';
  ok := false;
  BEGIN PERFORM portal_revoke_api_key((SELECT key1_id FROM t)); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'D: revocó la clave ajena';
  ok := false;
  BEGIN PERFORM portal_rotate_api_key((SELECT key1_id FROM t), 0); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'D: rotó la clave ajena';
  ASSERT (SELECT count(*) FROM portal_webhook_deliveries((SELECT hook FROM t))) = 0, 'D: leyó entregas ajenas';
  ok := false;
  BEGIN PERFORM portal_test_webhook((SELECT hook FROM t)); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'D: disparó una prueba en el webhook ajeno';
END $$;

-- La otra aseguradora también escucha (para probar que no recibe lo ajeno).
UPDATE t SET hook2 = (SELECT (r->>'id')::uuid
  FROM portal_save_webhook(NULL, 'https://hooks.otra.com/budi', webhook_event_types(), NULL, true) r);

RESET ROLE;

-- ---------------------------------------------------------------
-- E. Eventos del caso
-- ---------------------------------------------------------------
-- Sin sesión (como el sistema): las transiciones directas solo las permite así.
SELECT set_config('request.jwt.claims', '', true);
-- Servicio cubierto por la Uno. Los triggers diferidos se disparan con
-- SET CONSTRAINTS ... IMMEDIATE (la transacción de prueba nunca hace commit).
INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                              dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price, coverage_status)
VALUES ('d4d4d4d4-0000-4000-8000-000000000005', 'initiated', 'tow', 'light', 'x', 13.70, -89.20, 'Prueba',
        13.71, -89.21, 'Destino', 'Vehículo varado', 60, 'covered');
UPDATE t SET req = (SELECT id FROM service_requests WHERE user_id = 'd4d4d4d4-0000-4000-8000-000000000005' ORDER BY created_at DESC LIMIT 1);
INSERT INTO coverage_usage (member_id, request_id, service_type, used_on, amount_covered, amount_copay)
SELECT m.id, t.req, 'tow', sv_today(), 60, 0 FROM members m, t WHERE m.document_number = '011111111';
SET CONSTRAINTS trg_enqueue_case_webhooks IMMEDIATE;

UPDATE service_requests SET status = 'assigned', assigned_at = now() WHERE id = (SELECT req FROM t);
UPDATE service_requests SET status = 'en_route' WHERE id = (SELECT req FROM t);
UPDATE service_requests SET status = 'active', activated_at = now() WHERE id = (SELECT req FROM t);
UPDATE service_requests SET status = 'completed', completed_at = now() WHERE id = (SELECT req FROM t);

DO $$
DECLARE
  d RECORD;
  v_events TEXT;
  n INT;
BEGIN
  SELECT string_agg(event, ',' ORDER BY event) INTO v_events
    FROM webhook_deliveries WHERE webhook_id = (SELECT hook FROM t);
  ASSERT (SELECT array_agg(event ORDER BY event) FROM webhook_deliveries WHERE webhook_id = (SELECT hook FROM t))
       = ARRAY['case.arrived', 'case.assigned', 'case.completed', 'case.created'],
         'E: eventos esperados created/assigned/arrived/completed, hubo ' || COALESCE(v_events, 'ninguno');

  -- La otra aseguradora escucha todo, pero el caso no es suyo.
  SELECT count(*) INTO n FROM webhook_deliveries WHERE webhook_id = (SELECT hook2 FROM t);
  ASSERT n = 0, 'E: la otra aseguradora recibió un caso ajeno';

  -- El cuerpo: lo que la aseguradora ya ve, sin datos del socio ni del Usuario.
  SELECT payload INTO STRICT d FROM webhook_deliveries
   WHERE webhook_id = (SELECT hook FROM t) AND event = 'case.completed';
  ASSERT (d.payload->'data'->>'folio') LIKE 'BUDI-%', 'E: falta el folio';
  ASSERT d.payload->'data'->>'member_document' = '011111111', 'E: falta el documento del afiliado';
  ASSERT d.payload->>'id' = (SELECT id::text FROM webhook_deliveries WHERE payload = d.payload), 'E: id del cuerpo distinto al de la entrega';
  ASSERT NOT (d.payload::text ~* 'operator|pin|phone|lat|lng|full_name|Usuario'), 'E: el cuerpo lleva datos de más: ' || d.payload::text;

  -- Todas quedaron encoladas en pg_net.
  ASSERT NOT EXISTS (SELECT 1 FROM webhook_deliveries WHERE webhook_id = (SELECT hook FROM t)
                      AND (status <> 'sending' OR net_request_id IS NULL)), 'E: una entrega no salió';
END $$;

-- Firma: se recalcula igual que el receptor (t.cuerpo con el secreto).
DO $$
DECLARE
  v_req BIGINT;
  v_sig TEXT;
  v_t   TEXT;
  v_body TEXT;
BEGIN
  SELECT net_request_id, payload::text INTO v_req, v_body FROM webhook_deliveries
   WHERE webhook_id = (SELECT hook FROM t) AND event = 'case.created';
  SELECT headers->>'X-Budi-Signature', convert_from(body, 'UTF8') INTO v_sig, v_body
    FROM net.http_request_queue WHERE id = v_req;
  v_t := substring(v_sig FROM 't=([0-9]+)');
  ASSERT v_sig = 't=' || v_t || ',v1=' || encode(extensions.hmac(v_t || '.' || v_body, (SELECT secret FROM t), 'sha256'), 'hex'),
         'E: la firma no corresponde al cuerpo enviado';
END $$;

-- Un webhook desactivado no recibe.
UPDATE insurer_webhooks SET is_active = false WHERE id = (SELECT hook FROM t);
UPDATE service_requests SET status = 'cancelled', cancelled_at = now() WHERE id = (SELECT req FROM t);
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM webhook_deliveries WHERE event = 'case.cancelled' AND webhook_id = (SELECT hook FROM t)),
         'E: un webhook desactivado recibió un evento';
END $$;
UPDATE insurer_webhooks SET is_active = true WHERE id = (SELECT hook FROM t);

-- ---------------------------------------------------------------
-- F. Claves: rotación con gracia, revocación, vencimiento
-- ---------------------------------------------------------------
DO $$
BEGIN
  ASSERT verify_insurer_api_key((SELECT key1 FROM t)) = 'c3c3c3c3-0000-4000-8000-000000000001', 'F: la clave nueva no valida';
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como('d4d4d4d4-0000-4000-8000-000000000001');
UPDATE t SET (key2_id, key2) = (SELECT (r->>'id')::uuid, r->>'key' FROM portal_rotate_api_key((SELECT key1_id FROM t), 24) r);
RESET ROLE;

DO $$
BEGIN
  ASSERT verify_insurer_api_key((SELECT key1 FROM t)) IS NOT NULL, 'F: la clave rotada murió antes de la gracia';
  ASSERT verify_insurer_api_key((SELECT key2 FROM t)) = 'c3c3c3c3-0000-4000-8000-000000000001', 'F: la clave de reemplazo no valida';
  ASSERT (SELECT name FROM insurer_api_keys WHERE key_prefix = left((SELECT key2 FROM t), 12)) = 'ERP producción',
         'F: el reemplazo no conserva el nombre';
  -- Pasada la gracia deja de valer.
  UPDATE insurer_api_keys SET expires_at = now() - interval '1 second' WHERE id = (SELECT key1_id FROM t);
  ASSERT verify_insurer_api_key((SELECT key1 FROM t)) IS NULL, 'F: la clave vencida sigue valiendo';
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como('d4d4d4d4-0000-4000-8000-000000000001');
SELECT portal_revoke_api_key((SELECT key2_id FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  -- Revocada y vencida ya no se pueden rotar.
  BEGIN PERFORM portal_rotate_api_key((SELECT key2_id FROM t), 24); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F: rotó una clave revocada';
END $$;
RESET ROLE;
DO $$
BEGIN
  ASSERT verify_insurer_api_key((SELECT key2 FROM t)) IS NULL, 'F: la clave revocada sigue valiendo';
END $$;

-- ---------------------------------------------------------------
-- G. Reintentos
-- ---------------------------------------------------------------
-- Se simulan las respuestas de pg_net: 500 para una, 200 para otra.
DO $$
DECLARE
  v_fail UUID;
  v_ok   UUID;
  r JSONB;
BEGIN
  SELECT id INTO v_fail FROM webhook_deliveries WHERE webhook_id = (SELECT hook FROM t) AND event = 'case.assigned';
  SELECT id INTO v_ok   FROM webhook_deliveries WHERE webhook_id = (SELECT hook FROM t) AND event = 'case.created';
  INSERT INTO net._http_response (id, status_code, content, timed_out)
  SELECT net_request_id, CASE WHEN id = v_fail THEN 500 ELSE 200 END, '', false
    FROM webhook_deliveries WHERE id IN (v_fail, v_ok);

  r := process_webhook_deliveries();
  ASSERT (SELECT status FROM webhook_deliveries WHERE id = v_ok) = 'delivered', 'G: un 200 no quedó entregado';
  ASSERT (SELECT status = 'pending' AND last_error = 'HTTP 500' AND next_attempt_at > now()
            FROM webhook_deliveries WHERE id = v_fail), 'G: un 500 no se reprogramó';

  -- En el 6.º intento fallido se da por perdida.
  UPDATE webhook_deliveries SET attempts = 6, status = 'sending', sent_at = now() - interval '5 minutes', net_request_id = -1
   WHERE id = v_fail;
  r := process_webhook_deliveries();
  ASSERT (SELECT status FROM webhook_deliveries WHERE id = v_fail) = 'failed', 'G: siguió reintentando tras 6 intentos';
END $$;

-- Reenviar a mano la fallida la vuelve a mandar.
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('d4d4d4d4-0000-4000-8000-000000000001');
SELECT portal_redeliver_webhook((SELECT id FROM portal_webhook_deliveries((SELECT hook FROM t)) WHERE event = 'case.assigned'));
DO $$
BEGIN
  ASSERT (SELECT status FROM portal_webhook_deliveries((SELECT hook FROM t)) WHERE event = 'case.assigned') = 'sending',
         'G: el reenvío manual no salió';
END $$;

ROLLBACK;
