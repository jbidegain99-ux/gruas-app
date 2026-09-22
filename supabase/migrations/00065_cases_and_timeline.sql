-- =====================================================
-- 00065 — B-14: folio/caso por servicio + línea de tiempo
--
-- Cada servicio pasa a tener un CASO con un folio único y legible
-- (BUDI-000001), que es la referencia con la que se lo nombra hacia afuera:
-- el cliente, el operador y —cuando llegue B-17— la aseguradora hablan del
-- folio, no del UUID interno del service_request.
--
-- POR QUÉ UNA TABLA `cases` SEPARADA, Y NO UNA COLUMNA EN service_requests
--  · Es la vista de NEGOCIO del servicio, no la operativa. Aquí van a colgar el
--    SLA (B-15) y la relación con la aseguradora, y desde aquí el portal B2B
--    (B-17) leerá — sin exponerle la fila cruda de service_requests. Separar
--    deja darle a la aseguradora acceso a `cases` con su propia RLS.
--  · El folio es un identificador PÚBLICO estable; el UUID del request es
--    interno. No se mezclan.
--
-- LA LÍNEA DE TIEMPO NO ES UNA TABLA NUEVA: ya existe en `request_events`, que
-- registra cada transición (creada, asignada, en camino, PIN, precio, cobertura,
-- cancelaciones...). `get_case_timeline()` la traduce a frases en español.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. La secuencia del folio
-- ---------------------------------------------------------------
-- Global e incremental: BUDI-000001, 000002... Único, legible y ordenable por
-- antigüedad. El año no va en el folio a propósito: reiniciar la numeración cada
-- año obliga a llevar el año como parte de la clave y complica la unicidad; una
-- secuencia global no se equivoca nunca.
CREATE SEQUENCE IF NOT EXISTS public.case_folio_seq;

CREATE OR REPLACE FUNCTION public.next_case_folio()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT 'BUDI-' || lpad(nextval('public.case_folio_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------
-- 2. La tabla de casos
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cases (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio      TEXT NOT NULL UNIQUE,
  request_id UUID NOT NULL UNIQUE REFERENCES public.service_requests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cases_request_idx ON public.cases (request_id);

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

-- Por ahora solo el admin. La política de la aseguradora (ve solo sus casos)
-- entra con el portal B-17.
DROP POLICY IF EXISTS "Admin gestiona casos" ON public.cases;
CREATE POLICY "Admin gestiona casos" ON public.cases
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- El usuario dueño y el operador asignado pueden ver el folio de SU servicio
-- (para mostrarlo en la app). No ven casos ajenos.
DROP POLICY IF EXISTS "Participantes ven su caso" ON public.cases;
CREATE POLICY "Participantes ven su caso" ON public.cases
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
       WHERE sr.id = cases.request_id
         AND (sr.user_id = auth.uid() OR sr.operator_id = auth.uid())
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.cases FROM authenticated, anon;

COMMENT ON TABLE public.cases IS
  'B-14: un caso por servicio, con folio público (BUDI-xxxxxx). Vista de negocio '
  'del service_request; aquí colgarán el SLA (B-15) y el acceso de la aseguradora '
  '(B-17). Lo crea el trigger al nacer el servicio; el cliente NO lo escribe.';

-- ---------------------------------------------------------------
-- 3. El caso nace con el servicio
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_case_to_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.cases (folio, request_id, created_at)
  VALUES (next_case_folio(), NEW.id, NEW.created_at)
  ON CONFLICT (request_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_case_trigger ON public.service_requests;
CREATE TRIGGER assign_case_trigger
  AFTER INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.assign_case_to_request();

-- ---------------------------------------------------------------
-- 4. Backfill: los servicios que ya existen también reciben folio
-- ---------------------------------------------------------------
-- En orden cronológico, para que BUDI-000001 sea el servicio más antiguo. La
-- secuencia queda donde corresponde y el trigger sigue desde ahí.
INSERT INTO public.cases (folio, request_id, created_at)
SELECT next_case_folio(), sr.id, sr.created_at
  FROM service_requests sr
  LEFT JOIN cases c ON c.request_id = sr.id
 WHERE c.id IS NULL
 ORDER BY sr.created_at ASC;

-- ---------------------------------------------------------------
-- 5. La línea de tiempo, en español
-- ---------------------------------------------------------------
-- Traduce request_events a frases legibles, ordenadas. SECURITY DEFINER +
-- chequeo de acceso: el admin ve cualquier caso; el cliente/operador solo el
-- suyo. Devuelve también el actor para saber quién hizo cada cosa.
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
     AND auth.uid() IS DISTINCT FROM v_operator THEN
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
  -- created_at manda; cuando varios eventos caen en el mismo instante (los de la
  -- creación viven en una sola transacción y comparten now()), un peso por tipo
  -- los pone en su orden lógico en vez de dejarlo al azar del UUID.
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

REVOKE ALL ON FUNCTION public.get_case_timeline(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_case_timeline(TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_case_timeline(TEXT) IS
  'B-14: línea de tiempo del caso (por folio), traducida a español. Admin ve '
  'cualquiera; cliente y operador solo el suyo.';
