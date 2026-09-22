-- =====================================================
-- 00066 — B-15: medición de SLA por caso + objetivos por aseguradora
--
-- Cada caso tiene cuatro hitos que YA quedan registrados con su timestamp en
-- service_requests: creación (created_at), asignación (assigned_at), llegada
-- (activated_at — el PIN se verifica cuando el operador llega) y cierre
-- (completed_at). De ahí salen los tres intervalos que le importan a una
-- aseguradora:
--     asignación = created_at  → assigned_at   (¿cuánto tardó en haber operador?)
--     llegada    = assigned_at → activated_at  (¿cuánto tardó en llegar?)
--     servicio   = activated_at → completed_at (¿cuánto duró la atención?)
--
-- POR QUÉ SE CALCULAN, NO SE GUARDAN
-- Los timestamps de service_requests son la fuente de verdad; duplicar los
-- intervalos en `cases` solo abre la puerta a que se desincronicen. `get_case_sla`
-- los calcula al vuelo. Si algún reporte de B-24 necesitara velocidad, se
-- materializa entonces — no antes.
--
-- EL OBJETIVO ES POR ASEGURADORA
-- Cada aseguradora pacta sus propios tiempos (asignar en X, llegar en Y). Van en
-- `insurers`; un servicio particular (sin aseguradora) se mide contra un objetivo
-- por defecto de la plataforma.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Objetivos de SLA por aseguradora
-- ---------------------------------------------------------------
-- Defaults pensados para El Salvador: asignar en 10 min, llegar en 45 (tráfico +
-- geografía). Son el punto de partida; cada aseguradora ajusta los suyos.
ALTER TABLE public.insurers
  ADD COLUMN IF NOT EXISTS sla_assignment_minutes INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS sla_arrival_minutes    INT NOT NULL DEFAULT 45;

COMMENT ON COLUMN public.insurers.sla_assignment_minutes IS
  'B-15: objetivo — minutos máximos entre solicitud y asignación de operador.';
COMMENT ON COLUMN public.insurers.sla_arrival_minutes IS
  'B-15: objetivo — minutos máximos entre asignación y llegada (PIN verificado).';

-- ---------------------------------------------------------------
-- 2. El SLA de un caso: tiempos reales + cumplimiento
-- ---------------------------------------------------------------
-- Devuelve, por folio: los tres intervalos (en segundos, NULL si el hito aún no
-- ocurrió), el objetivo aplicado, si se cumplió cada tramo, y de qué aseguradora
-- salió el objetivo (NULL = particular, objetivo por defecto).
--
-- La aseguradora del caso se resuelve por la cadena de cobertura
-- (request → coverage_usage → member → policy → insurer). Un caso sin cobertura
-- cae al objetivo por defecto de la plataforma.
--
-- SECURITY DEFINER + acceso: admin cualquiera; cliente/operador solo el suyo
-- (mismo criterio que get_case_timeline).
CREATE OR REPLACE FUNCTION public.get_case_sla(p_folio TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sr           service_requests;
  v_user_id      UUID;
  v_operator     UUID;
  v_insurer_name TEXT;
  v_asig_target  INT := 10;   -- default plataforma
  v_lleg_target  INT := 45;
  v_asig_secs    NUMERIC;
  v_lleg_secs    NUMERIC;
  v_serv_secs    NUMERIC;
BEGIN
  SELECT sr.* INTO v_sr
    FROM cases c JOIN service_requests sr ON sr.id = c.request_id
   WHERE c.folio = p_folio;

  IF v_sr.id IS NULL THEN
    RAISE EXCEPTION 'Caso no encontrado';
  END IF;

  v_user_id := v_sr.user_id;
  v_operator := v_sr.operator_id;
  IF NOT is_admin()
     AND auth.uid() IS DISTINCT FROM v_user_id
     AND auth.uid() IS DISTINCT FROM v_operator THEN
    RAISE EXCEPTION 'No tenes acceso a este caso';
  END IF;

  -- Objetivo: el de la aseguradora del caso, si la hay.
  SELECT i.name, i.sla_assignment_minutes, i.sla_arrival_minutes
    INTO v_insurer_name, v_asig_target, v_lleg_target
    FROM coverage_usage cu
    JOIN members m   ON m.id = cu.member_id
    JOIN policies p  ON p.id = m.policy_id
    JOIN insurers i  ON i.id = p.insurer_id
   WHERE cu.request_id = v_sr.id
   LIMIT 1;

  -- Sin cobertura: coalesce restaura los defaults de plataforma.
  v_asig_target := COALESCE(v_asig_target, 10);
  v_lleg_target := COALESCE(v_lleg_target, 45);

  v_asig_secs := EXTRACT(EPOCH FROM (v_sr.assigned_at  - v_sr.created_at));
  v_lleg_secs := EXTRACT(EPOCH FROM (v_sr.activated_at - v_sr.assigned_at));
  v_serv_secs := EXTRACT(EPOCH FROM (v_sr.completed_at - v_sr.activated_at));

  RETURN jsonb_build_object(
    'folio', p_folio,
    'insurer_name', v_insurer_name,             -- NULL = particular
    'assignment_seconds', v_asig_secs,
    'arrival_seconds',    v_lleg_secs,
    'service_seconds',    v_serv_secs,
    'assignment_target_minutes', v_asig_target,
    'arrival_target_minutes',    v_lleg_target,
    -- met = null mientras el hito no ocurrió; true/false una vez que ocurrió.
    'assignment_met', CASE WHEN v_asig_secs IS NULL THEN NULL
                           ELSE v_asig_secs <= v_asig_target * 60 END,
    'arrival_met',    CASE WHEN v_lleg_secs IS NULL THEN NULL
                           ELSE v_lleg_secs <= v_lleg_target * 60 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_case_sla(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_case_sla(TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_case_sla(TEXT) IS
  'B-15: tiempos reales del caso (asignación/llegada/servicio) y cumplimiento '
  'contra el objetivo de su aseguradora (o el default). Admin cualquiera; '
  'cliente/operador solo el suyo.';
