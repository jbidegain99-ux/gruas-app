-- 00125: pagos a socios operadores (backlog LAN-08, B-23)
--
-- La liquidación ya existía (00079/00087/00091) y el libro registra pagos
-- sueltos (00097). Faltaba:
--   1. Datos bancarios de las EMPRESAS de grúas (los socios independientes ya
--      los cargan en su registro, 00114). Tabla aparte, legible solo por ADMIN.
--   2. Lote de pago: foto de lo que Budi le debe a cada socio o empresa a una
--      fecha de corte, con su cuenta bancaria y los servicios que cubre. De
--      ahí sale el archivo para el banco (CSV genérico; el formato exacto de
--      cada banco se ajusta al elegir banco).
--   3. Marcar el lote pagado con fecha, referencia y comprobante: registra un
--      pago en el libro por cada destinatario (los saldos bajan) y le avisa
--      al socio.
--   4. El socio ve en la app cuánto se le pagó, cuándo y por qué servicios.

-- ─── 1. Cuentas de las empresas ─────────────────────────────────────────────
CREATE TABLE public.provider_bank_accounts (
  provider_id    UUID PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  bank_name      TEXT NOT NULL,
  account_type   TEXT NOT NULL CHECK (account_type IN ('ahorro', 'corriente')),
  account_number TEXT NOT NULL CHECK (account_number ~ '^[0-9-]{6,30}$'),
  holder         TEXT NOT NULL,
  holder_nit     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.provider_bank_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_bank_accounts FROM anon, authenticated;
-- El número de cuenta SÍ va a la bitácora (solo la ve ADMIN): cambiar la
-- cuenta de destino es justo lo que hay que poder rastrear.
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.provider_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at,updated_by');

CREATE OR REPLACE FUNCTION public.admin_set_provider_bank(
  p_provider UUID, p_bank TEXT, p_type TEXT, p_number TEXT, p_holder TEXT, p_nit TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador edita cuentas bancarias';
  END IF;
  IF NULLIF(btrim(COALESCE(p_bank, '')), '') IS NULL OR NULLIF(btrim(COALESCE(p_holder, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el banco y el titular';
  END IF;
  IF p_type NOT IN ('ahorro', 'corriente') THEN
    RAISE EXCEPTION 'Tipo de cuenta: ahorro o corriente';
  END IF;
  IF regexp_replace(COALESCE(p_number, ''), '[^0-9-]', '', 'g') !~ '^[0-9-]{6,30}$' THEN
    RAISE EXCEPTION 'Número de cuenta inválido';
  END IF;
  INSERT INTO provider_bank_accounts (provider_id, bank_name, account_type, account_number, holder, holder_nit, updated_by)
  VALUES (p_provider, btrim(p_bank), p_type, regexp_replace(p_number, '[^0-9-]', '', 'g'), btrim(p_holder),
          NULLIF(btrim(COALESCE(p_nit, '')), ''), auth.uid())
  ON CONFLICT (provider_id) DO UPDATE SET
    bank_name = EXCLUDED.bank_name, account_type = EXCLUDED.account_type,
    account_number = EXCLUDED.account_number, holder = EXCLUDED.holder,
    holder_nit = EXCLUDED.holder_nit, updated_at = now(), updated_by = auth.uid();
END;
$$;

-- Para el formulario del admin: la cuenta de una empresa (enmascarada no:
-- el admin es quien paga).
CREATE OR REPLACE FUNCTION public.admin_provider_bank(p_provider UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador ve cuentas bancarias';
  END IF;
  RETURN (SELECT to_jsonb(b) - 'updated_by' FROM provider_bank_accounts b WHERE provider_id = p_provider);
END;
$$;

-- ─── 2. Lotes de pago ───────────────────────────────────────────────────────
CREATE TABLE public.payout_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number       TEXT UNIQUE,
  cutoff       DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'paid', 'void')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_on      DATE,
  reference    TEXT,
  receipt_path TEXT,
  paid_at      TIMESTAMPTZ,
  paid_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  void_reason  TEXT
);
CREATE SEQUENCE public.payout_batch_seq;

CREATE TABLE public.payout_items (
  batch_id          UUID NOT NULL REFERENCES public.payout_batches(id) ON DELETE CASCADE,
  payee_kind        TEXT NOT NULL CHECK (payee_kind IN ('provider', 'operator')),
  payee_id          UUID NOT NULL,
  payee_name        TEXT,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  bank_name         TEXT,
  account_type      TEXT,
  account_number    TEXT,
  holder            TEXT,
  services          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ledger_payment_id UUID REFERENCES public.ledger_payments(id),
  PRIMARY KEY (batch_id, payee_kind, payee_id)
);

ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_batches, public.payout_items FROM anon, authenticated;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.payout_batches
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'status,paid_on,reference,void_reason');

-- Comprobantes del banco: bucket privado, solo ADMIN.
INSERT INTO storage.buckets (id, name, public) VALUES ('payout-receipts', 'payout-receipts', false)
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "admin: sube comprobantes de pago" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'payout-receipts' AND public.is_admin());
CREATE POLICY "admin: lee comprobantes de pago" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'payout-receipts' AND public.is_admin());

-- Servicios que cubre un pago: los que se le deben desde el último lote
-- pagado a ese destinatario, hasta el corte.
CREATE OR REPLACE FUNCTION public.payout_services_for(p_kind TEXT, p_id UUID, p_cutoff DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH desde AS (
    SELECT max(b.cutoff) AS d FROM payout_items i JOIN payout_batches b ON b.id = i.batch_id
     WHERE b.status = 'paid' AND i.payee_kind = p_kind AND i.payee_id = p_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'folio', c.folio, 'completed_at', o.completed_at,
           'service_type', o.service_type, 'amount', o.amount) ORDER BY o.completed_at), '[]'::jsonb)
    FROM ledger_obligations() o
    LEFT JOIN cases c ON c.request_id = o.request_id
   WHERE o.debtor_kind = 'budi' AND o.creditor_kind = p_kind AND o.creditor_id = p_id
     AND o.completed_at < sv_day_start(p_cutoff + 1)
     AND ((SELECT d FROM desde) IS NULL OR o.completed_at >= sv_day_start((SELECT d FROM desde) + 1));
