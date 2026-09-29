-- 00123: estados de cuenta para clientes institucionales y observaciones por caso
-- (backlog MOPT-03, MOPT-04 y ASE-03; D1 con la propuesta por defecto de Jose)
--
-- Un estado de cuenta es el cierre de un período para UNA organización (MOPT o
-- aseguradora). Sus líneas son una FOTO de cada servicio completado en el
-- período, tomada del mismo cálculo que el libro de movimientos (00097/00102):
--   - MOPT: monto del servicio (lo que el MOPT le paga al socio o a su
--     empresa) + tarifa de plataforma de Budi (tasa vigente al completarse).
--   - Aseguradora: lo que cubre su póliza (a pagar a Budi) y, informativo, el
--     copago del afiliado. Cuadra con admin_finance_by_insurer.
--
-- Ciclo: borrador → emitido → aprobado por el cliente → pagado.
--   - En borrador Budi lo puede regenerar. Al emitirlo, las líneas quedan
--     congeladas: ni un cambio de tarifa ni una corrección posterior las mueve.
--   - El cliente (dueño o administrador del portal) lo aprueba. Antes puede
--     OBSERVAR casos (analista incluido): un caso observado queda fuera del
--     total aprobado hasta que Budi lo confirma o lo ajusta. El historial de
--     cada observación lo ven ambas partes (MOPT-04).
--   - Budi lo marca pagado con fecha y referencia.
-- Un servicio entra en un solo estado de cuenta (no anulado) por organización.

CREATE SEQUENCE public.account_statement_seq;

CREATE TABLE public.account_statements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  number          TEXT UNIQUE,
  period_from     DATE NOT NULL,
  period_to       DATE NOT NULL CHECK (period_to >= period_from),
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'issued', 'approved', 'paid', 'void')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  issued_at       TIMESTAMPTZ,
  issued_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  approved_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_amount NUMERIC(12,2),
  paid_at         DATE,
  paid_reference  TEXT,
  paid_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  void_reason     TEXT
);
CREATE INDEX account_statements_org_idx ON public.account_statements (organization_id, period_from DESC);

CREATE TABLE public.account_statement_lines (
  statement_id   UUID NOT NULL REFERENCES public.account_statements(id) ON DELETE CASCADE,
  request_id     UUID NOT NULL REFERENCES public.service_requests(id),
  folio          TEXT,
  completed_at   TIMESTAMPTZ NOT NULL,
  service_type   TEXT NOT NULL,
  provider_kind  TEXT,          -- provider | operator (MOPT)
  provider_id    UUID,
  provider_name  TEXT,
  tow_km         NUMERIC(10,2),
  total_km       NUMERIC(10,2),
  amount         NUMERIC(12,2) NOT NULL,   -- MOPT: servicio · aseguradora: cubierto
  fee            NUMERIC(12,2) NOT NULL DEFAULT 0,  -- MOPT: tarifa de plataforma
  copay          NUMERIC(12,2),            -- aseguradora: informativo
  PRIMARY KEY (statement_id, request_id)
);

CREATE TABLE public.statement_observations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id    UUID NOT NULL REFERENCES public.account_statements(id) ON DELETE CASCADE,
  request_id      UUID NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'adjusted')),
  adjusted_amount NUMERIC(12,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  FOREIGN KEY (statement_id, request_id) REFERENCES public.account_statement_lines(statement_id, request_id),
  UNIQUE (statement_id, request_id)
);

CREATE TABLE public.statement_observation_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id UUID NOT NULL REFERENCES public.statement_observations(id) ON DELETE CASCADE,
  side           TEXT NOT NULL CHECK (side IN ('client', 'budi')),
  kind           TEXT NOT NULL CHECK (kind IN ('opened', 'reply', 'confirmed', 'adjusted', 'reopened')),
  body           TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  amount         NUMERIC(12,2),
  author_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.account_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statement_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statement_observation_events ENABLE ROW LEVEL SECURITY;
-- Sin políticas: todo pasa por las RPC de abajo, que deciden quién ve qué.
REVOKE ALL ON public.account_statements, public.account_statement_lines,
              public.statement_observations, public.statement_observation_events FROM anon, authenticated;

