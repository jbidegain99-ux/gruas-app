-- =====================================================
-- Auditoría del programa MOPT (migr. 00141)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Un Usuario no inserta solicitudes a mano (cortesía y deuda inventadas).
--   B. Pagos a socios: solo dueño o administrador del portal.
--   C. Estado de cuenta: no se aprueba con observaciones abiertas y, cerrado,
--      Budi ya no las responde.
--   D. Afiliado sin servicios del año en zona MOPT: paga el programa.
--   E. Tope charge_user con servicios en curso; programa suspendido.
--   F. Reporte oficial solo de meses cerrados; zona 00:00–00:00 = 24 h;
--      Servicios por fecha de cierre; SLA con el nombre del programa.
--   G. (00142) En curso sin importar la fecha de pedido; turno nocturno con
--      días; las vistas previas siguen andando con el candado del tope.
--   H. (00144) Avisos push: sin "grúa" y sin avisarle al socio lo que él hizo.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal2') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

-- Programa MOPT propio del test, con una zona siempre abierta.
INSERT INTO providers (id, name, is_active, is_mopt, tow_type_supported)
VALUES ('9a9a9a9a-0000-4000-8000-000000000001', 'MOPT de prueba (auditoría)', true, true, 'both');
INSERT INTO organizations (type, name, provider_id)
VALUES ('MOPT', 'MOPT de prueba (auditoría)', '9a9a9a9a-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO mopt_zones (provider_id, name, polygon, is_active)
VALUES ('9a9a9a9a-0000-4000-8000-000000000001', 'Zona auditoría',
        '[[11.00, -81.00], [11.00, -80.90], [11.10, -80.90], [11.10, -81.00]]'::jsonb, true);

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated', x.email,
       jsonb_build_object('full_name', x.nombre) || x.meta, now(), now()
  FROM (VALUES
    ('9a9a9a9a-0000-4000-8000-0000000000b1'::uuid, 'au.admin@budi.invalid',   'Admin auditoría',  '{}'::jsonb),
    ('9a9a9a9a-0000-4000-8000-0000000000b2'::uuid, 'au.dueno@budi.invalid',   'Dueña MOPT',       '{}'::jsonb),
    ('9a9a9a9a-0000-4000-8000-0000000000b3'::uuid, 'au.lector@budi.invalid',  'Lector MOPT',      '{}'::jsonb),
    ('9a9a9a9a-0000-4000-8000-0000000000b4'::uuid, 'au.usuario@budi.invalid', 'Usuario prueba',   '{}'::jsonb),
    ('9a9a9a9a-0000-4000-8000-0000000000b5'::uuid, 'au.socio@budi.invalid',   'Socio de la flota', '{"role": "OPERATOR"}'::jsonb)
  ) AS x(id, email, nombre, meta);

CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT (SELECT id FROM organizations WHERE provider_id = '9a9a9a9a-0000-4000-8000-000000000001' AND type = 'MOPT' LIMIT 1) AS org,
       '9a9a9a9a-0000-4000-8000-000000000001'::uuid AS prov,
       '9a9a9a9a-0000-4000-8000-0000000000b1'::uuid AS admin,
       '9a9a9a9a-0000-4000-8000-0000000000b2'::uuid AS dueno,
       '9a9a9a9a-0000-4000-8000-0000000000b3'::uuid AS lector,
       '9a9a9a9a-0000-4000-8000-0000000000b4'::uuid AS usuario,
       '9a9a9a9a-0000-4000-8000-0000000000b5'::uuid AS socio,
       NULL::uuid AS caso, NULL::uuid AS pago, NULL::uuid AS ec, NULL::uuid AS obs, NULL::text AS folio;
GRANT SELECT, UPDATE ON t TO PUBLIC;

UPDATE profiles SET role = 'ADMIN' WHERE id = (SELECT admin FROM t);
UPDATE profiles SET provider_id = (SELECT prov FROM t), verification_status = 'approved' WHERE id = (SELECT socio FROM t);
INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT org, dueno, 'owner', 'active' FROM t UNION ALL
SELECT org, lector, 'viewer', 'active' FROM t;

-- Un servicio del programa completado hoy por $80.
WITH sr AS (
  INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng,
                                pickup_address, dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price,
                                created_at, assigned_at, activated_at, completed_at, mopt_provider_id)
  SELECT usuario, socio, 'completed', 'tow', 'light', 'x', 11.05, -80.95, 'Zona auditoría', 11.06, -80.96, 'Destino',
         'Vehículo varado', 80, now() - interval '1 hour', now() - interval '55 minutes', now() - interval '30 minutes',
         now() - interval '5 minutes', prov
    FROM t
  RETURNING id
)
UPDATE t SET caso = (SELECT id FROM sr);

