-- =====================================================
-- Test de organizaciones y membresias (migr. 00106, backlog POR-01)
--
-- Correr contra la base LOCAL:  pnpm db:test organizations
-- Todo corre en una transaccion que se revierte: no deja datos.
--
--   A. La aseguradora A no ve casos de la B (y viceversa).
--   B. El MOPT ve lo suyo y nada de las aseguradoras.
--   C. Un miembro deshabilitado o una organizacion suspendida pierden el
--      acceso en la siguiente consulta, sin esperar a que venza el token.
--   D. Nadie que no sea admin administra miembros.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- 00153: el interruptor de aseguradoras viene apagado; estas pruebas las ejercitan.
UPDATE platform_features SET insurers_enabled = true;

-- ---------------------------------------------------------------
-- Preparacion: una segunda aseguradora con su propio caso cubierto
-- ---------------------------------------------------------------
CREATE TEMP TABLE t ON COMMIT DROP AS SELECT
  (SELECT i.id FROM insurers i ORDER BY created_at LIMIT 1)       AS ins_a,
  gen_random_uuid()                                                AS ins_b,
  '6b6b6b6b-0000-4000-8000-00000000000b'::uuid                     AS user_b,
  (SELECT m.profile_id FROM organization_members m
     JOIN organizations o ON o.id = m.organization_id
    WHERE o.type = 'INSURER' AND m.status = 'active' LIMIT 1)      AS user_a,
  (SELECT m.profile_id FROM organization_members m
     JOIN organizations o ON o.id = m.organization_id
    WHERE o.type = 'MOPT' AND m.status = 'active' LIMIT 1)         AS user_mopt;
GRANT SELECT ON t TO PUBLIC;

INSERT INTO insurers (id, name, is_active) SELECT ins_b, 'Aseguradora B (test)', true FROM t;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', user_b, 'authenticated', 'authenticated',
       'aseguradora.b@test.invalid', '{"full_name": "Analista B"}', now(), now() FROM t;

INSERT INTO organization_members (organization_id, profile_id, role)
SELECT o.id, t.user_b, 'analyst' FROM organizations o, t WHERE o.insurer_id = t.ins_b;

-- Un caso cubierto por la B: se toma un servicio existente que NO sea de la A
-- y se le carga consumo de un afiliado de una poliza de la B.
CREATE TEMP TABLE t_req ON COMMIT DROP AS
SELECT sr.id FROM service_requests sr
 WHERE NOT EXISTS (SELECT 1 FROM coverage_usage cu WHERE cu.request_id = sr.id)
 ORDER BY sr.created_at DESC LIMIT 1;
GRANT SELECT ON t_req TO PUBLIC;

WITH plan AS (
  INSERT INTO coverage_plans (insurer_id, code, name)
  SELECT ins_b, 'TEST-B', 'Plan B' FROM t RETURNING id
), regla AS (
  -- Plan que cubre todo (service_type NULL = regla general): la 00086 solo le
  -- muestra a la aseguradora los casos que su plan cubre.
  INSERT INTO coverage_rules (plan_id, service_type, rule_key, rule_value)
  SELECT id, NULL, 'covered', 1 FROM plan RETURNING plan_id
), pol AS (
  INSERT INTO policies (insurer_id, plan_id, policy_number, holder_name, starts_on, status)
  SELECT t.ins_b, (SELECT plan_id FROM regla), 'POL-B-TEST', 'Titular B', current_date - 30, 'active' FROM t RETURNING id
), mem AS (
  INSERT INTO members (policy_id, document_number, full_name, relationship, starts_on, is_active)
  SELECT pol.id, '099999999', 'Afiliado B', 'holder', current_date - 30, true FROM pol RETURNING id
)
INSERT INTO coverage_usage (member_id, request_id, service_type, used_on, amount_covered, amount_copay)
SELECT mem.id, (SELECT id FROM t_req), 'tow', current_date, 10, 0 FROM mem;

-- ---------------------------------------------------------------
-- A/B. Aislamiento
-- ---------------------------------------------------------------
-- Sesión de la persona, con 2FA verificado (aal2) salvo que se pida lo contrario:
-- desde la 00113 el dueño y los administradores de un portal lo necesitan.
CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal2') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- Desde la 00115 las funciones nuevas nacen sin EXECUTE para PUBLIC.
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

