-- =====================================================
-- Alta de un cliente institucional (migr. 00130, backlog VEN-03)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Solo ADMIN: ni un dueño de portal ni un usuario usan estas RPC.
--   B. Aseguradora de punta a punta sin SQL: crear → contrato → invitar dueño
--      (sin cuenta previa) → aceptar → plan/póliza/afiliado → caso de prueba →
--      cerrar el alta. El cierre se niega mientras falte un paso.
--   C. MOPT: crear → contrato + tarifa → zona → caso de prueba dentro y fuera.
--   D. El caso de prueba no crea servicios ni consume cobertura.
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
    ('e5e5e5e5-0000-4000-8000-000000000001', 'alta.admin@budi.invalid',   'Admin Altas'),
    ('e5e5e5e5-0000-4000-8000-000000000002', 'alta.usuario@budi.invalid', 'Usuario')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'ADMIN' WHERE id = 'e5e5e5e5-0000-4000-8000-000000000001';

CREATE TEMP TABLE t (org UUID, ins UUID, token TEXT, mopt_org UUID, prov UUID) ON COMMIT DROP;
INSERT INTO t DEFAULT VALUES;
GRANT ALL ON t TO PUBLIC;

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------
-- A. Solo ADMIN
-- ---------------------------------------------------------------
SELECT pg_temp.como('e5e5e5e5-0000-4000-8000-000000000002');
DO $$
DECLARE ok BOOLEAN;
BEGIN
  ok := false;
  BEGIN PERFORM admin_create_institution('INSURER', 'Pirata', NULL, NULL, NULL, NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: un usuario creó un cliente';
  ok := false;
  BEGIN PERFORM admin_onboarding_overview(); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: un usuario vio las altas';
  ok := false;
  BEGIN PERFORM admin_invite_org_member((SELECT id FROM organizations LIMIT 1), 'x@y.com', 'owner'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: un usuario invitó a un portal ajeno';
  ok := false;
  BEGIN PERFORM admin_preview_eligibility((SELECT id FROM organizations WHERE type = 'INSURER' LIMIT 1), 'tow', '012345678');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: un usuario consultó el padrón de una aseguradora';
END $$;

-- ---------------------------------------------------------------
-- B. Aseguradora de punta a punta
-- ---------------------------------------------------------------
SELECT pg_temp.como('e5e5e5e5-0000-4000-8000-000000000001');
UPDATE t SET org = admin_create_institution('INSURER', 'Seguros Alta (prueba)', '0614-010101-101-1', 'Ana Gerente',
                                             'ana@segurosalta.invalid', '2222-0000');
UPDATE t SET ins = (SELECT insurer_id FROM organizations WHERE id = (SELECT org FROM t));

DO $$
DECLARE s JSONB := admin_onboarding_status((SELECT org FROM t));
BEGIN
  ASSERT (SELECT ins FROM t) IS NOT NULL, 'B: no se creó la aseguradora';
  ASSERT (s->'steps'->0->>'done')::boolean, 'B: la organización no quedó activa';
  ASSERT (SELECT count(*) FROM jsonb_array_elements(s->'steps') x WHERE (x->>'done')::boolean) = 1, 'B: pasos hechos de más al crear';
  ASSERT NOT (s->>'ready')::boolean, 'B: lista sin pasos';
END $$;

-- Duplicado y tipo inválido.
DO $$
DECLARE ok BOOLEAN;
BEGIN
  ok := false;
  BEGIN PERFORM admin_create_institution('INSURER', 'seguros alta (PRUEBA)', NULL, NULL, NULL, NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: aceptó un nombre duplicado';
  ok := false;
  BEGIN PERFORM admin_create_institution('PROVIDER', 'Empresa', NULL, NULL, NULL, NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: aceptó un tipo no soportado';
END $$;

-- El cierre se niega mientras falten pasos.
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN PERFORM admin_complete_onboarding((SELECT org FROM t)); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: cerró un alta incompleta';
END $$;

-- Contrato.
SELECT admin_set_org_contract((SELECT org FROM t), 'ASE-2026-TEST', sv_today(), NULL, NULL, 'keep_courtesy', 'Tarifa por plan');

-- Invitar al dueño: la persona aún no tiene cuenta.
UPDATE t SET token = (SELECT r->>'token' FROM admin_invite_org_member((SELECT org FROM t), 'Dueno@SegurosAlta.invalid', 'owner') r);
DO $$
DECLARE s JSONB := admin_onboarding_status((SELECT org FROM t));
BEGIN
  ASSERT (s->'steps'->1->>'done')::boolean, 'B: el contrato no cuenta';
  ASSERT NOT (s->'steps'->2->>'done')::boolean, 'B: una invitación pendiente contó como dueño';
  ASSERT s->'steps'->2->'invitations'->0->>'email' = 'dueno@segurosalta.invalid', 'B: la invitación no aparece (o sin normalizar)';
END $$;

-- Un socio operador no puede ser invitado.
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_invite_org_member((SELECT org FROM t), (SELECT email FROM profiles WHERE role = 'OPERATOR' LIMIT 1), 'owner');
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'B: invitó a un socio operador a un portal cliente';
END $$;

-- La persona se registra (el enlace del correo le crea la cuenta) y acepta.
RESET ROLE;
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', 'e5e5e5e5-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
        'dueno@segurosalta.invalid', '{"full_name": "Dueño Alta"}', now(), now());
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('e5e5e5e5-0000-4000-8000-000000000003', 'aal1');
SELECT accept_org_invitation((SELECT token FROM t));

-- Plan, póliza y afiliado (lo mismo que hace la ficha de la aseguradora).
RESET ROLE;
WITH plan AS (
  INSERT INTO coverage_plans (insurer_id, code, name) SELECT ins, 'ALTA', 'Plan Alta' FROM t RETURNING id
), regla AS (
  INSERT INTO coverage_rules (plan_id, service_type, rule_key, rule_value) SELECT id, 'tow', 'covered', 1 FROM plan RETURNING plan_id
), pol AS (
  INSERT INTO policies (insurer_id, plan_id, policy_number, holder_name, starts_on, status)
  SELECT t.ins, (SELECT plan_id FROM regla), 'POL-ALTA-1', 'Empresa X', sv_today() - 1, 'active' FROM t RETURNING id
)
INSERT INTO members (policy_id, document_number, full_name, relationship, starts_on, is_active)
SELECT id, '05555555-5', 'Afiliada Prueba', 'holder', sv_today() - 1, true FROM pol;
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('e5e5e5e5-0000-4000-8000-000000000001');

DO $$
DECLARE
  s JSONB := admin_onboarding_status((SELECT org FROM t));
  r JSONB;
  n_req INT := (SELECT count(*) FROM service_requests);
  n_use INT := (SELECT count(*) FROM coverage_usage);
BEGIN
  ASSERT (s->'steps'->2->>'done')::boolean, 'B: el dueño aceptó y no cuenta';
  ASSERT (s->'steps'->3->>'done')::boolean, 'B: plan/póliza/afiliado no cuentan: ' || (s->'steps'->3)::text;
  ASSERT NOT (s->'steps'->4->>'done')::boolean, 'B: caso de prueba hecho sin probar';

  -- Documento que no está.
  r := admin_preview_eligibility((SELECT org FROM t), 'tow', '09999999-9');
  ASSERT NOT (r->>'ok')::boolean AND r->>'reason' LIKE '%padrón%', 'B: documento ajeno dio positivo: ' || r::text;
  -- Servicio que el plan no cubre.
  r := admin_preview_eligibility((SELECT org FROM t), 'locksmith', '055555555');
  ASSERT NOT (r->>'ok')::boolean AND r->>'reason' LIKE '%no cubre%', 'B: servicio no cubierto dio positivo: ' || r::text;
  ASSERT NOT (admin_onboarding_status((SELECT org FROM t))->'steps'->4->>'done')::boolean, 'B: una prueba fallida marcó el paso';
  -- Afiliada real, con el documento escrito distinto (se normaliza).
  r := admin_preview_eligibility((SELECT org FROM t), 'tow', '05555555-5', NULL, NULL, 80);
  ASSERT (r->>'ok')::boolean, 'B: la afiliada vigente no quedó cubierta: ' || r::text;
  ASSERT r->>'member' = 'Afiliada Prueba' AND (r->>'amount_total')::numeric = 80, 'B: desglose incompleto: ' || r::text;

  -- D. No toca datos de servicio.
  ASSERT (SELECT count(*) FROM service_requests) = n_req, 'D: el caso de prueba creó un servicio';
  ASSERT (SELECT count(*) FROM coverage_usage) = n_use, 'D: el caso de prueba consumió cobertura';

  s := admin_onboarding_status((SELECT org FROM t));
  ASSERT (s->>'ready')::boolean, 'B: con todo hecho no queda lista: ' || (s->'steps')::text;
  s := admin_complete_onboarding((SELECT org FROM t), 'Alta de prueba');
  ASSERT s->>'completed_at' IS NOT NULL AND (s->>'hours')::numeric < 24, 'B: el cierre no quedó registrado';
  ASSERT (SELECT completed_at FROM admin_onboarding_overview() WHERE organization_id = (SELECT org FROM t)) IS NOT NULL,
         'B: el resumen no muestra el alta completa';
  RAISE NOTICE 'B. aseguradora: crear → contrato → invitar → aceptar → padrón → prueba → cierre: OK';
END $$;

-- ---------------------------------------------------------------
-- C. Programa MOPT
-- ---------------------------------------------------------------
UPDATE t SET mopt_org = admin_create_institution('MOPT', 'MOPT Alta (prueba)', NULL, NULL, 'mopt@alta.invalid', NULL);
UPDATE t SET prov = (SELECT provider_id FROM organizations WHERE id = (SELECT mopt_org FROM t));
SELECT admin_set_org_contract((SELECT mopt_org FROM t), 'MOPT-ALTA', sv_today(), NULL, 5000, 'keep_courtesy', NULL);

DO $$
DECLARE s JSONB := admin_onboarding_status((SELECT mopt_org FROM t));
BEGIN
  ASSERT s->'steps'->3->>'key' = 'zones', 'C: el MOPT no pide zonas';
  ASSERT NOT (s->'steps'->1->>'done')::boolean, 'C: contrato sin tarifa de Budi contó como hecho';
END $$;

SELECT admin_schedule_rate('mopt_fee', (SELECT prov FROM t), 0.05, sv_today(), 'Alta de prueba');

-- Zona en un lugar donde no hay otros programas (Golfo de Fonseca).
RESET ROLE;
INSERT INTO mopt_zones (provider_id, name, polygon, service_types, is_active)
SELECT prov, 'Zona de prueba', '[[13.20,-87.90],[13.20,-87.80],[13.30,-87.80],[13.30,-87.90]]'::jsonb, NULL, true FROM t;
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('e5e5e5e5-0000-4000-8000-000000000001');

DO $$
DECLARE
  r JSONB;
  s JSONB;
BEGIN
  r := admin_preview_eligibility((SELECT mopt_org FROM t), 'tow', NULL, 13.50, -87.50);
  ASSERT NOT (r->>'ok')::boolean AND r->>'reason' LIKE '%ninguna zona%', 'C: punto fuera dio positivo: ' || r::text;
  r := admin_preview_eligibility((SELECT mopt_org FROM t), 'tow', NULL, 13.25, -87.85);
  ASSERT (r->>'ok')::boolean, 'C: punto dentro de la zona no aplicó: ' || r::text;

  s := admin_onboarding_status((SELECT mopt_org FROM t));
  ASSERT (s->'steps'->1->>'done')::boolean AND (s->'steps'->3->>'done')::boolean AND (s->'steps'->4->>'done')::boolean,
         'C: pasos del MOPT sin completar: ' || (s->'steps')::text;
  ASSERT NOT (s->>'ready')::boolean, 'C: listo sin dueño';
  RAISE NOTICE 'C. MOPT: contrato + tarifa + zona + prueba dentro/fuera: OK';
END $$;

ROLLBACK;
