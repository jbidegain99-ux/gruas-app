-- =====================================================
-- 00075 — Tres cabos sueltos de la revision del dia
--
-- Ninguno es grave por si solo; los tres salieron de repasar lo que se toco hoy.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. El precio de la linea de tiempo, sin castear a ciegas
-- ---------------------------------------------------------------
-- La 00071 arreglo que el precio saliera con cuatro decimales, pero lo hizo con
-- un cast directo a NUMERIC. Hoy las siete filas PRICE_COMPUTED son numericas,
-- asi que no se rompe nada — pero `get_case_timeline` devuelve la linea de
-- tiempo COMPLETA de un caso: un unico payload malformado no se comeria esa
-- fila, se comeria el caso entero en el portal de la aseguradora. Se formatea
-- solo cuando el valor es un numero, y si no, se muestra crudo antes que perder
-- el dato.
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

-- ---------------------------------------------------------------
-- 2. Cancelar desde el panel deja constancia de por que
-- ---------------------------------------------------------------
-- `admin_cancel_request` no guardaba `cancellation_reason` ni `cancelled_by`, y
-- ni siquiera recibia un motivo. Desde la 00072 la linea de tiempo muestra el
-- motivo de una cancelacion, asi que las del admin se veian mudas justo donde
-- mas importa: son las que alguien va a querer explicar despues.
--
-- El parametro va con DEFAULT NULL para no romper a quien ya la llama con un
-- solo argumento.
CREATE OR REPLACE FUNCTION public.admin_cancel_request(p_request_id uuid, p_reason text DEFAULT NULL)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
  v_admin_role user_role;
BEGIN
  -- Verify admin role
  SELECT role INTO v_admin_role FROM profiles WHERE id = auth.uid();
  IF v_admin_role != 'ADMIN' THEN
    RAISE EXCEPTION 'Only admins can force cancel requests';
  END IF;

  -- Cancel request
  UPDATE service_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = auth.uid(),
    cancellation_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  RETURN v_request;
END;
$function$;

-- ---------------------------------------------------------------
-- 3. Fuera `operator_cancel_request`
-- ---------------------------------------------------------------
-- No la llama nadie —ni la movil ni la web, verificado— y es una version vieja y
-- peor de lo que hoy hace la rama de operador de `cancel_service_request`
-- (00035). Aquella, al soltar un servicio al pool:
--   * deja el evento OPERATOR_CANCELLED, que NO es decorativo: lo consultan el
--     trigger de la 00037 y `get_available_requests_for_operator` para no volver
--     a ofrecerle la solicitud al operador que la acaba de soltar;
--   * encola la push "buscando otro operador" al cliente;
--   * limpia `activated_at` y `route_polyline`, que eran del operador saliente.
-- Esta no hace nada de eso: solo pone `operator_id = NULL` y `status =
-- 'initiated'`. Y estaba con EXECUTE para `authenticated`, o sea alcanzable por
-- la API: un operador podia soltar un servicio sin dejar rastro, sin que el
-- cliente se enterara, y que el pool se lo volviera a ofrecer en el acto.
-- Se elimina en vez de arreglarla: seria una segunda copia de algo que ya
-- funciona bien, y esa duplicacion es justamente como nacio el problema.
DROP FUNCTION IF EXISTS public.operator_cancel_request(uuid);

-- ---------------------------------------------------------------
-- 4. `operator_can_serve` es un helper interno, no una API
-- ---------------------------------------------------------------
-- Nacio en la 00073 recibiendo el id del operador como parametro para poder
-- reusarla desde el pool, desde `accept_service_request` y desde el despacho
-- (00074). El efecto colateral es que, con EXECUTE para `authenticated`,
-- cualquiera podia preguntar por CUALQUIER operador y averiguar que servicios
-- presta su empresa.
--
-- Se le quita el grant. Los tres llamadores son SECURITY DEFINER de `postgres`,
-- asi que la ejecutan con los permisos del dueno y siguen funcionando: no hace
-- falta que `authenticated` la tenga.
REVOKE EXECUTE ON FUNCTION public.operator_can_serve(UUID, TEXT) FROM authenticated;