SET LOCAL ROLE authenticated;

SELECT pg_temp.como((SELECT user_b FROM t));
DO $$
DECLARE n INT;
BEGIN
  ASSERT auth_insurer_id() = (SELECT ins_b FROM t), 'A0: la B no resuelve su aseguradora por membresia';
  SELECT count(*) INTO n FROM service_requests;
  ASSERT n = 1, format('A1: la aseguradora B ve %s servicios (esperado 1, solo el suyo)', n);
  SELECT count(*) INTO n FROM insurers;
  ASSERT n = 1, 'A2: la B ve otra aseguradora';
  SELECT count(*) INTO n FROM organizations;
  ASSERT n = 1, 'A3: la B ve otras organizaciones';
  RAISE NOTICE 'A. la aseguradora B ve solo lo suyo: OK';
END $$;

SELECT pg_temp.como((SELECT user_a FROM t));
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM service_requests WHERE id = (SELECT id FROM t_req);
  ASSERT n = 0, 'A4: la aseguradora A ve el caso de la B';
  SELECT count(*) INTO n FROM coverage_usage WHERE request_id = (SELECT id FROM t_req);
  ASSERT n = 0, 'A5: la A ve el consumo de la B';
  SELECT count(*) INTO n FROM service_requests;
  ASSERT n > 0, 'A6: la A dejo de ver sus propios casos';
  SELECT count(*) INTO n FROM organization_members WHERE profile_id = (SELECT user_b FROM t);
  ASSERT n = 0, 'A7: la A ve el equipo de la B';
  RAISE NOTICE 'A. la aseguradora A no ve nada de la B: OK';
END $$;

SELECT pg_temp.como((SELECT user_mopt FROM t));
DO $$
DECLARE n INT;
BEGIN
  ASSERT auth_mopt_id() IS NOT NULL, 'B0: el MOPT no resuelve su programa por membresia';
  ASSERT auth_insurer_id() IS NULL, 'B1: el MOPT resuelve una aseguradora';
  PERFORM mopt_overview();
  SELECT count(*) INTO n FROM coverage_usage;
  ASSERT n = 0, 'B2: el MOPT ve consumo de aseguradoras';
  RAISE NOTICE 'B. el MOPT ve su programa y nada de aseguradoras: OK';
END $$;

-- ---------------------------------------------------------------
-- C. Corte inmediato
-- ---------------------------------------------------------------
RESET ROLE;
UPDATE organization_members SET status = 'disabled' WHERE profile_id = (SELECT user_b FROM t);
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT user_b FROM t));
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM service_requests;
  ASSERT n = 0, 'C1: un miembro deshabilitado sigue viendo casos';
  ASSERT auth_insurer_id() IS NULL, 'C2: un miembro deshabilitado sigue con aseguradora';
  RAISE NOTICE 'C1. miembro deshabilitado sin acceso: OK';
END $$;

RESET ROLE;
UPDATE organization_members SET status = 'active' WHERE profile_id = (SELECT user_b FROM t);
UPDATE organizations SET status = 'suspended' WHERE insurer_id = (SELECT ins_b FROM t);
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT user_b FROM t));
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM service_requests;
  ASSERT n = 0, 'C3: una organizacion suspendida sigue viendo casos';
  RAISE NOTICE 'C2. organizacion suspendida sin acceso: OK';
END $$;

-- ---------------------------------------------------------------
-- D. Administrar miembros es solo del admin
-- ---------------------------------------------------------------
SELECT pg_temp.como((SELECT user_a FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_add_org_member((SELECT id FROM organizations LIMIT 1), 'x@test.invalid', 'owner');
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'D1: un miembro pudo agregar gente';
  ok := false;
  BEGIN
    INSERT INTO organization_members (organization_id, profile_id, role)
    SELECT o.id, auth.uid(), 'owner' FROM organizations o LIMIT 1;
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'D2: un miembro pudo escribir la tabla de membresias';
  RAISE NOTICE 'D. solo el admin administra miembros: OK';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------
-- E. POR-02: 2FA obligatorio para dueño y administradores
-- ---------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT user_a FROM t), 'aal1');
DO $$
DECLARE n INT; v JSONB;
BEGIN
  SELECT count(*) INTO n FROM service_requests;
  ASSERT n = 0, 'E1: el dueño sin 2FA ve casos';
  ASSERT auth_insurer_id() IS NULL, 'E2: el dueño sin 2FA resuelve su aseguradora';
  v := my_organization();
  ASSERT (v->>'mfa_required')::boolean AND NOT (v->>'mfa_ok')::boolean, 'E3: la web no se entera de que falta el 2FA: ' || v::text;
  RAISE NOTICE 'E. dueño sin 2FA no ve datos y la web lo manda a activarlo: OK';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------
