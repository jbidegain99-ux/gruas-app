-- =====================================================
-- Revisión de punta a punta del MOPT (migr. 00154-00157)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte. Con las aseguradoras
-- apagadas (00153), como está hoy.
--
--   A. Consumo del tope y reporte mensual con lo aprobado (no el original);
--      el anexo sin GPS dice "sin dato", no 0 km.
--   B. Un socio pagado de más no le resta a lo pendiente con los demás.
--   C. Marcar pagado el estado de cuenta registra en el libro la tarifa
--      (lo único que el MOPT le paga a Budi), sin duplicar lo ya cargado.
--   D. El socio de la flota sabe que le paga el programa.
--   E. (00155) Flota: placa, calificación solo del programa y alerta de
--      socio sin señal con un servicio en curso.
--   F. (00156) Aviso de casos observados al pagar; el reporte oficial se
--      rehace al aprobar el estado de cuenta (solo si cambió).
--   G. (00156) Programa suspendido: la vista previa lo explica.
--   H. (00157) El vehículo del pedido (nota de la app) llega a las columnas.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal2') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO providers (id, name, is_active, is_mopt, tow_type_supported)
VALUES ('9b9b9b9b-0000-4000-8000-000000000001', 'MOPT de prueba (revisión)', true, true, 'both');
INSERT INTO organizations (type, name, provider_id)
VALUES ('MOPT', 'MOPT de prueba (revisión)', '9b9b9b9b-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
-- Tarifa de plataforma del 5 % desde ayer.
INSERT INTO rate_versions (kind, subject_id, rate, valid_from, note)
VALUES ('mopt_fee', '9b9b9b9b-0000-4000-8000-000000000001', 5, now() - interval '1 day', 'test');

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated', x.email,
       jsonb_build_object('full_name', x.nombre) || x.meta, now(), now()
  FROM (VALUES
    ('9b9b9b9b-0000-4000-8000-0000000000b1'::uuid, 'rv.admin@budi.invalid',   'Admin revisión', '{}'::jsonb),
    ('9b9b9b9b-0000-4000-8000-0000000000b2'::uuid, 'rv.dueno@budi.invalid',   'Dueña MOPT',     '{}'::jsonb),
    ('9b9b9b9b-0000-4000-8000-0000000000b3'::uuid, 'rv.usuario@budi.invalid', 'Usuario',        '{}'::jsonb),
    ('9b9b9b9b-0000-4000-8000-0000000000b4'::uuid, 'rv.socio.a@budi.invalid', 'Socio A',        '{"role": "OPERATOR"}'::jsonb),
    ('9b9b9b9b-0000-4000-8000-0000000000b5'::uuid, 'rv.socio.b@budi.invalid', 'Socio B',        '{"role": "OPERATOR"}'::jsonb)
  ) AS x(id, email, nombre, meta);

CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT (SELECT id FROM organizations WHERE provider_id = '9b9b9b9b-0000-4000-8000-000000000001' AND type = 'MOPT' LIMIT 1) AS org,
       '9b9b9b9b-0000-4000-8000-000000000001'::uuid AS prov,
       '9b9b9b9b-0000-4000-8000-0000000000b1'::uuid AS admin,
       '9b9b9b9b-0000-4000-8000-0000000000b2'::uuid AS dueno,
       '9b9b9b9b-0000-4000-8000-0000000000b3'::uuid AS usuario,
       '9b9b9b9b-0000-4000-8000-0000000000b4'::uuid AS socio_a,
       '9b9b9b9b-0000-4000-8000-0000000000b5'::uuid AS socio_b,
       NULL::uuid AS caso_a, NULL::uuid AS caso_b, NULL::uuid AS ec, NULL::uuid AS obs;
GRANT SELECT, UPDATE ON t TO PUBLIC;

UPDATE profiles SET role = 'ADMIN' WHERE id = (SELECT admin FROM t);
UPDATE profiles SET provider_id = (SELECT prov FROM t), verification_status = 'approved'
 WHERE id IN ((SELECT socio_a FROM t), (SELECT socio_b FROM t));
INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT org, dueno, 'owner', 'active' FROM t;

-- Dos servicios del programa completados hoy: A por $80 (socio A), B por $40
-- (socio B). Sin GPS: los km del caso quedan sin dato.
CREATE TEMP TABLE nuevos ON COMMIT DROP AS
WITH sr AS (
  INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng,
                                pickup_address, dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price,
                                created_at, assigned_at, activated_at, completed_at, mopt_provider_id)
  SELECT usuario, x.op, 'completed', 'tow', 'light', 'x', 11.05, -80.95, 'Zona', 11.06, -80.96, 'Destino',
         'Vehículo varado', x.precio, now() - interval '1 hour', now() - interval '55 minutes',
         now() - interval '30 minutes', now() - x.hace, prov
    FROM t, (VALUES ((SELECT socio_a FROM t), 80::numeric, interval '10 minutes'),
                    ((SELECT socio_b FROM t), 40::numeric, interval '5 minutes')) AS x(op, precio, hace)
  RETURNING id, operator_id
)
SELECT * FROM sr;
UPDATE t SET caso_a = (SELECT id FROM nuevos WHERE operator_id = t.socio_a),
             caso_b = (SELECT id FROM nuevos WHERE operator_id = t.socio_b);

