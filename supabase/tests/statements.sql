-- =====================================================
-- Estados de cuenta y observaciones (migr. 00123: MOPT-03, MOPT-04, ASE-03)
--
-- Correr contra la base LOCAL:  pnpm db:test   (en una base limpia, después
-- de `pnpm qa:cycle`, que deja servicios completados de aseguradora y MOPT).
-- Todo corre en una transacción que se revierte.
--
--   A. La aseguradora: el total cuadra con la liquidación del admin.
--   B. El MOPT: servicio + tarifa cuadran con el libro de movimientos.
--   C. Ciclo: borrador invisible al cliente → emitido (congelado) →
--      observación (fuera del total) → ajuste de Budi → aprobado → pagado.
--   D. Permisos: solo lectura no observa, analista no aprueba, otra
--      organización no ve nada, soporte no ve dinero.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID, p_aal TEXT DEFAULT 'aal2') RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

-- El libro de movimientos (00097) visto como el dueño de la base.
-- Solo los casos del estado de cuenta: los que ya están en otro (aprobado,
-- pagado) no entran al borrador nuevo pero siguen en el libro.
CREATE OR REPLACE FUNCTION pg_temp.libro_mopt(p UUID, p_ec UUID) RETURNS TABLE (amount NUMERIC)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT o.amount FROM public.ledger_obligations() o
   WHERE o.debtor_kind = 'mopt' AND o.debtor_id = p
     AND o.request_id IN (SELECT l.request_id FROM public.account_statement_lines l WHERE l.statement_id = p_ec);
$$;
-- Completados del programa en el período que no están en ningún estado de
-- cuenta vigente: el borrador tiene que haberlos tomado todos.
CREATE OR REPLACE FUNCTION pg_temp.mopt_sin_estado(p UUID, p_desde DATE, p_hasta DATE) RETURNS BIGINT
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*) FROM public.service_requests sr
   WHERE sr.mopt_provider_id = p AND sr.status = 'completed' AND sr.total_price IS NOT NULL
     AND sr.completed_at >= public.sv_day_start(p_desde) AND sr.completed_at < public.sv_day_start(p_hasta + 1)
     AND NOT EXISTS (SELECT 1 FROM public.account_statement_lines l JOIN public.account_statements s ON s.id = l.statement_id
                      WHERE l.request_id = sr.id AND s.status <> 'void');
$$;
GRANT EXECUTE ON FUNCTION pg_temp.mopt_sin_estado TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.libro_mopt TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('7c7c7c7c-0000-4000-8000-000000000001', 'ec.admin@budi.invalid',    'Admin EC'),
    ('7c7c7c7c-0000-4000-8000-000000000002', 'ec.dueno@budi.invalid',    'Dueña aseguradora'),
    ('7c7c7c7c-0000-4000-8000-000000000003', 'ec.analista@budi.invalid', 'Analista aseguradora'),
    ('7c7c7c7c-0000-4000-8000-000000000004', 'ec.lector@budi.invalid',   'Lector aseguradora'),
    ('7c7c7c7c-0000-4000-8000-000000000005', 'ec.mopt@budi.invalid',     'Dueño MOPT'),
    ('7c7c7c7c-0000-4000-8000-000000000006', 'ec.soporte@budi.invalid',  'Soporte EC')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'ADMIN'   WHERE id = '7c7c7c7c-0000-4000-8000-000000000001';
UPDATE profiles SET role = 'SUPPORT' WHERE id = '7c7c7c7c-0000-4000-8000-000000000006';