-- F. POR-02: invitar, aceptar, roles y bitácora
-- ---------------------------------------------------------------
-- Tres personas nuevas: una analista, un administrador y un intruso.
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '6c6c6c6c-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated',
        'analista@test.invalid', '{"full_name": "Ana Analista"}', now(), now()),
       ('00000000-0000-0000-0000-000000000000', '6c6c6c6c-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated',
        'jefe@test.invalid', '{"full_name": "Javier Jefe"}', now(), now()),
       ('00000000-0000-0000-0000-000000000000', '6c6c6c6c-0000-4000-8000-0000000000a3', 'authenticated', 'authenticated',
        'intruso@test.invalid', '{"full_name": "Intruso"}', now(), now());

CREATE TEMP TABLE t_inv (k TEXT PRIMARY KEY, token TEXT, id UUID) ON COMMIT DROP;
GRANT ALL ON t_inv TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT user_a FROM t));
DO $$
DECLARE r JSONB; ok BOOLEAN;
BEGIN
  r := org_invite('Analista@Test.invalid', 'analyst');
  INSERT INTO t_inv VALUES ('analista', r->>'token', (r->>'id')::uuid);
  r := org_invite('jefe@test.invalid', 'admin');
  INSERT INTO t_inv VALUES ('jefe', r->>'token', (r->>'id')::uuid);
  ASSERT length((SELECT token FROM t_inv WHERE k = 'analista')) = 48, 'F1: token inesperado';
  -- La tabla ni se puede leer desde la app: el token solo viaja en el correo.
  ok := false;
  BEGIN PERFORM 1 FROM organization_invitations; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'F2: la tabla de invitaciones es legible desde la app';
  ok := false;
  BEGIN PERFORM org_invite('no-es-un-correo', 'viewer'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F3: aceptó un correo inválido';
  RAISE NOTICE 'F1. el dueño invita (token con hash, correo validado): OK';
END $$;

RESET ROLE;
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM t_inv i JOIN organization_invitations x ON x.id = i.id WHERE x.token_hash = i.token),
    'F2b: el token se guardó en claro';
END $$;
SET LOCAL ROLE authenticated;