SET LOCAL ROLE authenticated;

-- La dueña le paga los $80 al socio A antes de que se ajuste el caso.
SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
SELECT register_ledger_payment('mopt', (SELECT prov FROM t), 'operator', (SELECT socio_a FROM t), 80, NULL, 'TRF-A', NULL);

-- Estado de cuenta: el caso A se observa y Budi lo ajusta a $60.
SELECT pg_temp.como((SELECT admin FROM t));
DO $$
BEGIN
  UPDATE t SET ec = admin_generate_statement((SELECT org FROM t), sv_today(), sv_today());
  PERFORM admin_issue_statement((SELECT ec FROM t));
END $$;
SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
UPDATE t SET obs = observe_statement_case((SELECT ec FROM t), (SELECT caso_a FROM t), 'Llegó tarde');
-- F1 (00156): mientras está observado, Socios operadores lo avisa al pagar.
DO $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM mopt_list_operators() WHERE operator_id = (SELECT socio_a FROM t);
  ASSERT a.observed_cases = 1 AND a.observed_amount = 80, 'F1: no cuenta los casos observados del socio';
  ASSERT (SELECT observed_cases FROM mopt_list_operators() WHERE operator_id = (SELECT socio_b FROM t)) = 0,
    'F1: el socio B no tiene casos observados';
