-- 00099: libro de movimientos, registro de pagos y el portal del MOPT.
--
-- Hasta aca la liquidacion era un REPORTE: decia cuanto le tocaba a cada quien,
-- pero no quedaba asentado que se pago, cuando ni por que monto.
--
-- Diseno:
-- * Lo que se DEBE no se guarda: se deriva de los servicios completados, que ya
--   tienen el precio congelado (`ledger_obligations`). Una tabla de deudas
--   necesitaria un trigger o un cron que la mantenga al dia, y el modo de falla
--   de eso es silencioso. Mismo criterio que la liquidacion de la 00079/00091:
--   una sola definicion (effective_commission_rate) para el reporte y el libro.
-- * Lo que se PAGA si se guarda (`ledger_payments`), porque es un hecho externo
--   que el sistema no puede deducir. Nunca se borra: un pago mal cargado se
--   ANULA con motivo, y queda en la bitacora (00094).
-- * Saldo = debido - pagado, por par (quien debe -> a quien).
--
-- Movimientos que genera cada servicio completado con precio:
--   aseguradora -> Budi   lo que cubre el plan (coverage_usage.amount_covered)
--   Budi -> empresa       bruto - comision   (o al operador si es independiente)
--   MOPT -> operador       el bruto entero    (servicios del MOPT; Budi no media)
--   MOPT -> Budi           la tarifa de plataforma (mopt_fee_rate), si es > 0
--
-- Lo que paga el USUARIO (particular o copago) no entra: hoy nadie cobra dentro
-- del sistema y como se cobra (efectivo al operador o pasarela) es una decision
-- pendiente. Cuando se tome, se suma aca como otro movimiento.

-- ---------------------------------------------------------------
-- 1. Lo que se debe (derivado)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_obligations()
RETURNS TABLE (
  request_id    UUID,
  completed_at  TIMESTAMPTZ,
  service_type  TEXT,
  concept       TEXT,
  debtor_kind   TEXT,
  debtor_id     UUID,
  creditor_kind TEXT,
  creditor_id   UUID,
  amount        NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT sr.id, sr.completed_at, COALESCE(sr.service_type, 'tow') AS service_type,
           sr.total_price, sr.provider_id, sr.operator_id, sr.mopt_provider_id,
           ope.commission_rate AS operator_rate
      FROM service_requests sr
      LEFT JOIN profiles ope ON ope.id = sr.operator_id
     WHERE sr.status = 'completed'
       AND sr.total_price IS NOT NULL
  )
  -- La aseguradora le debe a Budi lo que cubre el plan.
  SELECT b.id, b.completed_at, b.service_type, 'cobertura',
         'insurer', po.insurer_id, 'budi', NULL::UUID, cu.amount_covered
    FROM base b
    JOIN coverage_usage cu ON cu.request_id = b.id
    JOIN members m         ON m.id = cu.member_id
    JOIN policies po       ON po.id = m.policy_id
   WHERE b.mopt_provider_id IS NULL
     AND cu.amount_covered > 0

  UNION ALL
  -- Budi le debe a quien presto el servicio: bruto menos comision. Misma cuenta
  -- que admin_settlement_by_provider (ROUND por linea, 00081).
  SELECT b.id, b.completed_at, b.service_type, 'servicio',
         'budi', NULL::UUID,
         CASE WHEN b.provider_id IS NOT NULL THEN 'provider' ELSE 'operator' END,
         COALESCE(b.provider_id, b.operator_id),
         b.total_price - ROUND(b.total_price * effective_commission_rate(b.provider_id, b.operator_rate) / 100, 2)
    FROM base b
   WHERE b.mopt_provider_id IS NULL
     AND b.operator_id IS NOT NULL

  UNION ALL
  -- El MOPT le debe a su operador el servicio entero.
  SELECT b.id, b.completed_at, b.service_type, 'servicio',
         'mopt', b.mopt_provider_id, 'operator', b.operator_id, b.total_price
    FROM base b
   WHERE b.mopt_provider_id IS NOT NULL
     AND b.operator_id IS NOT NULL

  UNION ALL
  -- El MOPT le debe a Budi la tarifa de plataforma, si se configuro una.
  SELECT b.id, b.completed_at, b.service_type, 'tarifa_plataforma',
         'mopt', b.mopt_provider_id, 'budi', NULL::UUID,
         ROUND(b.total_price * mopt_fee_rate(b.mopt_provider_id) / 100, 2)
    FROM base b
   WHERE b.mopt_provider_id IS NOT NULL
     AND mopt_fee_rate(b.mopt_provider_id) > 0;
