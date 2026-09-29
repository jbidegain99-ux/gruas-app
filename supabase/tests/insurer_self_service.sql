-- =====================================================
-- Autoservicio de la aseguradora (migr. 00127, backlog ASE-02)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Roles: solo lectura consulta; analista carga y da de baja; dueño y
--      administrador crean planes y pólizas.
--   B. Aislamiento: nada de otra aseguradora se lee ni se toca.
--   C. 10 000 afiliados en lotes de 2 000, cada uno bajo el límite de 8 s de
--      la API, con el error por fila numerado sobre el archivo completo.
--   D. La baja corta la cobertura al instante.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal2') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

-- Dos aseguradoras nuevas, cada una con su organización.
INSERT INTO insurers (id, name, is_active) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000001', 'Aseguradora Uno (prueba)', true),
  ('a1a1a1a1-0000-4000-8000-000000000002', 'Aseguradora Dos (prueba)', true);
INSERT INTO organizations (type, name, insurer_id)
SELECT 'INSURER', name, id FROM insurers WHERE id IN ('a1a1a1a1-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('b2b2b2b2-0000-4000-8000-000000000001', 'as.dueno@budi.invalid',    'Dueño Uno'),
    ('b2b2b2b2-0000-4000-8000-000000000002', 'as.analista@budi.invalid', 'Analista Uno'),
    ('b2b2b2b2-0000-4000-8000-000000000003', 'as.lector@budi.invalid',   'Lector Uno'),
    ('b2b2b2b2-0000-4000-8000-000000000004', 'as.otro@budi.invalid',     'Dueño Dos')
  ) AS x(id, email, nombre);

INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT o.id, x.p::uuid, x.r, 'active'
  FROM (VALUES ('a1a1a1a1-0000-4000-8000-000000000001', 'b2b2b2b2-0000-4000-8000-000000000001', 'owner'),
               ('a1a1a1a1-0000-4000-8000-000000000001', 'b2b2b2b2-0000-4000-8000-000000000002', 'analyst'),
               ('a1a1a1a1-0000-4000-8000-000000000001', 'b2b2b2b2-0000-4000-8000-000000000003', 'viewer'),
               ('a1a1a1a1-0000-4000-8000-000000000002', 'b2b2b2b2-0000-4000-8000-000000000004', 'owner')) AS x(i, p, r)
  JOIN organizations o ON o.insurer_id = x.i::uuid AND o.type = 'INSURER';

CREATE TEMP TABLE t (plan UUID, poliza UUID, poliza2 UUID, afiliado UUID) ON COMMIT DROP;
INSERT INTO t VALUES (NULL, NULL, NULL, NULL);
GRANT ALL ON t TO PUBLIC;

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------
-- A. Roles
-- ---------------------------------------------------------------
SELECT pg_temp.como('b2b2b2b2-0000-4000-8000-000000000003', 'aal1');  -- lector
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  ASSERT portal_insurer_catalog()->>'role' = 'viewer', 'A1: el lector no ve su catalogo';
  BEGIN
    PERFORM portal_save_plan(NULL, 'X', 'X', NULL, true);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Tu rol%';
  END;
  ASSERT ok, 'A1: el lector creo un plan';
END $$;

SELECT pg_temp.como('b2b2b2b2-0000-4000-8000-000000000001', 'aal2');  -- dueño
DO $$
BEGIN
  UPDATE t SET plan = portal_save_plan(NULL, 'ORO', 'Plan Oro', 'Asistencia completa', true);
  UPDATE t SET poliza = portal_save_policy(NULL, 'POL-0001', 'Empresa Contratante S.A.', (SELECT plan FROM t),
                                            sv_today() - 30, NULL, 'active');
  ASSERT jsonb_array_length(portal_insurer_catalog()->'policies') = 1, 'A2: el dueño no ve su poliza';
END $$;

SELECT pg_temp.como('b2b2b2b2-0000-4000-8000-000000000002', 'aal1');  -- analista
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM portal_save_policy(NULL, 'POL-X', 'X', (SELECT plan FROM t), sv_today(), NULL, 'active');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Tu rol%';
  END;
  ASSERT ok, 'A3: la analista creo una poliza';
  RAISE NOTICE 'A. roles: lector consulta, analista no crea polizas, dueño si: OK';
END $$;

-- ---------------------------------------------------------------
-- C. 10 000 afiliados en 5 lotes de 2 000
-- ---------------------------------------------------------------
-- Un lote por sentencia, como el portal (una llamada a la API por lote): el
-- límite de 8 s del rol authenticated aplica a cada uno.
CREATE TEMP TABLE t_res (lote INT, r JSONB) ON COMMIT DROP;
GRANT ALL ON t_res TO PUBLIC;
SET LOCAL statement_timeout = '8s';
INSERT INTO t_res SELECT 0, portal_import_members((SELECT poliza FROM t), (
  SELECT jsonb_agg(jsonb_build_object(
           'document_number', CASE WHEN n = 7777 THEN '' ELSE lpad(n::text, 8, '0') || '-' || (n % 10) END,
           'full_name', 'Afiliado ' || n,
           'relationship', CASE WHEN n % 3 = 0 THEN 'beneficiario' ELSE 'titular' END))
    FROM generate_series(1, 2000) n), 0);
