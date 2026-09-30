-- =====================================================
-- Auditoría del programa MOPT (2026-09-30): seguridad, dinero y números.
--
-- Seguridad
--   1. `service_requests` tenía el INSERT por defecto de Supabase para
--      `authenticated` y una política que solo pedía user_id = auth.uid().
--      Un Usuario insertaba la fila a mano con mopt_provider_id, status
--      'completed' y total_price a su gusto: cortesía fuera de zona, deuda
--      inventada del MOPT con un socio y el tope del contrato consumido. Las
--      apps crean solo por create_service_request (SECURITY DEFINER).
--   2. register_ledger_payment / void_ledger_payment solo pedían ser miembro
--      del programa: "Solo lectura" y analista (sin 2FA) registraban y anulaban
--      pagos a los socios. Ahora, como approve_statement: dueño o administrador.
--
-- Dinero
--   3. Un caso observado y abierto al aprobar quedaba fuera del total para
--      siempre (ya estaba en un estado de cuenta no anulado) y Budi podía
--      "resolverlo" después, cambiando los totales de un estado cerrado.
--      Regla: no se aprueba con observaciones abiertas y Budi responde solo
--      mientras el estado está emitido.
--   4. Afiliado con el límite anual de servicios agotado dentro de una zona
--      MOPT: el seguro "cubría" en papel, el MOPT no entraba y el Usuario
--      pagaba el 100 %. Ahora, sin eventos restantes, paga el programa.
--   5. El tope con on_cap = 'charge_user' solo contaba completados: los
--      servicios en curso lo pasaban de largo. Se reserva el precio base de
--      cada servicio MOPT en curso.
--   6. Un programa suspendido seguía dando cortesía.
--   7. El admin podía congelar como "oficial" el reporte del mes en curso (o
--      uno futuro); si se enviaba, el job del día 1 ya no lo rehacía.
--   8. Una zona con hora de inicio = hora de fin nunca abría; ahora es 24 h.
--
-- Números
--   9. Servicios del portal filtraba por fecha de pedido; cumplimiento,
--      reporte y estado de cuenta, por fecha de cierre. En el borde de mes no
--      cuadraban. Ahora: fecha de cierre, o de pedido si no ha cerrado. La
--      zona se elige igual que en cumplimiento (la más antigua).
--  10. get_case_sla devuelve program_name: el detalle de un caso MOPT decía
--      "Servicio particular · objetivos de la plataforma".
--  11. statement_detail.by_provider agrupaba por nombre: dos socios con el
--      mismo nombre salían en una sola fila.
-- =====================================================

-- ─── 1. Solicitudes: solo por create_service_request ────────────────────────
REVOKE INSERT ON public.service_requests FROM anon, authenticated;
DROP POLICY IF EXISTS "Users can create requests" ON public.service_requests;

-- ─── 2. Pagos del portal MOPT: dueño o administrador ────────────────────────
CREATE OR REPLACE FUNCTION public.mopt_can_manage_payments()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT o.member_role IN ('owner', 'admin')
                     FROM auth_org() o WHERE o.type = 'MOPT'), false);