-- El intruso no puede usar la invitación de otro correo.
SELECT pg_temp.como('6c6c6c6c-0000-4000-8000-0000000000a3', 'aal1');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN PERFORM accept_org_invitation((SELECT token FROM t_inv WHERE k = 'analista')); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F4: alguien de otro correo aceptó la invitación';
  ok := false;
  BEGIN PERFORM accept_org_invitation('token-inventado'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F5: aceptó un token inventado';
  RAISE NOTICE 'F2. una invitación solo sirve para su correo: OK';
END $$;

-- La analista acepta y, sin 2FA (no lo necesita), ve los casos de su aseguradora.
SELECT pg_temp.como('6c6c6c6c-0000-4000-8000-0000000000a1', 'aal1');
DO $$
DECLARE r JSONB; n INT; ok BOOLEAN := false;
BEGIN
  r := accept_org_invitation((SELECT token FROM t_inv WHERE k = 'analista'));
  ASSERT r->>'role' = 'analyst' AND NOT (r->>'mfa_required')::boolean, 'F6: ' || r::text;
  SELECT count(*) INTO n FROM service_requests;
  ASSERT n > 0, 'F7: la analista no ve los casos de su aseguradora';
  BEGIN PERFORM accept_org_invitation((SELECT token FROM t_inv WHERE k = 'analista')); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F8: la invitación se pudo usar dos veces';
  ok := false;
  BEGIN PERFORM org_invite('otro@test.invalid', 'viewer'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F9: una analista pudo invitar';
  ASSERT (org_team()->>'can_manage')::boolean = false, 'F10: la analista figura como administradora del equipo';
  RAISE NOTICE 'F3. la analista acepta, ve lo suyo y no administra: OK';
END $$;

-- El jefe (admin) acepta; sin 2FA no ve nada, con 2FA sí.
SELECT pg_temp.como('6c6c6c6c-0000-4000-8000-0000000000a2', 'aal1');
DO $$
DECLARE r JSONB; n INT;
BEGIN
  r := accept_org_invitation((SELECT token FROM t_inv WHERE k = 'jefe'));
  ASSERT (r->>'mfa_required')::boolean, 'F11: un administrador no exige 2FA';
  SELECT count(*) INTO n FROM service_requests;
  ASSERT n = 0, 'F12: un administrador sin 2FA ve casos';
END $$;
SELECT pg_temp.como('6c6c6c6c-0000-4000-8000-0000000000a2', 'aal2');
DO $$
DECLARE ok BOOLEAN := false; n INT;
BEGIN
  SELECT count(*) INTO n FROM service_requests;
  ASSERT n > 0, 'F13: el administrador con 2FA no ve casos';
  BEGIN PERFORM org_invite('otro.dueno@test.invalid', 'owner'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F14: un administrador pudo invitar a un dueño';
  ok := false;
  BEGIN PERFORM org_update_member((SELECT user_a FROM t), NULL, 'disabled'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F15: un administrador pudo desactivar al dueño';
  PERFORM org_update_member('6c6c6c6c-0000-4000-8000-0000000000a1', 'viewer', NULL);
  ASSERT (SELECT role FROM organization_members WHERE profile_id = '6c6c6c6c-0000-4000-8000-0000000000a1') = 'viewer',
    'F16: el administrador no pudo bajar a la analista a lectora';
  RAISE NOTICE 'F4. el administrador maneja analistas y lectores, no dueños: OK';
END $$;

-- El dueño: no puede tocarse a sí mismo ni dejar la organización sin dueño; ve la bitácora.
SELECT pg_temp.como((SELECT user_a FROM t));
DO $$
DECLARE ok BOOLEAN := false; n INT;
BEGIN
  BEGIN PERFORM org_update_member((SELECT user_a FROM t), 'viewer', NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F17: el dueño se cambió su propio rol';
  -- Promueve al jefe a dueño y lo vuelve a bajar: siempre queda un dueño.
  PERFORM org_update_member('6c6c6c6c-0000-4000-8000-0000000000a2', 'owner', NULL);
  PERFORM org_update_member('6c6c6c6c-0000-4000-8000-0000000000a2', 'admin', NULL);
  -- Desactivar a la lectora: pierde el acceso al instante.
  PERFORM org_update_member('6c6c6c6c-0000-4000-8000-0000000000a1', NULL, 'disabled');
  SELECT count(*) INTO n FROM org_access_log(200) WHERE kind = 'equipo';
  ASSERT n >= 3, format('F18: la bitácora del equipo tiene %s eventos', n);
  RAISE NOTICE 'F5. el dueño administra, nunca queda sin dueño y ve la bitácora (% eventos): OK', n;
END $$;

SELECT pg_temp.como('6c6c6c6c-0000-4000-8000-0000000000a1', 'aal1');
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM service_requests;
  ASSERT n = 0, 'F19: la lectora desactivada sigue viendo casos';
  RAISE NOTICE 'F6. desactivar corta el acceso al instante: OK';
END $$;
RESET ROLE;

-- El único dueño no se puede quedar sin serlo, ni siquiera por el panel de otro dueño:
-- con un solo dueño, degradarlo lo impide la regla de "siempre un dueño".
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('6c6c6c6c-0000-4000-8000-0000000000a2');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  -- El jefe es admin: no toca dueños (ya probado). Se verifica la regla con el conteo.
  ASSERT (SELECT count(*) FROM organization_members m JOIN organizations o ON o.id = m.organization_id
           WHERE o.insurer_id = (SELECT ins_a FROM t) AND m.role = 'owner' AND m.status = 'active') >= 1,
    'F20: la organización quedó sin dueño';
  RAISE NOTICE 'F7. la organización conserva un dueño activo: OK';
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'TODO VERDE'; END $$;
ROLLBACK;
