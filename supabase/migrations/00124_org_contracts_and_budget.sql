-- 00124: contrato y presupuesto del cliente institucional (backlog MOPT-05, D1)
--
-- Ficha de contrato por organización: referencia, vigencia, tarifas pactadas
-- (texto; los montos salen del catálogo y de las tarifas versionadas, 00102),
-- tope mensual del Fondo Vial y qué pasa al llegar al tope:
--   - 'keep_courtesy' (por defecto, propuesta D1): el servicio sigue sin costo
--     para el Usuario y se le factura al MOPT; se avisa al 80 % y al 100 %.
--   - 'charge_user': al llegar al tope, la cortesía se corta y el Usuario
--     paga el servicio hasta el mes siguiente.
-- Fuera de la vigencia del contrato no hay cortesía. Un programa SIN contrato
-- cargado sigue como antes (cortesía por zona y horario), para no cortar a
-- nadie por una ficha que aún no existe.
--
-- Consumo del mes = servicios del programa completados en el mes (hora de El
-- Salvador): monto del servicio + tarifa de plataforma, el mismo total que el
-- estado de cuenta (00123).

CREATE TABLE public.organization_contracts (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  reference       TEXT,
  valid_from      DATE NOT NULL,
  valid_to        DATE,
  monthly_cap     NUMERIC(12,2) CHECK (monthly_cap IS NULL OR monthly_cap > 0),
  on_cap          TEXT NOT NULL DEFAULT 'keep_courtesy' CHECK (on_cap IN ('keep_courtesy', 'charge_user')),
  tariff_notes    TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
ALTER TABLE public.organization_contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_contracts FROM anon, authenticated;

CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_contracts
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at,updated_by');

-- Una fila por umbral avisado y mes: el aviso sale una sola vez.
CREATE TABLE public.org_budget_alerts (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  month           DATE NOT NULL,
  threshold       INTEGER NOT NULL CHECK (threshold IN (80, 100)),
  consumed        NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, month, threshold)
);
ALTER TABLE public.org_budget_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_budget_alerts FROM anon, authenticated;

