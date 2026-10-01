-- 00155: lo que el MOPT ve de su flota (2026-10-01).
--
-- 1. La placa de la grúa de cada socio en el mapa y en Socios operadores
--    (antes solo salía en "Km por grúa").
-- 2. La calificación promedio de cada socio, contando solo los servicios del
--    programa (lo que hizo para otros no es asunto del MOPT).
-- 3. Alerta: socio con un servicio en curso y sin señal de GPS hace más de
--    5 minutos (el mismo umbral que el mapa usa para "Sin señal").
--
-- Privacidad: igual que antes, nombre y teléfono del socio; nada de DUI ni
-- documentos. De las calificaciones, solo promedio y cantidad (sin
-- comentarios ni quién calificó).

-- Calificación del socio en los servicios del programa.
CREATE OR REPLACE FUNCTION public.mopt_operator_rating(p_mopt UUID, p_operator UUID)
RETURNS TABLE (avg_rating NUMERIC, ratings_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ROUND(avg(r.stars)::numeric, 1), count(*)
    FROM ratings r
    JOIN service_requests sr ON sr.id = r.request_id
   WHERE r.rated_operator_id = p_operator
     AND sr.mopt_provider_id = p_mopt;
$$;
REVOKE ALL ON FUNCTION public.mopt_operator_rating(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Cambia el tipo de retorno: hay que recrearlas.
DROP FUNCTION IF EXISTS public.mopt_fleet();
CREATE FUNCTION public.mopt_fleet()
RETURNS TABLE (
  operator_id UUID, full_name TEXT, phone TEXT,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION, is_online BOOLEAN, updated_at TIMESTAMPTZ,
  active_request_id UUID, active_status TEXT, active_address TEXT,
  active_folio TEXT, plate TEXT, avg_rating NUMERIC, ratings_count BIGINT
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
  SELECT p.id, p.full_name, p.phone,
         ol.lat, ol.lng, COALESCE(ol.is_online, false), ol.updated_at,
         act.id, act.status::text, act.pickup_address, cs.folio,
         ov.plate, rt.avg_rating, rt.ratings_count
    FROM profiles p
    LEFT JOIN operator_locations ol ON ol.operator_id = p.id
    LEFT JOIN operator_vehicles ov  ON ov.operator_id = p.id AND ov.is_active
    LEFT JOIN LATERAL (
      SELECT sr.id, sr.status, sr.pickup_address
        FROM service_requests sr
       WHERE sr.operator_id = p.id
         AND sr.status IN ('assigned', 'en_route', 'active')
       ORDER BY sr.assigned_at DESC NULLS LAST
       LIMIT 1
    ) act ON true
    LEFT JOIN cases cs ON cs.request_id = act.id
    CROSS JOIN LATERAL mopt_operator_rating(v_mopt, p.id) rt
   WHERE p.provider_id = v_mopt
     AND p.role = 'OPERATOR'
   ORDER BY p.full_name;
END;
$$;

DROP FUNCTION IF EXISTS public.mopt_list_operators();
CREATE FUNCTION public.mopt_list_operators()
RETURNS TABLE (
  operator_id UUID, full_name TEXT, phone TEXT, verification_status TEXT, in_program BOOLEAN,
  services BIGINT, owed NUMERIC, paid NUMERIC, balance NUMERIC, last_paid_on DATE,
  plate TEXT, avg_rating NUMERIC, ratings_count BIGINT
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
  )
  SELECT p.id, p.full_name, p.phone, p.verification_status,
         (p.provider_id = v_mopt AND p.role = 'OPERATOR'),
         COALESCE(s.services, 0), COALESCE(s.owed, 0), COALESCE(s.paid, 0),
         COALESCE(s.balance, 0), s.last_paid_on,
         ov.plate, rt.avg_rating, rt.ratings_count
    FROM ops
    JOIN profiles p ON p.id = ops.id
    LEFT JOIN saldos s ON s.creditor_id = p.id
    LEFT JOIN operator_vehicles ov ON ov.operator_id = p.id AND ov.is_active
    CROSS JOIN LATERAL mopt_operator_rating(v_mopt, p.id) rt
   ORDER BY COALESCE(s.balance, 0) DESC, p.full_name;
END;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['mopt_fleet()', 'mopt_list_operators()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Socios de la flota con un servicio abierto y sin GPS reciente.
CREATE OR REPLACE FUNCTION public.mopt_stale_on_service(p_mopt UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'operator_id', p.id, 'full_name', p.full_name, 'phone', p.phone,
           'request_id', sr.id, 'folio', cs.folio, 'status', sr.status,
           'last_seen', ol.updated_at) ORDER BY ol.updated_at NULLS FIRST), '[]'::jsonb)
    FROM service_requests sr
    JOIN profiles p ON p.id = sr.operator_id
    LEFT JOIN operator_locations ol ON ol.operator_id = p.id
    LEFT JOIN cases cs ON cs.request_id = sr.id
   WHERE sr.mopt_provider_id = p_mopt
     AND sr.status IN ('assigned', 'en_route', 'active')
     AND (ol.updated_at IS NULL OR ol.updated_at < now() - interval '5 minutes');
$$;
REVOKE ALL ON FUNCTION public.mopt_stale_on_service(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mopt_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
  v_mes_desde TIMESTAMPTZ := sv_day_start(date_trunc('month', sv_today())::date);
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;

  RETURN jsonb_build_object(
    'program_name', (SELECT name FROM providers WHERE id = v_mopt),
    'fee_rate', mopt_fee_rate_at(v_mopt, now()),
    'operators_total', (SELECT count(*) FROM profiles WHERE provider_id = v_mopt AND role = 'OPERATOR'),
    'operators_approved', (SELECT count(*) FROM profiles WHERE provider_id = v_mopt AND role = 'OPERATOR' AND verification_status = 'approved'),
    'zones_active', (SELECT count(*) FROM mopt_zones WHERE provider_id = v_mopt AND is_active),
    'in_progress', (SELECT count(*) FROM service_requests WHERE mopt_provider_id = v_mopt AND status IN ('initiated', 'assigned', 'en_route', 'active')),
    'completed_month', (SELECT count(*) FROM service_requests WHERE mopt_provider_id = v_mopt AND status = 'completed' AND completed_at >= v_mes_desde),
    -- 00148: con el monto aprobado cuando hubo ajuste en un estado de cuenta.
    'amount_month', (SELECT COALESCE(sum(COALESCE((SELECT a.amount FROM statement_adjustment(sr.id) a), sr.total_price)), 0)
                       FROM service_requests sr
                      WHERE sr.mopt_provider_id = v_mopt AND sr.status = 'completed' AND sr.completed_at >= v_mes_desde),
    -- 00154: sin negativos; lo pagado de más, aparte.
    'owed_to_operators', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all()
                           WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'operator' AND balance > 0),
    'overpaid_operators', (SELECT COALESCE(-sum(balance), 0) FROM ledger_balances_all()
                            WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'operator' AND balance < 0),
    'owed_to_budi', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all()
                      WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'budi' AND balance > 0),
    -- 00155: socios con un servicio abierto y sin GPS reciente.
    'stale_on_service', mopt_stale_on_service(v_mopt)
  );
END;
$$;
