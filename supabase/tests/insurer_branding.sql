-- =====================================================
-- Marca blanca de la aseguradora (migr. 00135, backlog ASE-05)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Solo dueño/administrador (con 2FA) o el admin de Budi la cambian;
--      color hexadecimal; nombre obligatorio para activarla; el logo solo de
--      su propia carpeta.
--   B. Storage: cada aseguradora sube logos solo a su carpeta.
--   C. La app: el afiliado vigente ve la marca activa de SU aseguradora;
--      nadie más (ni afiliado vencido, ni particular, ni con marca apagada).
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
    ('c9c9c9c9-0000-4000-8000-000000000001', 'mb.admin@budi.invalid',     'Admin'),
    ('c9c9c9c9-0000-4000-8000-000000000002', 'mb.dueno@budi.invalid',     'Dueño Marca'),
    ('c9c9c9c9-0000-4000-8000-000000000003', 'mb.analista@budi.invalid',  'Analista Marca'),
    ('c9c9c9c9-0000-4000-8000-000000000004', 'mb.otro@budi.invalid',      'Dueño Otra'),
    ('c9c9c9c9-0000-4000-8000-000000000005', 'mb.afiliado@budi.invalid',  'Afiliada'),
    ('c9c9c9c9-0000-4000-8000-000000000006', 'mb.vencido@budi.invalid',   'Afiliado vencido'),
    ('c9c9c9c9-0000-4000-8000-000000000007', 'mb.particular@budi.invalid','Particular')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'ADMIN' WHERE id = 'c9c9c9c9-0000-4000-8000-000000000001';

CREATE TEMP TABLE t (org UUID, ins UUID, org2 UUID, ins2 UUID) ON COMMIT DROP;
INSERT INTO t DEFAULT VALUES;
GRANT ALL ON t TO PUBLIC;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como('c9c9c9c9-0000-4000-8000-000000000001');
UPDATE t SET org  = admin_create_institution('INSURER', 'Seguros Marca (prueba)', NULL, NULL, NULL, NULL),
             org2 = admin_create_institution('INSURER', 'Seguros Otra (prueba)', NULL, NULL, NULL, NULL);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE t SET ins = (SELECT insurer_id FROM organizations WHERE id = t.org), ins2 = (SELECT insurer_id FROM organizations WHERE id = t.org2);

INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT o, p::uuid, r, 'active' FROM t, LATERAL (VALUES
  (t.org,  'c9c9c9c9-0000-4000-8000-000000000002', 'owner'),
  (t.org,  'c9c9c9c9-0000-4000-8000-000000000003', 'analyst'),
  (t.org2, 'c9c9c9c9-0000-4000-8000-000000000004', 'owner')) AS x(o, p, r);

