-- =====================================================
-- 00072 — Un solo evento por cancelacion, y limpieza de los duplicados viejos
--
-- Continuacion de la 00053, que dejo el trabajo a medias. Aquella arreglo el
-- REQUEST_CREATED duplicado pero solo ese: la cancelacion sigue dejando DOS
-- filas en `request_events`, y ademas nunca se limpiaron las filas ya escritas.
--
-- EL DUPLICADO QUE SIGUE VIVO
-- En la via terminal de `cancel_service_request` (la de USER y ADMIN) pasan dos
-- cosas por el mismo hecho:
--   1. el UPDATE a status='cancelled' dispara `log_service_request_changes`,
--      que emite USER_CANCELLED/ADMIN_CANCELLED con {old_status, new_status};
--   2. la funcion inserta ademas su propio evento con {reason, cancelled_by_role}.
-- Verificado cancelando una solicitud recien creada: dos USER_CANCELLED con el
-- mismo timestamp y payloads distintos.
--
-- CUAL SOBREVIVE: EL TRIGGER — el mismo criterio de la 00053. Es el unico punto
-- por el que pasan todas las escrituras, asi que una cancelacion hecha por SQL o
-- desde otra funcion tambien queda registrada. Y como la 00053 hizo con
-- REQUEST_CREATED, el payload del trigger se enriquece para no perder nada: se
-- le suman `reason` y `cancelled_by_role`, que solo tenia la version de la
-- funcion. Queda incluso mas fiel — lee `NEW.cancellation_reason`, que es lo que
-- de verdad se guardo, en vez del parametro crudo.
--
-- OJO CON LA OTRA VIA. El INSERT de OPERATOR_CANCELLED que hace la misma funcion
-- cuando el operador libera la solicitud al pool NO se toca: ahi el status pasa
-- a 'initiated', no a 'cancelled', asi que el trigger no emite ese evento y no
-- hay duplicado. Ademas ese INSERT va antes del UPDATE a proposito, porque el
-- trigger de la 00037 y `get_available_requests_for_operator` lo consultan para
-- no volver a ofrecerle la solicitud al operador que acaba de soltarla.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. El trigger pasa a ser el unico emisor, con el payload completo
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_service_request_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Log status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
    SELECT
      NEW.id,
      COALESCE(auth.uid(), NEW.user_id),
      COALESCE(
        (SELECT role FROM profiles WHERE id = auth.uid()),
        'USER'
      ),
      CASE
        WHEN NEW.status = 'assigned' THEN 'OPERATOR_ACCEPTED'::event_type
        WHEN NEW.status = 'en_route' THEN 'OPERATOR_EN_ROUTE'::event_type
        WHEN NEW.status = 'active' THEN 'PIN_VERIFIED'::event_type
        WHEN NEW.status = 'completed' THEN 'STATUS_CHANGED'::event_type
        WHEN NEW.status = 'cancelled' AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'ADMIN' THEN 'ADMIN_CANCELLED'::event_type
        WHEN NEW.status = 'cancelled' AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'OPERATOR' THEN 'OPERATOR_CANCELLED'::event_type
        WHEN NEW.status = 'cancelled' THEN 'USER_CANCELLED'::event_type
        ELSE 'STATUS_CHANGED'::event_type
      END,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      )
      -- Al cancelar, el trigger absorbe lo que antes ponia el INSERT explicito
      -- de cancel_service_request: el motivo y quien cancelo. Sin esto, quitar
      -- aquel INSERT dejaria la linea de tiempo sin el "por que".
      || CASE WHEN NEW.status = 'cancelled' THEN jsonb_build_object(
              'reason', NEW.cancellation_reason,
              'cancelled_by_role', COALESCE(
                (SELECT role FROM profiles WHERE id = auth.uid())::text, 'USER')
           ) ELSE '{}'::jsonb END;
  END IF;

  -- Log price computation
  IF OLD.total_price IS NULL AND NEW.total_price IS NOT NULL THEN
    INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
    SELECT
      NEW.id,
      COALESCE(auth.uid(), NEW.operator_id),
      COALESCE(
        (SELECT role FROM profiles WHERE id = auth.uid()),
        'OPERATOR'
      ),
      'PRICE_COMPUTED'::event_type,
      NEW.price_breakdown;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------
