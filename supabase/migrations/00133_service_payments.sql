-- =====================================================
-- LAN-07 · Pagos de servicios particulares (parte sin pasarela)
--
-- Decisión D4 (propuesta por defecto del backlog, pendiente de confirmar con
-- Jose): Wompi (tarjeta) + efectivo. Esta migración deja:
--
--   * `service_payments`: lo que el USUARIO paga por un servicio completado
--     (particular = precio total; afiliado = copago; MOPT = nada). La fila
--     nace sola al completarse el servicio (trigger diferido: el copago se
--     calcula después en la misma transacción).
--   * EFECTIVO: el socio operador confirma "Recibí el efectivo" (solo el suyo,
--     solo por el monto exacto). Queda el comprobante numerado (RC-000001).
--   * TARJETA: la capa queda lista para la pasarela: `user_start_card_payment`
--     crea la referencia y `confirm_gateway_payment` (solo service_role, para
--     el webhook de la pasarela) la confirma verificando el monto. Mientras no
--     haya pasarela configurada (secreto de Vault `payment_gateway`), la
--     tarjeta responde "todavía no disponible".
--   * LIBRO: hasta hoy el libro asumía que Budi cobraba todo y le debía al
--     socio el neto completo aunque el Usuario le pagara en efectivo a él. El
--     concepto nuevo `efectivo_cobrado` (negativo, mismo par Budi → socio)
--     descuenta lo que el socio ya recibió: el saldo y los lotes de pago
--     (00125) se compensan solos; si queda negativo, el socio le debe la
--     comisión a Budi.
--   * LIQUIDACIONES: admin y socio ven `efectivo` y `saldo` además del neto.
--
-- El comprobante NO es factura: la factura electrónica (DTE) es LAN-09.
-- =====================================================

