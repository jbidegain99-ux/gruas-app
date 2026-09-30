-- =====================================================
-- Avisos push: sin suponer grúa y sin avisarle al socio su propia acción
--
-- Visto al recorrer un servicio de batería del MOPT (2026-09-30):
--   * Al Usuario le llegaba "¡Grúa Asignada!" en batería, llanta, cerrajería…
--   * Al socio, "Se te ha asignado un nuevo servicio de grúa." — y además al
--     aceptar él mismo desde el pool (el trigger solo miraba operator_id).
--   * "Gracias por usar GruasApp" (marca vieja) y "el usuario" en minúscula.
-- =====================================================

CREATE OR REPLACE FUNCTION public.notify_service_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
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
        -- Operator/admin cancelled, notify user
        target_user_id := NEW.user_id;
        target_role := 'user';
        notification_title := 'Servicio Cancelado';
        notification_body := 'Tu servicio ha sido cancelado.';
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
$$;

CREATE OR REPLACE FUNCTION public.notify_operator_new_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Only trigger when operator_id is set for the first time
  -- 00144: solo si lo asignó otra persona (soporte o admin). Cuando el socio
  -- acepta desde el pool, el aviso le llegaba por su propia acción.
  IF OLD.operator_id IS NULL AND NEW.operator_id IS NOT NULL
     AND auth.uid() IS DISTINCT FROM NEW.operator_id THEN
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      NEW.operator_id,
      'Nuevo servicio asignado',
      'Te asignaron un servicio. Abre la app para ver los detalles.',
      jsonb_build_object(
        'type', 'new_service_request',
        'service_request_id', NEW.id,
        'role', 'operator'
      ),
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$;
