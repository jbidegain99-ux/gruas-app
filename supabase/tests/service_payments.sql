-- =====================================================
-- Pagos del Usuario (migr. 00133, backlog LAN-07)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Al completarse nace el cobro: particular = total, afiliado = copago,
--      MOPT o copago 0 = sin cobro.
--   B. Efectivo: solo el socio del servicio lo confirma, una vez; comprobante.
--   C. Libro y liquidación: el efectivo que ya tiene el socio se descuenta
--      (particular en efectivo: el socio le debe la comisión a Budi).
--   D. Tarjeta: sin pasarela, "no disponible"; con pasarela, la confirma solo
--      el webhook (service_role) y con el monto exacto; idempotente.
--   E. El comprobante lo ven el Usuario, su socio y Budi; nadie más. Sin comisión.
--   F. Admin: anular y registrar transferencia.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- 00153: el interruptor de aseguradoras viene apagado; estas pruebas las ejercitan.
UPDATE platform_features SET insurers_enabled = true;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('a7a7a7a7-0000-4000-8000-000000000001', 'pg.usuario@budi.invalid',  'Usuaria Pago'),
    ('a7a7a7a7-0000-4000-8000-000000000002', 'pg.socio@budi.invalid',    'Socio Pago'),
    ('a7a7a7a7-0000-4000-8000-000000000003', 'pg.otro@budi.invalid',     'Otro Socio'),
    ('a7a7a7a7-0000-4000-8000-000000000004', 'pg.admin@budi.invalid',    'Admin Pago'),
    ('a7a7a7a7-0000-4000-8000-000000000005', 'pg.curioso@budi.invalid',  'Curioso'),
    ('a7a7a7a7-0000-4000-8000-000000000011', 'pg.u2@budi.invalid',       'Usuario 2'),
    ('a7a7a7a7-0000-4000-8000-000000000012', 'pg.u3@budi.invalid',       'Usuario 3'),
    ('a7a7a7a7-0000-4000-8000-000000000013', 'pg.u4@budi.invalid',       'Usuario 4'),
    ('a7a7a7a7-0000-4000-8000-000000000014', 'pg.u5@budi.invalid',       'Usuario 5')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'OPERATOR', provider_id = NULL
 WHERE id IN ('a7a7a7a7-0000-4000-8000-000000000002', 'a7a7a7a7-0000-4000-8000-000000000003');
UPDATE profiles SET role = 'ADMIN' WHERE id = 'a7a7a7a7-0000-4000-8000-000000000004';

CREATE TEMP TABLE t (particular UUID, copago UUID, cubierto UUID, mopt UUID, tarjeta UUID, rate NUMERIC) ON COMMIT DROP;
INSERT INTO t DEFAULT VALUES;
GRANT ALL ON t TO PUBLIC;

-- Cinco servicios del mismo socio, en curso (un Usuario no puede tener dos abiertos, 00063).
CREATE OR REPLACE FUNCTION pg_temp.servicio(p_price NUMERIC, p_user UUID) RETURNS UUID LANGUAGE sql AS $$
  INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng,
                                pickup_address, dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price,
                                assigned_at, activated_at)
  VALUES (p_user, 'a7a7a7a7-0000-4000-8000-000000000002', 'active', 'tow', 'light', 'x',
          13.70, -89.20, 'Zona', 13.71, -89.21, 'Destino', 'Vehículo varado', p_price, now() - interval '40 minutes',
          now() - interval '20 minutes')
  RETURNING id;
$$;
UPDATE t SET particular = pg_temp.servicio(100, 'a7a7a7a7-0000-4000-8000-000000000011'),
             copago     = pg_temp.servicio(80,  'a7a7a7a7-0000-4000-8000-000000000001'),
             cubierto   = pg_temp.servicio(60,  'a7a7a7a7-0000-4000-8000-000000000012'),
             mopt       = pg_temp.servicio(90,  'a7a7a7a7-0000-4000-8000-000000000013'),
             tarjeta    = pg_temp.servicio(50,  'a7a7a7a7-0000-4000-8000-000000000014');
UPDATE t SET rate = commission_rate_at(NULL, 'a7a7a7a7-0000-4000-8000-000000000002', now());