-- ─── Consumo ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mopt_month_consumption(p_mopt_provider UUID, p_day DATE DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(sum(sr.total_price
           + ROUND(sr.total_price * mopt_fee_rate_at(sr.mopt_provider_id, sr.completed_at) / 100, 2)), 0)
    FROM service_requests sr
   WHERE sr.mopt_provider_id = p_mopt_provider
     AND sr.status = 'completed' AND sr.total_price IS NOT NULL
     AND sr.completed_at >= sv_day_start(date_trunc('month', COALESCE(p_day, sv_today()))::date)
     AND sr.completed_at <  sv_day_start((date_trunc('month', COALESCE(p_day, sv_today())) + interval '1 month')::date);
$$;
REVOKE ALL ON FUNCTION public.mopt_month_consumption(UUID, DATE) FROM PUBLIC, anon, authenticated;

-- ¿El programa puede dar cortesía hoy? (vigencia + tope)
CREATE OR REPLACE FUNCTION public.mopt_program_has_budget(p_mopt_provider UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN c.organization_id IS NULL THEN true   -- sin contrato cargado: como antes
    WHEN sv_today() < c.valid_from OR (c.valid_to IS NOT NULL AND sv_today() > c.valid_to) THEN false
    WHEN c.monthly_cap IS NOT NULL AND c.on_cap = 'charge_user'
         AND mopt_month_consumption(p_mopt_provider) >= c.monthly_cap THEN false
    ELSE true
  END
  FROM (SELECT 1) x
  LEFT JOIN organizations o ON o.type = 'MOPT' AND o.provider_id = p_mopt_provider
  LEFT JOIN organization_contracts c ON c.organization_id = o.id;
$$;
REVOKE ALL ON FUNCTION public.mopt_program_has_budget(UUID) FROM PUBLIC, anon, authenticated;

-- La zona, el horario y ahora también el contrato.
CREATE OR REPLACE FUNCTION public.mopt_program_for(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_service_type TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT z.provider_id
    FROM mopt_zones z
    JOIN providers pr ON pr.id = z.provider_id AND pr.is_mopt AND pr.is_active
   WHERE z.is_active
     AND (z.service_types IS NULL OR COALESCE(p_service_type, 'tow') = ANY (z.service_types))
     AND point_in_polygon(p_lat, p_lng, z.polygon)
     -- 00107: y en su horario.
     AND mopt_zone_open_now(z.hours_from, z.hours_to, z.active_days)
     -- 00124: y con contrato vigente y presupuesto (si el contrato corta al tope).
     AND mopt_program_has_budget(z.provider_id)
   ORDER BY z.created_at, z.id
   LIMIT 1;
$$;

-- ─── Ficha (admin) y estado (admin y el propio cliente) ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_org_contract(
  p_org UUID, p_reference TEXT, p_valid_from DATE, p_valid_to DATE,
  p_monthly_cap NUMERIC, p_on_cap TEXT, p_tariff_notes TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador edita contratos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org AND type IN ('MOPT', 'INSURER')) THEN
    RAISE EXCEPTION 'Solo el MOPT y las aseguradoras tienen contrato';
  END IF;
  IF p_valid_from IS NULL THEN
    RAISE EXCEPTION 'Indica desde cuándo rige el contrato';
  END IF;
  IF p_valid_to IS NOT NULL AND p_valid_to < p_valid_from THEN
    RAISE EXCEPTION 'La vigencia termina antes de empezar';
  END IF;
  IF p_monthly_cap IS NOT NULL AND p_monthly_cap <= 0 THEN
    RAISE EXCEPTION 'El tope mensual debe ser mayor que cero (o déjalo vacío)';
  END IF;
  IF COALESCE(p_on_cap, 'keep_courtesy') NOT IN ('keep_courtesy', 'charge_user') THEN
    RAISE EXCEPTION 'Qué pasa al llegar al tope: keep_courtesy o charge_user';
  END IF;

  INSERT INTO organization_contracts (organization_id, reference, valid_from, valid_to, monthly_cap,
                                      on_cap, tariff_notes, updated_by)
  VALUES (p_org, NULLIF(btrim(COALESCE(p_reference, '')), ''), p_valid_from, p_valid_to, p_monthly_cap,
          COALESCE(p_on_cap, 'keep_courtesy'), NULLIF(btrim(COALESCE(p_tariff_notes, '')), ''), auth.uid())
  ON CONFLICT (organization_id) DO UPDATE SET
    reference = EXCLUDED.reference, valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to,
    monthly_cap = EXCLUDED.monthly_cap, on_cap = EXCLUDED.on_cap, tariff_notes = EXCLUDED.tariff_notes,
    updated_at = now(), updated_by = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.org_contract_status(p_org UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org UUID;
  o organizations;
  c organization_contracts;
  v_consumed NUMERIC;
  v_pct NUMERIC;
BEGIN
  IF is_admin() AND p_org IS NOT NULL THEN
    v_org := p_org;
  ELSE
    SELECT a.organization_id INTO v_org FROM auth_org() a;
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'Necesitas una sesión en el portal de tu organización';
    END IF;
  END IF;

  SELECT * INTO o FROM organizations WHERE id = v_org;
  SELECT * INTO c FROM organization_contracts WHERE organization_id = v_org;

  IF o.type = 'MOPT' THEN
    v_consumed := mopt_month_consumption(o.provider_id);
  END IF;
  IF c.monthly_cap IS NOT NULL AND v_consumed IS NOT NULL THEN
    v_pct := ROUND(v_consumed * 100 / c.monthly_cap, 1);
  END IF;

  RETURN jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type),
    'has_contract', c.organization_id IS NOT NULL,
    'reference', c.reference,
    'valid_from', c.valid_from,
    'valid_to', c.valid_to,
    'active', c.organization_id IS NOT NULL AND sv_today() >= c.valid_from
              AND (c.valid_to IS NULL OR sv_today() <= c.valid_to),
    'monthly_cap', c.monthly_cap,
    'on_cap', c.on_cap,
    'tariff_notes', c.tariff_notes,
    'sla_assignment_minutes', o.sla_assignment_minutes,
    'sla_arrival_minutes', o.sla_arrival_minutes,
    'platform_fee_pct', CASE WHEN o.type = 'MOPT' THEN mopt_fee_rate_at(o.provider_id, now()) END,
    'month', to_char(sv_today(), 'YYYY-MM'),
    'consumed', v_consumed,
    'consumed_pct', v_pct,
    'level', CASE WHEN v_pct IS NULL THEN 'none'
                  WHEN v_pct >= 100 THEN 'reached'
                  WHEN v_pct >= 80 THEN 'warning'
                  ELSE 'ok' END,
    -- Lo que de verdad pasa hoy con un servicio nuevo en su zona.
    'courtesy_now', CASE WHEN o.type = 'MOPT' THEN mopt_program_has_budget(o.provider_id) END
  );
END;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_set_org_contract(uuid,text,date,date,numeric,text,text)', 'org_contract_status(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ─── Avisos al 80 % y al 100 % ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_org_budgets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_month DATE := date_trunc('month', sv_today())::date;
  v_consumed NUMERIC;
  v_pct NUMERIC;
  t INTEGER;
  v_sent INTEGER := 0;
BEGIN
  FOR r IN
    SELECT o.id, o.name, o.provider_id, c.monthly_cap, c.on_cap
      FROM organizations o JOIN organization_contracts c ON c.organization_id = o.id
     WHERE o.type = 'MOPT' AND o.status = 'active' AND c.monthly_cap IS NOT NULL
  LOOP
    v_consumed := mopt_month_consumption(r.provider_id);
    v_pct := v_consumed * 100 / r.monthly_cap;
    FOREACH t IN ARRAY ARRAY[80, 100] LOOP
      IF v_pct >= t AND NOT EXISTS (SELECT 1 FROM org_budget_alerts
                                     WHERE organization_id = r.id AND month = v_month AND threshold = t) THEN
        INSERT INTO org_budget_alerts (organization_id, month, threshold, consumed)
        VALUES (r.id, v_month, t, v_consumed);
        PERFORM notify_ops(format(
          '💰 Budi: %s llegó al %s%% de su tope mensual ($%s de $%s). %s',
          r.name, t, to_char(v_consumed, 'FM999999990.00'), to_char(r.monthly_cap, 'FM999999990.00'),
          CASE WHEN t = 100 AND r.on_cap = 'charge_user'
               THEN 'La cortesía se cortó: los Usuarios pagan hasta el mes siguiente.'
               WHEN t = 100 THEN 'Los servicios siguen sin costo para el Usuario y se le facturan.'
               ELSE 'Conviene avisarle.' END));
        v_sent := v_sent + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_sent;
END;
$$;
REVOKE ALL ON FUNCTION public.check_org_budgets() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('check-org-budgets', '*/15 * * * *', $$SELECT public.check_org_budgets()$$);

-- El aviso del panel (ADMIN) también muestra los topes en riesgo este mes.
DO $$
DECLARE v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.staff_ops_alerts()'::regprocedure) INTO v_def;
  IF position('budgets_at_risk' IN v_def) = 0 THEN
    v_def := replace(v_def,
      $a$    'checked_at', now()$a$,
      $b$    -- 00124: clientes al 80 % o más de su tope mensual (solo ADMIN).
    'budgets_at_risk', CASE WHEN is_admin() THEN
                         (SELECT count(DISTINCT organization_id) FROM org_budget_alerts
                           WHERE month = date_trunc('month', sv_today())::date)
                       END,
    'checked_at', now()$b$);
    IF position('budgets_at_risk' IN v_def) = 0 THEN
      RAISE EXCEPTION 'staff_ops_alerts cambió: no se pudo agregar budgets_at_risk';
    END IF;
    EXECUTE v_def;
  END IF;
END $$;