$$;
REVOKE ALL ON FUNCTION public.mopt_can_manage_payments() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_ledger_payment(p_payer_kind text, p_payer_id uuid, p_payee_kind text, p_payee_id uuid, p_amount numeric, p_paid_on date DEFAULT NULL::date, p_reference text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
RETURNS uuid
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
    -- 00141: solo lectura y analista no mueven dinero.
    IF NOT mopt_can_manage_payments() THEN
      RAISE EXCEPTION 'Solo el dueño o un administrador del portal registra pagos';
    END IF;
    IF p_payer_kind <> 'mopt' OR p_payer_id IS DISTINCT FROM v_mopt OR p_payee_kind <> 'operator' THEN
      RAISE EXCEPTION 'Desde el portal MOPT solo se registran pagos del programa a sus socios operadores';
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

CREATE OR REPLACE FUNCTION public.void_ledger_payment(p_payment_id uuid, p_reason text)
RETURNS void
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
  -- 00141: solo lectura y analista no mueven dinero.
  IF NOT is_admin() AND NOT mopt_can_manage_payments() THEN
    RAISE EXCEPTION 'Solo el dueño o un administrador del portal anula pagos';
  END IF;
  IF v_pago.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'El pago ya estaba anulado';
  END IF;

  UPDATE ledger_payments
     SET voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   WHERE id = p_payment_id;
END;
$$;

-- ─── 3. Estados de cuenta: se aprueba sin observaciones abiertas ────────────
CREATE OR REPLACE FUNCTION public.approve_statement(p_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount NUMERIC;
  v_totals JSONB;
BEGIN
  IF statement_access(p_id) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'Estado de cuenta no encontrado';
  END IF;
  IF (SELECT member_role FROM auth_org()) NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Solo el dueño o un administrador del portal aprueba estados de cuenta';
  END IF;
  -- Bloquea la fila: una observación nueva no se cuela entre la cuenta y el UPDATE.
  PERFORM 1 FROM account_statements WHERE id = p_id FOR UPDATE;
  v_totals := statement_totals(p_id);
  -- 00141: un caso observado y abierto al aprobar no volvía a cobrarse nunca
  -- (ya está en un estado no anulado). Primero responde Budi, luego apruebas.
  IF (v_totals->>'observed_open')::INT > 0 THEN
    RAISE EXCEPTION 'Hay % caso(s) observado(s) sin respuesta de Budi. Se aprueba cuando estén resueltos.',
      (v_totals->>'observed_open')::INT;
  END IF;
  v_amount := (v_totals->>'approvable')::NUMERIC;
  UPDATE account_statements
     SET status = 'approved', approved_at = now(), approved_by = auth.uid(), approved_amount = v_amount
   WHERE id = p_id AND status = 'issued';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo se aprueba un estado de cuenta emitido';
  END IF;
  RETURN v_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_answer_observation(p_observation uuid, p_body text, p_resolution text DEFAULT NULL::text, p_adjusted_amount numeric DEFAULT NULL::numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ob statement_observations;
  v_line_amount NUMERIC;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador responde observaciones';
  END IF;
  IF NULLIF(btrim(COALESCE(p_body, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Escribe la respuesta';
  END IF;
  SELECT * INTO v_ob FROM statement_observations WHERE id = p_observation FOR UPDATE;
  IF v_ob.id IS NULL THEN
    RAISE EXCEPTION 'Observación no encontrada';
  END IF;
  -- 00141: aprobado o pagado, el estado está cerrado; su total ya no se mueve.
  IF (SELECT status FROM account_statements WHERE id = v_ob.statement_id) <> 'issued' THEN
    RAISE EXCEPTION 'El estado de cuenta ya no está emitido; sus observaciones no se pueden responder';
  END IF;
  IF p_resolution IS NOT NULL AND p_resolution NOT IN ('confirmed', 'adjusted') THEN
    RAISE EXCEPTION 'Resolución inválida';
  END IF;
  IF p_resolution = 'adjusted' THEN
    SELECT amount INTO v_line_amount FROM account_statement_lines
     WHERE statement_id = v_ob.statement_id AND request_id = v_ob.request_id;
    IF p_adjusted_amount IS NULL OR p_adjusted_amount < 0 OR p_adjusted_amount > v_line_amount THEN
      RAISE EXCEPTION 'El monto ajustado va de 0 a % (el monto original)', v_line_amount;
    END IF;
  END IF;

  INSERT INTO statement_observation_events (observation_id, side, kind, body, amount, author_id)
  VALUES (p_observation, 'budi', COALESCE(p_resolution, 'reply'), btrim(p_body),
          CASE WHEN p_resolution = 'adjusted' THEN p_adjusted_amount END, auth.uid());

  IF p_resolution IS NOT NULL THEN
    UPDATE statement_observations
       SET status = p_resolution, resolved_at = now(),
           adjusted_amount = CASE WHEN p_resolution = 'adjusted' THEN p_adjusted_amount END
     WHERE id = p_observation;
  END IF;
END;
$$;

-- ─── 4. Pagador: límite anual agotado -> paga el MOPT ───────────────────────
CREATE OR REPLACE FUNCTION public.mopt_payer_for(p_coverage jsonb, p_lat double precision, p_lng double precision, p_service_type text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_coverage->>'status' = 'covered'
     AND plan_cubre_servicio((p_coverage->>'plan_id')::UUID, COALESCE(p_service_type, 'tow'))
     -- 00141: con los servicios del año agotados el seguro no paga nada; si el
     -- punto cae en una zona MOPT, la cortesía aplica como a cualquier otro.
     AND COALESCE((evaluate_coverage((p_coverage->>'member_id')::UUID,
                                     COALESCE(p_service_type, 'tow'), 0)->>'covered')::BOOLEAN, true) THEN
    RETURN NULL;
  END IF;
  RETURN mopt_program_for(p_lat, p_lng, p_service_type);
END;
$$;

-- ─── 5 y 6. Presupuesto: reserva de los servicios en curso; suspendido = sin cortesía
-- Lo que ya está comprometido: el precio base (+ tarifa) de cada servicio MOPT abierto.
CREATE OR REPLACE FUNCTION public.mopt_open_reservation(p_mopt_provider uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(sum(s.base_price + ROUND(s.base_price * mopt_fee_rate_at(sr.mopt_provider_id, now()) / 100, 2)), 0)
    FROM service_requests sr
    JOIN services s ON s.slug = COALESCE(sr.service_type, 'tow')
   WHERE sr.mopt_provider_id = p_mopt_provider
     AND sr.status IN ('initiated', 'assigned', 'en_route', 'active');
$$;
REVOKE ALL ON FUNCTION public.mopt_open_reservation(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mopt_program_has_budget(p_mopt_provider uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    -- 00141: un programa suspendido no da cortesía (tampoco entra a su portal).
    WHEN o.id IS NOT NULL AND o.status <> 'active' THEN false
    WHEN c.organization_id IS NULL THEN true   -- sin contrato cargado: como antes
    WHEN sv_today() < c.valid_from OR (c.valid_to IS NOT NULL AND sv_today() > c.valid_to) THEN false
    -- 00141: lo cerrado del mes + el precio base de lo que está en curso. Solo
    -- con lo cerrado, N servicios abiertos cerca del tope lo pasaban de largo.
    WHEN c.monthly_cap IS NOT NULL AND c.on_cap = 'charge_user'
         AND mopt_month_consumption(p_mopt_provider) + mopt_open_reservation(p_mopt_provider) >= c.monthly_cap THEN false
    ELSE true
  END
  FROM (SELECT 1) x
  LEFT JOIN organizations o ON o.type = 'MOPT' AND o.provider_id = p_mopt_provider
  LEFT JOIN organization_contracts c ON c.organization_id = o.id;
$$;


-- ─── 7. Reporte oficial: solo meses cerrados ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_generate_mopt_report(p_mopt uuid, p_month text, p_send boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  IF p_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Mes inválido (AAAA-MM)';
  END IF;
  -- 00141: el mes en curso no tiene cifras finales; la foto quedaba como
  -- "oficial" y, si se enviaba, el job del día 1 ya no la rehacía.
  IF (p_month || '-01')::date >= date_trunc('month', sv_today())::date THEN
    RAISE EXCEPTION 'Solo se genera el reporte de un mes que ya cerró';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM providers WHERE id = p_mopt AND is_mopt) THEN
    RAISE EXCEPTION 'Programa MOPT no encontrado';
  END IF;
  v_id := _generate_mopt_report(p_mopt, (p_month || '-01')::date, p_send);
  RETURN (SELECT jsonb_build_object('id', id, 'month', to_char(month, 'YYYY-MM'), 'email_status', email_status,
                                    'emailed_to', emailed_to, 'completed', report->'compliance'->'completed')
            FROM mopt_reports WHERE id = v_id);
END;
$$;

-- Fotos del mes en curso que ya existan (generadas antes de esta regla): fuera.
DELETE FROM public.mopt_reports WHERE month >= date_trunc('month', sv_today())::date;

-- ─── 8. Zona con inicio = fin: abierta las 24 h ─────────────────────────────
CREATE OR REPLACE FUNCTION public.mopt_zone_open_now(p_from time without time zone, p_to time without time zone, p_days smallint[])
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ahora AS (SELECT now() AT TIME ZONE 'America/El_Salvador' AS t)
  SELECT (p_days IS NULL OR cardinality(p_days) = 0
            OR EXTRACT(ISODOW FROM t)::smallint = ANY (p_days))
     AND (p_from IS NULL OR p_to IS NULL
            OR p_from = p_to                     -- 00141: 00:00–00:00 = todo el día
            OR (p_from < p_to AND t::time >= p_from AND t::time < p_to)
            OR (p_from > p_to AND (t::time >= p_from OR t::time < p_to)))
    FROM ahora
$$;

-- ─── 9. Servicios del portal: mismo corte que cumplimiento y reporte ────────
CREATE OR REPLACE FUNCTION public.mopt_list_services(p_from date, p_to date)
RETURNS TABLE(id uuid, folio text, status text, service_type text, client_name text, vehicle_plate text, pickup_address text, pickup_lat double precision, pickup_lng double precision, operator_name text, created_at timestamp with time zone, completed_at timestamp with time zone, total_price numeric, zone text)
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
  SELECT sr.id, c.folio, sr.status::text, COALESCE(sr.service_type, 'tow'),
         cli.full_name, sr.vehicle_plate,
         sr.pickup_address, sr.pickup_lat, sr.pickup_lng,
         ope.full_name, sr.created_at, sr.completed_at, sr.total_price,
         COALESCE(
           -- 00141: la zona más antigua, como mopt_compliance y el reporte.
           (SELECT z.name FROM mopt_zones z
             WHERE z.provider_id = v_mopt
               AND point_in_polygon(sr.pickup_lat, sr.pickup_lng, z.polygon)
             ORDER BY z.created_at, z.id LIMIT 1),
           sv_department(sr.pickup_lat, sr.pickup_lng))
    FROM service_requests sr
    LEFT JOIN cases c      ON c.request_id = sr.id
    LEFT JOIN profiles cli ON cli.id = sr.user_id
    LEFT JOIN profiles ope ON ope.id = sr.operator_id
   WHERE sr.mopt_provider_id = v_mopt
     -- 00141: por fecha de cierre (la del reporte y el estado de cuenta); lo
     -- que no ha cerrado, por fecha de pedido.
     AND COALESCE(sr.completed_at, sr.created_at) >= sv_day_start(p_from)
     AND COALESCE(sr.completed_at, sr.created_at) <  sv_day_start(p_to + 1)
   ORDER BY sr.created_at DESC;
END;
$$;

-- ─── 10. SLA del caso: nombre del programa MOPT ─────────────────────────────
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

-- ─── 11. Estado de cuenta: resumen por socio o empresa, no por nombre ───────
CREATE OR REPLACE FUNCTION public.statement_detail(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_side TEXT := statement_access(p_id);
  v JSONB;
BEGIN
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'Estado de cuenta no encontrado';
  END IF;

  SELECT jsonb_build_object(
    'id', s.id, 'number', s.number, 'status', s.status,
    'period_from', s.period_from, 'period_to', s.period_to,
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type),
    'issued_at', s.issued_at, 'approved_at', s.approved_at, 'approved_amount', s.approved_amount,
    'approved_by', (SELECT COALESCE(NULLIF(btrim(full_name), ''), email) FROM profiles WHERE id = s.approved_by),
    'paid_at', s.paid_at, 'paid_reference', s.paid_reference, 'void_reason', s.void_reason,
    'viewer', v_side,
    'can_approve', v_side = 'client' AND s.status = 'issued'
                   AND (SELECT member_role FROM auth_org()) IN ('owner', 'admin'),
    'can_observe', v_side = 'client' AND s.status = 'issued'
                   AND (SELECT member_role FROM auth_org()) IN ('owner', 'admin', 'analyst'),
    'totals', statement_totals(s.id),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'request_id', l.request_id, 'folio', l.folio, 'completed_at', l.completed_at,
               'service_type', l.service_type, 'provider_name', l.provider_name,
               'tow_km', l.tow_km, 'total_km', l.total_km,
               'amount', l.amount, 'fee', l.fee, 'copay', l.copay,
               'observation', CASE WHEN ob.id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', ob.id, 'status', ob.status, 'adjusted_amount', ob.adjusted_amount,
                 'events', (SELECT jsonb_agg(jsonb_build_object(
                              'side', e.side, 'kind', e.kind, 'body', e.body, 'amount', e.amount,
                              'author', COALESCE(NULLIF(btrim(p.full_name), ''), p.email, 'Cuenta eliminada'),
                              'at', e.created_at) ORDER BY e.created_at)
                              FROM statement_observation_events e
                              LEFT JOIN profiles p ON p.id = e.author_id
                             WHERE e.observation_id = ob.id)) END
             ) ORDER BY l.completed_at)
        FROM account_statement_lines l
        LEFT JOIN statement_observations ob ON ob.statement_id = l.statement_id AND ob.request_id = l.request_id
       WHERE l.statement_id = s.id), '[]'::jsonb),
    'by_provider', COALESCE((
      -- 00141: por socio o empresa (id), no por nombre: dos homónimos eran una fila.
      SELECT jsonb_agg(x ORDER BY x->>'provider_name', x->>'provider_id')
        FROM (SELECT jsonb_build_object('provider_id', provider_id, 'provider_kind', provider_kind,
                       'provider_name', COALESCE(provider_name, '—'),
                       'services', count(*), 'amount', sum(amount), 'tow_km', sum(tow_km)) AS x
                FROM account_statement_lines WHERE statement_id = s.id
               GROUP BY provider_kind, provider_id, provider_name) g), '[]'::jsonb)
  ) INTO v
  FROM account_statements s JOIN organizations o ON o.id = s.organization_id
  WHERE s.id = p_id;
  RETURN v;
END;
$$;