-- Cobertura: copago de $20 y otro cubierto al 100 %; el MOPT absorbe uno.
WITH plan AS (
  INSERT INTO coverage_plans (insurer_id, code, name)
  SELECT id, 'PG', 'Plan Pago' FROM insurers ORDER BY created_at LIMIT 1 RETURNING id, insurer_id
), pol AS (
  INSERT INTO policies (insurer_id, plan_id, policy_number, holder_name, starts_on, status)
  SELECT insurer_id, id, 'POL-PAGO', 'Titular', sv_today() - 30, 'active' FROM plan RETURNING id
), mem AS (
  INSERT INTO members (policy_id, document_number, full_name, relationship, starts_on, is_active)
  SELECT id, '07777777-7', 'Usuaria Pago', 'holder', sv_today() - 30, true FROM pol RETURNING id
)
INSERT INTO coverage_usage (member_id, request_id, service_type, used_on, amount_covered, amount_copay)
SELECT mem.id, x.req, 'tow', sv_today(), x.cov, x.cop
  FROM mem, t, LATERAL (VALUES (t.copago, 60::numeric, 20::numeric), (t.cubierto, 60, 0)) AS x(req, cov, cop);
UPDATE service_requests SET mopt_provider_id = (SELECT id FROM providers WHERE is_mopt LIMIT 1) WHERE id = (SELECT mopt FROM t);

-- Se completan (como lo hace complete_service_request) y corre el trigger diferido.
UPDATE service_requests SET status = 'completed', completed_at = now()
 WHERE id IN (SELECT unnest(ARRAY[particular, copago, cubierto, mopt, tarjeta]) FROM t);
SET CONSTRAINTS trg_create_service_payment IMMEDIATE;

-- ---------------------------------------------------------------
-- A. El cobro nace al completarse
-- ---------------------------------------------------------------
DO $$
BEGIN
  ASSERT (SELECT amount FROM service_payments WHERE request_id = (SELECT particular FROM t)) = 100, 'A: particular sin cobro del total';
  ASSERT (SELECT amount FROM service_payments WHERE request_id = (SELECT copago FROM t)) = 20, 'A: afiliado sin cobro del copago';
  ASSERT NOT EXISTS (SELECT 1 FROM service_payments WHERE request_id = (SELECT cubierto FROM t)), 'A: cobro de un servicio cubierto al 100 %';
  ASSERT NOT EXISTS (SELECT 1 FROM service_payments WHERE request_id = (SELECT mopt FROM t)), 'A: cobro de un servicio MOPT';
  ASSERT (SELECT bool_and(status = 'pending') FROM service_payments
           WHERE request_id IN ((SELECT particular FROM t), (SELECT copago FROM t))), 'A: no nacen pendientes';
  RAISE NOTICE 'A. particular = total, copago = copago, MOPT y cubierto = sin cobro: OK';
END $$;

-- ---------------------------------------------------------------
-- B. Efectivo
-- ---------------------------------------------------------------
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok BOOLEAN;
BEGIN
  PERFORM pg_temp.como('a7a7a7a7-0000-4000-8000-000000000003');  -- otro socio
  ok := false;
  BEGIN PERFORM operator_confirm_cash((SELECT particular FROM t)); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: otro socio confirmó el efectivo';
  PERFORM pg_temp.como('a7a7a7a7-0000-4000-8000-000000000001');  -- la Usuaria del copago
  ok := false;
  BEGIN PERFORM operator_confirm_cash((SELECT copago FROM t)); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: la Usuaria se marcó pagada sola';
  ASSERT (SELECT count(*) FROM my_pending_payments()) = 1 AND (SELECT amount FROM my_pending_payments()) = 20,
         'B: la Usuaria no ve su pago pendiente';
END $$;

SELECT pg_temp.como('a7a7a7a7-0000-4000-8000-000000000002');
DO $$
DECLARE r JSONB;
BEGIN
  ASSERT (SELECT count(*) FROM operator_pending_cash()) = 3, 'B: el socio no ve lo que tiene por cobrar';
  r := operator_confirm_cash((SELECT particular FROM t));
  ASSERT r->>'status' = 'paid' AND r->>'method' = 'cash' AND r->>'receipt_number' ~ '^RC-[0-9]{6}$', 'B: comprobante: ' || r::text;
  r := operator_confirm_cash((SELECT copago FROM t));
  BEGIN
    PERFORM operator_confirm_cash((SELECT particular FROM t));
    RAISE EXCEPTION 'B: confirmó dos veces';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'B:%' THEN RAISE; END IF;
  END;
  ASSERT (SELECT count(*) FROM operator_pending_cash()) = 1, 'B: sigue viendo cobros ya confirmados';
  RAISE NOTICE 'B. efectivo: solo su socio, una vez, con comprobante: OK';
