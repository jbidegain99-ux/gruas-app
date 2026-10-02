-- =====================================================================
-- 00164 — Un servicio en curso no se cancela desde la app
--
-- cancel_service_request dejaba cancelar en cualquier estado salvo completado
-- o cancelado. Con el servicio ACTIVO (PIN verificado, la grúa trabajando):
--   · el socio lo "soltaba" y volvía al pool como si nada, con el vehículo
--     del Usuario posiblemente enganchado;
--   · el Usuario lo cancelaba y el socio perdía el servicio sin registro.
-- La app no muestra "Cancelar" en ese estado (lib/cancellation.ts y la
-- pantalla del socio cortan en 'en_route'); el servidor no lo aplicaba.
-- Encontrado probando atajos por la API (2026-10-02).
--
-- Ahora, en 'active', Usuario y socio reciben un error que los manda a
-- soporte. ADMIN y SUPPORT sí pueden (y admin_cancel_request no cambia).
-- El resto de la función, igual que antes (00109).
-- =====================================================================

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

  IF v_user_id IS NULL OR v_user_role IS NULL
     OR v_user_role::text NOT IN ('USER', 'OPERATOR', 'ADMIN', 'SUPPORT') THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

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

  -- 00164: con el servicio en curso (PIN verificado: la grúa ya está
  -- trabajando, quizá con el vehículo enganchado) ni el Usuario ni el socio
  -- lo cortan solos. La app ya no les muestra "Cancelar" en este estado; el
  -- servidor lo hacía igual. Lo resuelve soporte, que decide qué pasa con el
  -- cobro y con el vehículo.
  IF v_request.status = 'active' AND v_user_role::text IN ('USER', 'OPERATOR') THEN
    RETURN jsonb_build_object('success', false, 'error',
      CASE v_user_role::text
        WHEN 'USER' THEN 'Tu servicio ya está en curso. Si necesitas detenerlo, escríbenos a soporte.'
        ELSE 'El servicio ya empezó. Para dejarlo, comunícate con soporte.'
      END);
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
      'Buscando otro socio operador',
      'El socio operador no pudo atender tu servicio. Tu solicitud sigue activa y estamos buscando otro socio operador.',
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
      'message', 'Servicio liberado. La solicitud volverá a ofrecerse a otros socios operadores.'
    );
  END IF;

  -- ==========================================================
  -- USER / ADMIN cancelan -> cancelacion terminal (como antes)
  -- ==========================================================
  v_event_type := CASE
    WHEN v_user_role::text IN ('ADMIN', 'SUPPORT') THEN 'ADMIN_CANCELLED'::event_type
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
