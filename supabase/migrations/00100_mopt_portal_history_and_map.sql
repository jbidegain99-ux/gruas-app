-- 00100: el portal MOPT ve a quien atendio, donde, y a su flota en vivo.
--
-- Hasta aca /mopt listaba servicios sin decir a QUIEN se atendio, sin mapa ni
-- detalle, y sin saber donde andan sus operadores. El MOPT presta el servicio
-- con su flota: necesita esa informacion para operar y rendir cuentas.
--
-- Que ve y que no (Decreto 144, minimo necesario):
--   si: nombre de la persona atendida, placa y vehiculo, lugares, recorrido del
--       operador, tiempos, linea de tiempo del caso.
--   no: telefono, DUI, poliza. No los necesita para operar ni pagar.
--
-- Como en la 00099, todo va por RPC con auth_mopt_id(): la cuenta MOPT no recibe
-- politicas sobre tablas. La linea de tiempo y el SLA reusan las RPC del admin y
-- de la aseguradora, que ahora tambien dejan entrar al programa dueno del caso.

-- ---------------------------------------------------------------
-- 1. ¿Este servicio es de mi programa?
-- ---------------------------------------------------------------
-- COALESCE a false: para quien no es MOPT, auth_mopt_id() es NULL y la
-- comparacion daria NULL (la trampa del void_ledger_payment de la 00099).
CREATE OR REPLACE FUNCTION public.request_belongs_to_my_mopt(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT sr.mopt_provider_id = auth_mopt_id()
      FROM service_requests sr
     WHERE sr.id = p_request_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.request_belongs_to_my_mopt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_belongs_to_my_mopt(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- 2. Lista de servicios: ahora con a quien se atendio
-- ---------------------------------------------------------------
-- Cambia el tipo de retorno: hay que soltarla antes.
DROP FUNCTION IF EXISTS public.mopt_list_services(DATE, DATE);
CREATE FUNCTION public.mopt_list_services(p_from DATE, p_to DATE)
RETURNS TABLE (
  id UUID, folio TEXT, status TEXT, service_type TEXT,
  client_name TEXT, vehicle_plate TEXT,
  pickup_address TEXT, pickup_lat DOUBLE PRECISION, pickup_lng DOUBLE PRECISION,
  operator_name TEXT, created_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, total_price NUMERIC
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
  SELECT sr.id, c.folio, sr.status::text, COALESCE(sr.service_type, 'tow'),
         cli.full_name, sr.vehicle_plate,
         sr.pickup_address, sr.pickup_lat, sr.pickup_lng,
         ope.full_name, sr.created_at, sr.completed_at, sr.total_price
    FROM service_requests sr
    LEFT JOIN cases c      ON c.request_id = sr.id
    LEFT JOIN profiles cli ON cli.id = sr.user_id
    LEFT JOIN profiles ope ON ope.id = sr.operator_id
   WHERE sr.mopt_provider_id = v_mopt
     AND sr.created_at >= sv_day_start(p_from)
     AND sr.created_at <  sv_day_start(p_to + 1)
   ORDER BY sr.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.mopt_list_services(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_list_services(DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------
-- 3. Detalle de un servicio
-- ---------------------------------------------------------------
-- "No existe" y "no es tuyo" dan el mismo error: no se confirma que exista un
-- servicio de otro programa.
CREATE OR REPLACE FUNCTION public.mopt_service_detail(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
  v JSONB;
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;

  SELECT jsonb_build_object(
           'id', sr.id,
           'folio', c.folio,
           'status', sr.status,
           'service_type', COALESCE(sr.service_type, 'tow'),
           'incident_type', sr.incident_type,
           'client_name', cli.full_name,
           'vehicle_plate', sr.vehicle_plate,
           'vehicle', NULLIF(concat_ws(' ', sr.vehicle_make, sr.vehicle_model, sr.vehicle_color), ''),
           'operator_name', ope.full_name,
           'pickup_address', sr.pickup_address,
           'pickup_lat', sr.pickup_lat,
           'pickup_lng', sr.pickup_lng,
           'dropoff_address', sr.dropoff_address,
           'dropoff_lat', sr.dropoff_lat,
           'dropoff_lng', sr.dropoff_lng,
           'created_at', sr.created_at,
           'assigned_at', sr.assigned_at,
           'activated_at', sr.activated_at,
           'completed_at', sr.completed_at,
           'cancelled_at', sr.cancelled_at,
           'distance_km', sr.distance_pickup_to_dropoff_km,
           'total_price', sr.total_price,
           -- Recorrido real del operador (lo que grabo la app durante el servicio).
           'trail', COALESCE((
             SELECT jsonb_agg(jsonb_build_array(t.lat, t.lng) ORDER BY t.recorded_at)
               FROM service_location_trail t
              WHERE t.request_id = sr.id
           ), '[]'::jsonb)
         )
    INTO v
    FROM service_requests sr
    LEFT JOIN cases c      ON c.request_id = sr.id
    LEFT JOIN profiles cli ON cli.id = sr.user_id
    LEFT JOIN profiles ope ON ope.id = sr.operator_id
   WHERE sr.id = p_request_id
     AND sr.mopt_provider_id = v_mopt;

  IF v IS NULL THEN
    RAISE EXCEPTION 'Servicio no encontrado';
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.mopt_service_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_service_detail(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- 4. Flota en vivo y zonas
-- ---------------------------------------------------------------
-- Los operadores del programa con su ultima ubicacion y el servicio que llevan.
-- Misma ventana de "ubicacion fresca" que el mapa de flota del admin y
-- assign_nearest_operator: 5 minutos.
CREATE OR REPLACE FUNCTION public.mopt_fleet()
RETURNS TABLE (
  operator_id UUID, full_name TEXT, phone TEXT,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION, is_online BOOLEAN, updated_at TIMESTAMPTZ,
  active_request_id UUID, active_status TEXT, active_address TEXT
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
         act.id, act.status::text, act.pickup_address
    FROM profiles p
    LEFT JOIN operator_locations ol ON ol.operator_id = p.id
    LEFT JOIN LATERAL (
      SELECT sr.id, sr.status, sr.pickup_address
        FROM service_requests sr
       WHERE sr.operator_id = p.id
         AND sr.status IN ('assigned', 'en_route', 'active')
       ORDER BY sr.assigned_at DESC NULLS LAST
       LIMIT 1
    ) act ON true
   WHERE p.provider_id = v_mopt
     AND p.role = 'OPERATOR'
   ORDER BY p.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.mopt_fleet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_fleet() TO authenticated;

CREATE OR REPLACE FUNCTION public.mopt_zones_mine()
RETURNS TABLE (id UUID, name TEXT, polygon JSONB, service_types TEXT[], is_active BOOLEAN)
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
  SELECT z.id, z.name, z.polygon, z.service_types, z.is_active
    FROM mopt_zones z
   WHERE z.provider_id = v_mopt
   ORDER BY z.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.mopt_zones_mine() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_zones_mine() TO authenticated;

-- ---------------------------------------------------------------
-- 5. Linea de tiempo y SLA: tambien para el programa dueno del caso
-- ---------------------------------------------------------------

-- get_case_timeline: 00100 deja entrar al programa MOPT dueno del caso
CREATE OR REPLACE FUNCTION public.get_case_timeline(p_folio text)
 RETURNS TABLE(at timestamp with time zone, event_type text, label text, actor_role text, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id UUID;
  v_user_id    UUID;
  v_operator   UUID;
BEGIN
  SELECT c.request_id, sr.user_id, sr.operator_id
    INTO v_request_id, v_user_id, v_operator
    FROM cases c JOIN service_requests sr ON sr.id = c.request_id
   WHERE c.folio = p_folio;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'Caso no encontrado';
  END IF;

  IF NOT is_admin()
     AND auth.uid() IS DISTINCT FROM v_user_id
     AND auth.uid() IS DISTINCT FROM v_operator
     AND NOT request_belongs_to_my_insurer(v_request_id)
     AND NOT request_belongs_to_my_mopt(v_request_id) THEN  -- 00100
    RAISE EXCEPTION 'No tenes acceso a este caso';
  END IF;

  RETURN QUERY
  SELECT
    re.created_at,
    re.event_type::text,
    CASE re.event_type
      WHEN 'REQUEST_CREATED'      THEN 'Solicitud creada'
      WHEN 'COVERAGE_CHECKED'     THEN 'Cobertura verificada'
      WHEN 'OPERATOR_ACCEPTED'    THEN 'Operador asignado'
      WHEN 'OPERATOR_EN_ROUTE'    THEN 'Operador en camino'
      WHEN 'PIN_VERIFIED'         THEN 'PIN verificado (el operador llegó)'
      WHEN 'PRICE_COMPUTED'       THEN 'Precio calculado'
      WHEN 'PRICE_DISTANCE_CAPPED' THEN 'Distancia ajustada al máximo razonable'
      WHEN 'STATUS_CHANGED'       THEN 'Cambio de estado'
      WHEN 'MESSAGE_SENT'         THEN 'Mensaje en el chat'
      WHEN 'RATING_SUBMITTED'     THEN 'Calificación enviada'
      WHEN 'USER_CANCELLED'       THEN 'Cancelado por el cliente'
      WHEN 'OPERATOR_CANCELLED'   THEN 'El operador liberó el servicio'
      WHEN 'ADMIN_CANCELLED'      THEN 'Cancelado por un administrador'
      ELSE re.event_type::text
    END AS label,
    re.actor_role::text,
    COALESCE(
      re.payload->>'reason',
      re.payload->>'new_status',
      CASE WHEN re.event_type = 'PRICE_COMPUTED' THEN
             CASE
               -- Se formatea solo si de verdad es un numero. El cast a secas
               -- lanzaba, y como esto es una funcion que devuelve la linea de
               -- tiempo entera, un payload malformado no se comia una fila: se
               -- comia el caso completo en el portal.
               WHEN re.payload->>'total' ~ '^-?[0-9]+(\.[0-9]+)?$'
                 THEN '$' || to_char((re.payload->>'total')::NUMERIC, 'FM999999990.00')
               -- Si no lo es, se muestra crudo antes que perderlo.
               ELSE COALESCE('$' || (re.payload->>'total'), '?')
             END
           END,
      CASE WHEN re.event_type = 'COVERAGE_CHECKED'
           THEN COALESCE(re.payload->>'coverage_status', re.payload->>'status') END
    ) AS detail
  FROM request_events re
  WHERE re.request_id = v_request_id
  ORDER BY re.created_at ASC,
    CASE re.event_type
      WHEN 'REQUEST_CREATED'       THEN 1
      WHEN 'COVERAGE_CHECKED'      THEN 2
      WHEN 'OPERATOR_ACCEPTED'     THEN 3
      WHEN 'OPERATOR_EN_ROUTE'     THEN 4
      WHEN 'PIN_VERIFIED'          THEN 5
      WHEN 'PRICE_DISTANCE_CAPPED' THEN 6
      WHEN 'PRICE_COMPUTED'        THEN 7
      WHEN 'STATUS_CHANGED'        THEN 8
      WHEN 'USER_CANCELLED'        THEN 9
      WHEN 'OPERATOR_CANCELLED'    THEN 9
      WHEN 'ADMIN_CANCELLED'       THEN 9
      WHEN 'RATING_SUBMITTED'      THEN 10
      ELSE 50
    END ASC,
    re.id ASC;
END;
$function$;

-- get_case_sla: 00100 deja entrar al programa MOPT dueno del caso
CREATE OR REPLACE FUNCTION public.get_case_sla(p_folio text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sr           service_requests;
  v_insurer_name TEXT;
  v_asig_target  INT := 10;
  v_lleg_target  INT := 45;
  v_asig_secs    NUMERIC;
  v_lleg_secs    NUMERIC;
  v_serv_secs    NUMERIC;
BEGIN
  SELECT sr.* INTO v_sr
    FROM cases c JOIN service_requests sr ON sr.id = c.request_id
   WHERE c.folio = p_folio;

  IF v_sr.id IS NULL THEN
    RAISE EXCEPTION 'Caso no encontrado';
  END IF;

  IF NOT is_admin()
     AND auth.uid() IS DISTINCT FROM v_sr.user_id
     AND auth.uid() IS DISTINCT FROM v_sr.operator_id
     AND NOT request_belongs_to_my_insurer(v_sr.id)
     AND NOT request_belongs_to_my_mopt(v_sr.id) THEN  -- 00100
    RAISE EXCEPTION 'No tenes acceso a este caso';
  END IF;

  SELECT i.name, i.sla_assignment_minutes, i.sla_arrival_minutes
    INTO v_insurer_name, v_asig_target, v_lleg_target
    FROM coverage_usage cu
    JOIN members m   ON m.id = cu.member_id
    JOIN policies p  ON p.id = m.policy_id
    JOIN insurers i  ON i.id = p.insurer_id
   WHERE cu.request_id = v_sr.id
   LIMIT 1;

  v_asig_target := COALESCE(v_asig_target, 10);
  v_lleg_target := COALESCE(v_lleg_target, 45);

  v_asig_secs := EXTRACT(EPOCH FROM (v_sr.assigned_at  - v_sr.created_at));
  v_lleg_secs := EXTRACT(EPOCH FROM (v_sr.activated_at - v_sr.assigned_at));
  v_serv_secs := EXTRACT(EPOCH FROM (v_sr.completed_at - v_sr.activated_at));

  RETURN jsonb_build_object(
    'folio', p_folio,
    'insurer_name', v_insurer_name,
    'assignment_seconds', v_asig_secs,
    'arrival_seconds',    v_lleg_secs,
    'service_seconds',    v_serv_secs,
    'assignment_target_minutes', v_asig_target,
    'arrival_target_minutes',    v_lleg_target,
    'assignment_met', CASE WHEN v_asig_secs IS NULL THEN NULL
                           ELSE v_asig_secs <= v_asig_target * 60 END,
    'arrival_met',    CASE WHEN v_lleg_secs IS NULL THEN NULL
                           ELSE v_lleg_secs <= v_lleg_target * 60 END
  );
END;
$function$;
