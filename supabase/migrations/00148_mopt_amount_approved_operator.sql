-- =====================================================
-- Monto aprobado por el MOPT también en el historial del socio y el resumen
--
-- Seguimiento de 00147: en el historial del socio el total ya daba $283.00
-- (con el ajuste) pero la línea de BUDI-001243 seguía en $61.00
-- (my_operator_service_earnings), y el resumen del portal MOPT sumaba el
-- original en "Completados este mes" (mopt_overview).
-- Finanzas del admin queda con el bruto a propósito: es el valor de la
-- operación; el dinero se ve en Cuentas / Negocio, que salen del libro.
-- =====================================================

CREATE OR REPLACE FUNCTION public.my_operator_service_earnings(p_request_ids uuid[])
RETURNS TABLE(request_id uuid, bruto numeric, comision_pct numeric, comision numeric, a_cobrar numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_op UUID := auth.uid();
BEGIN
  IF v_op IS NULL THEN
    RAISE EXCEPTION 'Se necesita una sesion';
  END IF;

  RETURN QUERY
  SELECT sr.id, m.monto, cr.rate,
         ROUND(m.monto * cr.rate / 100, 2),
         m.monto - ROUND(m.monto * cr.rate / 100, 2)
    FROM service_requests sr
    -- 00148: en MOPT, lo aprobado (ajuste del estado de cuenta), como el resumen.
    CROSS JOIN LATERAL (
      SELECT COALESCE(CASE WHEN sr.mopt_provider_id IS NOT NULL
                           THEN (SELECT a.amount FROM statement_adjustment(sr.id) a) END,
                      sr.total_price) AS monto
    ) m
    CROSS JOIN LATERAL (
      SELECT CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 0::numeric
                  ELSE commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) END AS rate
    ) cr
   WHERE sr.id = ANY (p_request_ids)
     AND sr.operator_id = v_op
     AND sr.status = 'completed'
     AND sr.total_price IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.mopt_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
  v_mes_desde TIMESTAMPTZ := sv_day_start(date_trunc('month', sv_today())::date);
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;

  RETURN jsonb_build_object(
    'program_name', (SELECT name FROM providers WHERE id = v_mopt),
    'fee_rate', mopt_fee_rate_at(v_mopt, now()),
    'operators_total', (SELECT count(*) FROM profiles WHERE provider_id = v_mopt AND role = 'OPERATOR'),
    'operators_approved', (SELECT count(*) FROM profiles WHERE provider_id = v_mopt AND role = 'OPERATOR' AND verification_status = 'approved'),
    'zones_active', (SELECT count(*) FROM mopt_zones WHERE provider_id = v_mopt AND is_active),
    'in_progress', (SELECT count(*) FROM service_requests WHERE mopt_provider_id = v_mopt AND status IN ('initiated', 'assigned', 'en_route', 'active')),
    'completed_month', (SELECT count(*) FROM service_requests WHERE mopt_provider_id = v_mopt AND status = 'completed' AND completed_at >= v_mes_desde),
    -- 00148: con el monto aprobado cuando hubo ajuste en un estado de cuenta.
    'amount_month', (SELECT COALESCE(sum(COALESCE((SELECT a.amount FROM statement_adjustment(sr.id) a), sr.total_price)), 0)
                       FROM service_requests sr
                      WHERE sr.mopt_provider_id = v_mopt AND sr.status = 'completed' AND sr.completed_at >= v_mes_desde),
    'owed_to_operators', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all() WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'operator'),
    'owed_to_budi', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all() WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'budi')
  );
END;
$$;