END $$;
SELECT pg_temp.como((SELECT admin FROM t));
SELECT admin_answer_observation((SELECT obs FROM t), 'Se ajusta', 'adjusted', 60);
-- F2 (00156): el reporte oficial del mes ya existe (foto con el original).
RESET ROLE;
SELECT _generate_mopt_report((SELECT prov FROM t), sv_today(), false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
BEGIN
  -- 60 + 3 de tarifa, 40 + 2.
  ASSERT approve_statement((SELECT ec FROM t)) = 105, 'aprobado distinto de 105';
END $$;
RESET ROLE;
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM mopt_reports WHERE provider_id = (SELECT prov FROM t);
  ASSERT r.version = 2, 'F2: aprobar no rehízo el reporte oficial';
  ASSERT (r.report->'cost'->>'total')::numeric = 105, 'F2: el reporte rehecho no tiene lo aprobado';
  ASSERT r.corrected_statement = (SELECT number FROM account_statements WHERE id = (SELECT ec FROM t)),
    'F2: el reporte no dice qué estado de cuenta lo corrigió';
  -- Sin cambios en las cifras, no se rehace ni se reenvía.
  ASSERT _mopt_refresh_reports_after_approval((SELECT ec FROM t)) = 0, 'F3: rehízo un reporte que no cambió';
  ASSERT (SELECT version FROM mopt_reports WHERE id = r.id) = 2, 'F3: subió la versión sin cambios';
  RAISE NOTICE 'F. aviso de observados al pagar y reporte corregido al aprobar: OK';
END $$;
SET LOCAL ROLE authenticated;

-- A. Tope y reporte con lo aprobado.
RESET ROLE;
DO $$
DECLARE r JSONB;
BEGIN
  ASSERT mopt_month_consumption((SELECT prov FROM t)) = 105,
    'A1: el consumo del tope usa el precio original y no lo aprobado';
  r := _mopt_report_build((SELECT prov FROM t), sv_today());
  ASSERT (r->'cost'->>'services')::numeric = 100, 'A2: el reporte suma servicios con el precio original';
  ASSERT (r->'cost'->>'platform_fee')::numeric = 5, 'A2: el reporte suma la tarifa original';
  ASSERT (r->'cost'->>'total')::numeric = 105, 'A2: el total del reporte no es lo aprobado';
  ASSERT (SELECT (a->>'cost')::numeric FROM jsonb_array_elements(r->'annex') a
           WHERE a->>'folio' = (SELECT folio FROM cases WHERE request_id = (SELECT caso_a FROM t))) = 60,
    'A3: el anexo muestra el costo original del caso ajustado';
  ASSERT (SELECT bool_and(a->'km' = 'null'::jsonb) FROM jsonb_array_elements(r->'annex') a),
    'A4: el anexo dice 0 km en casos sin GPS';
  RAISE NOTICE 'A. tope y reporte con lo aprobado; anexo sin GPS sin dato: OK';
END $$;

-- B. Socio A pagado de más ($80 contra $60): no le resta a lo del socio B.
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
DECLARE o JSONB := mopt_overview();
BEGIN
  ASSERT (o->>'owed_to_operators')::numeric = 40, 'B1: lo pendiente con los socios resta al pagado de más';
  ASSERT (o->>'overpaid_operators')::numeric = 20, 'B2: no avisa lo pagado de más';
  RAISE NOTICE 'B. socio pagado de más aparte: OK';
END $$;

-- C. Marcar pagado → libro. Budi ya había cargado $2 a mano: solo faltan $3.
SELECT pg_temp.como((SELECT admin FROM t));
SELECT register_ledger_payment('mopt', (SELECT prov FROM t), 'budi', NULL, 2, NULL, 'MANUAL', NULL);
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_mark_statement_paid((SELECT ec FROM t), sv_today() + 1, 'FUTURO');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'La fecha de pago no puede ser futura%';
  END;
  ASSERT ok, 'C0: marcó pagado con fecha futura';
END $$;
SELECT admin_mark_statement_paid((SELECT ec FROM t), sv_today(), 'TRF-EC');
RESET ROLE;
DO $$
BEGIN
  ASSERT (SELECT status FROM account_statements WHERE id = (SELECT ec FROM t)) = 'paid', 'C1: no quedó pagado';
  ASSERT (SELECT amount FROM ledger_payments
           WHERE payer_kind = 'mopt' AND payer_id = (SELECT prov FROM t) AND payee_kind = 'budi' AND reference = 'TRF-EC') = 3,
    'C2: el pago del estado de cuenta no llegó al libro por la tarifa pendiente';
  ASSERT (SELECT balance FROM ledger_balances_all()
           WHERE debtor_kind = 'mopt' AND debtor_id = (SELECT prov FROM t) AND creditor_kind = 'budi') = 0,
    'C3: el MOPT sigue debiéndole tarifa a Budi con el estado de cuenta pagado';
  -- Los servicios no se le pagan a Budi: lo del socio B sigue pendiente.
  ASSERT (SELECT balance FROM ledger_balances_all()
           WHERE debtor_kind = 'mopt' AND debtor_id = (SELECT prov FROM t) AND creditor_kind = 'operator'
             AND creditor_id = (SELECT socio_b FROM t)) = 40,
    'C4: marcar pagado tocó lo que el MOPT les debe a sus socios';
  RAISE NOTICE 'C. marcar pagado registra la tarifa en el libro, sin duplicar: OK';
END $$;

-- D. El socio de la flota ve que le paga el programa.
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT socio_b FROM t), 'aal1');
DO $$
DECLARE p JSONB := my_payouts();
BEGIN
  ASSERT p->>'program' = 'MOPT de prueba (revisión)', 'D1: my_payouts no dice que le paga el programa';
  ASSERT p->>'company' IS NULL, 'D2: al socio MOPT le dice que le paga una empresa';
  RAISE NOTICE 'D. el socio sabe quién le paga: OK';
