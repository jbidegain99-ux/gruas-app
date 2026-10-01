-- 00156: decisiones de producto del MOPT (Walter, 2026-10-01).
--
-- 1. El reporte mensual oficial se rehace al aprobar el estado de cuenta del
--    mes, si las cifras cambiaron (ajustes de Budi): sube de versión, queda
--    marcado como corregido y se reenvía por correo.
-- 2. Contrato vencido o programa suspendido: la vista previa lo dice, para
--    que el Usuario sepa por qué esta vez no es cortesía (como el tope, 00151).
-- 3. Socios operadores con casos observados sin resolver: el portal avisa al
--    registrarles un pago (se puede pagar igual).

-- ─── 1. Reporte corregido ──────────────────────────────────────────────────
ALTER TABLE public.mopt_reports
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrected_statement TEXT;

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
  ON CONFLICT (provider_id, month) DO UPDATE
    -- 00142: la foto cambió; el "enviado" anterior era de otra versión.
    -- 00156: y se cuenta la versión.
    SET report = EXCLUDED.report, generated_at = now(), email_status = NULL,
        version = mopt_reports.version + 1
  RETURNING id INTO v_id;
  IF p_send THEN
    PERFORM _email_mopt_report(v_id);
  END IF;
  RETURN v_id;
END;
$$;

