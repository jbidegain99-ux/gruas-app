-- =====================================================
-- 00105 — Ficha 360 por cuenta y dashboard de negocio
--
-- Adaptacion de §4.1/§4.2 del spec de super admin. Dos lecturas agregadas,
-- solo para ADMIN (las dos muestran dinero; soporte no, ver 00104):
--
-- * admin_account_360(kind, id, desde, hasta): todo lo de UNA cuenta
--   —empresa proveedora, aseguradora o programa MOPT— en una respuesta.
-- * admin_business_dashboard(): la plataforma en conjunto, 6 meses.
--
-- Leccion del spec que se aplica aca: cada numero sale de UNA definicion.
-- * Tiempos de SLA: request_sla(), que ahora usa tambien get_case_sla.
-- * Que servicios son "de" una cuenta: account_request_ids().
-- * Dinero: ledger_obligations() (00099/00102), la misma fuente que el libro
--   y la liquidacion. La ficha nunca recalcula una comision por su cuenta.
-- * "Activa" y "dormida" son una PARTICION de las cuentas activas (is_active):
--   con actividad + dormidas = activas. El spec documenta el bug de tener dos
--   poblaciones distintas de "activa" en la misma pantalla; aca no pasa.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. SLA de un servicio: una sola definicion
-- ---------------------------------------------------------------
-- Objetivos: los de la aseguradora que cubrio el servicio, si no 10/45 min.
CREATE OR REPLACE FUNCTION public.request_sla(p_request_id UUID)
RETURNS TABLE (
  assignment_seconds NUMERIC,
  arrival_seconds    NUMERIC,
  service_seconds    NUMERIC,
  assignment_target  INT,
  arrival_target     INT,
  insurer_name       TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXTRACT(EPOCH FROM (sr.assigned_at  - sr.created_at)),
    EXTRACT(EPOCH FROM (sr.activated_at - sr.assigned_at)),
    EXTRACT(EPOCH FROM (sr.completed_at - sr.activated_at)),
    COALESCE(i.sla_assignment_minutes, 10),
    COALESCE(i.sla_arrival_minutes, 45),
    i.name
  FROM service_requests sr
  LEFT JOIN coverage_usage cu ON cu.request_id = sr.id
  LEFT JOIN members m         ON m.id = cu.member_id
  LEFT JOIN policies p        ON p.id = m.policy_id
  LEFT JOIN insurers i        ON i.id = p.insurer_id
  WHERE sr.id = p_request_id
$$;

REVOKE ALL ON FUNCTION public.request_sla(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_case_sla(p_folio text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    RAISE EXCEPTION 'No tenes acceso a este caso';
  END IF;

  -- 00105: la cuenta vive en request_sla(), compartida con la ficha 360 y el
  -- dashboard de negocio.
  SELECT * INTO v_sla FROM request_sla(v_sr.id);

  RETURN jsonb_build_object(
    'folio', p_folio,
    'insurer_name', v_sla.insurer_name,
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
$function$;

-- ---------------------------------------------------------------
-- 2. Que servicios son de una cuenta
-- ---------------------------------------------------------------
--   provider  el servicio lo presto un operador de la empresa
--   mopt      el servicio lo pago el programa
--   insurer   el servicio lo cubrio un plan de la aseguradora (coverage_usage):
--             misma regla que el movimiento 'cobertura' del libro
CREATE OR REPLACE FUNCTION public.account_request_ids(p_kind TEXT, p_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sr.id FROM service_requests sr
   WHERE p_kind = 'provider' AND sr.provider_id = p_id AND sr.mopt_provider_id IS NULL
  UNION ALL
  SELECT sr.id FROM service_requests sr
   WHERE p_kind = 'mopt' AND sr.mopt_provider_id = p_id
  UNION ALL
  SELECT cu.request_id
    FROM coverage_usage cu
    JOIN members m  ON m.id = cu.member_id
    JOIN policies p ON p.id = m.policy_id
   WHERE p_kind = 'insurer' AND p.insurer_id = p_id
$$;

REVOKE ALL ON FUNCTION public.account_request_ids(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- El mes de El Salvador de un instante (primer dia del mes).
CREATE OR REPLACE FUNCTION public.sv_month(p_ts TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$ SELECT date_trunc('month', p_ts AT TIME ZONE 'America/El_Salvador')::date $$;

REVOKE ALL ON FUNCTION public.sv_month(TIMESTAMPTZ) FROM PUBLIC, anon;

-- ---------------------------------------------------------------
-- 3. Ficha 360
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_account_360(
  p_kind TEXT,
  p_id   UUID,
  p_from DATE,
  p_to   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from    TIMESTAMPTZ := sv_day_start(p_from);
  v_to      TIMESTAMPTZ := sv_day_start(p_to + 1);
  v_ledger  TEXT;                 -- como se llama la cuenta en el libro
  v_account JSONB;
  v_people  JSONB;
  v_money   JSONB;
  v_result  JSONB;
  v_ids     UUID[];
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la ficha de una cuenta';
  END IF;
  IF p_kind NOT IN ('provider', 'insurer', 'mopt') THEN
    RAISE EXCEPTION 'Tipo de cuenta desconocido: %', p_kind;
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Periodo invalido';
  END IF;
  v_ledger := p_kind;

  -- Identidad ----------------------------------------------------
  IF p_kind = 'insurer' THEN
    SELECT jsonb_build_object(
             'name', i.name, 'is_active', i.is_active, 'created_at', i.created_at,
             'contact_name', i.contact_name, 'contact_email', i.contact_email,
             'contact_phone', i.contact_phone, 'tax_id', i.tax_id)
      INTO v_account FROM insurers i WHERE i.id = p_id;
  ELSE
    SELECT jsonb_build_object(
             'name', p.name, 'is_active', p.is_active, 'created_at', p.created_at,
             'contact_email', p.contact_email, 'contact_phone', p.contact_phone,
             'address', p.address, 'business_type', p.business_type)
      INTO v_account FROM providers p
     WHERE p.id = p_id AND p.is_mopt = (p_kind = 'mopt');
  END IF;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'La cuenta no existe';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT x FROM account_request_ids(p_kind, p_id) x);

  -- Personas ------------------------------------------------------
  IF p_kind = 'insurer' THEN
    SELECT jsonb_build_object(
             'plans',           (SELECT count(*) FROM coverage_plans WHERE insurer_id = p_id),
             'policies_active', (SELECT count(*) FROM policies WHERE insurer_id = p_id AND status = 'active'),
             'members_active',  (SELECT count(*) FROM members m JOIN policies po ON po.id = m.policy_id
                                  WHERE po.insurer_id = p_id AND m.is_active),
             'sla_assignment_minutes', (SELECT sla_assignment_minutes FROM insurers WHERE id = p_id),
             'sla_arrival_minutes',    (SELECT sla_arrival_minutes FROM insurers WHERE id = p_id))
      INTO v_people;
  ELSE
    SELECT jsonb_build_object(
             'operators',         count(*),
             'approved',          count(*) FILTER (WHERE pr.verification_status = 'approved'),
             'pending',           count(*) FILTER (WHERE pr.verification_status = 'pending'),
             -- Mismo criterio que la flota del admin: reporto en los ultimos 5 min.
             'online_now',        count(*) FILTER (WHERE ol.is_online AND ol.updated_at > now() - interval '5 minutes'),
             'zones_active',      CASE WHEN p_kind = 'mopt'
                                    THEN (SELECT count(*) FROM mopt_zones WHERE provider_id = p_id AND is_active) END,
             'services_offered',  (SELECT COALESCE(jsonb_agg(s.name_es ORDER BY s.sort_order), '[]'::jsonb)
                                     FROM provider_services ps JOIN services s ON s.id = ps.service_id
                                    WHERE ps.provider_id = p_id AND ps.is_available))
      INTO v_people
      FROM profiles pr
      LEFT JOIN operator_locations ol ON ol.operator_id = pr.id
     WHERE pr.provider_id = p_id AND pr.role = 'OPERATOR';
  END IF;

  -- Dinero del periodo, desde el libro -------------------------------
  -- Siempre desde ledger_obligations: lo que la ficha dice que se debe es
  -- exactamente lo que el libro y la liquidacion dicen.
  SELECT jsonb_build_object(
    -- Empresa: lo que Budi le debe (neto) y lo que retuvo de comision.
    'payout',        COALESCE(SUM(o.amount) FILTER (WHERE o.concept = 'servicio' AND o.creditor_kind = 'provider'), 0),
    'commission',    COALESCE(SUM(sr.total_price - o.amount) FILTER (WHERE o.concept = 'servicio' AND o.creditor_kind = 'provider'), 0),
    -- Aseguradora: lo que le factura Budi por cobertura.
    'coverage',      COALESCE(SUM(o.amount) FILTER (WHERE o.concept = 'cobertura'), 0),
    -- MOPT: lo que debe a sus operadores y la tarifa de plataforma de Budi.
    'owed_operators', COALESCE(SUM(o.amount) FILTER (WHERE o.concept = 'servicio' AND o.debtor_kind = 'mopt'), 0),
    'platform_fee',  COALESCE(SUM(o.amount) FILTER (WHERE o.concept = 'tarifa_plataforma'), 0),
    'copay',         CASE WHEN p_kind = 'insurer' THEN (
                       SELECT COALESCE(SUM(cu.amount_copay), 0)
                         FROM coverage_usage cu JOIN service_requests s2 ON s2.id = cu.request_id
                        WHERE cu.request_id = ANY (v_ids)
                          AND s2.status = 'completed'
                          AND s2.completed_at >= v_from AND s2.completed_at < v_to) END,
    'commission_rate_now', CASE
                       WHEN p_kind = 'provider' THEN commission_rate_at(p_id, NULL, now())
                       WHEN p_kind = 'mopt'     THEN mopt_fee_rate_at(p_id, now()) END,
    'next_rate_change', (SELECT jsonb_build_object('rate', rv.rate, 'valid_from', rv.valid_from)
                           FROM rate_versions rv
                          WHERE rv.kind = CASE p_kind WHEN 'provider' THEN 'provider' WHEN 'mopt' THEN 'mopt_fee' END
                            AND rv.subject_id = p_id AND rv.valid_from > now()
                          ORDER BY rv.valid_from LIMIT 1)
  )
    INTO v_money
    FROM ledger_obligations() o
    JOIN service_requests sr ON sr.id = o.request_id
   WHERE o.request_id = ANY (v_ids)
     AND o.completed_at >= v_from AND o.completed_at < v_to
     AND (   (o.debtor_kind = v_ledger AND o.debtor_id = p_id)
          OR (o.creditor_kind = v_ledger AND o.creditor_id = p_id));

  SELECT jsonb_build_object(
    'account', v_account || jsonb_build_object('kind', p_kind, 'id', p_id),
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'people',  v_people,
    'money',   v_money,

    -- Servicios del periodo (por fecha de creacion; completados y dinero por
    -- fecha de cierre, igual que la liquidacion).
    'services', (
      SELECT jsonb_build_object(
        'created',     count(*) FILTER (WHERE sr.created_at >= v_from AND sr.created_at < v_to),
        'completed',   count(*) FILTER (WHERE sr.status = 'completed' AND sr.completed_at >= v_from AND sr.completed_at < v_to),
        'cancelled',   count(*) FILTER (WHERE sr.status = 'cancelled' AND sr.cancelled_at >= v_from AND sr.cancelled_at < v_to),
        'in_progress', count(*) FILTER (WHERE sr.status IN ('initiated', 'assigned', 'en_route', 'active')),
        'gross',       COALESCE(SUM(sr.total_price) FILTER (WHERE sr.status = 'completed' AND sr.completed_at >= v_from AND sr.completed_at < v_to), 0),
        'last_completed_at', MAX(sr.completed_at) FILTER (WHERE sr.status = 'completed'))
        FROM service_requests sr WHERE sr.id = ANY (v_ids)),

    -- 6 meses, independiente del periodo elegido.
    'monthly', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('month', m.mes, 'completed', COALESCE(x.n, 0), 'gross', COALESCE(x.gross, 0)) ORDER BY m.mes), '[]'::jsonb)
        FROM generate_series(date_trunc('month', sv_today()) - interval '5 months', date_trunc('month', sv_today()), interval '1 month') AS m(mes)
        LEFT JOIN (
          SELECT sv_month(sr.completed_at) AS mes, count(*) AS n, SUM(sr.total_price) AS gross
            FROM service_requests sr
           WHERE sr.id = ANY (v_ids) AND sr.status = 'completed'
           GROUP BY 1
        ) x ON x.mes = m.mes::date),

    'sla', (
      SELECT jsonb_build_object(
        'n',                      count(*),
        'avg_assignment_seconds', ROUND(AVG(s.assignment_seconds)),
        'avg_arrival_seconds',    ROUND(AVG(s.arrival_seconds)),
        'assignment_met_pct',     ROUND(100.0 * count(*) FILTER (WHERE s.assignment_seconds <= s.assignment_target * 60)
                                        / NULLIF(count(*) FILTER (WHERE s.assignment_seconds IS NOT NULL), 0), 1),
        'arrival_met_pct',        ROUND(100.0 * count(*) FILTER (WHERE s.arrival_seconds <= s.arrival_target * 60)
                                        / NULLIF(count(*) FILTER (WHERE s.arrival_seconds IS NOT NULL), 0), 1))
        FROM service_requests sr
        CROSS JOIN LATERAL request_sla(sr.id) s
       WHERE sr.id = ANY (v_ids)
         AND sr.status = 'completed' AND sr.completed_at >= v_from AND sr.completed_at < v_to),

    'ratings', (
      SELECT jsonb_build_object('n', count(*), 'avg', ROUND(AVG(r.stars), 2))
        FROM ratings r JOIN service_requests sr ON sr.id = r.request_id
       WHERE sr.id = ANY (v_ids)
         AND sr.completed_at >= v_from AND sr.completed_at < v_to),

    -- Saldos vivos (no del periodo: lo que se debe HOY).
    'balances', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'debtor_kind', b.debtor_kind, 'creditor_kind', b.creditor_kind,
               'counterparty', CASE WHEN b.debtor_kind = v_ledger AND b.debtor_id = p_id
                                    THEN COALESCE(cp_c.name, CASE b.creditor_kind WHEN 'budi' THEN 'Budi' END)
                                    ELSE COALESCE(cp_d.name, CASE b.debtor_kind WHEN 'budi' THEN 'Budi' END) END,
               'direction', CASE WHEN b.debtor_kind = v_ledger AND b.debtor_id = p_id THEN 'debe' ELSE 'le_deben' END,
               'owed', b.owed, 'paid', b.paid, 'balance', b.balance, 'last_paid_on', b.last_paid_on)), '[]'::jsonb)
        FROM ledger_balances_all() b
        LEFT JOIN LATERAL (
          SELECT COALESCE((SELECT name FROM providers WHERE id = b.creditor_id),
                          (SELECT name FROM insurers  WHERE id = b.creditor_id),
                          (SELECT full_name FROM profiles WHERE id = b.creditor_id)) AS name) cp_c ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE((SELECT name FROM providers WHERE id = b.debtor_id),
                          (SELECT name FROM insurers  WHERE id = b.debtor_id),
                          (SELECT full_name FROM profiles WHERE id = b.debtor_id)) AS name) cp_d ON true
       WHERE (b.debtor_kind = v_ledger AND b.debtor_id = p_id)
          OR (b.creditor_kind = v_ledger AND b.creditor_id = p_id)),

    'payments', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.paid_on DESC, x.created_at DESC), '[]'::jsonb) FROM (
        SELECT lp.id, lp.amount, lp.paid_on, lp.reference, lp.created_at,
               lp.voided_at IS NOT NULL AS voided,
               CASE WHEN lp.payer_kind = v_ledger AND lp.payer_id = p_id THEN 'pago' ELSE 'cobro' END AS direction
          FROM ledger_payments lp
         WHERE (lp.payer_kind = v_ledger AND lp.payer_id = p_id)
            OR (lp.payee_kind = v_ledger AND lp.payee_id = p_id)
         ORDER BY lp.paid_on DESC, lp.created_at DESC
         LIMIT 8) x),

    'top_operators', CASE WHEN p_kind = 'insurer' THEN '[]'::jsonb ELSE (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.completed DESC), '[]'::jsonb) FROM (
        SELECT pr.id, pr.full_name AS name, count(*) AS completed,
               ROUND(AVG(r.stars), 2) AS rating
          FROM service_requests sr
          JOIN profiles pr ON pr.id = sr.operator_id
          LEFT JOIN ratings r ON r.request_id = sr.id
         WHERE sr.id = ANY (v_ids)
           AND sr.status = 'completed' AND sr.completed_at >= v_from AND sr.completed_at < v_to
         GROUP BY pr.id, pr.full_name
         ORDER BY count(*) DESC
         LIMIT 5) x) END,

    -- Actividad de configuracion: lo que la bitacora (00094) registro sobre la
    -- cuenta, sus operadores (entrar/salir de la empresa) o sus polizas/planes.
    'activity', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.occurred_at DESC), '[]'::jsonb) FROM (
        SELECT a.occurred_at, a.actor_name, a.table_name, a.action, a.record_label, a.changes
          FROM audit_log a
         WHERE a.record_id = p_id::text
            OR (a.table_name = 'profiles'
                AND (a.changes -> 'provider_id' ->> 'new' = p_id::text
                  OR a.changes -> 'provider_id' ->> 'old' = p_id::text
                  OR a.changes -> 'insurer_id'  ->> 'new' = p_id::text
                  OR a.changes -> 'insurer_id'  ->> 'old' = p_id::text))
            OR (a.table_name = 'rate_versions' AND a.changes -> 'subject_id' ->> 'new' = p_id::text)
            OR (p_kind = 'insurer' AND a.table_name IN ('policies', 'coverage_plans')
                AND a.record_id IN (SELECT id::text FROM policies WHERE insurer_id = p_id
                                    UNION ALL SELECT id::text FROM coverage_plans WHERE insurer_id = p_id))
            OR (p_kind = 'mopt' AND a.table_name = 'mopt_zones'
                AND a.record_id IN (SELECT id::text FROM mopt_zones WHERE provider_id = p_id))
         ORDER BY a.occurred_at DESC
         LIMIT 10) x)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_account_360(TEXT, UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_360(TEXT, UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------
-- 4. Dashboard de negocio
-- ---------------------------------------------------------------
-- Definiciones (se muestran tambien en la pantalla):
-- * Por mes: creados por created_at; completados y dinero por completed_at
--   (igual que la liquidacion); cancelados por cancelled_at.
-- * Ingreso de Budi = comision retenida + tarifa de plataforma MOPT. La
--   cobertura que factura a las aseguradoras NO es ingreso de Budi: es plata
--   que entra y se va al proveedor. Se muestra aparte.
-- * Cuenta con actividad = activa con al menos un servicio completado en los
--   ultimos 30 dias. Dormida = activa sin ninguno. Son una particion.
CREATE OR REPLACE FUNCTION public.admin_business_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since   TIMESTAMPTZ := now() - interval '30 days';
  v_first   DATE := (date_trunc('month', sv_today()) - interval '5 months')::date;
  v_result  JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver el dashboard de negocio';
  END IF;

  WITH meses AS (
    SELECT m::date AS mes
      FROM generate_series(v_first::timestamp, date_trunc('month', sv_today()), interval '1 month') m
  ),
  creados AS (
    SELECT sv_month(created_at) AS mes, count(*) AS n
      FROM service_requests WHERE created_at >= sv_day_start(v_first) GROUP BY 1
  ),
  cerrados AS (
    SELECT sv_month(completed_at) AS mes, count(*) AS n, SUM(total_price) AS gross
      FROM service_requests
     WHERE status = 'completed' AND completed_at >= sv_day_start(v_first) GROUP BY 1
  ),
  cancelados AS (
    SELECT sv_month(cancelled_at) AS mes, count(*) AS n
      FROM service_requests
     WHERE status = 'cancelled' AND cancelled_at >= sv_day_start(v_first) GROUP BY 1
  ),
  libro AS (
    SELECT sv_month(o.completed_at) AS mes,
           SUM(sr.total_price - o.amount) FILTER (WHERE o.concept = 'servicio' AND o.debtor_kind = 'budi') AS commission,
           SUM(o.amount) FILTER (WHERE o.concept = 'tarifa_plataforma') AS mopt_fee,
           SUM(o.amount) FILTER (WHERE o.concept = 'cobertura') AS coverage
      FROM ledger_obligations() o
      JOIN service_requests sr ON sr.id = o.request_id
     WHERE o.completed_at >= sv_day_start(v_first)
     GROUP BY 1
  ),
  cuentas AS (
    SELECT 'provider'::text AS kind, p.id, p.name,
           (SELECT MAX(sr.completed_at) FROM service_requests sr
             WHERE sr.provider_id = p.id AND sr.mopt_provider_id IS NULL AND sr.status = 'completed') AS last_at
      FROM providers p WHERE p.is_active AND NOT p.is_mopt
    UNION ALL
    SELECT 'mopt', p.id, p.name,
           (SELECT MAX(sr.completed_at) FROM service_requests sr
             WHERE sr.mopt_provider_id = p.id AND sr.status = 'completed')
      FROM providers p WHERE p.is_active AND p.is_mopt
    UNION ALL
    SELECT 'insurer', i.id, i.name,
           (SELECT MAX(sr.completed_at) FROM service_requests sr
             WHERE sr.status = 'completed' AND sr.id IN (SELECT account_request_ids('insurer', i.id)))
      FROM insurers i WHERE i.is_active
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'months', (
      SELECT jsonb_agg(jsonb_build_object(
               'month',      m.mes,
               'created',    COALESCE(c.n, 0),
               'completed',  COALESCE(k.n, 0),
               'cancelled',  COALESCE(x.n, 0),
               'gross',      COALESCE(k.gross, 0),
               'commission', COALESCE(l.commission, 0),
               'mopt_fee',   COALESCE(l.mopt_fee, 0),
               'revenue',    COALESCE(l.commission, 0) + COALESCE(l.mopt_fee, 0),
               'coverage',   COALESCE(l.coverage, 0)) ORDER BY m.mes)
        FROM meses m
        LEFT JOIN creados c    ON c.mes = m.mes
        LEFT JOIN cerrados k   ON k.mes = m.mes
        LEFT JOIN cancelados x ON x.mes = m.mes
        LEFT JOIN libro l      ON l.mes = m.mes),

    'accounts', (
      SELECT jsonb_object_agg(kind, info) FROM (
        SELECT kind, jsonb_build_object(
                 'active',  count(*),
                 'engaged', count(*) FILTER (WHERE last_at >= v_since),
                 'dormant', COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'last_at', last_at)
                                      ORDER BY last_at NULLS FIRST, name)
                                      FILTER (WHERE last_at IS NULL OR last_at < v_since), '[]'::jsonb)) AS info
          FROM cuentas GROUP BY kind) t),

    'operators', (
      SELECT jsonb_build_object(
        'approved',   count(*) FILTER (WHERE pr.verification_status = 'approved'),
        'engaged',    count(*) FILTER (WHERE EXISTS (
                        SELECT 1 FROM service_requests sr
                         WHERE sr.operator_id = pr.id AND sr.status = 'completed' AND sr.completed_at >= v_since)),
        'online_now', count(*) FILTER (WHERE EXISTS (
                        SELECT 1 FROM operator_locations ol
                         WHERE ol.operator_id = pr.id AND ol.is_online AND ol.updated_at > now() - interval '5 minutes')),
        'pending',    count(*) FILTER (WHERE pr.verification_status = 'pending'))
        FROM profiles pr WHERE pr.role = 'OPERATOR'),

    'sla_30d', (
      SELECT jsonb_build_object(
        'n',                      count(*),
        'avg_assignment_seconds', ROUND(AVG(s.assignment_seconds)),
        'avg_arrival_seconds',    ROUND(AVG(s.arrival_seconds)),
        'assignment_met_pct',     ROUND(100.0 * count(*) FILTER (WHERE s.assignment_seconds <= s.assignment_target * 60)
                                        / NULLIF(count(*) FILTER (WHERE s.assignment_seconds IS NOT NULL), 0), 1),
        'arrival_met_pct',        ROUND(100.0 * count(*) FILTER (WHERE s.arrival_seconds <= s.arrival_target * 60)
                                        / NULLIF(count(*) FILTER (WHERE s.arrival_seconds IS NOT NULL), 0), 1))
        FROM service_requests sr CROSS JOIN LATERAL request_sla(sr.id) s
       WHERE sr.status = 'completed' AND sr.completed_at >= v_since),

    'cancel_rate_30d', (
      SELECT ROUND(100.0 * count(*) FILTER (WHERE status = 'cancelled') / NULLIF(count(*), 0), 1)
        FROM service_requests WHERE created_at >= v_since),

    'top_providers_month', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.completed DESC), '[]'::jsonb) FROM (
        SELECT p.id, p.name, count(*) AS completed, SUM(sr.total_price) AS gross
          FROM service_requests sr JOIN providers p ON p.id = sr.provider_id
         WHERE sr.status = 'completed' AND sr.mopt_provider_id IS NULL
           AND sr.completed_at >= sv_day_start(date_trunc('month', sv_today())::date)
         GROUP BY p.id, p.name ORDER BY count(*) DESC LIMIT 5) x)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_business_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_business_dashboard() TO authenticated;