END $$;

-- E. (00155) La flota: placa, calificación del programa y alerta sin señal.
RESET ROLE;
INSERT INTO operator_vehicles (operator_id, plate, vehicle_type)
SELECT socio_a, 'RV0001', 'tow_light' FROM t;
-- Socio A: 4 estrellas en el servicio del programa; 1 estrella en un servicio
-- particular (fuera del programa) que no le toca ver al MOPT.
INSERT INTO ratings (request_id, rater_user_id, rated_operator_id, stars)
SELECT caso_a, usuario, socio_a, 4 FROM t;
WITH sr AS (
  INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng,
                                pickup_address, dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price,
                                created_at, completed_at)
  SELECT usuario, socio_a, 'completed', 'tow', 'light', 'x', 13.7, -89.2, 'Particular', 13.71, -89.21, 'Destino',
         'Vehículo varado', 50, now() - interval '3 hours', now() - interval '2 hours'
    FROM t
  RETURNING id
)
INSERT INTO ratings (request_id, rater_user_id, rated_operator_id, stars)
SELECT sr.id, t.usuario, t.socio_a, 1 FROM sr, t;
-- Socio B: con un servicio del programa en curso y el GPS de hace 20 min.
INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng,
                              pickup_address, dropoff_lat, dropoff_lng, dropoff_address, incident_type,
                              created_at, assigned_at, mopt_provider_id)
SELECT usuario, socio_b, 'en_route', 'tow', 'light', 'x', 11.05, -80.95, 'Zona', 11.06, -80.96, 'Destino',
       'Vehículo varado', now() - interval '25 minutes', now() - interval '24 minutes', prov
  FROM t;
INSERT INTO operator_locations (operator_id, lat, lng, is_online, updated_at)
SELECT socio_b, 11.05, -80.95, true, now() - interval '20 minutes' FROM t
ON CONFLICT (operator_id) DO UPDATE SET updated_at = excluded.updated_at, is_online = true;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
DECLARE a RECORD; s JSONB;
BEGIN
  SELECT * INTO a FROM mopt_list_operators() WHERE operator_id = (SELECT socio_a FROM t);
  ASSERT a.plate = 'RV0001', 'E1: Socios operadores sin la placa';
  ASSERT a.avg_rating = 4 AND a.ratings_count = 1,
    'E2: la calificación cuenta servicios fuera del programa';
  ASSERT (SELECT plate FROM mopt_fleet() WHERE operator_id = (SELECT socio_a FROM t)) = 'RV0001', 'E1: el mapa sin la placa';
  ASSERT (SELECT active_folio FROM mopt_fleet() WHERE operator_id = (SELECT socio_b FROM t)) IS NOT NULL,
    'E3: el mapa no dice el folio del servicio en curso';
  s := mopt_overview()->'stale_on_service';
  ASSERT jsonb_array_length(s) = 1 AND (s->0->>'operator_id')::uuid = (SELECT socio_b FROM t),
    'E4: no avisa del socio sin señal con servicio en curso';
  RAISE NOTICE 'E. flota: placa, calificación del programa y alerta sin señal: OK';
END $$;

-- Un Usuario o un socio no leen la flota del MOPT.
SELECT pg_temp.como((SELECT socio_a FROM t), 'aal1');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM mopt_fleet();
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Esta cuenta no pertenece%';
  END;
  ASSERT ok, 'E5: un socio leyó la flota del MOPT';
