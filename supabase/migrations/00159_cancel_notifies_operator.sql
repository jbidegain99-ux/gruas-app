-- =====================================================================
-- 00159 — Cuando Budi cancela, también se entera el socio asignado
--
-- notify_service_status_change (00144) avisaba a una sola parte al cancelar:
-- si cancelaba el Usuario, al socio; si no, al Usuario. Cuando cancela soporte
-- o el admin (admin_cancel_request) con un socio ya asignado, el socio no
-- recibía nada: podía seguir manejando hacia la recogida con la app en
-- segundo plano. (Si el socio cancela, la solicitud vuelve al pool —00035— y
-- no pasa por aquí.)
--
-- Ahora, si la cancelación no la hizo el Usuario y hay socio asignado, se le
-- avisa también al socio, con el motivo.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.notify_service_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  notification_title TEXT;
  notification_body TEXT;
  notification_data JSONB;
  target_user_id UUID;
  target_role TEXT;
  edge_function_url TEXT;
BEGIN
  -- Only trigger on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Get the Edge Function URL from environment or use default
  edge_function_url := current_setting('app.settings.edge_function_url', true);
  IF edge_function_url IS NULL THEN
    edge_function_url := 'http://localhost:54321/functions/v1';
  END IF;

  -- Determine notification content based on status change
  CASE NEW.status
    WHEN 'assigned' THEN
      -- Notify user that operator was assigned
      target_user_id := NEW.user_id;
      target_role := 'user';
      notification_title := '¡Socio operador asignado!';
      notification_body := 'Un socio operador fue asignado a tu solicitud. Pronto estará en camino.';
      notification_data := jsonb_build_object(
        'type', 'service_assigned',
        'service_request_id', NEW.id,
        'operator_id', NEW.operator_id,
        'role', 'user'
      );

    WHEN 'en_route' THEN
      -- Notify user that operator is on the way
      target_user_id := NEW.user_id;
      target_role := 'user';
      notification_title := 'Socio operador en camino';
      notification_body := 'El socio operador está en camino a tu ubicación.';
      notification_data := jsonb_build_object(
        'type', 'service_status_update',
        'service_request_id', NEW.id,
        'status', 'en_route',
        'role', 'user'
      );

    WHEN 'active' THEN
      -- Notify user that service has started
      target_user_id := NEW.user_id;
      target_role := 'user';
      notification_title := 'Servicio Iniciado';
      notification_body := 'El socio operador llegó y el servicio comenzó.';
      notification_data := jsonb_build_object(
        'type', 'service_status_update',
        'service_request_id', NEW.id,
        'status', 'active',
        'role', 'user'
      );

    WHEN 'completed' THEN
      -- Notify user that service is complete
      target_user_id := NEW.user_id;
      target_role := 'user';
      notification_title := 'Servicio Completado';
      notification_body := '¡Tu servicio quedó completado! Gracias por usar Budi.';
      notification_data := jsonb_build_object(
        'type', 'service_status_update',
        'service_request_id', NEW.id,
        'status', 'completed',
        'role', 'user'
      );

    WHEN 'cancelled' THEN
      -- Notify the other party about cancellation
      IF NEW.cancelled_by = NEW.user_id THEN
        -- User cancelled, notify operator
        target_user_id := NEW.operator_id;
        target_role := 'operator';
        notification_title := 'Servicio Cancelado';
        notification_body := 'El Usuario canceló el servicio.';
      ELSE
        -- Budi (soporte/admin) cancelled, notify user
        target_user_id := NEW.user_id;
        target_role := 'user';
        notification_title := 'Servicio Cancelado';
        notification_body := 'Tu servicio ha sido cancelado.';
        -- 00159: y al socio asignado, que si no seguiría en camino.
        IF NEW.operator_id IS NOT NULL THEN
          INSERT INTO notification_queue (user_id, title, body, data, created_at)
          VALUES (
            NEW.operator_id,
            'Servicio Cancelado',
            'Budi canceló este servicio' || COALESCE(': ' || NULLIF(btrim(NEW.cancellation_reason), ''), '') || '. Ya no tienes que ir.',
            jsonb_build_object(
              'type', 'service_cancelled',
              'service_request_id', NEW.id,
              'reason', NEW.cancellation_reason,
              'role', 'operator'
            ),
            NOW()
          );
        END IF;
      END IF;
      notification_data := jsonb_build_object(
        'type', 'service_cancelled',
        'service_request_id', NEW.id,
        'reason', NEW.cancellation_reason,
        'role', target_role
      );

    ELSE
      -- No notification for other status changes
      RETURN NEW;
  END CASE;

  -- Skip if no target user
  IF target_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert notification into queue table for async processing
  INSERT INTO notification_queue (user_id, title, body, data, created_at)
  VALUES (target_user_id, notification_title, notification_body, notification_data, NOW());

  RETURN NEW;
END;
$function$;
