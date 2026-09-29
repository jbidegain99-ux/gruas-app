-- =====================================================
-- Pagos a socios operadores (migr. 00125, backlog LAN-08)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. El lote toma lo que Budi debe, con la cuenta bancaria y los servicios.
--   B. Pagado: registra en el libro (el saldo baja), avisa al socio, y quien
--      no tenía cuenta sale del lote y sigue pendiente.
--   C. El socio ve cuánto, cuándo y por qué servicios. Solo lo suyo.
--   D. Solo ADMIN prepara y paga; las cuentas no se leen directo.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre), now(), now()
  FROM (VALUES
    ('9e9e9e9e-0000-4000-8000-000000000001', 'pg.admin@budi.invalid',   'Admin pagos'),
    ('9e9e9e9e-0000-4000-8000-000000000002', 'pg.concta@budi.invalid',  'Socio con cuenta'),
    ('9e9e9e9e-0000-4000-8000-000000000003', 'pg.sincta@budi.invalid',  'Socio sin cuenta'),
    ('9e9e9e9e-0000-4000-8000-000000000004', 'pg.usuario@budi.invalid', 'Usuario pagos'),
    ('9e9e9e9e-0000-4000-8000-000000000005', 'pg.usuario2@budi.invalid','Usuario pagos 2')
  ) AS x(id, email, nombre);
UPDATE profiles SET role = 'ADMIN' WHERE id = '9e9e9e9e-0000-4000-8000-000000000001';
UPDATE profiles SET role = 'OPERATOR', verification_status = 'approved', provider_id = NULL
 WHERE id IN ('9e9e9e9e-0000-4000-8000-000000000002', '9e9e9e9e-0000-4000-8000-000000000003');
INSERT INTO operator_profiles (operator_id, bank_name, bank_account_type, bank_account_number, bank_account_holder)
VALUES ('9e9e9e9e-0000-4000-8000-000000000002', 'Banco Agrícola', 'ahorro', '3001234567', 'Socio con cuenta');

CREATE TEMP TABLE t ON COMMIT DROP AS SELECT
  '9e9e9e9e-0000-4000-8000-000000000001'::uuid AS admin,
  '9e9e9e9e-0000-4000-8000-000000000002'::uuid AS concta,
  '9e9e9e9e-0000-4000-8000-000000000003'::uuid AS sincta,
  NULL::uuid AS lote, NULL::text AS folio;
GRANT ALL ON t TO PUBLIC;

-- Un servicio completado para cada socio (particular: Budi les debe).
INSERT INTO service_requests (user_id, operator_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng,
                              pickup_address, dropoff_lat, dropoff_lng, dropoff_address, incident_type, total_price,
                              completed_at, assigned_at, activated_at)
VALUES ('9e9e9e9e-0000-4000-8000-000000000004', '9e9e9e9e-0000-4000-8000-000000000002', 'completed', 'tow', 'light', 'x',
        13.69, -89.21, 'Punto', 13.70, -89.22, 'Destino', 'Vehículo varado', 80, now() - interval '1 day',
        now() - interval '1 day 1 hour', now() - interval '1 day 30 minutes'),
       ('9e9e9e9e-0000-4000-8000-000000000005', '9e9e9e9e-0000-4000-8000-000000000003', 'completed', 'tow', 'light', 'x',
        13.69, -89.21, 'Punto', 13.70, -89.22, 'Destino', 'Vehículo varado', 60, now() - interval '1 day',
        now() - interval '1 day 1 hour', now() - interval '1 day 30 minutes');
UPDATE t SET folio = (SELECT c.folio FROM cases c JOIN service_requests sr ON sr.id = c.request_id
                       WHERE sr.operator_id = '9e9e9e9e-0000-4000-8000-000000000002');

SET LOCAL ROLE authenticated;

-- D1. Un socio no prepara pagos ni lee cuentas.
SELECT pg_temp.como((SELECT concta FROM t));
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_create_payout_batch(NULL);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Solo un administrador%';
  END;
  ASSERT ok, 'D1: un socio preparo un lote';
  ok := false;
  BEGIN
    PERFORM count(*) FROM provider_bank_accounts;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'D1: las cuentas bancarias se leen directo';
END $$;

