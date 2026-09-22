-- =====================================================
-- 00068 — B-17: portal B2B para aseguradoras (backend)
--
-- La aseguradora inicia sesión y ve SOLO sus casos, con folio, estado y SLA.
-- Es un actor externo nuevo: hasta ahora los roles eran USER / OPERATOR / ADMIN.
-- Se agrega el rol INSURER y se ata cada cuenta de aseguradora a su `insurer_id`.
--
-- El corazón es el AISLAMIENTO: una aseguradora no puede ver nada de otra. Todo
-- cuelga de `auth_insurer_id()` — el insurer de la cuenta que llama, o NULL si no
-- es aseguradora — y de `request_belongs_to_my_insurer()`, que recorre la cadena
-- de cobertura (caso → request → coverage_usage → member → policy → insurer). Un
-- caso es "de" una aseguradora solo si su servicio consumió una póliza suya.
--
-- La UI del portal es aparte; esto es el modelo, la RLS y las consultas.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. El rol y el vínculo
-- ---------------------------------------------------------------
-- OJO con este ADD VALUE. `supabase db push` corre cada archivo de migración
-- dentro de una transacción, y Postgres no deja USAR un valor de enum recién
-- agregado antes de que commitee:
--     ERROR: unsafe use of new value "INSURER" of enum type user_role
--     HINT:  New enum values must be committed before they can be used.
-- El cuerpo de una función `LANGUAGE sql` se parsea al crearla, así que un
-- `role = 'INSURER'` ahí abajo cuenta como uso y revienta la migración entera.
-- (En plpgsql el cuerpo es una cadena que no se valida hasta ejecutarse, por eso
-- la 00047 y la 00060 hacen lo mismo sin problema.)
-- La salida es comparar por texto: `role::text = 'INSURER'` no toca el enum
-- nuevo. Ver `auth_insurer_id()` justo abajo.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'INSURER';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS insurer_id UUID REFERENCES public.insurers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.insurer_id IS
  'B-17: la aseguradora a la que pertenece esta cuenta (solo para rol INSURER). '
  'Análogo a provider_id para operadores de una empresa.';

-- ---------------------------------------------------------------
-- 2. Helpers de identidad de la aseguradora
-- ---------------------------------------------------------------
-- El insurer de quien llama, si es INSURER. NULL en cualquier otro caso — así las
-- políticas que lo usan no le abren nada a un no-INSURER.
CREATE OR REPLACE FUNCTION public.auth_insurer_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- `role::text`, no `role = 'INSURER'`: esta función se crea en la misma
  -- transacción que el ADD VALUE de arriba, y comparar contra el enum haría
  -- fallar la migración. Ver la nota del paso 1.
  SELECT insurer_id FROM public.profiles
   WHERE id = auth.uid() AND role::text = 'INSURER';
$$;

REVOKE ALL ON FUNCTION public.auth_insurer_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_insurer_id() TO authenticated;

-- ¿El servicio de este caso consumió una póliza de MI aseguradora?
CREATE OR REPLACE FUNCTION public.request_belongs_to_my_insurer(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM coverage_usage cu
      JOIN members m  ON m.id  = cu.member_id
      JOIN policies po ON po.id = m.policy_id
     WHERE cu.request_id = p_request_id
       AND po.insurer_id = auth_insurer_id()
  );
$$;

