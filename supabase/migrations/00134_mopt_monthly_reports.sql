-- =====================================================
-- MOPT-06 · Reporte mensual oficial del programa MOPT (B-24)
--
-- El día 1 de cada mes (8:00 a. m. SV) se genera el reporte del mes anterior
-- por programa y se guarda como FOTO (`mopt_reports`): lo que se envió no
-- cambia si después se corrige un dato. Contiene:
--   * resumen ejecutivo: servicios, SLA (asignación y llegada), km, por tipo
--     de servicio y por zona (mismo cálculo que el tablero MOPT-01);
--   * costo: servicios + tarifa de Budi, contra el tope del contrato (MOPT-05);
--   * anexo: cada servicio con folio, fecha, tipo, zona, km, costo y SLA
--     (sin datos del Usuario).
--
-- Correo: se manda a dueño y administradores del portal MOPT con el resumen y
-- el enlace al reporte (que se imprime a PDF desde el portal). Sale por pg_net
-- a Resend si existen los secretos de Vault `resend_api_key` y
-- `report_from_email` (y `app_base_url` para el enlace). Sin ellos, el reporte
-- se genera igual y queda "sin enviar: falta configurar el correo".
-- =====================================================

-- ─── Núcleo de cumplimiento con el programa como parámetro ─────────────────
-- Igual que mopt_compliance (00107) pero sin depender de la sesión: lo usan el
-- job y el admin.
CREATE OR REPLACE FUNCTION public._mopt_compliance_for(p_mopt UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH svc AS (
    SELECT sr.*, s.assignment_seconds, s.arrival_seconds, s.assignment_target, s.arrival_target,
           c.approach_km, c.tow_km
      FROM service_requests sr
      CROSS JOIN LATERAL request_sla(sr.id) s
      LEFT JOIN cases c ON c.request_id = sr.id
     WHERE sr.mopt_provider_id = p_mopt
       AND sr.status = 'completed'
       AND sr.completed_at >= sv_day_start(p_from) AND sr.completed_at < sv_day_start(p_to + 1)
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'targets', (SELECT jsonb_build_object(
                   'assignment_minutes', COALESCE(o.sla_assignment_minutes, 10),
                   'arrival_minutes',    COALESCE(o.sla_arrival_minutes, 45))
                  FROM organizations o WHERE o.provider_id = p_mopt),
    'completed',              (SELECT count(*) FROM svc),
    'avg_arrival_seconds',    (SELECT ROUND(AVG(arrival_seconds)) FROM svc),
    'avg_assignment_seconds', (SELECT ROUND(AVG(assignment_seconds)) FROM svc),
    'on_time_pct', (SELECT ROUND(100.0 * count(*) FILTER (WHERE arrival_seconds <= arrival_target * 60)
                              / NULLIF(count(*) FILTER (WHERE arrival_seconds IS NOT NULL), 0), 1) FROM svc),
    'assignment_met_pct', (SELECT ROUND(100.0 * count(*) FILTER (WHERE assignment_seconds <= assignment_target * 60)
                              / NULLIF(count(*) FILTER (WHERE assignment_seconds IS NOT NULL), 0), 1) FROM svc),
    'km_total', (SELECT COALESCE(SUM(COALESCE(approach_km, 0) + COALESCE(tow_km, 0)), 0) FROM svc),
    'by_service', (SELECT COALESCE(jsonb_agg(jsonb_build_object('service_type', service_type, 'count', n) ORDER BY n DESC), '[]'::jsonb)
                     FROM (SELECT COALESCE(service_type, 'tow') AS service_type, count(*) AS n FROM svc GROUP BY 1) x),
    'by_zone', (SELECT COALESCE(jsonb_agg(jsonb_build_object('zone', zona, 'count', n) ORDER BY n DESC), '[]'::jsonb)
                  FROM (SELECT COALESCE((SELECT z.name FROM mopt_zones z
                                          WHERE z.provider_id = p_mopt
                                            AND point_in_polygon(svc.pickup_lat, svc.pickup_lng, z.polygon)
                                          ORDER BY z.created_at LIMIT 1), 'Fuera de zona') AS zona,
                               count(*) AS n
                          FROM svc GROUP BY 1) x));
$$;
REVOKE ALL ON FUNCTION public._mopt_compliance_for(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;

-- ─── El reporte de un mes ───────────────────────────────────────────────────
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
               'services', COALESCE(sum(sr.total_price), 0),
               'platform_fee', COALESCE(sum(ROUND(sr.total_price * mopt_fee_rate_at(sr.mopt_provider_id, sr.completed_at) / 100, 2)), 0),
               'total', mopt_month_consumption(p_mopt, v_from))
               FROM service_requests sr
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
               'km', ROUND(COALESCE(cs.approach_km, 0) + COALESCE(cs.tow_km, 0), 1),
               'cost', sr.total_price,
               'operator', op.full_name,
               'assignment_met', s.assignment_seconds <= s.assignment_target * 60,
               'arrival_met', s.arrival_seconds <= s.arrival_target * 60) ORDER BY sr.completed_at)
             FROM service_requests sr
             CROSS JOIN LATERAL request_sla(sr.id) s
             LEFT JOIN cases cs ON cs.request_id = sr.id
             LEFT JOIN profiles op ON op.id = sr.operator_id
            WHERE sr.mopt_provider_id = p_mopt AND sr.status = 'completed'
              AND sr.completed_at >= sv_day_start(v_from) AND sr.completed_at < sv_day_start(v_to + 1)), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public._mopt_report_build(UUID, DATE) FROM PUBLIC, anon, authenticated;

