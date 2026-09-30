-- =====================================================
-- SLA de un caso cancelado: "No aplica" en vez de "Pendiente"
--
-- Visto en el portal de aseguradoras (BUDI-000188): un caso cancelado mostraba
-- la llegada como "Pendiente", como si todavía pudiera ocurrir.
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_case_sla(p_folio text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sr  service_requests;
  v_sla RECORD;
BEGIN
  SELECT sr.* INTO v_sr
    FROM cases c JOIN service_requests sr ON sr.id = c.request_id
   WHERE c.folio = p_folio;

  IF v_sr.id IS NULL THEN
    RAISE EXCEPTION 'Caso no encontrado';
  END IF;

  IF NOT is_staff()
     AND auth.uid() IS DISTINCT FROM v_sr.user_id
     AND auth.uid() IS DISTINCT FROM v_sr.operator_id
     AND NOT request_belongs_to_my_insurer(v_sr.id)
     AND NOT request_belongs_to_my_mopt(v_sr.id) THEN  -- 00100
    RAISE EXCEPTION 'No tienes acceso a este caso';
  END IF;

  -- 00105: la cuenta vive en request_sla(), compartida con la ficha 360 y el
  -- dashboard de negocio.
  SELECT * INTO v_sla FROM request_sla(v_sr.id);

  RETURN jsonb_build_object(
    'folio', p_folio,
    'insurer_name', v_sla.insurer_name,
    -- 00141: con objetivos del contrato MOPT, no "de la plataforma".
    'program_name', (SELECT o.name FROM organizations o
                      WHERE o.type = 'MOPT' AND o.provider_id = v_sr.mopt_provider_id),
    -- 00152: un caso cancelado no "espera" su llegada: la pantalla dice "No aplica".
    'cancelled', v_sr.status = 'cancelled',
    'assignment_seconds', v_sla.assignment_seconds,
    'arrival_seconds',    v_sla.arrival_seconds,
    'service_seconds',    v_sla.service_seconds,
    'assignment_target_minutes', v_sla.assignment_target,
    'arrival_target_minutes',    v_sla.arrival_target,
    'assignment_met', CASE WHEN v_sla.assignment_seconds IS NULL THEN NULL
                           ELSE v_sla.assignment_seconds <= v_sla.assignment_target * 60 END,
    'arrival_met',    CASE WHEN v_sla.arrival_seconds IS NULL THEN NULL
                           ELSE v_sla.arrival_seconds <= v_sla.arrival_target * 60 END
  );
END;
$$;