SET LOCAL ROLE authenticated;

-- A. INSERT directo: sin permiso aunque la fila sea "suya".
SELECT pg_temp.como((SELECT usuario FROM t), 'aal1');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO service_requests (user_id, status, tow_type, pickup_lat, pickup_lng, pickup_address,
                                  dropoff_lat, dropoff_lng, dropoff_address, mopt_provider_id, total_price, completed_at)
    VALUES ((SELECT usuario FROM t), 'completed', 'light', 13.99, -89.55, 'Fuera de zona', 13.70, -89.20, 'SS',
            (SELECT prov FROM t), 5000, now());
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'A: un Usuario inserto una solicitud completada a cargo del MOPT';
  RAISE NOTICE 'A. solicitudes solo por create_service_request: OK';
END $$;

-- B. Pagos: el lector no registra ni anula; la dueña (2FA) sí.
SELECT pg_temp.como((SELECT lector FROM t), 'aal1');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM register_ledger_payment('mopt', (SELECT prov FROM t), 'operator', (SELECT socio FROM t), 10, NULL, 'LECTOR', NULL);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Solo el dueño o un administrador%';
  END;
  ASSERT ok, 'B1: el lector registro un pago';
END $$;

SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
BEGIN
  UPDATE t SET pago = register_ledger_payment('mopt', (SELECT prov FROM t), 'operator', (SELECT socio FROM t), 30, NULL, 'TRF-AU', NULL);
  ASSERT (SELECT pago FROM t) IS NOT NULL, 'B2: la duena no pudo registrar';
END $$;

SELECT pg_temp.como((SELECT lector FROM t), 'aal1');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM void_ledger_payment((SELECT pago FROM t), 'lo anulo yo');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Solo el dueño o un administrador%';
  END;
  ASSERT ok, 'B3: el lector anulo un pago';
END $$;

SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
SELECT void_ledger_payment((SELECT pago FROM t), 'Monto mal cargado');
DO $$ BEGIN RAISE NOTICE 'B. pagos a socios solo dueno o administrador: OK'; END $$;

-- C. Estado de cuenta con una observación abierta.
SELECT pg_temp.como((SELECT admin FROM t));
DO $$
BEGIN
  UPDATE t SET ec = admin_generate_statement((SELECT org FROM t), sv_today(), sv_today());
  PERFORM admin_issue_statement((SELECT ec FROM t));
END $$;

SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  UPDATE t SET obs = observe_statement_case((SELECT ec FROM t), (SELECT caso FROM t), 'El socio llegó tarde');
  BEGIN
    PERFORM approve_statement((SELECT ec FROM t));
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Hay 1 caso(s) observado(s)%';
  END;
  ASSERT ok, 'C1: se aprobo con una observacion abierta';
END $$;

SELECT pg_temp.como((SELECT admin FROM t));
SELECT admin_answer_observation((SELECT obs FROM t), 'Revisado el GPS: llegó tarde; se ajusta', 'adjusted', 20);

SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
DECLARE v NUMERIC;
BEGIN
  v := approve_statement((SELECT ec FROM t));
  ASSERT v = 20, 'C2: no aprobo el monto ajustado';
  -- 00149: el desglose (servicios + tarifa) suma lo aprobado, y por socio también.
  ASSERT (SELECT (x->>'approvable_amount')::numeric + (x->>'approvable_fee')::numeric
            FROM (SELECT statement_detail((SELECT ec FROM t))->'totals' AS x) q) = v,
    'C2: el desglose del estado de cuenta no suma el total aprobado';
  ASSERT (SELECT (p->>'approved_amount')::numeric FROM jsonb_array_elements(statement_detail((SELECT ec FROM t))->'by_provider') p) = 20,
    'C2: por proveedor muestra el original y no lo aprobado';
  ASSERT (SELECT (x->>'provider_id')::uuid FROM jsonb_array_elements(statement_detail((SELECT ec FROM t))->'by_provider') x)
         = (SELECT socio FROM t), 'C3: by_provider sin el id del socio';
END $$;