END $$;

-- ---------------------------------------------------------------
-- C. Libro y liquidación
-- ---------------------------------------------------------------
RESET ROLE;
DO $$
DECLARE
  r NUMERIC := (SELECT rate FROM t);
  com_part NUMERIC := ROUND(100 * r / 100, 2);
  com_cop  NUMERIC := ROUND(80 * r / 100, 2);
  com_tar  NUMERIC := ROUND(50 * r / 100, 2);
  bal NUMERIC;
BEGIN
  -- Particular en efectivo: servicio (100 − com) − efectivo 100 = −com.
  ASSERT (SELECT sum(amount) FROM ledger_obligations() WHERE request_id = (SELECT particular FROM t)
            AND creditor_id = 'a7a7a7a7-0000-4000-8000-000000000002') = -com_part, 'C: particular en efectivo no deja la comisión como deuda del socio';
  -- Copago en efectivo: (80 − com) − 20.
  ASSERT (SELECT sum(amount) FROM ledger_obligations() WHERE request_id = (SELECT copago FROM t)
            AND creditor_id = 'a7a7a7a7-0000-4000-8000-000000000002') = 80 - com_cop - 20, 'C: copago en efectivo mal descontado';
  -- Tarjeta aún pendiente: Budi le debe el neto completo (si luego paga con tarjeta, lo cobró Budi).
  ASSERT (SELECT sum(amount) FROM ledger_obligations() WHERE request_id = (SELECT tarjeta FROM t)
            AND creditor_id = 'a7a7a7a7-0000-4000-8000-000000000002') = 50 - com_tar, 'C: servicio sin pago en efectivo cambió';
  SELECT balance INTO bal FROM ledger_balances_all()
   WHERE debtor_kind = 'budi' AND creditor_kind = 'operator' AND creditor_id = 'a7a7a7a7-0000-4000-8000-000000000002';
  ASSERT bal = (100 - com_part - 100) + (80 - com_cop - 20) + (60 - ROUND(60 * r / 100, 2)) + (50 - com_tar),
         'C: saldo del socio no compensa el efectivo: ' || bal;
  ASSERT (SELECT concept FROM ledger_obligations() WHERE request_id = (SELECT particular FROM t) AND amount < 0) = 'efectivo_cobrado',
         'C: el efectivo no aparece con su concepto';
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.como('a7a7a7a7-0000-4000-8000-000000000002');
DO $$
DECLARE e RECORD;
BEGIN
  SELECT * INTO e FROM my_operator_earnings(sv_today(), sv_today());
  ASSERT e.servicios = 5 AND e.efectivo = 120, 'C: el socio no ve lo que cobró en efectivo: ' || row_to_json(e)::text;
  ASSERT e.saldo = e.a_pagar - 120, 'C: saldo del socio: ' || row_to_json(e)::text;
  RAISE NOTICE 'C. libro y liquidación descuentan el efectivo que ya tiene el socio: OK';
END $$;

-- ---------------------------------------------------------------
-- D. Tarjeta
-- ---------------------------------------------------------------
SELECT pg_temp.como('a7a7a7a7-0000-4000-8000-000000000014');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN PERFORM user_start_card_payment((SELECT tarjeta FROM t)); EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%todavía no está disponible%'; END;
  ASSERT ok, 'D: sin pasarela la tarjeta no avisa que no está disponible';
  ASSERT NOT (service_payment((SELECT tarjeta FROM t))->>'card_available')::boolean, 'D: dice que hay tarjeta sin pasarela';
  ok := false;
  BEGIN PERFORM confirm_gateway_payment('x', 'wompi', 'tx', 50, true); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'D: un usuario puede confirmar pagos de la pasarela';
END $$;

RESET ROLE;
SELECT vault.create_secret('wompi', 'payment_gateway');
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('a7a7a7a7-0000-4000-8000-000000000014');
CREATE TEMP TABLE ref (r TEXT) ON COMMIT DROP;
GRANT ALL ON ref TO PUBLIC;
INSERT INTO ref SELECT user_start_card_payment((SELECT tarjeta FROM t))->>'reference';

RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  ASSERT confirm_gateway_payment('NO-EXISTE', 'wompi', 'tx0', 50, true) = 'unknown_reference', 'D: referencia desconocida';
  ASSERT confirm_gateway_payment((SELECT r FROM ref), 'wompi', 'tx1', 50, false) = 'declined', 'D: rechazo';
  ASSERT (SELECT status FROM service_payments WHERE reference = (SELECT r FROM ref)) = 'pending', 'D: un rechazo cerró el cobro';
  BEGIN PERFORM confirm_gateway_payment((SELECT r FROM ref), 'wompi', 'tx2', 5, true); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'D: aceptó un monto distinto';
  ASSERT confirm_gateway_payment((SELECT r FROM ref), 'wompi', 'tx3', 50, true) = 'paid', 'D: aprobado';
  ASSERT confirm_gateway_payment((SELECT r FROM ref), 'wompi', 'tx3', 50, true) = 'already_paid', 'D: no es idempotente';
END $$;
RESET ROLE;
DO $$
BEGIN
  ASSERT (SELECT method = 'card' AND gateway_tx = 'tx3' AND receipt_number IS NOT NULL FROM service_payments
           WHERE request_id = (SELECT tarjeta FROM t)), 'D: el pago con tarjeta no quedó registrado';
  -- Lo cobró Budi: el socio sigue con su neto completo.
  ASSERT NOT EXISTS (SELECT 1 FROM ledger_obligations() WHERE request_id = (SELECT tarjeta FROM t) AND concept = 'efectivo_cobrado'),
         'D: un pago con tarjeta se contó como efectivo del socio';
  RAISE NOTICE 'D. tarjeta: no disponible sin pasarela; webhook con monto exacto e idempotente: OK';
END $$;

-- ---------------------------------------------------------------
-- E. Quién ve el comprobante
-- ---------------------------------------------------------------
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  r JSONB;
  ok BOOLEAN := false;
BEGIN
  PERFORM pg_temp.como('a7a7a7a7-0000-4000-8000-000000000001');
  r := service_payment((SELECT copago FROM t));
  ASSERT r->>'payer' = 'insurer' AND (r->>'amount_due')::numeric = 20 AND (r->>'covered')::numeric = 60, 'E: desglose del afiliado: ' || r::text;
  ASSERT NOT (r::text ~* 'commission|comision|rate'), 'E: el comprobante muestra la comisión: ' || r::text;
  PERFORM pg_temp.como('a7a7a7a7-0000-4000-8000-000000000005');  -- otra persona
  BEGIN PERFORM service_payment((SELECT copago FROM t)); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'E: un tercero vio el comprobante';
  ok := false;
  BEGIN PERFORM 1 FROM service_payments; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'E: la tabla de cobros es legible directo';
  RAISE NOTICE 'E. comprobante solo para Usuario, socio y Budi, sin comisión: OK';
END $$;

-- ---------------------------------------------------------------
-- F. Admin: anular y registrar transferencia
-- ---------------------------------------------------------------
SELECT pg_temp.como('a7a7a7a7-0000-4000-8000-000000000004');
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  PERFORM admin_void_service_payment((SELECT id FROM admin_service_payments(sv_today(), sv_today(), NULL) a WHERE a.request_id = (SELECT particular FROM t)),
                                     'El socio confirmó por error');
  BEGIN PERFORM admin_record_service_payment((SELECT id FROM admin_service_payments(sv_today(), sv_today(), NULL) a WHERE a.request_id = (SELECT copago FROM t)), 'transfer', 'x');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'F: registró un pago que ya estaba pagado';
  ASSERT (SELECT count(*) FROM admin_service_payments(sv_today(), sv_today(), NULL) a
           WHERE a.request_id IN ((SELECT particular FROM t), (SELECT copago FROM t), (SELECT tarjeta FROM t))) = 3, 'F: listado del admin';
END $$;
RESET ROLE;
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM ledger_obligations() WHERE request_id = (SELECT particular FROM t) AND concept = 'efectivo_cobrado'),
         'F: el efectivo anulado sigue descontándose';
  RAISE NOTICE 'F. anulación saca el efectivo del libro: OK';
END $$;

ROLLBACK;