-- A. El lote.
SELECT pg_temp.como((SELECT admin FROM t));
DO $$
DECLARE d JSONB; con JSONB; sin JSONB;
BEGIN
  UPDATE t SET lote = admin_create_payout_batch(NULL);
  d := admin_payout_batch((SELECT lote FROM t));
  SELECT i INTO con FROM jsonb_array_elements(d->'items') i WHERE i->>'payee_id' = (SELECT concta FROM t)::text;
  SELECT i INTO sin FROM jsonb_array_elements(d->'items') i WHERE i->>'payee_id' = (SELECT sincta FROM t)::text;
  ASSERT con IS NOT NULL AND sin IS NOT NULL, 'A1: faltan destinatarios en el lote';
  ASSERT con->>'account_number' = '3001234567' AND sin->>'account_number' IS NULL, 'A2: cuentas mal tomadas';
  ASSERT (con->>'amount')::numeric > 0 AND (con->>'amount')::numeric <= 80, 'A3: monto fuera de rango: ' || (con->>'amount');
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(con->'services') s WHERE s->>'folio' = (SELECT folio FROM t)),
    'A4: el pago no lista el servicio que cubre';
  -- Recalcular el borrador no duplica.
  ASSERT admin_create_payout_batch(NULL) = (SELECT lote FROM t), 'A5: se creo otro borrador';
  RAISE NOTICE 'A. lote con cuenta, monto y servicios: OK';
END $$;

-- B. Pagado.
DO $$
DECLARE n INTEGER; ok BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM admin_mark_payout_paid((SELECT lote FROM t), sv_today(), '', NULL);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Indica la referencia%';
  END;
  ASSERT ok, 'B1: se pago sin referencia';
  n := admin_mark_payout_paid((SELECT lote FROM t), sv_today(), 'TRF-778899', 'lotes/prueba.pdf');
  ASSERT n >= 1, 'B2: no pago a nadie';
  ASSERT (SELECT status FROM admin_list_payout_batches() WHERE id = (SELECT lote FROM t)) = 'paid', 'B2: el lote no quedo pagado';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(admin_payout_batch((SELECT lote FROM t))->'items') i
                      WHERE i->>'payee_id' = (SELECT sincta FROM t)::text), 'B3: quien no tenia cuenta quedo en el lote pagado';
END $$;

RESET ROLE;
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM ledger_balances_all() WHERE creditor_kind = 'operator'
                       AND creditor_id = (SELECT concta FROM t) AND balance > 0), 'B4: el saldo pagado sigue pendiente';
  ASSERT EXISTS (SELECT 1 FROM ledger_balances_all() WHERE creditor_kind = 'operator'
                   AND creditor_id = (SELECT sincta FROM t) AND balance > 0), 'B5: al que no tenia cuenta se le borro la deuda';
  ASSERT EXISTS (SELECT 1 FROM notification_queue WHERE user_id = (SELECT concta FROM t) AND data->>'type' = 'payout'),
    'B6: al socio no le llego el aviso';
  RAISE NOTICE 'B. pagado: libro al dia, aviso al socio, el sin cuenta sigue pendiente: OK';
END $$;
SET LOCAL ROLE authenticated;

-- C. Lo que ve cada socio.
SELECT pg_temp.como((SELECT concta FROM t));
DO $$
DECLARE m JSONB; p JSONB;
BEGIN
  m := my_payouts();
  p := m->'payments'->0;
  ASSERT p->>'reference' = 'TRF-778899' AND p->>'payer' = 'Budi', 'C1: el socio no ve su pago: ' || m::text;
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'services') s WHERE s->>'folio' = (SELECT folio FROM t)),
    'C2: el socio no ve por que servicios';
  ASSERT (m->>'pending')::numeric = 0, 'C3: le figura saldo pendiente';
END $$;

SELECT pg_temp.como((SELECT sincta FROM t));
DO $$
DECLARE m JSONB;
BEGIN
  m := my_payouts();
  ASSERT jsonb_array_length(m->'payments') = 0, 'C4: el otro socio ve pagos ajenos';
  ASSERT (m->>'pending')::numeric > 0, 'C4: no ve lo que se le debe';
  RAISE NOTICE 'C. cada socio ve solo sus pagos, con servicios, y lo pendiente: OK';
END $$;

ROLLBACK;