REVOKE ALL ON FUNCTION public.request_belongs_to_my_insurer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_belongs_to_my_insurer(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- 3. RLS: la aseguradora ve sus casos y sus servicios
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Aseguradora ve sus casos" ON public.cases;
CREATE POLICY "Aseguradora ve sus casos" ON public.cases
  FOR SELECT USING (request_belongs_to_my_insurer(cases.request_id));

DROP POLICY IF EXISTS "Aseguradora ve sus servicios" ON public.service_requests;
CREATE POLICY "Aseguradora ve sus servicios" ON public.service_requests
  FOR SELECT USING (request_belongs_to_my_insurer(service_requests.id));

-- La aseguradora también puede leer su propia fila de profile (ya la cubre
-- "Users can view own profile"), y su propia aseguradora:
DROP POLICY IF EXISTS "Aseguradora ve su propia ficha" ON public.insurers;
CREATE POLICY "Aseguradora ve su propia ficha" ON public.insurers
  FOR SELECT USING (id = auth_insurer_id());

-- ---------------------------------------------------------------
-- 4. La aseguradora accede al timeline y al SLA de sus casos
-- ---------------------------------------------------------------
-- get_case_timeline y get_case_sla ya dejaban entrar a admin / dueño / operador.
-- Se agrega la aseguradora dueña. Reconstruidas por sustitución exacta: solo
-- cambia la condición de acceso.
CREATE OR REPLACE FUNCTION public.get_case_timeline(p_folio TEXT)
RETURNS TABLE (
  at          TIMESTAMPTZ,
  event_type  TEXT,
  label       TEXT,
  actor_role  TEXT,
  detail      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
     AND NOT request_belongs_to_my_insurer(v_request_id) THEN
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
      CASE WHEN re.event_type = 'PRICE_COMPUTED'
           THEN '$' || COALESCE(re.payload->>'total', '?') END,
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
$$;

-- get_case_sla: mismo agregado en el chequeo de acceso.
CREATE OR REPLACE FUNCTION public.get_case_sla(p_folio TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
     AND NOT request_belongs_to_my_insurer(v_sr.id) THEN
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
$$;

-- ---------------------------------------------------------------
-- 5. El listado de casos del portal
-- ---------------------------------------------------------------
-- Los casos de la aseguradora que llama, con lo que necesita la lista: folio,
-- servicio, estado, fecha, precio, y el cumplimiento de los dos tramos de SLA
-- (calculado inline con el objetivo de la aseguradora). Ordenados del más nuevo
-- al más viejo.
CREATE OR REPLACE FUNCTION public.list_insurer_cases()
RETURNS TABLE (
  folio          TEXT,
  service_type   TEXT,
  status         TEXT,
  created_at     TIMESTAMPTZ,
  total_price    NUMERIC,
  coverage_status TEXT,
  assignment_met BOOLEAN,
  arrival_met    BOOLEAN
)
LANGUAGE plpgsql
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

  SELECT sla_assignment_minutes, sla_arrival_minutes INTO v_asig, v_lleg
    FROM insurers WHERE id = v_insurer;

  RETURN QUERY
  SELECT
    c.folio,
    sr.service_type,
    sr.status::text,
    sr.created_at,
    sr.total_price,
    sr.coverage_status,
    CASE WHEN sr.assigned_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (sr.assigned_at - sr.created_at)) <= v_asig * 60 END,
    CASE WHEN sr.activated_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (sr.activated_at - sr.assigned_at)) <= v_lleg * 60 END
  FROM cases c
  JOIN service_requests sr ON sr.id = c.request_id
  WHERE EXISTS (
    SELECT 1 FROM coverage_usage cu
    JOIN members m  ON m.id = cu.member_id
    JOIN policies po ON po.id = m.policy_id
    WHERE cu.request_id = sr.id AND po.insurer_id = v_insurer
  )
  ORDER BY sr.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_insurer_cases() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_insurer_cases() TO authenticated;

-- ---------------------------------------------------------------
-- 6. El admin da de alta la cuenta de una aseguradora
-- ---------------------------------------------------------------
-- El usuario ya existe en auth (lo crea el admin por el panel de Supabase o la
-- API). Esto lo convierte en cuenta de aseguradora: rol INSURER + su insurer_id.
CREATE OR REPLACE FUNCTION public.admin_link_insurer_user(p_user_id UUID, p_insurer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede vincular una cuenta de aseguradora';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM insurers WHERE id = p_insurer_id) THEN
    RAISE EXCEPTION 'La aseguradora no existe';
  END IF;

  UPDATE profiles
     SET role = 'INSURER', insurer_id = p_insurer_id, updated_at = now()
   WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_link_insurer_user(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_insurer_user(UUID, UUID) TO authenticated;