SELECT pg_temp.como((SELECT admin FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_answer_observation((SELECT obs FROM t), 'Mejor lo ajusto', 'adjusted', 1);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'El estado de cuenta ya no está emitido%';
  END;
  ASSERT ok, 'C4: Budi cambio una observacion de un estado aprobado';
END $$;

-- C5 (00143): el libro le debe al socio lo aprobado, no el original.
RESET ROLE;
DO $$
BEGIN
  ASSERT (SELECT amount FROM ledger_obligations()
           WHERE request_id = (SELECT caso FROM t) AND concept = 'servicio' AND debtor_kind = 'mopt') = 20,
    'C5: el libro sigue con el monto original del caso ajustado';
END $$;

-- C6 (00146): las ganancias del socio también cuentan el monto aprobado.
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT socio FROM t), 'aal1');
DO $$
BEGIN
  ASSERT (SELECT a_pagar FROM my_operator_earnings(sv_today() - 1, sv_today() + 1)) = 20,
    'C6: la app del socio muestra el monto original y no el aprobado por el MOPT';
END $$;

-- C8 (00148): la línea del historial del socio también.
SELECT pg_temp.como((SELECT socio FROM t), 'aal1');
DO $$
BEGIN
  ASSERT (SELECT a_cobrar FROM my_operator_service_earnings(ARRAY[(SELECT caso FROM t)])) = 20,
    'C8: el historial del socio muestra el monto original del caso ajustado';
END $$;

-- C7 (00147): el portal MOPT (detalle y lista) muestra el monto aprobado.
SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
BEGIN
  ASSERT (mopt_service_detail((SELECT caso FROM t))->>'amount_due')::numeric = 20,
    'C7: el detalle del portal MOPT muestra el monto original';
  ASSERT (mopt_service_detail((SELECT caso FROM t))->>'adjusted_in') IS NOT NULL,
    'C7: el detalle no dice en qué estado de cuenta se ajustó';
  ASSERT (SELECT total_price FROM mopt_list_services(sv_today() - 1, sv_today() + 1) WHERE id = (SELECT caso FROM t)) = 20,
    'C7: la lista de Servicios suma el monto original';
  -- C8 (00148): resumen del portal con lo aprobado.
  ASSERT (mopt_overview()->>'amount_month')::numeric = 20,
    'C8: el resumen del portal suma el monto original';
  RAISE NOTICE 'C. se aprueba sin observaciones abiertas, cerrado no se mueve y libro, socio y portal siguen al ajuste: OK';
END $$;
RESET ROLE;

RESET ROLE;

-- D. Afiliado con 1 servicio al año, ya usado: en la zona MOPT paga el programa.
CREATE TEMP TABLE afi ON COMMIT DROP AS
WITH plan AS (
  INSERT INTO coverage_plans (insurer_id, code, name)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'AU-1', 'Plan un servicio') RETURNING id
), r AS (
  INSERT INTO coverage_rules (plan_id, service_type, rule_key, rule_value)
  SELECT id, NULL, 'covered', 1 FROM plan UNION ALL
  SELECT id, NULL, 'services_per_year', 1 FROM plan
  RETURNING plan_id
), pol AS (
  INSERT INTO policies (insurer_id, plan_id, policy_number, holder_name, starts_on, status)
  SELECT 'a0000000-0000-0000-0000-000000000001', id, 'POL-AU-1', 'Titular', sv_today() - 30, 'active'
    FROM plan WHERE EXISTS (SELECT 1 FROM r)
  RETURNING id, plan_id
), mem AS (
  INSERT INTO members (policy_id, document_number, full_name, relationship, starts_on, is_active)
  SELECT id, '099999999', 'Afiliado auditoría', 'holder', sv_today() - 30, true FROM pol
  RETURNING id, policy_id
)
SELECT mem.id AS member_id, pol.plan_id FROM mem JOIN pol ON pol.id = mem.policy_id;

DO $$
DECLARE cob JSONB := (SELECT jsonb_build_object('status', 'covered', 'member_id', member_id, 'plan_id', plan_id) FROM afi);
BEGIN
  ASSERT mopt_payer_for(cob, 11.05, -80.95, 'tow') IS NULL, 'D1: con servicios disponibles pago el MOPT';
  INSERT INTO coverage_usage (member_id, request_id, service_type, used_on)
  SELECT member_id, (SELECT caso FROM t), 'tow', sv_today() FROM afi;
  ASSERT mopt_payer_for(cob, 11.05, -80.95, 'tow') = (SELECT prov FROM t), 'D2: agotado el año, el Usuario pagaba todo en zona MOPT';
  RAISE NOTICE 'D. limite anual agotado en zona MOPT: paga el programa: OK';
END $$;