-- Afiliada vigente y afiliado vencido de la aseguradora con marca.
WITH plan AS (
  INSERT INTO coverage_plans (insurer_id, code, name) SELECT ins, 'MB', 'Plan Marca' FROM t RETURNING id, insurer_id
), pol AS (
  INSERT INTO policies (insurer_id, plan_id, policy_number, holder_name, starts_on, status)
  SELECT insurer_id, id, 'POL-MARCA', 'Titular', sv_today() - 60, 'active' FROM plan RETURNING id
)
INSERT INTO members (policy_id, profile_id, document_number, full_name, relationship, starts_on, ends_on, is_active)
SELECT pol.id, x.p::uuid, x.doc, x.n, 'holder', sv_today() - 60, x.fin, true
  FROM pol, (VALUES ('c9c9c9c9-0000-4000-8000-000000000005', '01010101-1', 'Afiliada', NULL::date),
                    ('c9c9c9c9-0000-4000-8000-000000000006', '02020202-2', 'Vencido', sv_today() - 1)) AS x(p, doc, n, fin);

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------
-- A. Quién y qué
-- ---------------------------------------------------------------
DO $$
DECLARE ok BOOLEAN;
BEGIN
  PERFORM pg_temp.como('c9c9c9c9-0000-4000-8000-000000000003');  -- analista
  ASSERT NOT (portal_branding()->>'can_edit')::boolean, 'A: el analista puede editar';
  ok := false;
  BEGIN PERFORM portal_save_branding(true, 'X', '#112233', NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: el analista cambió la marca';

  PERFORM pg_temp.como('c9c9c9c9-0000-4000-8000-000000000002', 'aal1');  -- dueño sin 2FA
  ok := false;
  BEGIN PERFORM portal_save_branding(true, 'X', '#112233', NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: el dueño cambió la marca sin 2FA';

  PERFORM pg_temp.como('c9c9c9c9-0000-4000-8000-000000000002');
  ok := false;
  BEGIN PERFORM portal_save_branding(true, 'X', 'rojo', NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: aceptó un color que no es hexadecimal';
  ok := false;
  BEGIN PERFORM portal_save_branding(true, '', '#112233', NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: activó la marca sin nombre';
  ok := false;
  BEGIN PERFORM portal_save_branding(true, 'X', '#112233', (SELECT ins2 FROM t)::text || '/logo.png'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A: apuntó al logo de otra aseguradora';
END $$;

SELECT pg_temp.como('c9c9c9c9-0000-4000-8000-000000000002');
SELECT portal_save_branding(true, 'Asistencia Vial Marca', '#1F4E79', (SELECT ins FROM t)::text || '/logo-1.png');
DO $$
DECLARE b JSONB := portal_branding();
BEGIN
  ASSERT (b->>'enabled')::boolean AND b->>'brand_name' = 'Asistencia Vial Marca' AND b->>'color' = '#1F4E79'
     AND (b->>'can_edit')::boolean, 'A: la marca no quedó guardada: ' || b::text;
  RAISE NOTICE 'A. solo dueño/admin con 2FA; color, nombre y logo validados: OK';
END $$;

-- ---------------------------------------------------------------
-- B. Storage: solo su carpeta
-- ---------------------------------------------------------------
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('insurer-branding', (SELECT ins FROM t)::text || '/logo-1.png', auth.uid());
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('insurer-branding', (SELECT ins2 FROM t)::text || '/logo.png', auth.uid());
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'B: subió un logo a la carpeta de otra aseguradora';
  PERFORM pg_temp.como('c9c9c9c9-0000-4000-8000-000000000003');  -- analista
  ok := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('insurer-branding', (SELECT ins FROM t)::text || '/logo-2.png', auth.uid());
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'B: el analista subió un logo';
  RAISE NOTICE 'B. logos solo en su carpeta y por dueño/admin: OK';
END $$;

-- ---------------------------------------------------------------
-- C. La app del afiliado
-- ---------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.como('c9c9c9c9-0000-4000-8000-000000000005');
  ASSERT my_insurer_branding()->>'brand_name' = 'Asistencia Vial Marca', 'C: la afiliada vigente no ve la marca';
  PERFORM pg_temp.como('c9c9c9c9-0000-4000-8000-000000000006');
  ASSERT my_insurer_branding() IS NULL, 'C: un afiliado vencido ve la marca';
  PERFORM pg_temp.como('c9c9c9c9-0000-4000-8000-000000000007');
  ASSERT my_insurer_branding() IS NULL, 'C: un particular ve una marca';
END $$;
SELECT pg_temp.como('c9c9c9c9-0000-4000-8000-000000000002');
SELECT portal_save_branding(false, 'Asistencia Vial Marca', '#1F4E79', NULL);
SELECT pg_temp.como('c9c9c9c9-0000-4000-8000-000000000005');
DO $$
BEGIN
  ASSERT my_insurer_branding() IS NULL, 'C: con la marca apagada la app la sigue mostrando';
  RAISE NOTICE 'C. solo el afiliado vigente ve la marca activa de su aseguradora: OK';
END $$;

ROLLBACK;
