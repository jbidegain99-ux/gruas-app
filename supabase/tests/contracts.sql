-- =====================================================
-- Contrato y presupuesto del MOPT (migr. 00124, backlog MOPT-05)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Sin contrato cargado, la cortesía sigue como antes.
--   B. Tope con 'keep_courtesy': sigue la cortesía; se avisa al 80 y al 100 %.
--   C. Tope con 'charge_user': al llegar, se corta la cortesía.
--   D. Fuera de la vigencia no hay cortesía.
--   E. El MOPT ve su estado; solo ADMIN edita el contrato.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- 00153: el interruptor de aseguradoras viene apagado; estas pruebas las ejercitan.
UPDATE platform_features SET insurers_enabled = true;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal2') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

-- Un programa MOPT propio del test, con una zona cuadrada siempre abierta.
INSERT INTO providers (id, name, is_active, is_mopt, tow_type_supported)
VALUES ('8d8d8d8d-0000-4000-8000-000000000001', 'MOPT de prueba (contratos)', true, true, 'both');
INSERT INTO organizations (id, type, name, provider_id)
VALUES ('8d8d8d8d-0000-4000-8000-0000000000aa', 'MOPT', 'MOPT de prueba (contratos)', '8d8d8d8d-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
-- El trigger ensure_organization (00106) pudo crearla al insertar el proveedor.
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT (SELECT id FROM organizations WHERE provider_id = '8d8d8d8d-0000-4000-8000-000000000001' AND type = 'MOPT' LIMIT 1) AS org,
       '8d8d8d8d-0000-4000-8000-000000000001'::uuid AS prov,
       '8d8d8d8d-0000-4000-8000-0000000000b1'::uuid AS admin,
       '8d8d8d8d-0000-4000-8000-0000000000b2'::uuid AS miembro;
GRANT SELECT ON t TO PUBLIC;

INSERT INTO mopt_zones (provider_id, name, polygon, is_active)
VALUES ((SELECT prov FROM t), 'Zona de prueba',
        '[[10.00, -80.00], [10.00, -79.90], [10.10, -79.90], [10.10, -80.00]]'::jsonb,
        true);

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '8d8d8d8d-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated',
        'ct.admin@budi.invalid', '{"full_name": "Admin contratos"}', now(), now()),
       ('00000000-0000-0000-0000-000000000000', '8d8d8d8d-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated',
        'ct.mopt@budi.invalid', '{"full_name": "Analista MOPT"}', now(), now());
UPDATE profiles SET role = 'ADMIN' WHERE id = (SELECT admin FROM t);
INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT org, miembro, 'analyst', 'active' FROM t;

-- Un servicio del programa completado hoy por $100.
INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                              dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price, completed_at,
                              assigned_at, activated_at, mopt_provider_id)
VALUES ((SELECT miembro FROM t), 'completed', 'tow', 'light', 'x', 10.05, -79.95, 'Zona de prueba',
        10.06, -79.96, 'Destino', 'Vehículo varado', 100, now(), now() - interval '30 minutes', now() - interval '10 minutes',
        (SELECT prov FROM t));

DO $$
BEGIN
  ASSERT mopt_program_for(10.05, -79.95, 'tow') = (SELECT prov FROM t), 'A: sin contrato se perdio la cortesia';
  ASSERT mopt_month_consumption((SELECT prov FROM t)) >= 100, 'A: el consumo del mes no cuenta el servicio';
  RAISE NOTICE 'A. sin contrato: cortesia como antes: OK';
END $$;

SET LOCAL ROLE authenticated;

-- E1. Un miembro del MOPT no edita su contrato.
SELECT pg_temp.como((SELECT miembro FROM t), 'aal1');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_set_org_contract((SELECT org FROM t), 'X', sv_today(), NULL, 1, 'charge_user', NULL);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Solo un administrador%';
  END;
  ASSERT ok, 'E1: el MOPT edito su propio contrato';
END $$;

-- B. Tope $110 que sigue con cortesía: al 90 % avisa el 80; no corta.
SELECT pg_temp.como((SELECT admin FROM t));
SELECT admin_set_org_contract((SELECT org FROM t), 'CT-001', sv_today() - 30, NULL, 110, 'keep_courtesy', 'Tarifa del catálogo vigente');
RESET ROLE;
DO $$
BEGIN
  ASSERT mopt_program_for(10.05, -79.95, 'tow') = (SELECT prov FROM t), 'B1: con keep_courtesy se corto la cortesia';
  ASSERT check_org_budgets() >= 1, 'B2: no aviso el 80 %';
  ASSERT EXISTS (SELECT 1 FROM org_budget_alerts WHERE organization_id = (SELECT org FROM t) AND threshold = 80), 'B2: sin fila del 80 %';
  ASSERT NOT EXISTS (SELECT 1 FROM org_budget_alerts WHERE organization_id = (SELECT org FROM t) AND threshold = 100), 'B2: aviso el 100 % antes de tiempo';
  PERFORM check_org_budgets();
  ASSERT (SELECT count(*) FROM org_budget_alerts WHERE organization_id = (SELECT org FROM t)) = 1, 'B3: el aviso se repitio';
  RAISE NOTICE 'B. keep_courtesy: sigue la cortesia y el aviso del 80 %% sale una vez: OK';
END $$;

-- C. Tope $100 que corta: al 100 % ya no hay cortesía.
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT admin FROM t));
SELECT admin_set_org_contract((SELECT org FROM t), 'CT-001', sv_today() - 30, NULL, 100, 'charge_user', NULL);
RESET ROLE;
DO $$
BEGIN
  ASSERT mopt_program_for(10.05, -79.95, 'tow') IS NULL, 'C1: al tope con charge_user sigue la cortesia';
  PERFORM check_org_budgets();
  ASSERT EXISTS (SELECT 1 FROM org_budget_alerts WHERE organization_id = (SELECT org FROM t) AND threshold = 100), 'C2: no aviso el 100 %';
  RAISE NOTICE 'C. charge_user: al tope se corta la cortesia: OK';
END $$;

-- D. Contrato vencido: sin cortesía aunque no haya tope.
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT admin FROM t));
SELECT admin_set_org_contract((SELECT org FROM t), 'CT-001', sv_today() - 60, sv_today() - 1, NULL, 'keep_courtesy', NULL);
RESET ROLE;
DO $$
BEGIN
  ASSERT mopt_program_for(10.05, -79.95, 'tow') IS NULL, 'D: contrato vencido sigue dando cortesia';
  RAISE NOTICE 'D. fuera de vigencia no hay cortesia: OK';
END $$;

-- E2. El MOPT ve su propio estado (y no puede pedir el de otro).
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT admin FROM t));
SELECT admin_set_org_contract((SELECT org FROM t), 'CT-001', sv_today() - 30, NULL, 100, 'charge_user', NULL);
SELECT pg_temp.como((SELECT miembro FROM t), 'aal1');
DO $$
DECLARE s JSONB;
BEGIN
  s := org_contract_status((SELECT id FROM organizations WHERE type = 'INSURER' LIMIT 1));
  ASSERT (s->'organization'->>'id')::uuid = (SELECT org FROM t), 'E2: un miembro pidio el estado de otra organizacion';
  ASSERT s->>'level' = 'reached' AND (s->>'courtesy_now')::boolean = false, 'E2: estado incorrecto: ' || s::text;
  ASSERT s->>'reference' = 'CT-001', 'E2: no ve su contrato';
  RAISE NOTICE 'E. el MOPT ve su estado; solo ADMIN edita: OK';
END $$;

ROLLBACK;