INSERT INTO t_res SELECT 1, portal_import_members((SELECT poliza FROM t), (
  SELECT jsonb_agg(jsonb_build_object(
           'document_number', CASE WHEN n = 7777 THEN '' ELSE lpad(n::text, 8, '0') || '-' || (n % 10) END,
           'full_name', 'Afiliado ' || n,
           'relationship', CASE WHEN n % 3 = 0 THEN 'beneficiario' ELSE 'titular' END))
    FROM generate_series(2001, 4000) n), 2000);
INSERT INTO t_res SELECT 2, portal_import_members((SELECT poliza FROM t), (
  SELECT jsonb_agg(jsonb_build_object(
           'document_number', CASE WHEN n = 7777 THEN '' ELSE lpad(n::text, 8, '0') || '-' || (n % 10) END,
           'full_name', 'Afiliado ' || n,
           'relationship', CASE WHEN n % 3 = 0 THEN 'beneficiario' ELSE 'titular' END))
    FROM generate_series(4001, 6000) n), 4000);
INSERT INTO t_res SELECT 3, portal_import_members((SELECT poliza FROM t), (
  SELECT jsonb_agg(jsonb_build_object(
           'document_number', CASE WHEN n = 7777 THEN '' ELSE lpad(n::text, 8, '0') || '-' || (n % 10) END,
           'full_name', 'Afiliado ' || n,
           'relationship', CASE WHEN n % 3 = 0 THEN 'beneficiario' ELSE 'titular' END))
    FROM generate_series(6001, 8000) n), 6000);
INSERT INTO t_res SELECT 4, portal_import_members((SELECT poliza FROM t), (
  SELECT jsonb_agg(jsonb_build_object(
           'document_number', CASE WHEN n = 7777 THEN '' ELSE lpad(n::text, 8, '0') || '-' || (n % 10) END,
           'full_name', 'Afiliado ' || n,
           'relationship', CASE WHEN n % 3 = 0 THEN 'beneficiario' ELSE 'titular' END))
    FROM generate_series(8001, 10000) n), 8000);
RESET statement_timeout;
DO $$
DECLARE ins INT; err JSONB;
BEGIN
  SELECT sum((r->>'inserted')::int), jsonb_agg(e) INTO ins, err
    FROM t_res LEFT JOIN LATERAL jsonb_array_elements(r->'errors') e ON true;
  err := (SELECT jsonb_agg(x) FROM jsonb_array_elements(err) x WHERE x <> 'null'::jsonb);
  ASSERT ins = 9999, 'C1: altas esperadas 9999, fueron ' || ins;
  ASSERT jsonb_array_length(err) = 1 AND (err->0->>'row')::int = 7777, 'C2: el error no quedo en la fila 7777: ' || err::text;
  RAISE NOTICE 'C. 10 000 filas en 5 lotes (cada uno bajo 8 s): 9 999 altas y el error en la fila 7 777: OK';
END $$;

-- ---------------------------------------------------------------
-- D. Baja inmediata
-- ---------------------------------------------------------------
DO $$
DECLARE ok BOOLEAN := false; m JSONB;
BEGIN
  m := portal_policy_members((SELECT poliza FROM t), '00000042-2', 10, 0);
  ASSERT (m->>'total')::int = 1, 'D1: la busqueda por documento no encontro al afiliado: ' || m::text;
  UPDATE t SET afiliado = (m->'rows'->0->>'id')::uuid;
  BEGIN
    PERFORM portal_set_member_active((SELECT afiliado FROM t), false, '');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Indica el motivo%';
  END;
  ASSERT ok, 'D2: baja sin motivo';
  PERFORM portal_set_member_active((SELECT afiliado FROM t), false, 'Dejó de pagar la póliza');
END $$;
RESET ROLE;
DO $$
BEGIN
  -- Lo que mira check_member_coverage al pedir un servicio.
  ASSERT NOT (SELECT m.is_active AND m.starts_on <= sv_today() AND (m.ends_on IS NULL OR m.ends_on >= sv_today())
                FROM members m WHERE m.id = (SELECT afiliado FROM t)), 'D3: el afiliado dado de baja sigue cubierto';
  ASSERT EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'members' AND record_id = (SELECT afiliado FROM t)::text),
    'D4: la baja no quedo en la bitacora';
  RAISE NOTICE 'D. la baja corta la cobertura al instante y queda en la bitacora: OK';
END $$;
SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------
-- B. Aislamiento
-- ---------------------------------------------------------------
SELECT pg_temp.como('b2b2b2b2-0000-4000-8000-000000000004', 'aal2');  -- dueño de la otra
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  ASSERT jsonb_array_length(portal_insurer_catalog()->'policies') = 0, 'B1: la otra aseguradora ve polizas ajenas';
  BEGIN
    PERFORM portal_policy_members((SELECT poliza FROM t), NULL, 10, 0);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'Póliza no encontrada';
  END;
  ASSERT ok, 'B2: la otra aseguradora leyo el padron ajeno';
  ok := false;
  BEGIN
    PERFORM portal_set_member_active((SELECT afiliado FROM t), true, NULL);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'Afiliado no encontrado';
  END;
  ASSERT ok, 'B3: la otra aseguradora reactivo un afiliado ajeno';
  ok := false;
  BEGIN
    PERFORM portal_save_policy(NULL, 'POL-Z', 'Z', (SELECT plan FROM t), sv_today(), NULL, 'active');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'Elige uno de tus planes';
  END;
  ASSERT ok, 'B4: la otra aseguradora uso un plan ajeno';
  RAISE NOTICE 'B. aislamiento entre aseguradoras: OK';
END $$;

ROLLBACK;
