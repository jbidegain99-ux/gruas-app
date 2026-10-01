-- 00154: revisión de punta a punta del MOPT (2026-10-01).
--
-- 1. "Marcar pagado" un estado de cuenta no tocaba el libro. El estado de
--    cuenta del MOPT quedaba "Pagado $297.15" (servicios + tarifa) mientras el
--    libro seguía diciendo que el MOPT le debía la tarifa a Budi. Y los
--    servicios no se le pagan a Budi: el MOPT se los paga directo a sus socios
--    (00099). Ahora, al marcar pagado, se registra en el libro la parte de
--    Budi: la tarifa aprobada (MOPT) o lo aprobado (aseguradora), con tope en
--    el saldo pendiente para no duplicar un pago ya cargado a mano.
-- 2. El consumo del tope y el reporte mensual usaban el precio original y no
--    lo aprobado (00143/00147/00148 alinearon libro, portal y app; estos dos
--    quedaron fuera). Un solo cálculo, igual al del libro: mopt_service_cost.
-- 3. El anexo del reporte mostraba "0 km" en casos sin GPS (00150: sin dato).
-- 4. Un saldo negativo con un socio (el MOPT le pagó y después Budi ajustó el
--    caso a la baja) restaba de lo pendiente con los demás socios.
-- 5. my_payouts dice quién le paga al socio de una flota MOPT.

-- ─── Costo aprobado de un servicio MOPT ────────────────────────────────────
-- Monto del servicio y tarifa de plataforma con la misma regla que
-- ledger_obligations: si Budi ajustó el caso en un estado de cuenta aprobado o
-- pagado, manda el ajuste (y la tarifa en proporción); si no, el original.
CREATE OR REPLACE FUNCTION public.mopt_service_cost(p_request UUID)
RETURNS TABLE (amount NUMERIC, fee NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(aj.amount, sr.total_price),
         COALESCE(aj.fee, ROUND(sr.total_price * mopt_fee_rate_at(sr.mopt_provider_id, sr.completed_at) / 100, 2))
    FROM service_requests sr
    LEFT JOIN LATERAL (
      SELECT ob.adjusted_amount AS amount,
             CASE WHEN l.amount > 0 THEN ROUND(l.fee * ob.adjusted_amount / l.amount, 2) ELSE 0 END AS fee
        FROM account_statement_lines l
        JOIN account_statements s      ON s.id = l.statement_id AND s.status IN ('approved', 'paid')
        JOIN statement_observations ob ON ob.statement_id = l.statement_id AND ob.request_id = l.request_id
                                      AND ob.status = 'adjusted'
       WHERE l.request_id = sr.id
       LIMIT 1
    ) aj ON true
   WHERE sr.id = p_request
     AND sr.total_price IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.mopt_service_cost(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mopt_month_consumption(p_mopt_provider UUID, p_day DATE DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(sum(c.amount + c.fee), 0)
    FROM service_requests sr
    CROSS JOIN LATERAL mopt_service_cost(sr.id) c
   WHERE sr.mopt_provider_id = p_mopt_provider
     AND sr.status = 'completed' AND sr.total_price IS NOT NULL
     AND sr.completed_at >= sv_day_start(date_trunc('month', COALESCE(p_day, sv_today()))::date)
     AND sr.completed_at <  sv_day_start((date_trunc('month', COALESCE(p_day, sv_today())) + interval '1 month')::date);
$$;

CREATE OR REPLACE FUNCTION public._mopt_report_build(p_mopt UUID, p_month DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from DATE := date_trunc('month', p_month)::date;
  v_to   DATE := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_org  UUID;
  c      RECORD;
BEGIN
  SELECT id INTO v_org FROM organizations WHERE provider_id = p_mopt;
  SELECT * INTO c FROM organization_contracts WHERE organization_id = v_org;

  RETURN jsonb_build_object(
    'program', (SELECT name FROM providers WHERE id = p_mopt),
    'month', to_char(v_from, 'YYYY-MM'),
    'compliance', _mopt_compliance_for(p_mopt, v_from, v_to),
    'cost', (SELECT jsonb_build_object(
               'services', COALESCE(sum(k.amount), 0),
               'platform_fee', COALESCE(sum(k.fee), 0),
               'total', mopt_month_consumption(p_mopt, v_from))
               FROM service_requests sr
               CROSS JOIN LATERAL mopt_service_cost(sr.id) k
              WHERE sr.mopt_provider_id = p_mopt AND sr.status = 'completed' AND sr.total_price IS NOT NULL
                AND sr.completed_at >= sv_day_start(v_from) AND sr.completed_at < sv_day_start(v_to + 1)),
    'contract', CASE WHEN c.organization_id IS NULL THEN NULL ELSE jsonb_build_object(
                  'reference', c.reference, 'monthly_cap', c.monthly_cap,
                  'used_pct', CASE WHEN c.monthly_cap > 0
                                   THEN ROUND(100 * mopt_month_consumption(p_mopt, v_from) / c.monthly_cap, 1) END) END,
    -- Anexo: sin nombre, teléfono ni placa del Usuario.
    'annex', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'folio', cs.folio,
               'completed_at', sr.completed_at,
               'service_type', COALESCE(sr.service_type, 'tow'),
               'zone', COALESCE((SELECT z.name FROM mopt_zones z
                                  WHERE z.provider_id = p_mopt AND point_in_polygon(sr.pickup_lat, sr.pickup_lng, z.polygon)
                                  ORDER BY z.created_at LIMIT 1), 'Fuera de zona'),
               -- 00150: sin GPS no hay dato (antes salía 0).
               'km', CASE WHEN cs.approach_km IS NULL AND cs.tow_km IS NULL THEN NULL
                          ELSE ROUND(COALESCE(cs.approach_km, 0) + COALESCE(cs.tow_km, 0), 1) END,
               'cost', k.amount,
               'operator', op.full_name,
               'assignment_met', s.assignment_seconds <= s.assignment_target * 60,
               'arrival_met', s.arrival_seconds <= s.arrival_target * 60) ORDER BY sr.completed_at)
             FROM service_requests sr
             CROSS JOIN LATERAL request_sla(sr.id) s
             LEFT JOIN LATERAL mopt_service_cost(sr.id) k ON true
             LEFT JOIN cases cs ON cs.request_id = sr.id
             LEFT JOIN profiles op ON op.id = sr.operator_id
            WHERE sr.mopt_provider_id = p_mopt AND sr.status = 'completed'
              AND sr.completed_at >= sv_day_start(v_from) AND sr.completed_at < sv_day_start(v_to + 1)), '[]'::jsonb));