-- La aseguradora con más cobertura cobrable y el MOPT con servicios completados.
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT
  (SELECT o.id FROM organizations o WHERE o.type = 'INSURER' AND o.status = 'active'
     ORDER BY (SELECT count(*) FROM coverage_usage cu JOIN members m ON m.id = cu.member_id
                 JOIN policies po ON po.id = m.policy_id
                WHERE po.insurer_id = o.insurer_id AND cu.amount_covered > 0) DESC LIMIT 1) AS aseg,
  (SELECT o.id FROM organizations o WHERE o.type = 'MOPT' AND o.status = 'active'
     ORDER BY (SELECT count(*) FROM service_requests sr WHERE sr.mopt_provider_id = o.provider_id
                 AND sr.status = 'completed') DESC LIMIT 1) AS mopt,
  DATE '2020-01-01' AS desde,
  (now() AT TIME ZONE 'America/El_Salvador')::date AS hasta,
  '7c7c7c7c-0000-4000-8000-000000000001'::uuid AS admin,
  '7c7c7c7c-0000-4000-8000-000000000002'::uuid AS dueno,
  '7c7c7c7c-0000-4000-8000-000000000003'::uuid AS analista,
  '7c7c7c7c-0000-4000-8000-000000000004'::uuid AS lector,
  '7c7c7c7c-0000-4000-8000-000000000005'::uuid AS moptdueno,
  '7c7c7c7c-0000-4000-8000-000000000006'::uuid AS soporte,
  NULL::uuid AS ec_aseg, NULL::uuid AS ec_mopt, NULL::uuid AS obs, NULL::uuid AS caso;
GRANT ALL ON t TO PUBLIC;

INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT (SELECT aseg FROM t), x.id, x.role, 'active'
  FROM (VALUES ('7c7c7c7c-0000-4000-8000-000000000002'::uuid, 'owner'),
               ('7c7c7c7c-0000-4000-8000-000000000003'::uuid, 'analyst'),
               ('7c7c7c7c-0000-4000-8000-000000000004'::uuid, 'viewer')) AS x(id, role);
INSERT INTO organization_members (organization_id, profile_id, role, status)
SELECT mopt, moptdueno, 'owner', 'active' FROM t WHERE mopt IS NOT NULL;

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------
-- A. Aseguradora: cuadra con la liquidación del admin
-- ---------------------------------------------------------------
SELECT pg_temp.como((SELECT admin FROM t));
DO $$
DECLARE v_ec UUID; v_tot JSONB; v_fin NUMERIC;
BEGIN
  v_ec := admin_generate_statement((SELECT aseg FROM t), (SELECT desde FROM t), (SELECT hasta FROM t));
  UPDATE t SET ec_aseg = v_ec;
  v_tot := (SELECT totals FROM list_statements((SELECT aseg FROM t)) WHERE id = v_ec);
  SELECT COALESCE(sum(f.a_facturar), 0) INTO v_fin
    FROM admin_finance_by_insurer((SELECT desde FROM t), (SELECT hasta FROM t)) f
   WHERE f.insurer_id = (SELECT insurer_id FROM organizations WHERE id = (SELECT aseg FROM t));
  ASSERT (v_tot->>'services')::int > 0, 'A1: la aseguradora no tiene servicios cobrables para probar';
  ASSERT (v_tot->>'amount')::numeric = v_fin,
    format('A2: el estado de cuenta (%s) no cuadra con la liquidacion del admin (%s)', v_tot->>'amount', v_fin);
  ASSERT admin_generate_statement((SELECT aseg FROM t), (SELECT desde FROM t), (SELECT hasta FROM t)) = v_ec, 'A3: regenero otro id';
  ASSERT (SELECT (totals->>'services')::int FROM list_statements((SELECT aseg FROM t)) WHERE id = v_ec) = (v_tot->>'services')::int,
    'A3: regenerar duplico lineas';
  RAISE NOTICE 'A. aseguradora: % servicios, $% — cuadra con la liquidacion', v_tot->>'services', v_tot->>'amount';
END $$;

