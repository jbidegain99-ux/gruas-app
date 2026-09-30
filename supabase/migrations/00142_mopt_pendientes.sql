-- =====================================================
-- MOPT: lo que quedó pendiente de la auditoría (00141)
--
--   1. mopt_in_progress_services(): los servicios en curso del programa sin
--      importar cuándo se pidieron. El mapa del portal solo veía los pedidos
--      desde la fecha "desde" y un servicio abierto de antes no aparecía.
--   2. Horario nocturno con días: "viernes 22:00–06:00" quedaba cerrado el
--      sábado a las 02:00 (se miraba el día de hoy). El tramo después de
--      medianoche ahora pertenece al día en que empezó el turno.
--   3. Tope del contrato: dos solicitudes simultáneas leían el mismo consumo
--      y las dos entraban con cortesía. mopt_payer_for toma un candado por
--      programa y vuelve a verificar el presupuesto dentro de él; el candado
--      dura hasta que create_service_request confirma la fila.
--   4. Reporte: regenerar un mes limpia el estado del correo (el viejo
--      "enviado" era de otra foto) y el pie dice "Usuarios".
-- =====================================================

-- ─── 1. Servicios en curso del programa ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mopt_in_progress_services()
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
     AND sr.status IN ('initiated', 'assigned', 'en_route', 'active')
   ORDER BY sr.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.mopt_in_progress_services() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_in_progress_services() TO authenticated;

-- ─── 2. Horario: el tramo de madrugada es del día en que empezó el turno ────
CREATE OR REPLACE FUNCTION public.mopt_zone_open_now(p_from time without time zone, p_to time without time zone, p_days smallint[])
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ahora AS (SELECT now() AT TIME ZONE 'America/El_Salvador' AS t),
  turno AS (
    SELECT t,
           -- Día al que pertenece este momento: en un turno que cruza la
           -- medianoche (22:00–06:00), las 02:00 del sábado son del viernes.
           CASE WHEN p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to AND t::time < p_to
                THEN EXTRACT(ISODOW FROM t - interval '1 day')::smallint
                ELSE EXTRACT(ISODOW FROM t)::smallint END AS dia
      FROM ahora
  )
  SELECT (p_days IS NULL OR cardinality(p_days) = 0 OR dia = ANY (p_days))
     AND (p_from IS NULL OR p_to IS NULL
            OR p_from = p_to                     -- 00141: 00:00–00:00 = todo el día
            OR (p_from < p_to AND t::time >= p_from AND t::time < p_to)
            OR (p_from > p_to AND (t::time >= p_from OR t::time < p_to)))
    FROM turno
$$;

-- ─── 3. Pagador con candado por programa ────────────────────────────────────
-- VOLATILE: cada consulta dentro toma una foto nueva, así que después del
-- candado se ve lo que la otra solicitud ya confirmó.
CREATE OR REPLACE FUNCTION public.mopt_payer_for(p_coverage jsonb, p_lat double precision, p_lng double precision, p_service_type text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID;
BEGIN
  IF p_coverage->>'status' = 'covered'
     AND plan_cubre_servicio((p_coverage->>'plan_id')::UUID, COALESCE(p_service_type, 'tow'))
     -- 00141: con los servicios del año agotados el seguro no paga nada; si el
     -- punto cae en una zona MOPT, la cortesía aplica como a cualquier otro.
     AND COALESCE((evaluate_coverage((p_coverage->>'member_id')::UUID,
                                     COALESCE(p_service_type, 'tow'), 0)->>'covered')::BOOLEAN, true) THEN
    RETURN NULL;
  END IF;

  v_mopt := mopt_program_for(p_lat, p_lng, p_service_type);
  IF v_mopt IS NULL THEN
    RETURN NULL;
  END IF;
  -- 00142: dos solicitudes a la vez cerca del tope no entran las dos.
  PERFORM pg_advisory_xact_lock(hashtext('budi:mopt_budget:' || v_mopt::text));
  RETURN mopt_program_for(p_lat, p_lng, p_service_type);
END;
$$;

-- ─── 4. Reporte: correo y regeneración ──────────────────────────────────────
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
      '<p style="color:#6b7280;font-size:12px">Budi · Asistencia vial. Este correo no contiene datos personales de los Usuarios.</p>',
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
    SET report = EXCLUDED.report, generated_at = now(), email_status = NULL
  RETURNING id INTO v_id;
  IF p_send THEN
    PERFORM _email_mopt_report(v_id);
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._generate_mopt_report(UUID, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
