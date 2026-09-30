-- =====================================================
-- Línea de tiempo del caso: "Cancelado por el Usuario"
--
-- El Usuario (cliente final) va con mayúscula en toda la plataforma; esta
-- etiqueta quedó en minúscula y se ve en el admin, el portal MOPT y el de
-- aseguradoras (y en el JSON exportado).
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_case_timeline(p_folio text)
RETURNS TABLE(at timestamp with time zone, event_type text, label text, actor_role text, detail text)
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

  IF NOT is_staff()
     AND auth.uid() IS DISTINCT FROM v_user_id
     AND auth.uid() IS DISTINCT FROM v_operator
     AND NOT request_belongs_to_my_insurer(v_request_id)
     AND NOT request_belongs_to_my_mopt(v_request_id) THEN  -- 00100
    RAISE EXCEPTION 'No tienes acceso a este caso';
  END IF;

  RETURN QUERY
  SELECT
    re.created_at,
    re.event_type::text,
    CASE re.event_type
      WHEN 'REQUEST_CREATED'      THEN 'Solicitud creada'
      WHEN 'COVERAGE_CHECKED'     THEN 'Cobertura verificada'
      WHEN 'OPERATOR_ACCEPTED'    THEN 'Socio operador asignado'
      WHEN 'OPERATOR_EN_ROUTE'    THEN 'Socio operador en camino'
      WHEN 'PIN_VERIFIED'         THEN 'PIN de confirmación verificado (el socio llegó)'
      WHEN 'PRICE_COMPUTED'       THEN 'Precio calculado'
      WHEN 'PRICE_DISTANCE_CAPPED' THEN 'Distancia ajustada al máximo razonable'
      WHEN 'STATUS_CHANGED'       THEN 'Cambio de estado'
      WHEN 'MESSAGE_SENT'         THEN 'Mensaje en el chat'
      WHEN 'RATING_SUBMITTED'     THEN 'Calificación enviada'
      WHEN 'USER_CANCELLED'       THEN 'Cancelado por el Usuario'
      WHEN 'OPERATOR_CANCELLED'   THEN 'El socio operador liberó el servicio'
      WHEN 'ADMIN_CANCELLED'      THEN 'Cancelado por Budi (soporte o administración)'
      WHEN 'PIN_REGENERATED'      THEN 'El Usuario generó un PIN de confirmación nuevo'
      WHEN 'PIN_LOCKOUT_RESET'    THEN 'Budi desbloqueó el PIN de confirmación'
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
      WHEN 'PIN_REGENERATED'       THEN 4
      WHEN 'PIN_LOCKOUT_RESET'     THEN 4
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