-- ---------------------------------------------------------------
-- B. MOPT: servicio + tarifa cuadran con el libro
-- ---------------------------------------------------------------
DO $$
DECLARE v_ec UUID; v_tot JSONB; v_libro NUMERIC; v_prov UUID;
BEGIN
  IF (SELECT mopt FROM t) IS NULL THEN
    RAISE NOTICE 'B. sin MOPT en esta base: no se prueba';
    RETURN;
  END IF;
  v_ec := admin_generate_statement((SELECT mopt FROM t), (SELECT desde FROM t), (SELECT hasta FROM t));
  UPDATE t SET ec_mopt = v_ec;
  v_tot := (SELECT totals FROM list_statements((SELECT mopt FROM t)) WHERE id = v_ec);
  SELECT provider_id INTO v_prov FROM organizations WHERE id = (SELECT mopt FROM t);
  SELECT COALESCE(sum(amount), 0) INTO v_libro FROM pg_temp.libro_mopt(v_prov, v_ec);
  ASSERT pg_temp.mopt_sin_estado(v_prov, (SELECT desde FROM t), (SELECT hasta FROM t)) = 0,
    'B1: quedaron servicios del período fuera del borrador';
  ASSERT (v_tot->>'total')::numeric = v_libro,
    format('B1: el estado de cuenta MOPT (%s) no cuadra con el libro (%s)', v_tot->>'total', v_libro);
  RAISE NOTICE 'B. MOPT: % servicios, servicio $% + tarifa $% = libro', v_tot->>'services', v_tot->>'amount', v_tot->>'fee';
END $$;

-- ---------------------------------------------------------------
-- C. Ciclo completo sobre el de la aseguradora
-- ---------------------------------------------------------------
SELECT pg_temp.como((SELECT dueno FROM t));
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM list_statements() WHERE id = (SELECT ec_aseg FROM t)), 'C1: el cliente ve un borrador';
END $$;

SELECT pg_temp.como((SELECT admin FROM t));
DO $$
BEGIN
  ASSERT admin_issue_statement((SELECT ec_aseg FROM t)) LIKE 'EC-%', 'C2: no numero el estado de cuenta';
END $$;

RESET ROLE;
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE account_statement_lines SET amount = amount + 1 WHERE statement_id = (SELECT ec_aseg FROM t);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%ya fue emitido%';
  END;
  ASSERT ok, 'C3: una linea emitida se pudo modificar';
  UPDATE t SET caso = (SELECT request_id FROM account_statement_lines WHERE statement_id = (SELECT ec_aseg FROM t)
                        ORDER BY amount DESC LIMIT 1);
END $$;
SET LOCAL ROLE authenticated;

SELECT pg_temp.como((SELECT analista FROM t), 'aal1');
DO $$
DECLARE antes NUMERIC; despues JSONB; ok BOOLEAN := false;
BEGIN
  antes := (statement_detail((SELECT ec_aseg FROM t))->'totals'->>'approvable')::numeric;
  UPDATE t SET obs = observe_statement_case((SELECT ec_aseg FROM t), (SELECT caso FROM t),
                                            'El afiliado dice que el socio llegó 2 horas tarde');
  despues := statement_detail((SELECT ec_aseg FROM t))->'totals';
  ASSERT (despues->>'observed_open')::int = 1, 'C4: no quedo observado';
  ASSERT (despues->>'approvable')::numeric < antes, 'C4: lo observado sigue en el total aprobable';
  BEGIN
    PERFORM approve_statement((SELECT ec_aseg FROM t));
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Solo el dueño%';
  END;
  ASSERT ok, 'C5: la analista aprobo';
END $$;

SELECT pg_temp.como((SELECT lector FROM t), 'aal1');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  ASSERT (statement_detail((SELECT ec_aseg FROM t))->>'can_observe')::boolean = false, 'C6: lector puede observar';
  BEGIN
    PERFORM observe_statement_case((SELECT ec_aseg FROM t), (SELECT caso FROM t), 'yo tambien');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%solo lectura%';
  END;
  ASSERT ok, 'C6: el lector observo';
END $$;