-- Tras aprobar un estado de cuenta MOPT: los meses del período que ya tienen
-- reporte oficial se rehacen si las cifras cambiaron. Un mes sin foto todavía
-- (en curso o antes del día 1) no se toca: el job del día 1 ya lo hará bien.
CREATE OR REPLACE FUNCTION public._mopt_refresh_reports_after_approval(p_statement UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s      RECORD;
  m      DATE;
  r      RECORD;
  v_new  JSONB;
  v_id   UUID;
  v_n    INT := 0;
BEGIN
  SELECT st.number, st.period_from, st.period_to, o.provider_id INTO s
    FROM account_statements st JOIN organizations o ON o.id = st.organization_id
   WHERE st.id = p_statement AND o.type = 'MOPT';
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  FOR m IN SELECT generate_series(date_trunc('month', s.period_from), date_trunc('month', s.period_to), interval '1 month')::date LOOP
    SELECT * INTO r FROM mopt_reports WHERE provider_id = s.provider_id AND month = m;
    CONTINUE WHEN NOT FOUND;
    v_new := _mopt_report_build(s.provider_id, m);
    CONTINUE WHEN v_new->'cost' IS NOT DISTINCT FROM r.report->'cost'
              AND v_new->'annex' IS NOT DISTINCT FROM r.report->'annex';
    UPDATE mopt_reports SET corrected_at = now(), corrected_statement = s.number
     WHERE id = r.id;
    v_id := _generate_mopt_report(s.provider_id, m, true);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._mopt_refresh_reports_after_approval(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_statement(p_id UUID)
RETURNS NUMERIC
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

  -- 00156: el reporte oficial del mes pasa a reflejar lo aprobado. Si algo
  -- falla al rehacerlo, la aprobación sigue (el reporte se puede regenerar).
  BEGIN
    PERFORM _mopt_refresh_reports_after_approval(p_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'No se pudo rehacer el reporte MOPT tras aprobar %: %', p_id, SQLERRM;
  END;
  RETURN v_amount;
END;
$$;

-- Correo: si es una versión corregida, lo dice en el asunto y el cuerpo.
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
  v_fix  TEXT := '';
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

  IF r.corrected_at IS NOT NULL THEN
    v_fix := format('<p><b>Versión corregida (v%s):</b> incluye los ajustes aprobados en el estado de cuenta %s. '
                    'Reemplaza al reporte enviado antes.</p>', r.version, COALESCE(r.corrected_statement, ''));
  END IF;

  IF v_to IS NULL OR cardinality(v_to) = 0 THEN
    v_status := 'sin enviar: el portal no tiene dueño ni administradores';
  ELSIF v_key IS NULL OR v_from IS NULL THEN
    v_status := 'sin enviar: falta configurar el correo (resend_api_key / report_from_email)';
  ELSE
    v_c := r.report->'compliance';
    v_month_name := to_char(r.month, 'TMMonth YYYY');
    v_html := v_fix || format(
      '<p>Reporte mensual del programa <b>%s</b> — %s.</p>'
      '<ul><li>Servicios completados: <b>%s</b></li>'
      '<li>Asignación a tiempo: <b>%s %%</b> · llegada a tiempo: <b>%s %%</b></li>'
      '<li>Km recorridos: <b>%s</b></li>'
      '<li>Costo del mes (servicios + tarifa): <b>$%s</b></li></ul>'
      '<p>El detalle y los anexos, listos para imprimir en PDF: <a href="%s/mopt/reportes/%s">ver el reporte</a>.</p>'
      '<p style="color:#6b7280;font-size:12px">Budi · Asistencia vial. Este correo no contiene datos personales de los Usuarios.</p>',
      r.report->>'program', v_month_name, v_c->>'completed',
      COALESCE(v_c->>'assignment_met_pct', '—'), COALESCE(v_c->>'on_time_pct', '—'),
      v_c->>'km_total', r.report->'cost'->>'total', v_base, to_char(r.month, 'YYYY-MM'));
    BEGIN
      PERFORM net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('from', v_from, 'to', to_jsonb(v_to),
                                   'subject', format('Reporte mensual%s %s · %s',
                                                     CASE WHEN r.corrected_at IS NOT NULL THEN ' corregido' ELSE '' END,
                                                     r.report->>'program', v_month_name),
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

-- El portal sabe si la foto es una versión corregida.
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
                                          'email_status', r.email_status, 'emailed_at', r.emailed_at,
                                          'version', r.version, 'corrected_at', r.corrected_at,
                                          'corrected_statement', r.corrected_statement);
  END IF;
  RETURN _mopt_report_build(v_mopt, v_month) || jsonb_build_object('snapshot', false, 'generated_at', now());
END;
$$;

-- ─── 2. Contrato vencido o programa suspendido ─────────────────────────────
CREATE OR REPLACE FUNCTION public.preview_mopt_program(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_service_type TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cov  JSONB;
  v_mopt UUID;
  v_zone UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('applies', false);
  END IF;
  v_cov := check_member_coverage();
  v_mopt := mopt_payer_for(v_cov, p_lat, p_lng, p_service_type);
  IF v_mopt IS NOT NULL THEN
    RETURN jsonb_build_object(
      'applies', true,
      'program_name', (SELECT name FROM providers WHERE id = v_mopt)
    );
  END IF;

  -- ¿Lo cubriría un programa si tuviera presupuesto? (mismas reglas que
  -- mopt_program_for, salvo el presupuesto). Solo si el seguro no paga.
  IF NOT insurer_pays_for(v_cov, p_service_type) THEN
    SELECT z.provider_id INTO v_zone
      FROM mopt_zones z
      JOIN providers pr ON pr.id = z.provider_id AND pr.is_mopt AND pr.is_active
     WHERE z.is_active
       AND (z.service_types IS NULL OR COALESCE(p_service_type, 'tow') = ANY (z.service_types))
       AND point_in_polygon(p_lat, p_lng, z.polygon)
       AND mopt_zone_open_now(z.hours_from, z.hours_to, z.active_days)
     ORDER BY z.created_at, z.id
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'applies', false,
    -- 00151: llegó al tope del mes y el contrato corta la cortesía.
    'capped', v_zone IS NOT NULL AND mopt_program_capped(v_zone),
    -- 00156: contrato vencido o programa suspendido.
    'paused', v_zone IS NOT NULL AND NOT mopt_program_capped(v_zone) AND NOT mopt_program_has_budget(v_zone),
    'program_name', (SELECT name FROM providers WHERE id = v_zone)
  );
END;
$$;

-- ─── 3. Casos observados por socio ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.mopt_list_operators();
CREATE FUNCTION public.mopt_list_operators()
RETURNS TABLE (
  operator_id UUID, full_name TEXT, phone TEXT, verification_status TEXT, in_program BOOLEAN,
  services BIGINT, owed NUMERIC, paid NUMERIC, balance NUMERIC, last_paid_on DATE,
  plate TEXT, avg_rating NUMERIC, ratings_count BIGINT,
  observed_cases BIGINT, observed_amount NUMERIC
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
  ),
  -- Casos del socio observados por el MOPT y sin respuesta de Budi.
  obs AS (
    SELECT sr.operator_id, count(*) AS n, COALESCE(sum(l.amount), 0) AS amount
      FROM statement_observations ob
      JOIN account_statements st      ON st.id = ob.statement_id AND st.status = 'issued'
      JOIN organizations o            ON o.id = st.organization_id AND o.provider_id = v_mopt
      JOIN account_statement_lines l  ON l.statement_id = ob.statement_id AND l.request_id = ob.request_id
      JOIN service_requests sr        ON sr.id = ob.request_id
     WHERE ob.status = 'open'
     GROUP BY sr.operator_id
  )
  SELECT p.id, p.full_name, p.phone, p.verification_status,
         (p.provider_id = v_mopt AND p.role = 'OPERATOR'),
         COALESCE(s.services, 0), COALESCE(s.owed, 0), COALESCE(s.paid, 0),
         COALESCE(s.balance, 0), s.last_paid_on,
         ov.plate, rt.avg_rating, rt.ratings_count,
         COALESCE(obs.n, 0), COALESCE(obs.amount, 0)
    FROM ops
    JOIN profiles p ON p.id = ops.id
    LEFT JOIN saldos s ON s.creditor_id = p.id
    LEFT JOIN operator_vehicles ov ON ov.operator_id = p.id AND ov.is_active
    LEFT JOIN obs ON obs.operator_id = p.id
    CROSS JOIN LATERAL mopt_operator_rating(v_mopt, p.id) rt
   ORDER BY COALESCE(s.balance, 0) DESC, p.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.mopt_list_operators() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_list_operators() TO authenticated;
