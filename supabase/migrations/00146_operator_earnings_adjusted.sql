-- =====================================================
-- Ganancias del socio: el monto que el MOPT aprobó
--
-- Visto en el recorrido de punta a punta (2026-09-30): Budi ajustó un caso MOPT
-- de $61.00 a $50.00 y el MOPT aprobó. El libro y el portal MOPT ya decían $50
-- (00143), pero la app del socio seguía mostrando "a pagar" $61.00 en
-- my_operator_earnings. Ahora cuenta lo mismo que el libro.
-- =====================================================

CREATE OR REPLACE FUNCTION public.my_operator_earnings(p_from date, p_to date)
RETURNS TABLE(servicios bigint, bruto numeric, comision_pct numeric, comision numeric, a_pagar numeric, efectivo numeric, saldo numeric)
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
  SELECT
    COUNT(*)::BIGINT,
    COALESCE(SUM(m.monto), 0),
    -- Sin servicios en el periodo: la tasa que le aplicaria hoy. Con tasas
    -- distintas dentro del periodo: NULL, la pantalla dice "varias".
    CASE
      WHEN COUNT(*) = 0 THEN commission_rate_at(
        (SELECT provider_id FROM profiles WHERE id = v_op), v_op, now())
      WHEN MIN(cr.rate) = MAX(cr.rate) THEN MIN(cr.rate)
    END,
    COALESCE(SUM(ROUND(m.monto * cr.rate / 100, 2)), 0),
    COALESCE(SUM(m.monto), 0)
      - COALESCE(SUM(ROUND(m.monto * cr.rate / 100, 2)), 0),
    COALESCE(SUM(ef.cash), 0),
    COALESCE(SUM(m.monto), 0)
      - COALESCE(SUM(ROUND(m.monto * cr.rate / 100, 2)), 0)
      - COALESCE(SUM(ef.cash), 0)
  FROM service_requests sr
  -- Los servicios del MOPT no tienen comision de Budi.
  CROSS JOIN LATERAL (
    SELECT CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 0::numeric
                ELSE commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) END AS rate
  ) cr
  CROSS JOIN LATERAL (SELECT _cash_collected(sr.id) AS cash) ef
  -- 00146: lo que el MOPT aprobó. Un caso ajustado en un estado de cuenta
  -- aprobado o pagado se le paga al socio por el monto ajustado (el mismo que
  -- el libro, 00143); si no, el precio del servicio.
  CROSS JOIN LATERAL (
    SELECT COALESCE((
      SELECT ob.adjusted_amount
        FROM account_statement_lines l
        JOIN account_statements s      ON s.id = l.statement_id AND s.status IN ('approved', 'paid')
        JOIN statement_observations ob ON ob.statement_id = l.statement_id AND ob.request_id = l.request_id
                                      AND ob.status = 'adjusted'
       WHERE l.request_id = sr.id AND sr.mopt_provider_id IS NOT NULL
    ), sr.total_price) AS monto
  ) m
  WHERE sr.operator_id = v_op
    AND sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1);
END;
$$;
