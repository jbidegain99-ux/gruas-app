-- 00121: base común de los portales — en vivo, filtros y zona (backlog POR-03)
--
-- 1. Zona de un caso: el departamento de El Salvador más cercano al punto de
--    recogida (centroide aproximado). Para el MOPT, si el punto cae en una de
--    sus zonas, el nombre de la zona. La aseguradora no recibe la dirección ni
--    las coordenadas: solo el departamento.
-- 2. `portal_insurer_cases(desde, hasta)`: lo mismo que list_insurer_cases
--    (B-17) filtrado por fecha en hora de El Salvador y con la zona.
--    `mopt_list_services` suma la columna `zone`.
-- 3. En vivo: al crear una solicitud o cambiar su estado, la base avisa por
--    Realtime (broadcast privado) a la organización que la ve: topic
--    `org:<id>`, con solo folio y estado. El portal recarga su lista con sus
--    propias RPC, así el aviso no puede filtrar nada que la RPC no dé. Solo
--    los miembros activos de esa organización (con 2FA si lo necesitan, igual
--    que auth_org) pueden escuchar ese topic.

-- ─── 1. Departamento ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sv_department(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT d.nombre
    FROM (VALUES
      ('Ahuachapán',   13.92, -89.85), ('Santa Ana',    14.15, -89.55),
      ('Sonsonate',    13.72, -89.72), ('Chalatenango', 14.13, -89.00),
      ('La Libertad',  13.65, -89.35), ('San Salvador', 13.74, -89.17),
      ('Cuscatlán',    13.80, -88.98), ('La Paz',       13.45, -88.95),
      ('Cabañas',      13.87, -88.75), ('San Vicente',  13.60, -88.73),
      ('Usulután',     13.40, -88.50), ('San Miguel',   13.45, -88.20),
      ('Morazán',      13.75, -88.10), ('La Unión',     13.40, -87.90)
    ) AS d(nombre, lat, lng)
   WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
   -- Distancia plana con la longitud corregida por la latitud (cos 13.7° ≈ 0.97):
   -- sobra para elegir el centroide más cercano dentro del país.
   ORDER BY (d.lat - p_lat) ^ 2 + ((d.lng - p_lng) * 0.97) ^ 2
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.sv_department(DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sv_department(DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- ─── 2a. Casos de la aseguradora, por fecha y con zona ─────────────────────
CREATE OR REPLACE FUNCTION public.portal_insurer_cases(p_from DATE, p_to DATE)
RETURNS TABLE (folio TEXT, service_type TEXT, status TEXT, created_at TIMESTAMPTZ, zone TEXT,
               total_price NUMERIC, coverage_status TEXT, cubierto NUMERIC, copago NUMERIC,
               assignment_met BOOLEAN, arrival_met BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_insurer UUID := auth_insurer_id();
  v_asig INT;
  v_lleg INT;
BEGIN
  IF v_insurer IS NULL THEN
    RAISE EXCEPTION 'Solo una cuenta de aseguradora puede ver sus casos';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Rango de fechas inválido';
  END IF;

  SELECT sla_assignment_minutes, sla_arrival_minutes INTO v_asig, v_lleg
    FROM insurers WHERE id = v_insurer;

  RETURN QUERY
  SELECT c.folio, COALESCE(sr.service_type, 'tow'), sr.status::text, sr.created_at,
         sv_department(sr.pickup_lat, sr.pickup_lng),
         sr.total_price, sr.coverage_status, cu.amount_covered, cu.amount_copay,
         CASE WHEN sr.assigned_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (sr.assigned_at - sr.created_at)) <= v_asig * 60 END,
         CASE WHEN sr.activated_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (sr.activated_at - sr.assigned_at)) <= v_lleg * 60 END
    FROM cases c
    JOIN service_requests sr ON sr.id = c.request_id
    LEFT JOIN coverage_usage cu ON cu.request_id = sr.id
   WHERE sr.created_at >= sv_day_start(p_from)
     AND sr.created_at <  sv_day_start(p_to + 1)
     AND EXISTS (
       SELECT 1 FROM coverage_usage cu2
       JOIN members m   ON m.id  = cu2.member_id
       JOIN policies po ON po.id = m.policy_id
       WHERE cu2.request_id = sr.id
         AND po.insurer_id = v_insurer
         AND plan_cubre_servicio(po.plan_id, sr.service_type))
   ORDER BY sr.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_insurer_cases(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_insurer_cases(DATE, DATE) TO authenticated;

-- ─── 2b. Servicios del MOPT con zona ────────────────────────────────────────
DROP FUNCTION public.mopt_list_services(DATE, DATE);
CREATE FUNCTION public.mopt_list_services(p_from DATE, p_to DATE)
RETURNS TABLE (id UUID, folio TEXT, status TEXT, service_type TEXT, client_name TEXT, vehicle_plate TEXT,
               pickup_address TEXT, pickup_lat DOUBLE PRECISION, pickup_lng DOUBLE PRECISION,
               operator_name TEXT, created_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, total_price NUMERIC,
               zone TEXT)
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
             ORDER BY z.name LIMIT 1),
           sv_department(sr.pickup_lat, sr.pickup_lng))
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

-- ─── 3. Aviso en vivo por organización ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_portal_case_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_folio TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.operator_id IS NOT DISTINCT FROM OLD.operator_id THEN
    RETURN NULL;
  END IF;

  SELECT folio INTO v_folio FROM cases WHERE request_id = NEW.id;

  FOR r IN
    SELECT o.id FROM organizations o
     WHERE o.status = 'active'
       AND ((o.type = 'MOPT' AND NEW.mopt_provider_id IS NOT NULL AND o.provider_id = NEW.mopt_provider_id)
         OR (o.type = 'INSURER' AND o.insurer_id IN (
               SELECT po.insurer_id FROM coverage_usage cu
                 JOIN members m   ON m.id = cu.member_id
                 JOIN policies po ON po.id = m.policy_id
                WHERE cu.request_id = NEW.id
                  AND plan_cubre_servicio(po.plan_id, NEW.service_type))))
  LOOP
    PERFORM realtime.send(
      jsonb_build_object('folio', v_folio, 'status', NEW.status::text),
      'case_changed', 'org:' || r.id::text, true);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Un aviso que no sale no puede tumbar la solicitud: el portal igual
  -- refresca cada minuto.
  RAISE WARNING 'notify_portal_case_change: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_portal_case_change() FROM PUBLIC, anon, authenticated;

-- Diferido al commit: la cobertura (coverage_usage) se escribe en la misma
-- transacción, después del INSERT de la solicitud.
CREATE CONSTRAINT TRIGGER trg_notify_portal_case_change
  AFTER INSERT OR UPDATE ON public.service_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.notify_portal_case_change();

-- Quién escucha: solo los miembros activos de esa organización.
DROP POLICY IF EXISTS "portal: escucha su organizacion" ON realtime.messages;
CREATE POLICY "portal: escucha su organizacion" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() = 'org:' || (SELECT o.organization_id FROM public.auth_org() o)::text
  );