-- ─── Lo que debe el Usuario ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_amount_due(p_request UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN sr.mopt_provider_id IS NOT NULL THEN 0
           WHEN cu.request_id IS NOT NULL THEN COALESCE(cu.amount_copay, 0)
           ELSE COALESCE(sr.total_price, 0)
         END
    FROM service_requests sr
    LEFT JOIN coverage_usage cu ON cu.request_id = sr.id
   WHERE sr.id = p_request;
$$;
REVOKE ALL ON FUNCTION public.user_amount_due(UUID) FROM PUBLIC, anon, authenticated;

-- ─── Cobros ─────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.service_receipt_seq;

CREATE TABLE IF NOT EXISTS public.service_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     UUID NOT NULL UNIQUE REFERENCES public.service_requests(id) ON DELETE CASCADE,
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'void')),
  method         TEXT CHECK (method IN ('cash', 'card', 'transfer')),
  -- Tarjeta: referencia que viaja a la pasarela y su id de transacción.
  reference      TEXT UNIQUE,
  gateway        TEXT,
  gateway_tx     TEXT,
  collected_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_at        TIMESTAMPTZ,
  receipt_number TEXT UNIQUE,
  note           TEXT,
  voided_at      TIMESTAMPTZ,
  voided_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  void_reason    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'paid' OR (method IS NOT NULL AND paid_at IS NOT NULL AND receipt_number IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS service_payments_pending_idx ON public.service_payments (created_at) WHERE status = 'pending';
ALTER TABLE public.service_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_payments FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit ON public.service_payments;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE ON public.service_payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at');

COMMENT ON TABLE public.service_payments IS
  'LAN-07: lo que el Usuario paga por un servicio (particular o copago), en efectivo al socio o con tarjeta.';

-- Al completarse el servicio nace el cobro (si hay algo que cobrar).
CREATE OR REPLACE FUNCTION public.create_service_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_due NUMERIC;
BEGIN
  IF NEW.status::text <> 'completed' THEN
    RETURN NULL;
  END IF;
  v_due := user_amount_due(NEW.id);
  IF COALESCE(v_due, 0) > 0 THEN
    INSERT INTO service_payments (request_id, amount) VALUES (NEW.id, v_due)
    ON CONFLICT (request_id) DO NOTHING;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- El cobro no puede impedir que el servicio se cierre.
  RAISE WARNING 'create_service_payment: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.create_service_payment() FROM PUBLIC, anon, authenticated;

-- Diferido: complete_service_request escribe el copago después del cambio de estado.
DROP TRIGGER IF EXISTS trg_create_service_payment ON public.service_requests;
CREATE CONSTRAINT TRIGGER trg_create_service_payment
  AFTER UPDATE OF status ON public.service_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.create_service_payment();

CREATE OR REPLACE FUNCTION public._mark_payment_paid(p_id UUID, p_method TEXT, p_collected_by UUID, p_note TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE service_payments
     SET status = 'paid', method = p_method, paid_at = now(), collected_by = p_collected_by,
         receipt_number = COALESCE(receipt_number, 'RC-' || lpad(nextval('service_receipt_seq')::text, 6, '0')),
         note = COALESCE(p_note, note), updated_at = now()
   WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION public._mark_payment_paid(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ─── Comprobante ────────────────────────────────────────────────────────────
-- Lo ven el Usuario del servicio, su socio operador y el admin de Budi.
-- No incluye la comisión de Budi (regla del backlog: el Usuario nunca la ve).
CREATE OR REPLACE FUNCTION public.service_payment(p_request UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  sr RECORD;
  sp RECORD;
  cu RECORD;
BEGIN
  SELECT r.*, c.folio, op.full_name AS operator_name, us.full_name AS user_name
    INTO sr
    FROM service_requests r
    LEFT JOIN cases c     ON c.request_id = r.id
    LEFT JOIN profiles op ON op.id = r.operator_id
    LEFT JOIN profiles us ON us.id = r.user_id
   WHERE r.id = p_request;
  -- Soporte no: ve la operación sin dinero (00103).
  IF NOT FOUND OR NOT (auth.uid() = sr.user_id OR auth.uid() = sr.operator_id OR is_admin()) THEN
    RAISE EXCEPTION 'Servicio no encontrado';
  END IF;

  SELECT * INTO sp FROM service_payments WHERE request_id = p_request;
  SELECT amount_covered, amount_copay INTO cu FROM coverage_usage WHERE request_id = p_request;

  RETURN jsonb_build_object(
    'request_id', sr.id,
    'folio', sr.folio,
    'service_type', COALESCE(sr.service_type, 'tow'),
    'completed_at', sr.completed_at,
    'operator_name', sr.operator_name,
    'user_name', sr.user_name,
    'payer', CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 'mopt' WHEN EXISTS (SELECT 1 FROM coverage_usage x WHERE x.request_id = sr.id) THEN 'insurer' ELSE 'user' END,
    'total_price', sr.total_price,
    'covered', CASE WHEN sr.mopt_provider_id IS NOT NULL THEN sr.total_price ELSE cu.amount_covered END,
    'amount_due', COALESCE(sp.amount, CASE WHEN sr.status::text = 'completed' THEN user_amount_due(sr.id) END),
    'status', CASE WHEN sp.id IS NULL THEN (CASE WHEN sr.status::text = 'completed' THEN 'not_required' ELSE 'not_yet' END)
                   ELSE sp.status END,
    'method', sp.method,
    'paid_at', sp.paid_at,
    'receipt_number', sp.receipt_number,
    'card_available', payment_gateway_enabled());
END;
$$;

-- ─── Efectivo: lo confirma el socio ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_confirm_cash(p_request UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
  SELECT sp.id INTO v_id
    FROM service_payments sp JOIN service_requests sr ON sr.id = sp.request_id
   WHERE sp.request_id = p_request AND sr.operator_id = auth.uid() AND sp.status = 'pending'
   FOR UPDATE OF sp;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No hay un cobro pendiente tuyo para este servicio';
  END IF;
  PERFORM _mark_payment_paid(v_id, 'cash', auth.uid(), NULL);
  RETURN service_payment(p_request);
END;
$$;

-- Cobros en efectivo que el socio todavía no confirma.
CREATE OR REPLACE FUNCTION public.operator_pending_cash()
RETURNS TABLE (request_id UUID, folio TEXT, service_type TEXT, completed_at TIMESTAMPTZ, amount NUMERIC, user_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sr.id, c.folio, COALESCE(sr.service_type, 'tow'), sr.completed_at, sp.amount, us.full_name
    FROM service_payments sp
    JOIN service_requests sr ON sr.id = sp.request_id
    LEFT JOIN cases c ON c.request_id = sr.id
    LEFT JOIN profiles us ON us.id = sr.user_id
   WHERE sr.operator_id = auth.uid() AND sp.status = 'pending'
   ORDER BY sr.completed_at DESC;
$$;

-- Cobros pendientes del Usuario (la app se los recuerda).
CREATE OR REPLACE FUNCTION public.my_pending_payments()
RETURNS TABLE (request_id UUID, folio TEXT, service_type TEXT, completed_at TIMESTAMPTZ, amount NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sr.id, c.folio, COALESCE(sr.service_type, 'tow'), sr.completed_at, sp.amount
    FROM service_payments sp
    JOIN service_requests sr ON sr.id = sp.request_id
    LEFT JOIN cases c ON c.request_id = sr.id
   WHERE sr.user_id = auth.uid() AND sp.status = 'pending'
   ORDER BY sr.completed_at DESC;
$$;

-- ─── Tarjeta: capa lista para la pasarela ───────────────────────────────────
-- Habilitada solo si existe el secreto de Vault `payment_gateway` (p. ej.
-- 'wompi'). Sin él, la app muestra la tarjeta como "próximamente".
CREATE OR REPLACE FUNCTION public.payment_gateway_enabled()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'payment_gateway' AND decrypted_secret <> '');
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_gateway_enabled() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.user_start_card_payment(p_request UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  sp RECORD;
  v_ref TEXT;
BEGIN
  SELECT p.* INTO sp
    FROM service_payments p JOIN service_requests sr ON sr.id = p.request_id
   WHERE p.request_id = p_request AND sr.user_id = auth.uid() AND p.status = 'pending'
   FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay un pago pendiente para este servicio';
  END IF;
  IF NOT payment_gateway_enabled() THEN
    RAISE EXCEPTION 'El pago con tarjeta todavía no está disponible. Puedes pagarle en efectivo al socio operador.';
  END IF;
  -- Referencia nueva en cada intento (la pasarela rechaza repetidas).
  v_ref := 'BUDI-' || replace(p_request::text, '-', '') || '-' || to_char(clock_timestamp(), 'YYMMDDHH24MISS');
  UPDATE service_payments SET method = 'card', reference = v_ref, updated_at = now() WHERE id = sp.id;
  RETURN jsonb_build_object('reference', v_ref, 'amount', sp.amount,
                            'amount_in_cents', (sp.amount * 100)::bigint, 'currency', 'USD');
END;
$$;

-- La llama el webhook de la pasarela (service_role). Verifica el monto.
CREATE OR REPLACE FUNCTION public.confirm_gateway_payment(p_reference TEXT, p_gateway TEXT, p_gateway_tx TEXT,
                                                         p_amount NUMERIC, p_approved BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE sp RECORD;
BEGIN
  SELECT * INTO sp FROM service_payments WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'unknown_reference';
  END IF;
  IF sp.status = 'paid' THEN
    RETURN 'already_paid';               -- el webhook puede llegar dos veces
  END IF;
  IF sp.status <> 'pending' THEN
    RETURN 'not_pending';
  END IF;
  IF NOT COALESCE(p_approved, false) THEN
    UPDATE service_payments SET gateway = p_gateway, gateway_tx = p_gateway_tx, updated_at = now() WHERE id = sp.id;
    RETURN 'declined';                   -- sigue pendiente: puede reintentar o pagar en efectivo
  END IF;
  IF p_amount IS DISTINCT FROM sp.amount THEN
    RAISE EXCEPTION 'Monto de la pasarela (%) distinto del cobro (%)', p_amount, sp.amount;
  END IF;
  UPDATE service_payments SET gateway = p_gateway, gateway_tx = p_gateway_tx WHERE id = sp.id;
  PERFORM _mark_payment_paid(sp.id, 'card', NULL, NULL);
  RETURN 'paid';
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_gateway_payment(TEXT, TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_gateway_payment(TEXT, TEXT, TEXT, NUMERIC, BOOLEAN) TO service_role;

-- ─── Admin ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_service_payments(p_from DATE, p_to DATE, p_status TEXT DEFAULT NULL)
RETURNS TABLE (id UUID, request_id UUID, folio TEXT, completed_at TIMESTAMPTZ, service_type TEXT, user_name TEXT,
               operator_name TEXT, amount NUMERIC, status TEXT, method TEXT, paid_at TIMESTAMPTZ,
               receipt_number TEXT, note TEXT, void_reason TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  RETURN QUERY
  SELECT sp.id, sr.id, c.folio, sr.completed_at, COALESCE(sr.service_type, 'tow'), us.full_name, op.full_name,
         sp.amount, sp.status, sp.method, sp.paid_at, sp.receipt_number, sp.note, sp.void_reason
    FROM service_payments sp
    JOIN service_requests sr ON sr.id = sp.request_id
    LEFT JOIN cases c ON c.request_id = sr.id
    LEFT JOIN profiles us ON us.id = sr.user_id
    LEFT JOIN profiles op ON op.id = sr.operator_id
   WHERE sr.completed_at >= sv_day_start(p_from) AND sr.completed_at < sv_day_start(p_to + 1)
     AND (p_status IS NULL OR sp.status = p_status)
   ORDER BY sr.completed_at DESC;
END;
$$;

-- El Usuario pagó por otra vía (transferencia) o el socio no alcanzó a confirmar.
CREATE OR REPLACE FUNCTION public.admin_record_service_payment(p_id UUID, p_method TEXT, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_op UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  IF p_method NOT IN ('cash', 'transfer') THEN
    RAISE EXCEPTION 'Método inválido (efectivo o transferencia)';
  END IF;
  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica cómo se confirmó el pago';
  END IF;
  SELECT sr.operator_id INTO v_op
    FROM service_payments sp JOIN service_requests sr ON sr.id = sp.request_id
   WHERE sp.id = p_id AND sp.status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado o no está pendiente';
  END IF;
  -- Efectivo: lo tiene el socio (cuenta en su liquidación). Transferencia: a Budi.
  PERFORM _mark_payment_paid(p_id, p_method, CASE WHEN p_method = 'cash' THEN v_op END, btrim(p_note));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_void_service_payment(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el motivo';
  END IF;
  UPDATE service_payments
     SET status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason), updated_at = now()
   WHERE id = p_id AND status <> 'void';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado o ya anulado';
  END IF;
END;
$$;

-- ─── Libro: el efectivo que ya tiene el socio ───────────────────────────────
CREATE OR REPLACE FUNCTION public.ledger_obligations()
 RETURNS TABLE(request_id uuid, completed_at timestamp with time zone, service_type text, concept text, debtor_kind text, debtor_id uuid, creditor_kind text, creditor_id uuid, amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT sr.id, sr.completed_at, COALESCE(sr.service_type, 'tow') AS service_type,
           sr.total_price, sr.provider_id, sr.operator_id, sr.mopt_provider_id,
           -- 00102: la tasa vigente cuando se completo el servicio, no la de hoy.
           commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS commission_rate,
           mopt_fee_rate_at(sr.mopt_provider_id, sr.completed_at) AS mopt_fee_rate
      FROM service_requests sr
     WHERE sr.status = 'completed'
       AND sr.total_price IS NOT NULL
  )
  SELECT b.id, b.completed_at, b.service_type, 'cobertura',
         'insurer', po.insurer_id, 'budi', NULL::UUID, cu.amount_covered
    FROM base b
    JOIN coverage_usage cu ON cu.request_id = b.id
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
         'mopt', b.mopt_provider_id, 'operator', b.operator_id, b.total_price
    FROM base b
   WHERE b.mopt_provider_id IS NOT NULL
     AND b.operator_id IS NOT NULL

  UNION ALL
  SELECT b.id, b.completed_at, b.service_type, 'tarifa_plataforma',
         'mopt', b.mopt_provider_id, 'budi', NULL::UUID,
         ROUND(b.total_price * b.mopt_fee_rate / 100, 2)
    FROM base b
   WHERE b.mopt_provider_id IS NOT NULL
     AND b.mopt_fee_rate > 0;
$function$;

-- ─── Liquidaciones con efectivo y saldo ─────────────────────────────────────
-- efectivo = lo que el socio ya cobró en mano; saldo = a_pagar − efectivo
-- (negativo: el socio le debe la comisión a Budi).
CREATE OR REPLACE FUNCTION public._cash_collected(p_request UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT amount FROM service_payments
                    WHERE request_id = p_request AND status = 'paid' AND method = 'cash'), 0);
$$;
REVOKE ALL ON FUNCTION public._cash_collected(UUID) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.my_operator_earnings(DATE, DATE);
CREATE FUNCTION public.my_operator_earnings(p_from date, p_to date)
 RETURNS TABLE(servicios bigint, bruto numeric, comision_pct numeric, comision numeric, a_pagar numeric,
               efectivo numeric, saldo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_op UUID := auth.uid();
BEGIN
  IF v_op IS NULL THEN
    RAISE EXCEPTION 'Se necesita una sesion';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- Sin servicios en el periodo: la tasa que le aplicaria hoy. Con tasas
    -- distintas dentro del periodo: NULL, la pantalla dice "varias".
    CASE
      WHEN COUNT(*) = 0 THEN commission_rate_at(
        (SELECT provider_id FROM profiles WHERE id = v_op), v_op, now())
      WHEN MIN(cr.rate) = MAX(cr.rate) THEN MIN(cr.rate)
    END,
    COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0),
    COALESCE(SUM(ef.cash), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0)
      - COALESCE(SUM(ef.cash), 0)
  FROM service_requests sr
  -- Los servicios del MOPT no tienen comision de Budi.
  CROSS JOIN LATERAL (
    SELECT CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 0::numeric
                ELSE commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) END AS rate
  ) cr
  CROSS JOIN LATERAL (SELECT _cash_collected(sr.id) AS cash) ef
  WHERE sr.operator_id = v_op
    AND sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1);
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_settlement_by_operator(DATE, DATE);
CREATE FUNCTION public.admin_settlement_by_operator(p_from date, p_to date)
 RETURNS TABLE(operator_id uuid, operador text, empresa text, comision_pct numeric, servicios bigint, bruto numeric,
               comision numeric, a_pagar numeric, efectivo numeric, saldo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    ope.id,
    COALESCE(ope.full_name, 'Sin socio operador'),
    COALESCE(pr.name, 'Independiente'),
    CASE WHEN MIN(cr.rate) = MAX(cr.rate) THEN MIN(cr.rate) END,
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0),
    COALESCE(SUM(ef.cash), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0)
      - COALESCE(SUM(ef.cash), 0)
  FROM service_requests sr
  LEFT JOIN profiles ope  ON ope.id = sr.operator_id
  LEFT JOIN providers pr  ON pr.id = sr.provider_id
  CROSS JOIN LATERAL (SELECT commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS rate) cr
  CROSS JOIN LATERAL (SELECT _cash_collected(sr.id) AS cash) ef
  WHERE sr.status = 'completed'
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  GROUP BY ope.id, ope.full_name, pr.id, pr.name
  ORDER BY 8 DESC;
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_settlement_by_provider(DATE, DATE);
CREATE FUNCTION public.admin_settlement_by_provider(p_from date, p_to date)
 RETURNS TABLE(provider_id uuid, destinatario text, es_independiente boolean, comision_pct numeric, servicios bigint,
               sin_precio bigint, bruto numeric, comision numeric, a_pagar numeric, efectivo numeric, saldo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    pr.id,
    COALESCE(pr.name, MAX(ope.full_name), 'Sin asignar'),
    pr.id IS NULL,
    CASE WHEN MIN(cr.rate) = MAX(cr.rate) THEN MIN(cr.rate) END,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE sr.total_price IS NULL)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- 00081: se suman las lineas ya redondeadas, no se redondea el total.
    COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0),
    COALESCE(SUM(ef.cash), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0)
      - COALESCE(SUM(ef.cash), 0)
  FROM service_requests sr
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  CROSS JOIN LATERAL (SELECT commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS rate) cr
  CROSS JOIN LATERAL (SELECT _cash_collected(sr.id) AS cash) ef
  WHERE sr.status = 'completed'
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  GROUP BY COALESCE(pr.id, ope.id), pr.id, pr.name
  ORDER BY 9 DESC;
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_settlement_detail(DATE, DATE);
CREATE FUNCTION public.admin_settlement_detail(p_from date, p_to date)
 RETURNS TABLE(folio text, completado timestamp with time zone, servicio text, destinatario text, operador text,
               comision_pct numeric, bruto numeric, comision numeric, a_pagar numeric, efectivo numeric, saldo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    c.folio,
    sr.completed_at,
    sr.service_type,
    COALESCE(pr.name, ope.full_name, 'Sin asignar'),
    COALESCE(ope.full_name, 'Sin socio operador'),
    cr.rate,
    COALESCE(sr.total_price, 0),
    ROUND(COALESCE(sr.total_price, 0) * cr.rate / 100, 2),
    COALESCE(sr.total_price, 0)
      - ROUND(COALESCE(sr.total_price, 0) * cr.rate / 100, 2),
    ef.cash,
    COALESCE(sr.total_price, 0)
      - ROUND(COALESCE(sr.total_price, 0) * cr.rate / 100, 2)
      - ef.cash
  FROM service_requests sr
  LEFT JOIN cases c      ON c.request_id = sr.id
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  CROSS JOIN LATERAL (SELECT commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS rate) cr
  CROSS JOIN LATERAL (SELECT _cash_collected(sr.id) AS cash) ef
  WHERE sr.status = 'completed'
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  ORDER BY sr.completed_at DESC;
END;
$function$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'service_payment(uuid)', 'operator_confirm_cash(uuid)', 'operator_pending_cash()', 'my_pending_payments()',
    'user_start_card_payment(uuid)', 'admin_service_payments(date,date,text)',
    'admin_record_service_payment(uuid,text,text)', 'admin_void_service_payment(uuid,text)',
    'my_operator_earnings(date,date)', 'admin_settlement_by_operator(date,date)',
    'admin_settlement_by_provider(date,date)', 'admin_settlement_detail(date,date)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