-- ─── Fotos enviadas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mopt_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  month        DATE NOT NULL CHECK (month = date_trunc('month', month)::date),
  report       JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_status TEXT,
  emailed_to   TEXT[],
  emailed_at   TIMESTAMPTZ,
  UNIQUE (provider_id, month)
);
ALTER TABLE public.mopt_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mopt_reports FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.mopt_reports IS
  'MOPT-06: foto mensual del reporte oficial por programa, tal como se envió.';

CREATE OR REPLACE FUNCTION public._vault_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN (SELECT NULLIF(decrypted_secret, '') FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._vault_secret(TEXT) FROM PUBLIC, anon, authenticated;

-- Correo con el resumen y el enlace. Devuelve el estado que queda registrado.
CREATE OR REPLACE FUNCTION public._email_mopt_report(p_report UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r      RECORD;
  v_key  TEXT := _vault_secret('resend_api_key');
  v_from TEXT := _vault_secret('report_from_email');
  v_base TEXT := COALESCE(_vault_secret('app_base_url'), 'https://budi.sv');
  v_to   TEXT[];
  v_c    JSONB;
  v_html TEXT;
  v_status TEXT;
  v_month_name TEXT;
BEGIN
  SELECT mr.*, o.id AS org_id INTO r
    FROM mopt_reports mr JOIN organizations o ON o.provider_id = mr.provider_id
   WHERE mr.id = p_report;
  IF NOT FOUND THEN
    RETURN 'no existe';
  END IF;

  SELECT array_agg(DISTINCT lower(p.email)) INTO v_to
    FROM organization_members om JOIN profiles p ON p.id = om.profile_id
   WHERE om.organization_id = r.org_id AND om.status = 'active' AND om.role IN ('owner', 'admin') AND p.email IS NOT NULL;

  IF v_to IS NULL OR cardinality(v_to) = 0 THEN
    v_status := 'sin enviar: el portal no tiene dueño ni administradores';
  ELSIF v_key IS NULL OR v_from IS NULL THEN
    v_status := 'sin enviar: falta configurar el correo (resend_api_key / report_from_email)';
  ELSE
    v_c := r.report->'compliance';
    v_month_name := to_char(r.month, 'TMMonth YYYY');
    v_html := format(
      '<p>Reporte mensual del programa <b>%s</b> — %s.</p>'
      '<ul><li>Servicios completados: <b>%s</b></li>'
      '<li>Asignación a tiempo: <b>%s %%</b> · llegada a tiempo: <b>%s %%</b></li>'
      '<li>Km recorridos: <b>%s</b></li>'
      '<li>Costo del mes (servicios + tarifa): <b>$%s</b></li></ul>'
      '<p>El detalle y los anexos, listos para imprimir en PDF: <a href="%s/mopt/reportes/%s">ver el reporte</a>.</p>'
      '<p style="color:#6b7280;font-size:12px">Budi · Asistencia vial. Este correo no contiene datos personales de los usuarios.</p>',
      r.report->>'program', v_month_name, v_c->>'completed',
      COALESCE(v_c->>'assignment_met_pct', '—'), COALESCE(v_c->>'on_time_pct', '—'),
      v_c->>'km_total', r.report->'cost'->>'total', v_base, to_char(r.month, 'YYYY-MM'));
    BEGIN
      PERFORM net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('from', v_from, 'to', to_jsonb(v_to),
                                   'subject', format('Reporte mensual %s · %s', r.report->>'program', v_month_name),
                                   'html', v_html),
        timeout_milliseconds := 10000);
      v_status := 'enviado';
    EXCEPTION WHEN OTHERS THEN
      v_status := 'error: ' || left(SQLERRM, 200);
    END;
  END IF;

  UPDATE mopt_reports
     SET email_status = v_status, emailed_to = v_to,
         emailed_at = CASE WHEN v_status = 'enviado' THEN now() ELSE emailed_at END
   WHERE id = p_report;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public._email_mopt_report(UUID) FROM PUBLIC, anon, authenticated;

-- Genera (o regenera) la foto de un mes y opcionalmente la envía.
CREATE OR REPLACE FUNCTION public._generate_mopt_report(p_mopt UUID, p_month DATE, p_send BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month DATE := date_trunc('month', p_month)::date;
  v_id UUID;
BEGIN
  INSERT INTO mopt_reports (provider_id, month, report)
  VALUES (p_mopt, v_month, _mopt_report_build(p_mopt, v_month))
  ON CONFLICT (provider_id, month) DO UPDATE SET report = EXCLUDED.report, generated_at = now()
  RETURNING id INTO v_id;
  IF p_send THEN
    PERFORM _email_mopt_report(v_id);
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._generate_mopt_report(UUID, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- Job del día 1: el mes anterior de cada programa activo.
CREATE OR REPLACE FUNCTION public.mopt_monthly_reports_job()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  n INT := 0;
  v_month DATE := (date_trunc('month', sv_today()) - interval '1 month')::date;
BEGIN
  FOR r IN SELECT id FROM providers WHERE is_mopt AND is_active LOOP
    -- No se reenvía si ya salió (el job puede correr dos veces).
    IF NOT EXISTS (SELECT 1 FROM mopt_reports WHERE provider_id = r.id AND month = v_month AND email_status = 'enviado') THEN
      PERFORM _generate_mopt_report(r.id, v_month, true);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.mopt_monthly_reports_job() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('mopt-monthly-reports')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mopt-monthly-reports');
  -- 14:00 UTC = 8:00 a. m. en El Salvador.
  PERFORM cron.schedule('mopt-monthly-reports', '0 14 1 * *', 'SELECT public.mopt_monthly_reports_job()');
END $$;

-- ─── Portal MOPT ────────────────────────────────────────────────────────────
-- Meses con actividad o con foto, del más reciente al más viejo.
CREATE OR REPLACE FUNCTION public.mopt_reports_list()
RETURNS TABLE (month TEXT, services BIGINT, generated_at TIMESTAMPTZ, email_status TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_mopt UUID := auth_mopt_id();
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;
  RETURN QUERY
  WITH meses AS (
    SELECT to_char(date_trunc('month', sr.completed_at AT TIME ZONE 'America/El_Salvador'), 'YYYY-MM') AS m, count(*) AS n
      FROM service_requests sr
     WHERE sr.mopt_provider_id = v_mopt AND sr.status = 'completed'
     GROUP BY 1
    UNION
    SELECT to_char(sv_today(), 'YYYY-MM'), 0
  )
  SELECT x.m, max(x.n)::bigint, mr.generated_at, mr.email_status
    FROM meses x
    LEFT JOIN mopt_reports mr ON mr.provider_id = v_mopt AND to_char(mr.month, 'YYYY-MM') = x.m
   GROUP BY x.m, mr.generated_at, mr.email_status
   ORDER BY x.m DESC
   LIMIT 36;
END;
$$;

-- El reporte de un mes: la foto enviada si existe; si no (mes en curso), en vivo.
CREATE OR REPLACE FUNCTION public.mopt_report(p_month TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt  UUID := auth_mopt_id();
  v_month DATE;
  r       RECORD;
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;
  IF p_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Mes inválido (AAAA-MM)';
  END IF;
  v_month := (p_month || '-01')::date;
  SELECT * INTO r FROM mopt_reports WHERE provider_id = v_mopt AND month = v_month;
  IF FOUND THEN
    RETURN r.report || jsonb_build_object('snapshot', true, 'generated_at', r.generated_at,
                                          'email_status', r.email_status, 'emailed_at', r.emailed_at);
  END IF;
  RETURN _mopt_report_build(v_mopt, v_month) || jsonb_build_object('snapshot', false, 'generated_at', now());
END;
$$;

-- ─── Admin: regenerar y reenviar ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_generate_mopt_report(p_mopt UUID, p_month TEXT, p_send BOOLEAN DEFAULT false)
RETURNS JSONB
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
  IF NOT EXISTS (SELECT 1 FROM providers WHERE id = p_mopt AND is_mopt) THEN
    RAISE EXCEPTION 'Programa MOPT no encontrado';
  END IF;
  v_id := _generate_mopt_report(p_mopt, (p_month || '-01')::date, p_send);
  RETURN (SELECT jsonb_build_object('id', id, 'month', to_char(month, 'YYYY-MM'), 'email_status', email_status,
                                    'emailed_to', emailed_to, 'completed', report->'compliance'->'completed')
            FROM mopt_reports WHERE id = v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mopt_reports(p_mopt UUID)
RETURNS TABLE (month TEXT, generated_at TIMESTAMPTZ, email_status TEXT, emailed_to TEXT[], services INT)
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
  SELECT to_char(mr.month, 'YYYY-MM'), mr.generated_at, mr.email_status, mr.emailed_to,
         (mr.report->'compliance'->>'completed')::int
    FROM mopt_reports mr WHERE mr.provider_id = p_mopt ORDER BY mr.month DESC;
END;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['mopt_reports_list()', 'mopt_report(text)', 'admin_generate_mopt_report(uuid,text,boolean)',
                           'admin_mopt_reports(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
