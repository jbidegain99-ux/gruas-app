-- =====================================================
-- Estados de cuenta: el ajuste aprobado llega al libro
--
-- Encontrado probando el flujo completo en el portal (2026-09-30): Budi ajustó
-- un caso MOPT de $61.00 a $30.00, el MOPT aprobó $159.60, pero el libro
-- (ledger_obligations) seguía con $61.00. El portal le mostraba al MOPT que le
-- debía al socio el monto original y la tarifa de Budi sin ajustar; las
-- fichas y el dashboard de negocio, igual.
--
-- Regla: cerrado el estado de cuenta (aprobado o pagado), el caso ajustado se
-- debe por el monto ajustado:
--   * MOPT: 'servicio' (MOPT -> socio) = ajustado; 'tarifa_plataforma' en
--     proporción, redondeada por línea como statement_totals.
--   * Aseguradora: 'cobertura' (aseguradora -> Budi) = ajustado. Lo que Budi
--     le debe al socio no cambia: la disputa es entre Budi y su cliente.
-- =====================================================

CREATE OR REPLACE FUNCTION public.ledger_obligations()
RETURNS TABLE(request_id uuid, completed_at timestamp with time zone, service_type text, concept text, debtor_kind text, debtor_id uuid, creditor_kind text, creditor_id uuid, amount numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT sr.id, sr.completed_at, COALESCE(sr.service_type, 'tow') AS service_type,
           sr.total_price, sr.provider_id, sr.operator_id, sr.mopt_provider_id,
           -- 00102: la tasa vigente cuando se completo el servicio, no la de hoy.
           commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS commission_rate,
           mopt_fee_rate_at(sr.mopt_provider_id, sr.completed_at) AS mopt_fee_rate
      FROM service_requests sr
     WHERE sr.status = 'completed'
       AND sr.total_price IS NOT NULL
  ),
  -- 00143: lo que el cliente aprobó. Un caso ajustado en un estado de cuenta
  -- aprobado o pagado se debe por el monto ajustado (y la tarifa, en
  -- proporción, igual que statement_totals). Mientras está emitido, manda el
  -- original. Un servicio vive en un solo estado de cuenta no anulado.
  ajuste AS (
    SELECT l.request_id,
           ob.adjusted_amount AS amount,
           CASE WHEN l.amount > 0 THEN ROUND(l.fee * ob.adjusted_amount / l.amount, 2) ELSE 0 END AS fee
      FROM account_statement_lines l
      JOIN account_statements s      ON s.id = l.statement_id AND s.status IN ('approved', 'paid')
      JOIN statement_observations ob ON ob.statement_id = l.statement_id AND ob.request_id = l.request_id
                                    AND ob.status = 'adjusted'
  )
  SELECT b.id, b.completed_at, b.service_type, 'cobertura',
         'insurer', po.insurer_id, 'budi', NULL::UUID, COALESCE(aj.amount, cu.amount_covered)
    FROM base b
    JOIN coverage_usage cu ON cu.request_id = b.id
    LEFT JOIN ajuste aj    ON aj.request_id = b.id
    JOIN members m         ON m.id = cu.member_id
    JOIN policies po       ON po.id = m.policy_id
   WHERE b.mopt_provider_id IS NULL
     AND cu.amount_covered > 0

  UNION ALL
  SELECT b.id, b.completed_at, b.service_type, 'servicio',
         'budi', NULL::UUID,
         CASE WHEN b.provider_id IS NOT NULL THEN 'provider' ELSE 'operator' END,
         COALESCE(b.provider_id, b.operator_id),
         b.total_price - ROUND(b.total_price * b.commission_rate / 100, 2)
    FROM base b
   WHERE b.mopt_provider_id IS NULL
     AND b.operator_id IS NOT NULL

  -- 00133 (LAN-07): lo que el Usuario le pagó en efectivo al socio ya está en
  -- manos del socio; se descuenta de lo que Budi le debe (mismo par, negativo).
  UNION ALL
  SELECT b.id, b.completed_at, b.service_type, 'efectivo_cobrado',
         'budi', NULL::UUID,
         CASE WHEN b.provider_id IS NOT NULL THEN 'provider' ELSE 'operator' END,
         COALESCE(b.provider_id, b.operator_id),
         -sp.amount
    FROM base b
    JOIN service_payments sp ON sp.request_id = b.id AND sp.status = 'paid' AND sp.method = 'cash'
   WHERE b.mopt_provider_id IS NULL
     AND b.operator_id IS NOT NULL

  UNION ALL
  SELECT b.id, b.completed_at, b.service_type, 'servicio',
         'mopt', b.mopt_provider_id, 'operator', b.operator_id, COALESCE(aj.amount, b.total_price)
    FROM base b
    LEFT JOIN ajuste aj ON aj.request_id = b.id
   WHERE b.mopt_provider_id IS NOT NULL
     AND b.operator_id IS NOT NULL

  UNION ALL
  SELECT b.id, b.completed_at, b.service_type, 'tarifa_plataforma',
         'mopt', b.mopt_provider_id, 'budi', NULL::UUID,
         COALESCE(aj.fee, ROUND(b.total_price * b.mopt_fee_rate / 100, 2))
    FROM base b
    LEFT JOIN ajuste aj ON aj.request_id = b.id
   WHERE b.mopt_provider_id IS NOT NULL
     AND b.mopt_fee_rate > 0;
$$;