END $$;

-- G. (00156) Programa suspendido: la vista previa lo explica.
RESET ROLE;
INSERT INTO mopt_zones (provider_id, name, polygon, is_active)
SELECT prov, 'Zona revisión', '[[11.00, -81.00], [11.00, -80.90], [11.10, -80.90], [11.10, -81.00]]'::jsonb, true FROM t;
UPDATE organizations SET status = 'suspended' WHERE id = (SELECT org FROM t);
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT usuario FROM t), 'aal1');
DO $$
DECLARE p JSONB := preview_mopt_program(11.05, -80.95, 'tow');
BEGIN
  ASSERT NOT (p->>'applies')::boolean, 'G1: suspendido sigue dando cortesía';
  ASSERT (p->>'paused')::boolean AND NOT (p->>'capped')::boolean, 'G1: no avisa que el programa no está dando cortesía';
  ASSERT p->>'program_name' = 'MOPT de prueba (revisión)', 'G1: no nombra al programa';
END $$;
RESET ROLE;
UPDATE organizations SET status = 'active' WHERE id = (SELECT org FROM t);
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT usuario FROM t), 'aal1');
DO $$
BEGIN
  ASSERT (preview_mopt_program(11.05, -80.95, 'tow')->>'applies')::boolean, 'G2: reactivado no vuelve la cortesía';
  RAISE NOTICE 'G. programa suspendido: la vista previa lo explica: OK';
END $$;

-- H. (00157) El vehículo del pedido llega a las columnas del servicio.
RESET ROLE;
INSERT INTO vehicles (user_id, make, model, color, plate, is_default)
SELECT usuario, 'Toyota', 'Corolla', 'Blanco', 'P512883', true FROM t;
CREATE TEMP TABLE veh ON COMMIT DROP AS
WITH a AS (
  INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type, notes, mopt_provider_id)
  SELECT usuario, 'cancelled', 'tow', 'light', 'x', 11.05, -80.95, 'Zona', 11.06, -80.96, 'Destino', 'Varado',
         'Vehículo: Toyota Corolla Blanco · P512883' || chr(10) || 'Frente a la gasolinera', prov FROM t
  RETURNING id
), b AS (
  INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type, notes, mopt_provider_id)
  SELECT usuario, 'cancelled', 'tow', 'light', 'x', 11.05, -80.95, 'Zona', 11.06, -80.96, 'Destino', 'Varado',
         'Vehículo: Pick-up prestado placa c 401-772', prov FROM t
  RETURNING id
)
SELECT (SELECT id FROM a) AS guardado, (SELECT id FROM b) AS libre;
GRANT SELECT ON veh TO PUBLIC;
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM service_requests WHERE id = (SELECT guardado FROM veh);
  ASSERT r.vehicle_make = 'Toyota' AND r.vehicle_model = 'Corolla' AND r.vehicle_color = 'Blanco' AND r.vehicle_plate = 'P512883',
    'H1: el vehículo guardado no pasó a las columnas del servicio';
  ASSERT (SELECT vehicle_plate FROM service_requests WHERE id = (SELECT libre FROM veh)) = 'C401-772',
    'H2: del texto libre no se rescató la placa';
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
BEGIN
  ASSERT mopt_service_detail((SELECT guardado FROM veh))->>'vehicle' = 'Toyota Corolla Blanco', 'H3: el detalle no muestra el vehículo';
  ASSERT mopt_service_detail((SELECT libre FROM veh))->>'vehicle' = 'Pick-up prestado placa c 401-772',
    'H3: sin marca/modelo, el detalle no muestra lo que escribió el Usuario';
  RAISE NOTICE 'H. el vehículo del pedido llega al portal del MOPT: OK';
END $$;

DO $$ BEGIN RAISE NOTICE 'TODO VERDE'; END $$;
ROLLBACK;
