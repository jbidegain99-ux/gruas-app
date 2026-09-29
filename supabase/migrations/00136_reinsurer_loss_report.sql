-- =====================================================
-- REA-03 · Reporte de siniestralidad trimestral para reaseguradoras
--
-- FORMATO PROVISIONAL: el backlog pide validarlo con una reaseguradora real.
-- Primera versión con las métricas estándar, por aseguradora cedente que lo
-- autorizó (REA-01) y en total:
--   * exposición: afiliados vigentes en algún momento del trimestre;
--   * frecuencia: servicios por cada 1 000 afiliados expuestos;
--   * severidad: costo promedio por servicio (lo que cubrió la aseguradora);
--   * costo por afiliado expuesto (frecuencia × severidad / 1 000);
--   * variación contra el trimestre anterior (%).
-- Misma regla que el tablero (00131): celdas con menos de 5 servicios se
-- suprimen, y una variación solo se publica si los dos trimestres se publican.
-- Respeta la vigencia del vínculo y el consentimiento de cada aseguradora.
-- =====================================================

CREATE OR REPLACE FUNCTION public._rea_quarter_bounds(p_year INT, p_quarter INT)
RETURNS TABLE (q_from DATE, q_to DATE)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT make_date(p_year, (p_quarter - 1) * 3 + 1, 1),
         (make_date(p_year, (p_quarter - 1) * 3 + 1, 1) + interval '3 months - 1 day')::date;
$$;

-- Una fila por cedente autorizada y trimestre, con las cifras crudas (uso interno).
CREATE OR REPLACE FUNCTION public._rea_quarter_raw(p_reinsurer UUID, p_from DATE, p_to DATE)
RETURNS TABLE (insurer_org_id UUID, insurer_name TEXT, services BIGINT, cost NUMERIC, exposure BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT rc.insurer_org_id, io.name,
         (SELECT count(*) FROM _reinsurer_cases(p_reinsurer, p_from, p_to) c WHERE c.insurer_org_id = rc.insurer_org_id),
         (SELECT COALESCE(sum(c.covered), 0) FROM _reinsurer_cases(p_reinsurer, p_from, p_to) c WHERE c.insurer_org_id = rc.insurer_org_id),
         (SELECT count(DISTINCT m.id) FROM members m JOIN policies po ON po.id = m.policy_id
           WHERE po.insurer_id = io.insurer_id
             AND m.starts_on <= p_to AND (m.ends_on IS NULL OR m.ends_on >= p_from)
             AND po.starts_on <= p_to AND (po.ends_on IS NULL OR po.ends_on >= p_from))
    FROM reinsurer_cedents rc
    JOIN organizations io ON io.id = rc.insurer_org_id
   WHERE rc.reinsurer_org_id = p_reinsurer AND rc.consent_status = 'granted';
$$;
REVOKE ALL ON FUNCTION public._rea_quarter_raw(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._rea_loss_cell(p_n BIGINT, p_cost NUMERIC, p_exposure BIGINT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_n < reinsurer_min_cell() THEN jsonb_build_object('suppressed', true, 'exposure', p_exposure)
  ELSE jsonb_build_object(
    'suppressed', false,
    'services', p_n,
    'exposure', p_exposure,
    'cost', round(p_cost, 2),
    'frequency_per_1000', CASE WHEN p_exposure > 0 THEN round(1000.0 * p_n / p_exposure, 2) END,
    'severity', round(p_cost / p_n, 2),
    'cost_per_member', CASE WHEN p_exposure > 0 THEN round(p_cost / p_exposure, 2) END) END;
$$;
REVOKE ALL ON FUNCTION public._rea_loss_cell(BIGINT, NUMERIC, BIGINT) FROM PUBLIC, anon, authenticated;

-- Variación % de una métrica entre dos celdas publicadas.
CREATE OR REPLACE FUNCTION public._rea_change(p_cur JSONB, p_prev JSONB, p_key TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN (p_cur->>'suppressed')::boolean OR (p_prev->>'suppressed')::boolean
                   OR NULLIF((p_prev->>p_key)::numeric, 0) IS NULL THEN NULL
              ELSE round(100 * ((p_cur->>p_key)::numeric - (p_prev->>p_key)::numeric) / (p_prev->>p_key)::numeric, 1) END;
$$;
REVOKE ALL ON FUNCTION public._rea_change(JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reinsurer_loss_report(p_year INT, p_quarter INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org UUID := auth_reinsurer_org();
  cur  RECORD;
  prev RECORD;
  v_py INT;
  v_pq INT;
  v_rows JSONB;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Necesitas una sesión en el portal de tu reaseguradora (con 2FA si eres dueño o administrador)';
  END IF;
  IF p_quarter NOT BETWEEN 1 AND 4 OR p_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Trimestre inválido';
  END IF;
  SELECT * INTO cur FROM _rea_quarter_bounds(p_year, p_quarter);
  v_py := CASE WHEN p_quarter = 1 THEN p_year - 1 ELSE p_year END;
  v_pq := CASE WHEN p_quarter = 1 THEN 4 ELSE p_quarter - 1 END;
  SELECT * INTO prev FROM _rea_quarter_bounds(v_py, v_pq);

  WITH c AS (SELECT * FROM _rea_quarter_raw(v_org, cur.q_from, cur.q_to)),
       p AS (SELECT * FROM _rea_quarter_raw(v_org, prev.q_from, prev.q_to)),
       j AS (
         SELECT c.insurer_name,
                _rea_loss_cell(c.services, c.cost, c.exposure) AS cc,
                _rea_loss_cell(COALESCE(p.services, 0), COALESCE(p.cost, 0), COALESCE(p.exposure, 0)) AS pc
           FROM c LEFT JOIN p ON p.insurer_org_id = c.insurer_org_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'insurer', insurer_name, 'current', cc, 'previous', pc,
           'change_pct', jsonb_build_object(
             'services', _rea_change(cc, pc, 'services'),
             'frequency_per_1000', _rea_change(cc, pc, 'frequency_per_1000'),
             'severity', _rea_change(cc, pc, 'severity'),
             'cost', _rea_change(cc, pc, 'cost'))) ORDER BY insurer_name), '[]'::jsonb)
    INTO v_rows FROM j;

  RETURN jsonb_build_object(
    'draft_format', true,
    'min_cell', reinsurer_min_cell(),
    'quarter', jsonb_build_object('year', p_year, 'quarter', p_quarter, 'from', cur.q_from, 'to', cur.q_to),
    'previous', jsonb_build_object('year', v_py, 'quarter', v_pq, 'from', prev.q_from, 'to', prev.q_to),
    'by_insurer', v_rows,
    -- Total: solo aseguradoras publicadas en ESTE trimestre (restar no revela nada).
    'total', (SELECT jsonb_build_object(
                'services', COALESCE(sum((r->'current'->>'services')::int), 0),
                'cost', COALESCE(sum((r->'current'->>'cost')::numeric), 0),
                'exposure', COALESCE(sum((r->'current'->>'exposure')::int) FILTER (WHERE NOT (r->'current'->>'suppressed')::boolean), 0),
                'suppressed_insurers', count(*) FILTER (WHERE (r->'current'->>'suppressed')::boolean))
                FROM jsonb_array_elements(v_rows) r));
END;
$$;
REVOKE ALL ON FUNCTION public.reinsurer_loss_report(INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reinsurer_loss_report(INT, INT) TO authenticated;