$$;

REVOKE ALL ON FUNCTION public.ledger_obligations() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- 2. Lo que se paga (hecho externo, append-only)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ledger_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_kind    TEXT NOT NULL CHECK (payer_kind IN ('budi', 'insurer', 'mopt')),
  payer_id      UUID,
  payee_kind    TEXT NOT NULL CHECK (payee_kind IN ('budi', 'provider', 'operator')),
  payee_id      UUID,
  amount        NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  paid_on       DATE NOT NULL,
  reference     TEXT,
  note          TEXT,
  created_by    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at     TIMESTAMPTZ,
  voided_by     UUID,
  void_reason   TEXT,
  -- Budi no tiene id; cualquier otra parte si.
  CHECK ((payer_kind = 'budi') = (payer_id IS NULL)),
  CHECK ((payee_kind = 'budi') = (payee_id IS NULL)),
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_ledger_payments_pair
  ON public.ledger_payments (payer_kind, payer_id, payee_kind, payee_id) WHERE voided_at IS NULL;

ALTER TABLE public.ledger_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_payments: admin lee" ON public.ledger_payments;
CREATE POLICY "ledger_payments: admin lee" ON public.ledger_payments
  FOR SELECT TO authenticated USING (is_admin());

-- Solo se escribe por las RPC de abajo, que validan quien paga a quien.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ledger_payments FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit ON public.ledger_payments;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.ledger_payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- ---------------------------------------------------------------
-- 3. Saldos
-- ---------------------------------------------------------------
-- Nombre legible de una parte. Budi no tiene fila.
CREATE OR REPLACE FUNCTION public.ledger_party_name(p_kind TEXT, p_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_kind
    WHEN 'budi'     THEN 'Budi'
    WHEN 'insurer'  THEN (SELECT name FROM insurers WHERE id = p_id)
    WHEN 'provider' THEN (SELECT name FROM providers WHERE id = p_id)
    WHEN 'mopt'      THEN (SELECT name FROM providers WHERE id = p_id)
    WHEN 'operator' THEN (SELECT full_name FROM profiles WHERE id = p_id)
  END;
$$;

REVOKE ALL ON FUNCTION public.ledger_party_name(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- Un solo lugar que junta lo debido con lo pagado. Lo usan el admin, el portal
-- MOPT y la validacion de pagos: si divergieran, la pantalla mostraria un saldo y
-- el sistema rechazaria el pago contra otro.
CREATE OR REPLACE FUNCTION public.ledger_balances_all()
RETURNS TABLE (
  debtor_kind   TEXT,
  debtor_id     UUID,
  creditor_kind TEXT,
  creditor_id   UUID,
  services      BIGINT,
  owed          NUMERIC,
  paid          NUMERIC,
  balance       NUMERIC,
  last_paid_on  DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH debido AS (
    SELECT o.debtor_kind, o.debtor_id, o.creditor_kind, o.creditor_id,
           COUNT(DISTINCT o.request_id) AS services, SUM(o.amount) AS owed
      FROM ledger_obligations() o
     GROUP BY 1, 2, 3, 4
  ),
  pagado AS (
    SELECT lp.payer_kind, lp.payer_id, lp.payee_kind, lp.payee_id,
           SUM(lp.amount) AS paid, MAX(lp.paid_on) AS last_paid_on
      FROM ledger_payments lp
     WHERE lp.voided_at IS NULL
     GROUP BY 1, 2, 3, 4
  )
  SELECT COALESCE(d.debtor_kind, p.payer_kind),
         COALESCE(d.debtor_id, p.payer_id),
         COALESCE(d.creditor_kind, p.payee_kind),
         COALESCE(d.creditor_id, p.payee_id),
         COALESCE(d.services, 0),
         COALESCE(d.owed, 0),
         COALESCE(p.paid, 0),
         COALESCE(d.owed, 0) - COALESCE(p.paid, 0),
         p.last_paid_on
    FROM debido d
    FULL JOIN pagado p
      ON p.payer_kind = d.debtor_kind
     AND p.payer_id IS NOT DISTINCT FROM d.debtor_id
     AND p.payee_kind = d.creditor_kind
     AND p.payee_id IS NOT DISTINCT FROM d.creditor_id;
$$;

REVOKE ALL ON FUNCTION public.ledger_balances_all() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_ledger_balances()
RETURNS TABLE (
  debtor_kind   TEXT,
  debtor_id     UUID,
  debtor_name   TEXT,
  creditor_kind TEXT,
  creditor_id   UUID,
  creditor_name TEXT,
  services      BIGINT,
  owed          NUMERIC,
  paid          NUMERIC,
  balance       NUMERIC,
  last_paid_on  DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las cuentas';
  END IF;

  RETURN QUERY
  SELECT b.debtor_kind, b.debtor_id, ledger_party_name(b.debtor_kind, b.debtor_id),
         b.creditor_kind, b.creditor_id, ledger_party_name(b.creditor_kind, b.creditor_id),
         b.services, b.owed, b.paid, b.balance, b.last_paid_on
    FROM ledger_balances_all() b
   ORDER BY b.balance DESC, 3, 6;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ledger_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ledger_balances() TO authenticated;

-- ---------------------------------------------------------------
-- 4. Registrar y anular pagos
-- ---------------------------------------------------------------
-- Quien puede registrar que:
--   admin: cualquier par que el libro conoce (Budi->empresa/operador,
--          aseguradora->Budi, MOPT->Budi, MOPT->operador).
--   MOPT:   solo pagos de SU programa a operadores a los que les debe.
-- No se puede pagar de mas: el monto no supera el saldo del par. El advisory
-- lock serializa dos pagos simultaneos al mismo par (los dos leerian el mismo
-- saldo y los dos pasarian la validacion).
CREATE OR REPLACE FUNCTION public.register_ledger_payment(
  p_payer_kind TEXT,
  p_payer_id   UUID,
  p_payee_kind TEXT,
  p_payee_id   UUID,
  p_amount     NUMERIC,
  p_paid_on    DATE DEFAULT NULL,
  p_reference  TEXT DEFAULT NULL,
  p_note       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt     UUID := auth_mopt_id();
  v_saldo   NUMERIC;
  v_id      UUID;
  v_paid_on DATE := COALESCE(p_paid_on, sv_today());
BEGIN
  IF NOT is_admin() THEN
    IF v_mopt IS NULL THEN
      RAISE EXCEPTION 'No tienes permiso para registrar pagos';
    END IF;
    IF p_payer_kind <> 'mopt' OR p_payer_id IS DISTINCT FROM v_mopt OR p_payee_kind <> 'operator' THEN
      RAISE EXCEPTION 'Desde el portal MOPT solo se registran pagos del programa a sus operadores';
    END IF;
  END IF;

  IF (p_payer_kind, p_payee_kind) NOT IN (
       ('budi', 'provider'), ('budi', 'operator'),
       ('insurer', 'budi'), ('mopt', 'budi'), ('mopt', 'operator')) THEN
    RAISE EXCEPTION 'Ese tipo de pago no existe en el libro';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto tiene que ser mayor que cero';
  END IF;
  IF round(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'El monto admite hasta dos decimales';
  END IF;
  IF v_paid_on > sv_today() THEN
    RAISE EXCEPTION 'La fecha de pago no puede ser futura';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(
    'budi:ledger:' || p_payer_kind || ':' || COALESCE(p_payer_id::text, '') ||
    '->' || p_payee_kind || ':' || COALESCE(p_payee_id::text, '')));

  SELECT b.balance INTO v_saldo
    FROM ledger_balances_all() b
   WHERE b.debtor_kind = p_payer_kind
     AND b.debtor_id IS NOT DISTINCT FROM p_payer_id
     AND b.creditor_kind = p_payee_kind
     AND b.creditor_id IS NOT DISTINCT FROM p_payee_id;

  IF v_saldo IS NULL OR v_saldo <= 0 THEN
    RAISE EXCEPTION 'No hay saldo pendiente entre esas partes';
  END IF;
  IF p_amount > v_saldo THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo pendiente (%)', p_amount, v_saldo;
  END IF;

  INSERT INTO ledger_payments (
    payer_kind, payer_id, payee_kind, payee_id, amount, paid_on,
    reference, note, created_by
  ) VALUES (
    p_payer_kind, p_payer_id, p_payee_kind, p_payee_id, p_amount, v_paid_on,
    NULLIF(trim(p_reference), ''), NULLIF(trim(p_note), ''), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_ledger_payment(TEXT, UUID, TEXT, UUID, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_ledger_payment(TEXT, UUID, TEXT, UUID, NUMERIC, DATE, TEXT, TEXT) TO authenticated;

-- Un pago no se borra: se anula con motivo. El admin anula cualquiera; el MOPT,
-- solo los de su programa.
CREATE OR REPLACE FUNCTION public.void_ledger_payment(p_payment_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pago ledger_payments;
BEGIN
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Indica por que se anula el pago';
  END IF;

  -- FOR UPDATE antes del guard: dos anulaciones simultaneas no pasan las dos.
  SELECT * INTO v_pago FROM ledger_payments WHERE id = p_payment_id FOR UPDATE;
  IF v_pago.id IS NULL THEN
    RAISE EXCEPTION 'El pago no existe';
  END IF;
  -- COALESCE: para quien no es MOPT, auth_mopt_id() es NULL, la comparacion da
  -- NULL, "NOT NULL" tambien es NULL, y un IF con NULL NO entra. Sin esto
  -- cualquier usuario con sesion anulaba pagos del MOPT.
  IF NOT is_admin()
     AND NOT COALESCE(v_pago.payer_kind = 'mopt' AND v_pago.payer_id = auth_mopt_id(), false) THEN
    RAISE EXCEPTION 'El pago no existe';
  END IF;
  IF v_pago.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'El pago ya estaba anulado';
  END IF;

  UPDATE ledger_payments
     SET voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   WHERE id = p_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.void_ledger_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_ledger_payment(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ledger_payments(p_limit INT DEFAULT 100)
RETURNS TABLE (
  id UUID, payer_kind TEXT, payer_name TEXT, payee_kind TEXT, payee_name TEXT,
  amount NUMERIC, paid_on DATE, reference TEXT, note TEXT,
  created_by_name TEXT, created_at TIMESTAMPTZ, voided_at TIMESTAMPTZ, void_reason TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver los pagos';
  END IF;
  RETURN QUERY
  SELECT lp.id, lp.payer_kind, ledger_party_name(lp.payer_kind, lp.payer_id),
         lp.payee_kind, ledger_party_name(lp.payee_kind, lp.payee_id),
         lp.amount, lp.paid_on, lp.reference, lp.note,
         (SELECT full_name FROM profiles WHERE profiles.id = lp.created_by),
         lp.created_at, lp.voided_at, lp.void_reason
    FROM ledger_payments lp
   ORDER BY lp.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 500);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ledger_payments(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ledger_payments(INT) TO authenticated;

-- ---------------------------------------------------------------
-- 5. Portal MOPT (/mopt)
-- ---------------------------------------------------------------
-- Todo por RPC con auth_mopt_id(): la cuenta MOPT no recibe politicas sobre
-- tablas, asi que no hay por donde leer mas alla de su programa. Y sin datos
-- personales del usuario (nombre, telefono, DUI), por el Decreto 144: el MOPT
-- ve el servicio y a SUS operadores, no a la persona atendida.
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
    'fee_rate', mopt_fee_rate(v_mopt),
    'operators_total', (SELECT count(*) FROM profiles WHERE provider_id = v_mopt AND role = 'OPERATOR'),
    'operators_approved', (SELECT count(*) FROM profiles WHERE provider_id = v_mopt AND role = 'OPERATOR' AND verification_status = 'approved'),
    'zones_active', (SELECT count(*) FROM mopt_zones WHERE provider_id = v_mopt AND is_active),
    'in_progress', (SELECT count(*) FROM service_requests WHERE mopt_provider_id = v_mopt AND status IN ('initiated', 'assigned', 'en_route', 'active')),
    'completed_month', (SELECT count(*) FROM service_requests WHERE mopt_provider_id = v_mopt AND status = 'completed' AND completed_at >= v_mes_desde),
    'amount_month', (SELECT COALESCE(sum(total_price), 0) FROM service_requests WHERE mopt_provider_id = v_mopt AND status = 'completed' AND completed_at >= v_mes_desde),
    'owed_to_operators', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all() WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'operator'),
    'owed_to_budi', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all() WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'budi')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mopt_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.mopt_list_services(p_from DATE, p_to DATE)
RETURNS TABLE (
  id UUID, folio TEXT, status TEXT, service_type TEXT, pickup_address TEXT,
  operator_name TEXT, created_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, total_price NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;

  RETURN QUERY
  SELECT sr.id, c.folio, sr.status::text, COALESCE(sr.service_type, 'tow'), sr.pickup_address,
         ope.full_name, sr.created_at, sr.completed_at, sr.total_price
    FROM service_requests sr
    LEFT JOIN cases c      ON c.request_id = sr.id
    LEFT JOIN profiles ope ON ope.id = sr.operator_id
   WHERE sr.mopt_provider_id = v_mopt
     AND sr.created_at >= sv_day_start(p_from)
     AND sr.created_at <  sv_day_start(p_to + 1)
   ORDER BY sr.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.mopt_list_services(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_list_services(DATE, DATE) TO authenticated;

-- Sus operadores y lo que les debe. Incluye a quien ya no esta en el programa
-- pero todavia tiene saldo: irse no cancela la deuda.
CREATE OR REPLACE FUNCTION public.mopt_list_operators()
RETURNS TABLE (
  operator_id UUID, full_name TEXT, phone TEXT, verification_status TEXT,
  in_program BOOLEAN, services BIGINT, owed NUMERIC, paid NUMERIC, balance NUMERIC, last_paid_on DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;

  RETURN QUERY
  WITH saldos AS (
    SELECT * FROM ledger_balances_all()
     WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'operator'
  ),
  ops AS (
    SELECT p.id FROM profiles p WHERE p.provider_id = v_mopt AND p.role = 'OPERATOR'
    UNION
    SELECT s.creditor_id FROM saldos s
  )
  SELECT p.id, p.full_name, p.phone, p.verification_status,
         (p.provider_id = v_mopt AND p.role = 'OPERATOR'),
         COALESCE(s.services, 0), COALESCE(s.owed, 0), COALESCE(s.paid, 0),
         COALESCE(s.balance, 0), s.last_paid_on
    FROM ops
    JOIN profiles p ON p.id = ops.id
    LEFT JOIN saldos s ON s.creditor_id = p.id
   ORDER BY COALESCE(s.balance, 0) DESC, p.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.mopt_list_operators() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_list_operators() TO authenticated;

CREATE OR REPLACE FUNCTION public.mopt_list_payments()
RETURNS TABLE (
  id UUID, payee_id UUID, payee_name TEXT, amount NUMERIC, paid_on DATE,
  reference TEXT, note TEXT, created_at TIMESTAMPTZ, voided_at TIMESTAMPTZ, void_reason TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;

  RETURN QUERY
  SELECT lp.id, lp.payee_id, ledger_party_name(lp.payee_kind, lp.payee_id),
         lp.amount, lp.paid_on, lp.reference, lp.note, lp.created_at, lp.voided_at, lp.void_reason
    FROM ledger_payments lp
   WHERE lp.payer_kind = 'mopt' AND lp.payer_id = v_mopt
   ORDER BY lp.created_at DESC
   LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.mopt_list_payments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_list_payments() TO authenticated;


-- ---------------------------------------------------------------
-- 6. Tarifas: la del MOPT aparte de la comision de las empresas
-- ---------------------------------------------------------------
-- admin_set_provider_commission: 00099 rechaza programas MOPT
CREATE OR REPLACE FUNCTION public.admin_set_provider_commission(p_provider_id uuid, p_rate numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar comisiones';
  END IF;

  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La comision debe estar entre 0 y 100');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM providers WHERE id = p_provider_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'El proveedor no existe');
  END IF;

  -- 00099: la tarifa de un programa MOPT va por admin_set_mopt_fee. Aca volver al
  -- default BORRA la fila, y para el MOPT "sin fila" es 0%, no 20%.
  IF EXISTS (SELECT 1 FROM providers WHERE id = p_provider_id AND is_mopt) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Es un programa MOPT: su tarifa se configura en Programas MOPT');
  END IF;

  -- Volver al default borra la fila en vez de guardarla: la tabla sigue
  -- diciendo solo lo que se aparto de la tarifa estandar.
  IF p_rate = default_commission_rate() THEN
    DELETE FROM provider_commissions WHERE provider_id = p_provider_id;
  ELSE
    INSERT INTO provider_commissions (provider_id, commission_rate)
    VALUES (p_provider_id, p_rate)
    ON CONFLICT (provider_id) DO UPDATE SET commission_rate = EXCLUDED.commission_rate;
  END IF;

  RETURN jsonb_build_object('success', true, 'provider_id', p_provider_id, 'commission_rate', p_rate);
END;
$function$;

-- La tarifa de plataforma de un programa MOPT. Siempre se guarda la fila, incluso
-- 0: "sin fila" ya significa 0 (mopt_fee_rate) y el 20% de las empresas no aplica.
CREATE OR REPLACE FUNCTION public.admin_set_mopt_fee(p_provider_id UUID, p_rate NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar la tarifa del MOPT';
  END IF;
  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 100 THEN
    RAISE EXCEPTION 'La tarifa debe estar entre 0 y 100';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM providers WHERE id = p_provider_id AND is_mopt) THEN
    RAISE EXCEPTION 'El programa MOPT no existe';
  END IF;

  INSERT INTO provider_commissions (provider_id, commission_rate)
  VALUES (p_provider_id, p_rate)
  ON CONFLICT (provider_id) DO UPDATE SET commission_rate = EXCLUDED.commission_rate;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_mopt_fee(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_mopt_fee(UUID, NUMERIC) TO authenticated;