END;
$$;

-- ─── Marcar pagado → libro ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_mark_statement_paid(p_id UUID, p_paid_on DATE, p_reference TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org    RECORD;
  v_number TEXT;
  v_kind   TEXT;
  v_payer  UUID;
  v_due    NUMERIC;
  v_saldo  NUMERIC;
  v_pay    NUMERIC;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador registra el pago';
  END IF;
  IF p_paid_on IS NULL OR NULLIF(btrim(COALESCE(p_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica la fecha y la referencia del pago';
  END IF;
  IF p_paid_on > sv_today() THEN
    RAISE EXCEPTION 'La fecha de pago no puede ser futura';
  END IF;

  UPDATE account_statements
     SET status = 'paid', paid_at = p_paid_on, paid_reference = btrim(p_reference), paid_by = auth.uid()
   WHERE id = p_id AND status = 'approved'
  RETURNING number INTO v_number;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo se marca pagado un estado de cuenta aprobado por el cliente';
  END IF;

  -- Lo que este estado de cuenta le debía a Budi. Al MOPT, solo la tarifa:
  -- los servicios se los paga a sus socios (y lo registra en su portal).
  SELECT o.type, o.provider_id, o.insurer_id INTO v_org
    FROM account_statements s JOIN organizations o ON o.id = s.organization_id
   WHERE s.id = p_id;
  IF v_org.type = 'MOPT' THEN
    v_kind := 'mopt';    v_payer := v_org.provider_id;
    v_due := (statement_totals(p_id) ->> 'approvable_fee')::numeric;
  ELSIF v_org.type = 'INSURER' THEN
    v_kind := 'insurer'; v_payer := v_org.insurer_id;
    v_due := (SELECT approved_amount FROM account_statements WHERE id = p_id);
  ELSE
    RETURN;
  END IF;

  -- Con tope en lo pendiente: si Budi ya cargó a mano parte de ese pago, no se
  -- duplica. Mismo candado que register_ledger_payment.
  PERFORM pg_advisory_xact_lock(hashtext(
    'budi:ledger:' || v_kind || ':' || COALESCE(v_payer::text, '') || '->budi:'));
  SELECT b.balance INTO v_saldo
    FROM ledger_balances_all() b
   WHERE b.debtor_kind = v_kind AND b.debtor_id = v_payer AND b.creditor_kind = 'budi';
  v_pay := LEAST(COALESCE(v_due, 0), GREATEST(COALESCE(v_saldo, 0), 0));

  IF v_pay > 0 THEN
    INSERT INTO ledger_payments (payer_kind, payer_id, payee_kind, payee_id, amount, paid_on, reference, note, created_by)
    VALUES (v_kind, v_payer, 'budi', NULL, v_pay, p_paid_on, btrim(p_reference),
            'Estado de cuenta ' || COALESCE(v_number, p_id::text), auth.uid());
  END IF;
END;
$$;

-- ─── Saldos sin negativos en el resumen del MOPT ───────────────────────────
-- Un socio pagado de más no le resta a lo que se les debe a los demás.
CREATE OR REPLACE FUNCTION public.mopt_overview()
RETURNS JSONB
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
    'owed_to_operators', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all()
                           WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'operator' AND balance > 0),
    'overpaid_operators', (SELECT COALESCE(-sum(balance), 0) FROM ledger_balances_all()
                            WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'operator' AND balance < 0),
    'owed_to_budi', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all()
                      WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'budi' AND balance > 0)
  );
END;
$$;

-- ─── Quién le paga al socio ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_payouts()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_provider UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_me AND role = 'OPERATOR') THEN
    RAISE EXCEPTION 'Solo para socios operadores';
  END IF;
  SELECT provider_id INTO v_provider FROM profiles WHERE id = v_me;

  RETURN jsonb_build_object(
    'company', CASE WHEN v_provider IS NOT NULL
                    THEN (SELECT name FROM providers WHERE id = v_provider AND NOT is_mopt) END,
    -- 00154: al socio de una flota MOPT le paga el programa, no Budi.
    'program', CASE WHEN v_provider IS NOT NULL
                    THEN (SELECT name FROM providers WHERE id = v_provider AND is_mopt) END,
    'pending', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all()
                 WHERE creditor_kind = 'operator' AND creditor_id = v_me AND balance > 0),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'paid_on', p.paid_on, 'amount', p.amount, 'reference', p.reference,
               'payer', CASE p.payer_kind WHEN 'budi' THEN 'Budi' ELSE ledger_party_name(p.payer_kind, p.payer_id) END,
               'services', COALESCE(i.services, '[]'::jsonb)) ORDER BY p.paid_on DESC, p.created_at DESC)
        FROM ledger_payments p
        LEFT JOIN payout_items i ON i.ledger_payment_id = p.id
       WHERE p.payee_kind = 'operator' AND p.payee_id = v_me AND p.voided_at IS NULL), '[]'::jsonb)
  );
END;
$$;