-- E. Tope $150 que corta: $80 cerrado + un servicio en curso (precio base) lo alcanza.
UPDATE services SET base_price = 75 WHERE slug = 'tow';
INSERT INTO organization_contracts (organization_id, reference, valid_from, monthly_cap, on_cap)
SELECT org, 'AU-001', sv_today() - 30, 150, 'charge_user' FROM t;
DO $$
BEGIN
  ASSERT mopt_program_for(11.05, -80.95, 'tow') = (SELECT prov FROM t), 'E1: con margen se corto la cortesia';
  INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type, mopt_provider_id)
  SELECT usuario, 'assigned', 'tow', 'light', 'x', 11.05, -80.95, 'Zona auditoría', 11.06, -80.96, 'Destino',
         'Vehículo varado', prov FROM t;
  ASSERT mopt_program_for(11.05, -80.95, 'tow') IS NULL, 'E2: los servicios en curso no cuentan contra el tope';
  DELETE FROM organization_contracts WHERE organization_id = (SELECT org FROM t);
  ASSERT mopt_program_for(11.05, -80.95, 'tow') = (SELECT prov FROM t), 'E3: sin contrato se perdio la cortesia';
  UPDATE organizations SET status = 'suspended' WHERE id = (SELECT org FROM t);
  ASSERT mopt_program_for(11.05, -80.95, 'tow') IS NULL, 'E4: un programa suspendido sigue dando cortesia';
  UPDATE organizations SET status = 'active' WHERE id = (SELECT org FROM t);
  RAISE NOTICE 'E. tope con servicios en curso y programa suspendido: OK';
END $$;

-- F. Reporte, horario, corte de Servicios y SLA.
DO $$
BEGIN
  ASSERT mopt_zone_open_now('00:00', '00:00', NULL), 'F1: 00:00-00:00 no abre nunca';
  ASSERT mopt_zone_open_now('06:00', '06:00', NULL), 'F1: 06:00-06:00 no abre nunca';
END $$;

-- Pedido el mes pasado, cerrado este mes: cuenta en este mes.
UPDATE service_requests
   SET created_at = sv_day_start(date_trunc('month', sv_today())::date) - interval '10 minutes',
       completed_at = sv_day_start(date_trunc('month', sv_today())::date) + interval '30 minutes'
 WHERE id = (SELECT caso FROM t);
UPDATE t SET folio = (SELECT folio FROM cases WHERE request_id = t.caso);

SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT admin FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_generate_mopt_report((SELECT prov FROM t), to_char(sv_today(), 'YYYY-MM'), false);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Solo se genera el reporte de un mes que ya cerró%';
  END;
  ASSERT ok, 'F2: se congelo como oficial el mes en curso';
END $$;

SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
DECLARE ini DATE := date_trunc('month', sv_today())::date;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM mopt_list_services(ini, sv_today()) WHERE id = (SELECT caso FROM t)),
    'F3: cerrado este mes no sale en Servicios de este mes';
  ASSERT NOT EXISTS (SELECT 1 FROM mopt_list_services((ini - interval '1 month')::date, ini - 1) WHERE id = (SELECT caso FROM t)),
    'F3: sale en el mes del pedido y no en el del cierre';
  ASSERT get_case_sla((SELECT folio FROM t))->>'program_name'
         = 'MOPT de prueba (auditoría)', 'F4: el SLA no nombra al programa';
  RAISE NOTICE 'F. reporte de mes cerrado, zona 24 h, corte por cierre y SLA del programa: OK';
END $$;

RESET ROLE;

-- G. Un servicio abierto pedido hace dos meses.
INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng,
                              pickup_address, dropoff_lat, dropoff_lng, dropoff_address, incident_type, created_at,
                              assigned_at, mopt_provider_id)
SELECT dueno, socio, 'active', 'tow', 'light', 'x', 11.05, -80.95, 'Pedido viejo', 11.06, -80.96, 'Destino',
       'Vehículo varado', now() - interval '60 days', now() - interval '60 days', prov FROM t;

DO $$
DECLARE
  sv   TIMESTAMP := now() AT TIME ZONE 'America/El_Salvador';
  ayer SMALLINT := EXTRACT(ISODOW FROM sv - interval '1 day')::smallint;
  hoy  SMALLINT := EXTRACT(ISODOW FROM sv)::smallint;
  fin  TIME := (sv + interval '1 hour')::time;