SELECT pg_temp.como((SELECT admin FROM t));
DO $$
DECLARE v_monto NUMERIC;
BEGIN
  SELECT (l->>'amount')::numeric INTO v_monto
    FROM jsonb_array_elements(statement_detail((SELECT ec_aseg FROM t))->'lines') l
   WHERE l->>'request_id' = (SELECT caso FROM t)::text;
  PERFORM admin_answer_observation((SELECT obs FROM t), 'Revisado el recorrido: se ajusta a la mitad', 'adjusted', round(v_monto / 2, 2));
END $$;

SELECT pg_temp.como((SELECT dueno FROM t), 'aal2');
DO $$
DECLARE d JSONB; v NUMERIC;
BEGIN
  d := statement_detail((SELECT ec_aseg FROM t));
  ASSERT (d->>'can_approve')::boolean, 'C8: la duena no puede aprobar';
  ASSERT (SELECT jsonb_array_length(l->'observation'->'events') FROM jsonb_array_elements(d->'lines') l
           WHERE l->>'request_id' = (SELECT caso FROM t)::text) = 2, 'C8: el hilo no muestra las dos partes';
  v := approve_statement((SELECT ec_aseg FROM t));
  ASSERT v = (d->'totals'->>'approvable')::numeric, 'C8: aprobo otro monto';
  ASSERT (d->'totals'->>'approvable')::numeric < (d->'totals'->>'total')::numeric, 'C8: el ajuste no bajo el total';
END $$;

-- C8b (00143): aprobado, el libro cobra a la aseguradora lo aprobado (con el ajuste).
RESET ROLE;
DO $$
BEGIN
  ASSERT (SELECT sum(o.amount) FROM ledger_obligations() o
           WHERE o.concept = 'cobertura'
             AND o.request_id IN (SELECT request_id FROM account_statement_lines WHERE statement_id = (SELECT ec_aseg FROM t)))
       = (SELECT approved_amount FROM account_statements WHERE id = (SELECT ec_aseg FROM t)),
    'C8b: el libro no refleja el ajuste aprobado';
END $$;
SET LOCAL ROLE authenticated;

SELECT pg_temp.como((SELECT admin FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_mark_statement_paid((SELECT ec_aseg FROM t), sv_today(), '');
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'C9: se marco pagado sin referencia';
  PERFORM admin_mark_statement_paid((SELECT ec_aseg FROM t), sv_today(), 'Transferencia 000123');
  ASSERT (SELECT status FROM list_statements((SELECT aseg FROM t)) WHERE id = (SELECT ec_aseg FROM t)) = 'paid', 'C9: no quedo pagado';
  RAISE NOTICE 'C. borrador → emitido (congelado) → observado → ajustado → aprobado → pagado: OK';
END $$;

-- ---------------------------------------------------------------
-- D. Aislamiento
-- ---------------------------------------------------------------
SELECT pg_temp.como((SELECT moptdueno FROM t), 'aal2');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  IF (SELECT mopt FROM t) IS NULL THEN RETURN; END IF;
  ASSERT NOT EXISTS (SELECT 1 FROM list_statements() WHERE id = (SELECT ec_aseg FROM t)), 'D1: el MOPT ve el de la aseguradora';
  BEGIN
    PERFORM statement_detail((SELECT ec_aseg FROM t));
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'Estado de cuenta no encontrado';
  END;
  ASSERT ok, 'D1: el MOPT abrio el detalle de otra organizacion';
END $$;

SELECT pg_temp.como((SELECT soporte FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM statement_detail((SELECT ec_aseg FROM t));
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'D2: soporte vio un estado de cuenta (es dinero)';
  ok := false;
  BEGIN
    PERFORM count(*) FROM account_statement_lines;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'D3: las lineas son legibles directo';
  RAISE NOTICE 'D. aislamiento entre organizaciones y sin dinero para soporte: OK';
END $$;

ROLLBACK;
