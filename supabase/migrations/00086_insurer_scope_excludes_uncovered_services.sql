-- =====================================================
-- 00086 — La aseguradora solo ve los casos que su plan cubre
--
-- EL BUG
-- `create_service_request` crea la fila de `coverage_usage` en cuanto el que
-- pide esta AFILIADO, sin mirar si el plan cubre ESE tipo de servicio:
-- `check_member_coverage()` responde "tiene poliza vigente" (covered/none/
-- inactive), no "el plan cubre una cerrajeria".
--
-- Como el alcance de la aseguradora se define por "existe consumo ligado a mi
-- poliza", una cerrajeria EXCLUIDA del plan terminaba:
--   · listada en su portal, con direcciones, linea de tiempo y SLA;
--   · contada en `admin_finance_by_insurer` como servicio suyo.
--
-- Medido: con una cerrajeria excluida de $35, Seguros Demo pasaba de
--   2 servicios / bruto 407.50 / copagos 122.50
-- a
--   3 servicios / bruto 442.50 / copagos 157.50
-- con `a_facturar` clavado en 285.00. O sea: le sumaba un servicio que no le
-- toca pagar, le ensuciaba el cumplimiento de SLA y le mostraba un servicio del
-- afiliado que no es asunto suyo.
--
-- El dinero nunca estuvo mal: `complete_service_request` ya dejaba
-- cubierto 0 / copago = precio, y el excluido tampoco quema eventos del plan.
-- Lo que estaba mal era el ALCANCE.
--
-- EL CRITERIO
-- Se resuelve al leer, no al escribir: la fila de consumo se sigue creando
-- (queda el rastro de que un afiliado pidio algo excluido), pero para la
-- aseguradora el caso solo existe si su plan declara cobertura para ese tipo de
-- servicio — el mismo predicado que usa `evaluate_coverage`:
--
--     coverage_rule_lookup(plan, servicio, 'covered') -> existe AND valor <> 0
--
-- Se mira la REGLA, no el monto. Un caso en curso todavia tiene 0/0 y la
-- aseguradora tiene que poder seguirlo en vivo; y uno que quedo en 0 porque el
-- afiliado agoto sus eventos SI es asunto de ella (es un reclamo contra su
-- poliza, negado por agotamiento), asi que sigue viendose.
-- =====================================================

-- ---------------------------------------------------------------
-- Un solo lugar donde vive el predicado, para que los tres lectores
-- no se puedan desincronizar.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plan_cubre_servicio(p_plan_id UUID, p_service_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT r.existe AND COALESCE(r.valor, 0) <> 0
       FROM coverage_rule_lookup(p_plan_id, p_service_type, 'covered') r),
    FALSE);
$$;

COMMENT ON FUNCTION public.plan_cubre_servicio(UUID, TEXT) IS
  'TRUE si el plan declara cobertura para ese tipo de servicio. Mira la regla, '
  'no el monto: un caso en curso vale 0 y aun asi esta dentro del plan.';

REVOKE ALL ON FUNCTION public.plan_cubre_servicio(UUID, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------
-- 1. El alcance de las policies RLS de la aseguradora
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_belongs_to_my_insurer(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM coverage_usage cu
      JOIN members m           ON m.id  = cu.member_id
      JOIN policies po         ON po.id = m.policy_id
      JOIN service_requests sr ON sr.id = cu.request_id
     WHERE cu.request_id = p_request_id
       AND po.insurer_id = auth_insurer_id()
       AND plan_cubre_servicio(po.plan_id, sr.service_type)
  );
$$;

-- ---------------------------------------------------------------
-- 2. La lista del portal
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_insurer_cases()
RETURNS TABLE (
  folio         TEXT,
  service_type  TEXT,
  status        TEXT,
  created_at    TIMESTAMPTZ,
  total_price   NUMERIC,
  coverage_status TEXT,
  cubierto      NUMERIC,
  copago        NUMERIC,
  assignment_met BOOLEAN,
  arrival_met    BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_insurer UUID := auth_insurer_id();
  v_asig INT;
  v_lleg INT;
BEGIN
  IF v_insurer IS NULL THEN
    RAISE EXCEPTION 'Solo una cuenta de aseguradora puede ver sus casos';
  END IF;

  SELECT sla_assignment_minutes, sla_arrival_minutes INTO v_asig, v_lleg
    FROM insurers WHERE id = v_insurer;

  RETURN QUERY
  SELECT
    c.folio,
    sr.service_type,
    sr.status::text,
    sr.created_at,
    sr.total_price,
    sr.coverage_status,
    cu.amount_covered,
    cu.amount_copay,
    CASE WHEN sr.assigned_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (sr.assigned_at - sr.created_at)) <= v_asig * 60 END,
    CASE WHEN sr.activated_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (sr.activated_at - sr.assigned_at)) <= v_lleg * 60 END
  FROM cases c
  JOIN service_requests sr ON sr.id = c.request_id
  -- El consumo es 1:1 con la solicitud (`coverage_usage.request_id` es UNIQUE),
  -- asi que este JOIN no multiplica filas. Va como LEFT por si algun caso
  -- llegara sin fila de consumo.
  LEFT JOIN coverage_usage cu ON cu.request_id = sr.id
  WHERE EXISTS (
    SELECT 1 FROM coverage_usage cu2
    JOIN members m   ON m.id  = cu2.member_id
    JOIN policies po ON po.id = m.policy_id
    WHERE cu2.request_id = sr.id
      AND po.insurer_id = v_insurer
      AND plan_cubre_servicio(po.plan_id, sr.service_type)
  )
  ORDER BY sr.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_insurer_cases() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_insurer_cases() TO authenticated;

-- ---------------------------------------------------------------
-- 3. El reporte del admin, con el mismo alcance que el portal
-- ---------------------------------------------------------------
-- Si el admin le factura por 3 servicios y en su portal la aseguradora ve 2,
-- la conciliacion del mes se cae. Van con el mismo criterio.
CREATE OR REPLACE FUNCTION public.admin_finance_by_insurer(p_from DATE, p_to DATE)
RETURNS TABLE (
  insurer_id  UUID,
  aseguradora TEXT,
  servicios   BIGINT,
  a_facturar  NUMERIC,
  copagos     NUMERIC,
  bruto       NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las finanzas';
  END IF;

  RETURN QUERY
  SELECT i.id, i.name,
         COUNT(*)::BIGINT,
         COALESCE(SUM(cu.amount_covered), 0),
         COALESCE(SUM(cu.amount_copay), 0),
         COALESCE(SUM(sr.total_price), 0)
    FROM service_requests sr
    JOIN coverage_usage cu ON cu.request_id = sr.id
    JOIN members m         ON m.id  = cu.member_id
    JOIN policies po       ON po.id = m.policy_id
    JOIN insurers i        ON i.id  = po.insurer_id
   WHERE sr.status = 'completed'
     AND sr.completed_at >= sv_day_start(p_from)
     AND sr.completed_at <  sv_day_start(p_to + 1)
     AND plan_cubre_servicio(po.plan_id, sr.service_type)
   GROUP BY i.id, i.name
   ORDER BY 4 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_finance_by_insurer(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_finance_by_insurer(DATE, DATE) TO authenticated;