$$;
REVOKE ALL ON FUNCTION public.payout_services_for(TEXT, UUID, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_payout_batch(p_cutoff DATE DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff DATE := COALESCE(p_cutoff, sv_today());
  v_id UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador prepara pagos';
  END IF;
  IF v_cutoff > sv_today() THEN
    RAISE EXCEPTION 'El corte no puede ser futuro';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payout-batch'));

  -- Un solo borrador a la vez: si hay uno, se recalcula.
  SELECT id INTO v_id FROM payout_batches WHERE status = 'draft';
  IF v_id IS NULL THEN
    INSERT INTO payout_batches (cutoff, created_by) VALUES (v_cutoff, auth.uid()) RETURNING id INTO v_id;
  ELSE
    DELETE FROM payout_items WHERE batch_id = v_id;
    UPDATE payout_batches SET cutoff = v_cutoff, created_at = now(), created_by = auth.uid() WHERE id = v_id;
  END IF;

  INSERT INTO payout_items (batch_id, payee_kind, payee_id, payee_name, amount,
                            bank_name, account_type, account_number, holder, services)
  SELECT v_id, b.creditor_kind, b.creditor_id, ledger_party_name(b.creditor_kind, b.creditor_id), b.balance,
         COALESCE(pb.bank_name, op.bank_name),
         COALESCE(pb.account_type, op.bank_account_type),
         COALESCE(pb.account_number, op.bank_account_number),
         COALESCE(pb.holder, op.bank_account_holder),
         payout_services_for(b.creditor_kind, b.creditor_id, v_cutoff)
    FROM ledger_balances_all() b
    LEFT JOIN provider_bank_accounts pb ON b.creditor_kind = 'provider' AND pb.provider_id = b.creditor_id
    LEFT JOIN operator_profiles op      ON b.creditor_kind = 'operator' AND op.operator_id = b.creditor_id
   WHERE b.debtor_kind = 'budi'
     AND b.creditor_kind IN ('provider', 'operator')
     AND b.balance > 0;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_payout_batches()
RETURNS TABLE (id UUID, number TEXT, cutoff DATE, status TEXT, created_at TIMESTAMPTZ, paid_on DATE,
               reference TEXT, payees BIGINT, missing_bank BIGINT, total NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador ve los pagos';
  END IF;
  RETURN QUERY
  SELECT b.id, b.number, b.cutoff, b.status, b.created_at, b.paid_on, b.reference,
         count(i.payee_id), count(i.payee_id) FILTER (WHERE i.account_number IS NULL),
         COALESCE(sum(i.amount), 0)
    FROM payout_batches b LEFT JOIN payout_items i ON i.batch_id = b.id
   GROUP BY b.id
   ORDER BY b.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_payout_batch(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador ve los pagos';
  END IF;
  RETURN (
    SELECT to_jsonb(b) - 'created_by' - 'paid_by' || jsonb_build_object(
      'items', COALESCE((SELECT jsonb_agg(to_jsonb(i) - 'batch_id' ORDER BY i.payee_name)
                           FROM payout_items i WHERE i.batch_id = b.id), '[]'::jsonb))
      FROM payout_batches b WHERE b.id = p_id);
END;
$$;

-- ─── 3. Pagado ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_mark_payout_paid(p_id UUID, p_paid_on DATE, p_reference TEXT, p_receipt_path TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b payout_batches;
  i RECORD;
  v_saldo NUMERIC;
  v_pay UUID;
  v_n INTEGER := 0;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador registra pagos';
  END IF;
  IF p_paid_on IS NULL OR p_paid_on > sv_today() THEN
    RAISE EXCEPTION 'Indica la fecha del pago (no futura)';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica la referencia del banco';
  END IF;
  IF p_receipt_path IS NOT NULL AND p_receipt_path NOT LIKE 'lotes/%' THEN
    RAISE EXCEPTION 'Comprobante inválido';
  END IF;

  SELECT * INTO b FROM payout_batches WHERE id = p_id FOR UPDATE;
  IF b.id IS NULL OR b.status <> 'draft' THEN
    RAISE EXCEPTION 'Solo se marca pagado un lote en borrador';
  END IF;

  -- Solo lo que se pudo pagar: con cuenta bancaria. Lo demás sigue debiéndose.
  FOR i IN SELECT * FROM payout_items WHERE batch_id = p_id AND account_number IS NOT NULL LOOP
    PERFORM pg_advisory_xact_lock(hashtext('budi:ledger:budi:->' || i.payee_kind || ':' || i.payee_id::text));
    SELECT bal.balance INTO v_saldo FROM ledger_balances_all() bal
     WHERE bal.debtor_kind = 'budi' AND bal.creditor_kind = i.payee_kind AND bal.creditor_id = i.payee_id;
    IF COALESCE(v_saldo, 0) < i.amount THEN
      RAISE EXCEPTION 'El saldo de % cambió desde que se preparó el lote. Recalcula el borrador.', i.payee_name;
    END IF;
    INSERT INTO ledger_payments (payer_kind, payer_id, payee_kind, payee_id, amount, paid_on, reference, note, created_by)
    VALUES ('budi', NULL, i.payee_kind, i.payee_id, i.amount, p_paid_on, btrim(p_reference),
            'Lote de pago ' || COALESCE(b.number, ''), auth.uid())
    RETURNING id INTO v_pay;
    UPDATE payout_items SET ledger_payment_id = v_pay
     WHERE batch_id = p_id AND payee_kind = i.payee_kind AND payee_id = i.payee_id;

    IF i.payee_kind = 'operator' THEN
      INSERT INTO notification_queue (user_id, title, body, data, created_at)
      VALUES (i.payee_id, 'Recibiste un pago de Budi',
              format('Te pagamos $%s por %s servicio(s). Revisa el detalle en tu historial.',
                     to_char(i.amount, 'FM999999990.00'), jsonb_array_length(i.services)),
              jsonb_build_object('type', 'payout', 'role', 'operator'), now());
    END IF;
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Ningún destinatario del lote tiene cuenta bancaria';
  END IF;

  -- Los que no tenían cuenta salen del lote: quedan para el siguiente.
  DELETE FROM payout_items WHERE batch_id = p_id AND account_number IS NULL;
  UPDATE payout_batches
     SET status = 'paid', number = 'PG-' || to_char(p_paid_on, 'YYYYMMDD') || '-' || lpad(nextval('payout_batch_seq')::text, 3, '0'),
         paid_on = p_paid_on, reference = btrim(p_reference), receipt_path = p_receipt_path,
         paid_at = now(), paid_by = auth.uid()
   WHERE id = p_id;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_void_payout_batch(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador descarta lotes';
  END IF;
  UPDATE payout_batches SET status = 'void', void_reason = 'Borrador descartado' WHERE id = p_id AND status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo se descarta un lote en borrador (uno pagado se corrige anulando sus pagos en el libro)';
  END IF;
END;
$$;

-- ─── 4. Lo que ve el socio ──────────────────────────────────────────────────
-- Sus pagos del libro (de Budi y, si es flota MOPT, del MOPT), con los
-- servicios cuando el pago vino de un lote. El chofer de una empresa no recibe
-- pagos directos: se le dice a quién le paga Budi.
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

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_set_provider_bank(uuid,text,text,text,text,text)', 'admin_provider_bank(uuid)',
    'admin_create_payout_batch(date)', 'admin_list_payout_batches()', 'admin_payout_batch(uuid)',
    'admin_mark_payout_paid(uuid,date,text,text)', 'admin_void_payout_batch(uuid)', 'my_payouts()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