-- 2. cancel_service_request deja de emitir el evento por su cuenta
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_service_request(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
  v_user_id UUID;
  v_user_role user_role;
  v_event_type event_type;
BEGIN
  -- 00059: testigo para el guardian de la maquina de estados.
  PERFORM set_config('app.sr_rpc', p_request_id::text, true);
  v_user_id := auth.uid();

  -- Get user role
  SELECT role INTO v_user_role FROM profiles WHERE id = v_user_id;

  -- Get the request
  SELECT * INTO v_request FROM service_requests WHERE id = p_request_id;

  IF v_request IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitud no encontrada');
  END IF;

  -- Check if request can be cancelled
  IF v_request.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta solicitud ya no puede ser cancelada');
  END IF;

  -- Verify user has permission to cancel
  IF v_user_role = 'USER' AND v_request.user_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

  IF v_user_role = 'OPERATOR' AND v_request.operator_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

  -- ==========================================================
  -- OPERADOR cancela -> liberar la solicitud de vuelta al pool
  -- ==========================================================
  IF v_user_role = 'OPERATOR' THEN
    -- Auditoria PRIMERO: queda constancia de quien la solto y por que.
    -- Debe ir ANTES del UPDATE porque el trigger de 00037
    -- (notify_operators_pool_request) dispara en ese UPDATE y consulta este
    -- evento para NO re-ofrecerle la solicitud al operador que la acaba de
    -- soltar. Tambien la usa get_available_requests_for_operator.
    INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
    VALUES (
      p_request_id,
      v_user_id,
      v_user_role,
      'OPERATOR_CANCELLED'::event_type,
      jsonb_build_object('reason', p_reason, 'released_to_pool', true)
    );

    UPDATE service_requests
    SET
      status = 'initiated',
      operator_id = NULL,
      assigned_at = NULL,
      activated_at = NULL,
      route_polyline = NULL,      -- la ruta era del operador saliente
      updated_at = NOW()
    WHERE id = p_request_id;

    -- El trigger de notificaciones (00018) no cubre 'cancelled'->'initiated',
    -- asi que encolamos la push al usuario directamente aqui.
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      v_request.user_id,
      'Buscando otro operador',
      'El operador no pudo atender tu servicio. Tu solicitud sigue activa y estamos buscando otro operador.',
      jsonb_build_object(
        'type', 'service_reassigning',
        'service_request_id', p_request_id,
        'role', 'user'
      ),
      NOW()
    );

    RETURN jsonb_build_object(
      'success', true,
      'released', true,
      'message', 'Servicio liberado. La solicitud volvera a ofrecerse a otros operadores.'
    );
  END IF;

  -- ==========================================================
  -- USER / ADMIN cancelan -> cancelacion terminal (como antes)
  -- ==========================================================
  v_event_type := CASE v_user_role
    WHEN 'ADMIN' THEN 'ADMIN_CANCELLED'::event_type
    ELSE 'USER_CANCELLED'::event_type
  END;

  UPDATE service_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = v_user_id,
    cancellation_reason = p_reason
  WHERE id = p_request_id;

  -- Sin INSERT de auditoria: lo emite el trigger log_service_request_changes al
  -- ver el cambio a 'cancelled', ya con el motivo. El INSERT que habia aca
  -- duplicaba ese evento. `v_event_type` se conserva porque el trigger resuelve
  -- el mismo tipo (USER_/ADMIN_CANCELLED) desde el rol de quien llama.

  RETURN jsonb_build_object('success', true, 'message', 'Solicitud cancelada exitosamente');
END;
$function$;

-- ---------------------------------------------------------------
-- 3. Limpieza de lo ya escrito
-- ---------------------------------------------------------------
-- Sin esto el arreglo solo vale para lo que venga: los casos viejos siguen
-- mostrando "Solicitud creada" dos veces en la linea de tiempo del portal.

-- 3a. REQUEST_CREATED: sobrevive la fila con el payload mas completo, que es la
-- forma que emite el trigger desde la 00053 (trae `service_type` y `has_photo`).
-- Idempotente: despues de correr no quedan grupos con mas de una fila.
WITH ordenadas AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY request_id
           ORDER BY jsonb_array_length(
                      COALESCE(jsonb_agg_keys.keys, '[]'::jsonb)) DESC, id
         ) AS pos
    FROM request_events re
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(k) AS keys FROM jsonb_object_keys(re.payload) k
    ) jsonb_agg_keys
   WHERE re.event_type = 'REQUEST_CREATED'
)
DELETE FROM request_events WHERE id IN (SELECT id FROM ordenadas WHERE pos > 1);

-- 3b. Cancelaciones: aca las dos filas traen datos distintos (una el motivo, la
-- otra la transicion de estado), asi que no se descarta ninguna informacion: se
-- fusionan los payloads en la que se conserva y se borran las demas. El
-- resultado tiene la misma forma que emitira el trigger de ahora en adelante.
WITH grupos AS (
  SELECT request_id, event_type, created_at,
         MIN(id::text)::uuid           AS conservar,
         jsonb_object_agg(k, v)        AS payload_fusionado
    FROM request_events re
    CROSS JOIN LATERAL jsonb_each(re.payload) AS e(k, v)
   WHERE re.event_type IN ('USER_CANCELLED', 'OPERATOR_CANCELLED', 'ADMIN_CANCELLED')
   GROUP BY request_id, event_type, created_at
  HAVING COUNT(DISTINCT re.id) > 1
)
UPDATE request_events re
   SET payload = g.payload_fusionado
  FROM grupos g
 WHERE re.id = g.conservar;

WITH sobrantes AS (
  SELECT re.id
    FROM request_events re
    JOIN (
      SELECT request_id, event_type, created_at, MIN(id::text)::uuid AS conservar
        FROM request_events
       WHERE event_type IN ('USER_CANCELLED', 'OPERATOR_CANCELLED', 'ADMIN_CANCELLED')
       GROUP BY request_id, event_type, created_at
      HAVING COUNT(*) > 1
    ) g ON g.request_id = re.request_id
       AND g.event_type = re.event_type
       AND g.created_at = re.created_at
   WHERE re.id <> g.conservar
     AND re.event_type IN ('USER_CANCELLED', 'OPERATOR_CANCELLED', 'ADMIN_CANCELLED')
)
DELETE FROM request_events WHERE id IN (SELECT id FROM sobrantes);