-- Emitido, lo congelado no se toca: ni por error desde una RPC futura.
CREATE OR REPLACE FUNCTION public.statement_lines_frozen()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM account_statements
   WHERE id = COALESCE(NEW.statement_id, OLD.statement_id);
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'El estado de cuenta ya fue emitido: sus líneas no se modifican';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_statement_lines_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON public.account_statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.statement_lines_frozen();

-- Quién emite, aprueba, paga o anula queda en la bitácora (00094).
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.account_statements
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'status,approved_amount,paid_at,paid_reference,void_reason');

-- ─── Cálculo de las líneas ──────────────────────────────────────────────────
-- Servicios completados de la organización en el período, que no estén ya en
-- otro estado de cuenta vigente de la misma organización.
CREATE OR REPLACE FUNCTION public.statement_candidate_lines(p_org UUID, p_from DATE, p_to DATE, p_exclude UUID)
RETURNS TABLE (request_id UUID, folio TEXT, completed_at TIMESTAMPTZ, service_type TEXT,
               provider_kind TEXT, provider_id UUID, provider_name TEXT,
               tow_km NUMERIC, total_km NUMERIC, amount NUMERIC, fee NUMERIC, copay NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o organizations;
BEGIN
  SELECT * INTO o FROM organizations WHERE id = p_org;

  IF o.type = 'MOPT' THEN
    RETURN QUERY
    SELECT sr.id, c.folio, sr.completed_at, COALESCE(sr.service_type, 'tow'),
           CASE WHEN sr.provider_id IS NOT NULL AND sr.provider_id <> o.provider_id THEN 'provider' ELSE 'operator' END,
           CASE WHEN sr.provider_id IS NOT NULL AND sr.provider_id <> o.provider_id THEN sr.provider_id ELSE sr.operator_id END,
           CASE WHEN sr.provider_id IS NOT NULL AND sr.provider_id <> o.provider_id
                THEN ledger_party_name('provider', sr.provider_id)
                ELSE ledger_party_name('operator', sr.operator_id) END,
           c.tow_km,
           -- Sin km calculados (caso sin recorrido) queda vacío, no en 0.
           CASE WHEN c.approach_km IS NULL AND c.tow_km IS NULL THEN NULL
                ELSE COALESCE(c.approach_km, 0) + COALESCE(c.tow_km, 0) END,
           sr.total_price,
           ROUND(sr.total_price * mopt_fee_rate_at(sr.mopt_provider_id, sr.completed_at) / 100, 2),
           NULL::NUMERIC
      FROM service_requests sr
      LEFT JOIN cases c ON c.request_id = sr.id
     WHERE sr.mopt_provider_id = o.provider_id
       AND sr.status = 'completed' AND sr.total_price IS NOT NULL
       AND sr.completed_at < sv_day_start(p_to + 1)
       AND sr.completed_at >= sv_day_start(p_from)
       AND NOT EXISTS (SELECT 1 FROM account_statement_lines l JOIN account_statements s ON s.id = l.statement_id
                        WHERE l.request_id = sr.id AND s.organization_id = p_org
                          AND s.status <> 'void' AND s.id IS DISTINCT FROM p_exclude)
     ORDER BY sr.completed_at;

  ELSIF o.type = 'INSURER' THEN
    RETURN QUERY
    SELECT sr.id, c.folio, sr.completed_at, COALESCE(sr.service_type, 'tow'),
           NULL::TEXT, NULL::UUID, NULL::TEXT,
           c.tow_km,
           -- Sin km calculados (caso sin recorrido) queda vacío, no en 0.
           CASE WHEN c.approach_km IS NULL AND c.tow_km IS NULL THEN NULL
                ELSE COALESCE(c.approach_km, 0) + COALESCE(c.tow_km, 0) END,
           cu.amount_covered, 0::NUMERIC, cu.amount_copay
      FROM service_requests sr
      JOIN coverage_usage cu ON cu.request_id = sr.id
      JOIN members m         ON m.id = cu.member_id
      JOIN policies po       ON po.id = m.policy_id
      LEFT JOIN cases c      ON c.request_id = sr.id
     WHERE po.insurer_id = o.insurer_id
       AND sr.mopt_provider_id IS NULL
       AND sr.status = 'completed' AND sr.total_price IS NOT NULL
       AND cu.amount_covered > 0
       AND sr.completed_at < sv_day_start(p_to + 1)
       AND sr.completed_at >= sv_day_start(p_from)
       AND NOT EXISTS (SELECT 1 FROM account_statement_lines l JOIN account_statements s ON s.id = l.statement_id
                        WHERE l.request_id = sr.id AND s.organization_id = p_org
                          AND s.status <> 'void' AND s.id IS DISTINCT FROM p_exclude)
     ORDER BY sr.completed_at;
  ELSE
    RAISE EXCEPTION 'Esta organización no recibe estados de cuenta';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.statement_candidate_lines(UUID, DATE, DATE, UUID) FROM PUBLIC, anon, authenticated;

-- Totales de un estado de cuenta. Lo observado y sin resolver queda aparte;
-- lo ajustado cuenta con su monto ajustado.
CREATE OR REPLACE FUNCTION public.statement_totals(p_statement UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'services', count(*),
    'amount',   COALESCE(sum(l.amount), 0),
    'fee',      COALESCE(sum(l.fee), 0),
    'copay',    COALESCE(sum(l.copay), 0),
    'total',    COALESCE(sum(l.amount + l.fee), 0),
    'observed_open', count(*) FILTER (WHERE ob.status = 'open'),
    'observed_open_amount', COALESCE(sum(l.amount + l.fee) FILTER (WHERE ob.status = 'open'), 0),
    -- Lo que se puede aprobar: sin lo observado abierto; lo ajustado, ajustado
    -- (el ajuste reemplaza al monto del servicio; la tarifa se recalcula en
    -- proporción).
    'approvable', COALESCE(sum(
        CASE WHEN ob.status = 'open' THEN 0
             WHEN ob.status = 'adjusted' THEN ob.adjusted_amount
                  + CASE WHEN l.amount > 0 THEN ROUND(l.fee * ob.adjusted_amount / l.amount, 2) ELSE 0 END
             ELSE l.amount + l.fee END), 0)
  )
  FROM account_statement_lines l
  LEFT JOIN statement_observations ob ON ob.statement_id = l.statement_id AND ob.request_id = l.request_id
  WHERE l.statement_id = p_statement;
$$;
REVOKE ALL ON FUNCTION public.statement_totals(UUID) FROM PUBLIC, anon, authenticated;

-- ─── Lado Budi (solo ADMIN: es dinero) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_generate_statement(p_org UUID, p_from DATE, p_to DATE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador genera estados de cuenta';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Rango de fechas inválido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org AND type IN ('MOPT', 'INSURER')) THEN
    RAISE EXCEPTION 'Solo el MOPT y las aseguradoras reciben estados de cuenta';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('statement:' || p_org::text));

  -- Mismo período en borrador: se regenera. Emitido: no se toca.
  SELECT id INTO v_id FROM account_statements
   WHERE organization_id = p_org AND period_from = p_from AND period_to = p_to AND status = 'draft';
  IF v_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM account_statements WHERE organization_id = p_org
                AND period_from = p_from AND period_to = p_to AND status NOT IN ('draft', 'void')) THEN
      RAISE EXCEPTION 'Ese período ya tiene un estado de cuenta emitido';
    END IF;
    INSERT INTO account_statements (organization_id, period_from, period_to, created_by)
    VALUES (p_org, p_from, p_to, auth.uid()) RETURNING id INTO v_id;
  ELSE
    DELETE FROM statement_observations WHERE statement_id = v_id;
    DELETE FROM account_statement_lines WHERE statement_id = v_id;
  END IF;

  INSERT INTO account_statement_lines (statement_id, request_id, folio, completed_at, service_type,
                                       provider_kind, provider_id, provider_name, tow_km, total_km,
                                       amount, fee, copay)
  SELECT v_id, c.request_id, c.folio, c.completed_at, c.service_type, c.provider_kind, c.provider_id,
         c.provider_name, c.tow_km, c.total_km, c.amount, c.fee, c.copay
    FROM statement_candidate_lines(p_org, p_from, p_to, v_id) c;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_issue_statement(p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s account_statements;
  v_number TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador emite estados de cuenta';
  END IF;
  SELECT * INTO s FROM account_statements WHERE id = p_id FOR UPDATE;
  IF s.id IS NULL OR s.status <> 'draft' THEN
    RAISE EXCEPTION 'Solo se emite un estado de cuenta en borrador';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM account_statement_lines WHERE statement_id = p_id) THEN
    RAISE EXCEPTION 'El estado de cuenta no tiene servicios';
  END IF;
  v_number := 'EC-' || to_char(s.period_from, 'YYYYMM') || '-' || lpad(nextval('account_statement_seq')::text, 4, '0');
  UPDATE account_statements
     SET status = 'issued', number = v_number, issued_at = now(), issued_by = auth.uid()
   WHERE id = p_id;
  RETURN v_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_void_statement(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador anula estados de cuenta';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el motivo de la anulación';
  END IF;
  UPDATE account_statements SET status = 'void', void_reason = btrim(p_reason)
   WHERE id = p_id AND status IN ('draft', 'issued');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo se anula un estado de cuenta en borrador o emitido (no aprobado ni pagado)';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_statement_paid(p_id UUID, p_paid_on DATE, p_reference TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador registra el pago';
  END IF;
  IF p_paid_on IS NULL OR NULLIF(btrim(COALESCE(p_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica la fecha y la referencia del pago';
  END IF;
  UPDATE account_statements
     SET status = 'paid', paid_at = p_paid_on, paid_reference = btrim(p_reference), paid_by = auth.uid()
   WHERE id = p_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo se marca pagado un estado de cuenta aprobado por el cliente';
  END IF;
END;
$$;

-- ─── Lectura (Budi y el cliente, con las mismas funciones) ─────────────────
-- ¿Puede quien llama ver este estado de cuenta? ADMIN, o un miembro activo
-- de la organización, y el cliente nunca ve un borrador.
CREATE OR REPLACE FUNCTION public.statement_access(p_id UUID)
RETURNS TEXT  -- 'budi' | 'client' | NULL
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN is_admin() THEN 'budi'
    WHEN EXISTS (SELECT 1 FROM account_statements s, auth_org() o
                  WHERE s.id = p_id AND s.organization_id = o.organization_id
                    AND s.status NOT IN ('draft', 'void')) THEN 'client'
  END;
$$;
REVOKE ALL ON FUNCTION public.statement_access(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_statements(p_org UUID DEFAULT NULL)
RETURNS TABLE (id UUID, organization_id UUID, organization_name TEXT, organization_type TEXT, number TEXT,
               period_from DATE, period_to DATE, status TEXT, issued_at TIMESTAMPTZ, approved_at TIMESTAMPTZ,
               approved_amount NUMERIC, paid_at DATE, paid_reference TEXT, totals JSONB)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org UUID;
BEGIN
  IF is_admin() THEN
    v_org := p_org;  -- NULL = todas
  ELSE
    SELECT o.organization_id INTO v_org FROM auth_org() o;
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'Necesitas una sesión en el portal de tu organización';
    END IF;
  END IF;

  RETURN QUERY
  SELECT s.id, s.organization_id, o.name, o.type, s.number, s.period_from, s.period_to, s.status,
         s.issued_at, s.approved_at, s.approved_amount, s.paid_at, s.paid_reference, statement_totals(s.id)
    FROM account_statements s
    JOIN organizations o ON o.id = s.organization_id
   WHERE (v_org IS NULL OR s.organization_id = v_org)
     AND (is_admin() OR s.status NOT IN ('draft', 'void'))
   ORDER BY s.period_from DESC, s.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.statement_detail(p_id UUID)
RETURNS JSONB
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
      SELECT jsonb_agg(x ORDER BY x->>'provider_name')
        FROM (SELECT jsonb_build_object('provider_name', COALESCE(provider_name, '—'),
                       'services', count(*), 'amount', sum(amount), 'tow_km', sum(tow_km)) AS x
                FROM account_statement_lines WHERE statement_id = s.id
               GROUP BY provider_name) g), '[]'::jsonb)
  ) INTO v
  FROM account_statements s JOIN organizations o ON o.id = s.organization_id
  WHERE s.id = p_id;
  RETURN v;
END;
$$;

-- ─── Lado cliente: observar y aprobar ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.observe_statement_case(p_statement UUID, p_request UUID, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_ob   statement_observations;
BEGIN
  IF statement_access(p_statement) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'Estado de cuenta no encontrado';
  END IF;
  SELECT member_role INTO v_role FROM auth_org();
  IF v_role NOT IN ('owner', 'admin', 'analyst') THEN
    RAISE EXCEPTION 'Tu rol en el portal es de solo lectura';
  END IF;
  IF (SELECT status FROM account_statements WHERE id = p_statement) <> 'issued' THEN
    RAISE EXCEPTION 'Solo se observan casos de un estado de cuenta emitido y sin aprobar';
  END IF;
  IF NULLIF(btrim(COALESCE(p_body, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Escribe qué observas del caso';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM account_statement_lines WHERE statement_id = p_statement AND request_id = p_request) THEN
    RAISE EXCEPTION 'Ese caso no está en este estado de cuenta';
  END IF;

  SELECT * INTO v_ob FROM statement_observations WHERE statement_id = p_statement AND request_id = p_request;
  IF v_ob.id IS NULL THEN
    INSERT INTO statement_observations (statement_id, request_id) VALUES (p_statement, p_request)
    RETURNING * INTO v_ob;
    INSERT INTO statement_observation_events (observation_id, side, kind, body, author_id)
    VALUES (v_ob.id, 'client', 'opened', btrim(p_body), auth.uid());
  ELSE
    -- Ya observado: se agrega al hilo; si estaba resuelto, se reabre.
    INSERT INTO statement_observation_events (observation_id, side, kind, body, author_id)
    VALUES (v_ob.id, 'client', CASE WHEN v_ob.status = 'open' THEN 'reply' ELSE 'reopened' END, btrim(p_body), auth.uid());
    UPDATE statement_observations SET status = 'open', resolved_at = NULL WHERE id = v_ob.id;
  END IF;
  RETURN v_ob.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_statement(p_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount NUMERIC;
BEGIN
  IF statement_access(p_id) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'Estado de cuenta no encontrado';
  END IF;
  IF (SELECT member_role FROM auth_org()) NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Solo el dueño o un administrador del portal aprueba estados de cuenta';
  END IF;
  v_amount := (statement_totals(p_id)->>'approvable')::NUMERIC;
  UPDATE account_statements
     SET status = 'approved', approved_at = now(), approved_by = auth.uid(), approved_amount = v_amount
   WHERE id = p_id AND status = 'issued';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo se aprueba un estado de cuenta emitido';
  END IF;
  RETURN v_amount;
END;
$$;

-- ─── Lado Budi: responder, confirmar o ajustar ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_answer_observation(p_observation UUID, p_body TEXT,
                                                           p_resolution TEXT DEFAULT NULL,
                                                           p_adjusted_amount NUMERIC DEFAULT NULL)
RETURNS VOID
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

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_generate_statement(uuid,date,date)', 'admin_issue_statement(uuid)',
    'admin_void_statement(uuid,text)', 'admin_mark_statement_paid(uuid,date,text)',
    'list_statements(uuid)', 'statement_detail(uuid)', 'observe_statement_case(uuid,uuid,text)',
    'approve_statement(uuid)', 'admin_answer_observation(uuid,text,text,numeric)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Una observación abierta necesita respuesta de Budi: al aviso del panel.
DO $$
DECLARE v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.staff_ops_alerts()'::regprocedure) INTO v_def;
  IF position('open_observations' IN v_def) = 0 THEN
    v_def := replace(v_def,
      $a$    'checked_at', now()$a$,
      $b$    -- 00123: casos observados por un cliente en su estado de cuenta (solo ADMIN).
    'open_observations', CASE WHEN is_admin() THEN
                           (SELECT count(*) FROM statement_observations WHERE status = 'open')
                         END,
    'checked_at', now()$b$);
    IF position('open_observations' IN v_def) = 0 THEN
      RAISE EXCEPTION 'staff_ops_alerts cambió: no se pudo agregar open_observations';
    END IF;
    EXECUTE v_def;
  END IF;
END $$;
