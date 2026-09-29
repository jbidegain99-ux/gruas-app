-- =====================================================
-- 00107 — Km reales por caso y por grua, cumplimiento del MOPT
--
-- Backlog de lanzamiento:
-- * VID-04  Km recorridos por grua y por caso, a partir del recorrido GPS
--           (service_location_trail), separando aproximacion (socio -> Usuario)
--           y arrastre (Usuario -> destino), guardados en el caso al completar.
-- * MOPT-01 Tablero de cumplimiento: casos, llegada promedio, % a tiempo contra
--           el SLA pactado, casos por tipo de servicio y por zona.
-- * MOPT-02 Km por grua: placa, socio, casos, km de aproximacion/arrastre/total
--           y % a tiempo, con detalle por grua.
-- * VID-03  Elegibilidad MOPT por zona, tipo de servicio Y horario (faltaba el
--           horario; zonas y tipos ya estaban desde la 00098).
--
-- "Grua" = la unidad del socio. No existia un registro de unidades (la tabla
-- `vehicles` son los carros de los Usuarios), asi que se crea
-- `operator_vehicles`. Tambien sirve para SRV-01: la capacidad (m3) de una
-- pipa es un dato del vehiculo (propuesta D6).
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Unidades de los socios operadores
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operator_vehicles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plate        TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'tow_light'
               CHECK (vehicle_type IN ('tow_light', 'tow_heavy', 'water_truck', 'service')),
  capacity_m3  NUMERIC(6,2) CHECK (capacity_m3 IS NULL OR capacity_m3 > 0),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operator_vehicles_plate_format CHECK (plate ~ '^[A-Z0-9-]{3,12}$')
);

COMMENT ON TABLE public.operator_vehicles IS
  '00107: las unidades (grua, pipa, vehiculo de servicio) de cada socio operador. '
  'La activa es la que se registra en el caso al completarlo.';

-- Una unidad activa por socio: es la que sale a atender.
CREATE UNIQUE INDEX IF NOT EXISTS operator_vehicles_one_active
  ON public.operator_vehicles (operator_id) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS operator_vehicles_plate_unique
  ON public.operator_vehicles (plate) WHERE is_active;

DROP TRIGGER IF EXISTS update_operator_vehicles_updated_at ON public.operator_vehicles;
CREATE TRIGGER update_operator_vehicles_updated_at
  BEFORE UPDATE ON public.operator_vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.operator_vehicles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_vehicles FROM PUBLIC, anon;
GRANT SELECT ON public.operator_vehicles TO authenticated;

DROP POLICY IF EXISTS "operator_vehicles: el socio ve las suyas" ON public.operator_vehicles;
CREATE POLICY "operator_vehicles: el socio ve las suyas" ON public.operator_vehicles
  FOR SELECT TO authenticated USING (operator_id = auth.uid());

DROP POLICY IF EXISTS "operator_vehicles: admin lee" ON public.operator_vehicles;
CREATE POLICY "operator_vehicles: admin lee" ON public.operator_vehicles
  FOR SELECT TO authenticated USING (is_admin());