BEGIN
  -- Turno que empezó "ayer" a las 23:59 y termina en una hora: estamos en la
  -- madrugada del turno de ayer. (Entre 22:59 y 23:59 no hay madrugada que probar.)
  IF sv::time < '22:59' THEN
    ASSERT mopt_zone_open_now('23:59', fin, ARRAY[ayer]), 'G1: la madrugada no cuenta como el dia del turno';
    ASSERT NOT mopt_zone_open_now('23:59', fin, ARRAY[hoy]), 'G1: la madrugada abrio el turno de hoy';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM mopt_in_progress_services() WHERE pickup_address = 'Pedido viejo'),
    'G2: el servicio abierto de hace dos meses no sale en curso';
  ASSERT NOT EXISTS (SELECT 1 FROM mopt_in_progress_services() WHERE id = (SELECT caso FROM t)),
    'G2: un completado sale como en curso';
END $$;

SELECT pg_temp.como((SELECT usuario FROM t), 'aal1');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  PERFORM preview_mopt_services(11.05, -80.95);
  PERFORM preview_mopt_program(11.05, -80.95, 'tow');
  BEGIN
    PERFORM mopt_in_progress_services();
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Esta cuenta no pertenece%';
  END;
  ASSERT ok, 'G3: un Usuario vio los servicios en curso del programa';
  RAISE NOTICE 'G. en curso sin fecha, turno nocturno y vistas previas con candado: OK';
END $$;

RESET ROLE;

-- H. El socio que acepta no recibe "Nuevo servicio asignado"; si asigna el admin, sí.
CREATE TEMP TABLE h (propio UUID, ajeno UUID) ON COMMIT DROP;
GRANT SELECT ON h TO PUBLIC;
WITH a AS (
  INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type, mopt_provider_id)
  SELECT lector, 'initiated', 'battery', 'light', 'x', 11.05, -80.95, 'Push A', 11.05, -80.95, 'Push A', 'Batería descargada', prov FROM t
  RETURNING id
), b AS (
  INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type, mopt_provider_id)
  SELECT admin, 'initiated', 'battery', 'light', 'x', 11.05, -80.95, 'Push B', 11.05, -80.95, 'Push B', 'Batería descargada', prov FROM t
  RETURNING id
)
INSERT INTO h SELECT (SELECT id FROM a), (SELECT id FROM b);
-- El socio del ciclo E/G tiene servicios abiertos: se usa otro de la misma flota.
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '9a9a9a9a-0000-4000-8000-0000000000b6', 'authenticated', 'authenticated',
        'au.socio2@budi.invalid', '{"full_name": "Socio dos", "role": "OPERATOR"}', now(), now());
UPDATE profiles SET provider_id = (SELECT prov FROM t), verification_status = 'approved'
 WHERE id = '9a9a9a9a-0000-4000-8000-0000000000b6';
UPDATE t SET socio = '9a9a9a9a-0000-4000-8000-0000000000b6';

SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT socio FROM t), 'aal1');
SELECT accept_service_request((SELECT propio FROM h));
SELECT pg_temp.como((SELECT admin FROM t));
SELECT admin_assign_request((SELECT ajeno FROM h), (SELECT socio FROM t));
RESET ROLE;
DO $$
BEGIN
  ASSERT (SELECT operator_id FROM service_requests WHERE id = (SELECT propio FROM h)) = (SELECT socio FROM t), 'H0: no quedo aceptado';
  ASSERT NOT EXISTS (SELECT 1 FROM notification_queue WHERE user_id = (SELECT socio FROM t)
                      AND data->>'service_request_id' = (SELECT propio FROM h)::text AND data->>'type' = 'new_service_request'),
    'H1: el socio recibio aviso por aceptar el mismo';
  ASSERT (SELECT title FROM notification_queue WHERE user_id = (SELECT lector FROM t)
           AND data->>'service_request_id' = (SELECT propio FROM h)::text ORDER BY created_at DESC LIMIT 1) = '¡Socio operador asignado!',
    'H2: el Usuario recibe un aviso que habla de grua en un servicio de bateria';
  ASSERT EXISTS (SELECT 1 FROM notification_queue WHERE user_id = (SELECT socio FROM t)
                  AND data->>'service_request_id' = (SELECT ajeno FROM h)::text AND data->>'type' = 'new_service_request'
                  AND body NOT ILIKE '%grúa%'),
    'H3: asignado por el admin, el socio no recibio aviso (o dice grua)';
  RAISE NOTICE 'H. avisos push sin grua y sin autoaviso al socio: OK';
END $$;

RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'TODO VERDE'; END $$;
ROLLBACK;