DROP TRIGGER IF EXISTS trg_audit ON public.operator_vehicles;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.operator_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- Registrar o cambiar la unidad activa de un socio. La anterior queda inactiva
-- (no se borra: los casos viejos la siguen nombrando).
CREATE OR REPLACE FUNCTION public.admin_set_operator_vehicle(
  p_operator_id  UUID,
  p_plate        TEXT,
  p_vehicle_type TEXT DEFAULT 'tow_light',
  p_capacity_m3  NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plate TEXT := upper(regexp_replace(COALESCE(p_plate, ''), '\s+', '', 'g'));
  v_id    UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar unidades';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND role = 'OPERATOR') THEN
    RAISE EXCEPTION 'Esa cuenta no es de un socio operador';
  END IF;

  -- Sin placa = el socio se queda sin unidad activa.
  UPDATE operator_vehicles SET is_active = false
   WHERE operator_id = p_operator_id AND is_active
     AND (v_plate = '' OR plate <> v_plate OR vehicle_type <> p_vehicle_type
          OR capacity_m3 IS DISTINCT FROM p_capacity_m3);
  IF v_plate = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id FROM operator_vehicles
   WHERE operator_id = p_operator_id AND is_active;
  IF v_id IS NOT NULL THEN
    RETURN v_id;  -- nada cambio
  END IF;

  INSERT INTO operator_vehicles (operator_id, plate, vehicle_type, capacity_m3)
  VALUES (p_operator_id, v_plate, p_vehicle_type, p_capacity_m3)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'La placa % ya esta registrada como unidad activa de otro socio', v_plate;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_operator_vehicle(UUID, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_operator_vehicle(UUID, TEXT, TEXT, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------
-- 2. Km reales desde el recorrido GPS
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 2 * 6371.0088 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- Km recorridos entre dos instantes. Filtros:
-- * Salto de GPS: un tramo que implicaria mas de 150 km/h se descarta (un
--   punto mal ubicado mete kilometros que nadie manejo).
-- * Ruido estando quieto: tramos de menos de 10 m no suman (el GPS "baila"
--   unos metros y, sumado durante una espera larga, inflaba el total).
CREATE OR REPLACE FUNCTION public.trail_km(p_request_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH pts AS (
    SELECT lat, lng, recorded_at,
           lag(lat) OVER w AS plat, lag(lng) OVER w AS plng, lag(recorded_at) OVER w AS pat
      FROM service_location_trail
     WHERE request_id = p_request_id
       AND (p_from IS NULL OR recorded_at >= p_from)
       AND (p_to   IS NULL OR recorded_at <= p_to)
    WINDOW w AS (ORDER BY recorded_at, id)
  ), tramos AS (
    SELECT haversine_km(plat, plng, lat, lng) AS km,
           EXTRACT(EPOCH FROM (recorded_at - pat)) AS secs
      FROM pts WHERE plat IS NOT NULL
  )
  SELECT ROUND(COALESCE(SUM(km), 0)::numeric, 2)
    FROM tramos
   WHERE km >= 0.01
     AND (secs <= 0 AND km < 0.2 OR secs > 0 AND km / (secs / 3600.0) <= 150)
$$;

REVOKE ALL ON FUNCTION public.trail_km(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS approach_km    NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS tow_km         NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS declared_km    NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS trail_points   INT,
  ADD COLUMN IF NOT EXISTS vehicle_id     UUID REFERENCES public.operator_vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_plate  TEXT,
  ADD COLUMN IF NOT EXISTS km_computed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.cases.approach_km IS '00107: km GPS del socio desde que acepto hasta que llego (PIN).';
COMMENT ON COLUMN public.cases.tow_km IS '00107: km GPS desde la llegada hasta completar (arrastre).';
COMMENT ON COLUMN public.cases.declared_km IS '00107: distance_pickup_to_dropoff_km declarada al completar, para contrastar.';

-- Calcula y guarda los km de un caso. Idempotente: se puede recalcular.
CREATE OR REPLACE FUNCTION public.compute_case_km(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sr service_requests;
  v_vehicle operator_vehicles;
BEGIN
  SELECT * INTO v_sr FROM service_requests WHERE id = p_request_id;
  IF v_sr.id IS NULL OR v_sr.status <> 'completed' THEN
    RETURN;
  END IF;

  SELECT * INTO v_vehicle FROM operator_vehicles
   WHERE operator_id = v_sr.operator_id AND is_active
   LIMIT 1;

  UPDATE cases
     SET approach_km    = trail_km(v_sr.id, v_sr.assigned_at, COALESCE(v_sr.activated_at, v_sr.completed_at)),
         tow_km         = CASE WHEN v_sr.activated_at IS NULL THEN 0
                               ELSE trail_km(v_sr.id, v_sr.activated_at, v_sr.completed_at) END,
         declared_km    = v_sr.distance_pickup_to_dropoff_km,
         trail_points   = (SELECT count(*) FROM service_location_trail WHERE request_id = v_sr.id),
         -- La unidad se fija una vez: recalcular los km no la cambia si el
         -- socio cambio de grua despues.
         vehicle_id     = COALESCE(vehicle_id, v_vehicle.id),
         vehicle_plate  = COALESCE(vehicle_plate, v_vehicle.plate),
         km_computed_at = now()
   WHERE request_id = v_sr.id;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_case_km(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.compute_case_km_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM compute_case_km(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_case_km_on_complete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compute_case_km ON public.service_requests;
CREATE TRIGGER trg_compute_case_km
  AFTER UPDATE OF status ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.compute_case_km_on_complete();

-- Backfill de los ya completados.
SELECT compute_case_km(sr.id) FROM service_requests sr WHERE sr.status = 'completed';

-- ---------------------------------------------------------------
-- 3. SLA pactado del MOPT
-- ---------------------------------------------------------------
-- Objetivos por organizacion (el contrato completo es MOPT-05). request_sla
-- (00105) los usa para los servicios del programa; las aseguradoras siguen
-- con los suyos en insurers.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sla_assignment_minutes INT CHECK (sla_assignment_minutes IS NULL OR sla_assignment_minutes > 0),
  ADD COLUMN IF NOT EXISTS sla_arrival_minutes    INT CHECK (sla_arrival_minutes IS NULL OR sla_arrival_minutes > 0);

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
    -- 00107: servicio del MOPT -> el SLA pactado con el programa.
    COALESCE(i.sla_assignment_minutes, mo.sla_assignment_minutes, 10),
    COALESCE(i.sla_arrival_minutes,    mo.sla_arrival_minutes,    45),
    i.name
  FROM service_requests sr
  LEFT JOIN coverage_usage cu ON cu.request_id = sr.id
  LEFT JOIN members m         ON m.id = cu.member_id
  LEFT JOIN policies p        ON p.id = m.policy_id
  LEFT JOIN insurers i        ON i.id = p.insurer_id
  LEFT JOIN organizations mo  ON mo.provider_id = sr.mopt_provider_id AND mo.type = 'MOPT'
  WHERE sr.id = p_request_id
$$;

CREATE OR REPLACE FUNCTION public.admin_set_org_sla(p_organization_id UUID, p_assignment INT, p_arrival INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar el SLA';
  END IF;
  IF p_assignment IS NOT NULL AND p_assignment <= 0 OR p_arrival IS NOT NULL AND p_arrival <= 0 THEN
    RAISE EXCEPTION 'Los objetivos deben ser minutos positivos';
  END IF;
  UPDATE organizations
     SET sla_assignment_minutes = p_assignment, sla_arrival_minutes = p_arrival
   WHERE id = p_organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_org_sla(UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_org_sla(UUID, INT, INT) TO authenticated;

-- ---------------------------------------------------------------
-- 4. Elegibilidad por horario (VID-03)
-- ---------------------------------------------------------------
-- Sin horario = todo el dia. Un rango que cruza la medianoche (22:00-06:00)
-- vale. Dias ISO (1 = lunes ... 7 = domingo); sin dias = todos.
ALTER TABLE public.mopt_zones
  ADD COLUMN IF NOT EXISTS hours_from  TIME,
  ADD COLUMN IF NOT EXISTS hours_to    TIME,
  ADD COLUMN IF NOT EXISTS active_days SMALLINT[],
  DROP CONSTRAINT IF EXISTS mopt_zones_hours_pair;
ALTER TABLE public.mopt_zones
  ADD CONSTRAINT mopt_zones_hours_pair CHECK ((hours_from IS NULL) = (hours_to IS NULL));

-- Columnas nuevas nacen ilegibles si la tabla tiene GRANT por columna (00056).
GRANT SELECT (hours_from, hours_to, active_days) ON public.mopt_zones TO authenticated;
GRANT UPDATE (hours_from, hours_to, active_days) ON public.mopt_zones TO authenticated;
GRANT INSERT (hours_from, hours_to, active_days) ON public.mopt_zones TO authenticated;

CREATE OR REPLACE FUNCTION public.mopt_zone_open_now(p_from TIME, p_to TIME, p_days SMALLINT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ahora AS (SELECT now() AT TIME ZONE 'America/El_Salvador' AS t)
  SELECT (p_days IS NULL OR cardinality(p_days) = 0
            OR EXTRACT(ISODOW FROM t)::smallint = ANY (p_days))
     AND (p_from IS NULL
            OR (p_from <= p_to AND t::time >= p_from AND t::time < p_to)
            OR (p_from >  p_to AND (t::time >= p_from OR t::time < p_to)))
    FROM ahora
$$;

CREATE OR REPLACE FUNCTION public.mopt_program_for(p_lat double precision, p_lng double precision, p_service_type text)
RETURNS uuid
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
   ORDER BY z.created_at, z.id
   LIMIT 1;
$$;

-- ---------------------------------------------------------------
-- 5. Portal MOPT: cumplimiento (MOPT-01) y km por grua (MOPT-02)
-- ---------------------------------------------------------------
-- Mismas definiciones que el admin: request_sla para el SLA, cases.*_km para
-- los km, completados por fecha de cierre en dias de El Salvador.
CREATE OR REPLACE FUNCTION public.mopt_compliance(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
  v_from TIMESTAMPTZ := sv_day_start(p_from);
  v_to   TIMESTAMPTZ := sv_day_start(p_to + 1);
BEGIN
  IF v_mopt IS NULL AND NOT is_admin() THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;
  -- El admin consulta el primer programa (una sola cuenta MOPT hoy).
  v_mopt := COALESCE(v_mopt, (SELECT id FROM providers WHERE is_mopt ORDER BY created_at LIMIT 1));

  RETURN (
    WITH svc AS (
      SELECT sr.*, s.assignment_seconds, s.arrival_seconds, s.assignment_target, s.arrival_target,
             c.approach_km, c.tow_km
        FROM service_requests sr
        CROSS JOIN LATERAL request_sla(sr.id) s
        LEFT JOIN cases c ON c.request_id = sr.id
       WHERE sr.mopt_provider_id = v_mopt
         AND sr.status = 'completed'
         AND sr.completed_at >= v_from AND sr.completed_at < v_to
    )
    SELECT jsonb_build_object(
      'period', jsonb_build_object('from', p_from, 'to', p_to),
      'targets', (SELECT jsonb_build_object(
                     'assignment_minutes', COALESCE(o.sla_assignment_minutes, 10),
                     'arrival_minutes',    COALESCE(o.sla_arrival_minutes, 45))
                    FROM organizations o WHERE o.provider_id = v_mopt),
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
                                            WHERE z.provider_id = v_mopt
                                              AND point_in_polygon(svc.pickup_lat, svc.pickup_lng, z.polygon)
                                            ORDER BY z.created_at LIMIT 1), 'Fuera de zona') AS zona,
                                 count(*) AS n
                            FROM svc GROUP BY 1) x)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mopt_km_by_vehicle(p_from DATE, p_to DATE)
RETURNS TABLE (
  operator_id  UUID,
  operator     TEXT,
  plate        TEXT,
  cases        BIGINT,
  approach_km  NUMERIC,
  tow_km       NUMERIC,
  total_km     NUMERIC,
  on_time_pct  NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
BEGIN
  IF v_mopt IS NULL AND NOT is_admin() THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;
  v_mopt := COALESCE(v_mopt, (SELECT id FROM providers WHERE is_mopt ORDER BY created_at LIMIT 1));

  RETURN QUERY
  SELECT sr.operator_id,
         COALESCE(p.full_name, 'Socio operador'),
         COALESCE(c.vehicle_plate, 'Sin placa'),
         count(*),
         COALESCE(SUM(c.approach_km), 0),
         COALESCE(SUM(c.tow_km), 0),
         COALESCE(SUM(COALESCE(c.approach_km, 0) + COALESCE(c.tow_km, 0)), 0),
         ROUND(100.0 * count(*) FILTER (WHERE s.arrival_seconds <= s.arrival_target * 60)
               / NULLIF(count(*) FILTER (WHERE s.arrival_seconds IS NOT NULL), 0), 1)
    FROM service_requests sr
    JOIN cases c ON c.request_id = sr.id
    LEFT JOIN profiles p ON p.id = sr.operator_id
    CROSS JOIN LATERAL request_sla(sr.id) s
   WHERE sr.mopt_provider_id = v_mopt
     AND sr.status = 'completed'
     AND sr.completed_at >= sv_day_start(p_from)
     AND sr.completed_at <  sv_day_start(p_to + 1)
   GROUP BY sr.operator_id, p.full_name, COALESCE(c.vehicle_plate, 'Sin placa')
   ORDER BY 7 DESC;
END;
$$;

-- Casos de una grua en el periodo (detalle de MOPT-02).
CREATE OR REPLACE FUNCTION public.mopt_vehicle_cases(p_operator_id UUID, p_plate TEXT, p_from DATE, p_to DATE)
RETURNS TABLE (
  request_id   UUID,
  folio        TEXT,
  service_type TEXT,
  completed_at TIMESTAMPTZ,
  approach_km  NUMERIC,
  tow_km       NUMERIC,
  declared_km  NUMERIC,
  arrival_seconds NUMERIC,
  on_time      BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID := auth_mopt_id();
BEGIN
  IF v_mopt IS NULL AND NOT is_admin() THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;
  v_mopt := COALESCE(v_mopt, (SELECT id FROM providers WHERE is_mopt ORDER BY created_at LIMIT 1));

  RETURN QUERY
  SELECT sr.id, c.folio, COALESCE(sr.service_type, 'tow'), sr.completed_at,
         c.approach_km, c.tow_km, c.declared_km, s.arrival_seconds,
         CASE WHEN s.arrival_seconds IS NULL THEN NULL ELSE s.arrival_seconds <= s.arrival_target * 60 END
    FROM service_requests sr
    JOIN cases c ON c.request_id = sr.id
    CROSS JOIN LATERAL request_sla(sr.id) s
   WHERE sr.mopt_provider_id = v_mopt
     AND sr.status = 'completed'
     AND sr.operator_id IS NOT DISTINCT FROM p_operator_id
     AND COALESCE(c.vehicle_plate, 'Sin placa') = p_plate
     AND sr.completed_at >= sv_day_start(p_from)
     AND sr.completed_at <  sv_day_start(p_to + 1)
   ORDER BY sr.completed_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.mopt_compliance(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mopt_km_by_vehicle(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mopt_vehicle_cases(UUID, TEXT, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mopt_compliance(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mopt_km_by_vehicle(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mopt_vehicle_cases(UUID, TEXT, DATE, DATE) TO authenticated;
