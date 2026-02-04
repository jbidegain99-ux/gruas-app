-- Create notification triggers for service request status changes

-- Function to send push notification via Edge Function
CREATE OR REPLACE FUNCTION notify_service_status_change()
RETURNS TRIGGER AS $$
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
      notification_title := '¡Grúa Asignada!';
      notification_body := 'Un operador ha sido asignado a tu solicitud. Pronto estará en camino.';
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
      notification_title := 'Operador en Camino';
      notification_body := 'El operador está en camino a tu ubicación.';
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
      notification_body := 'El operador ha llegado y el servicio ha comenzado.';
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
      notification_body := '¡Tu servicio ha sido completado! Gracias por usar GruasApp.';
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
        notification_body := 'El cliente ha cancelado el servicio.';
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create notification queue table for async processing
CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  sent BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for processing unsent notifications
CREATE INDEX idx_notification_queue_unsent ON notification_queue(sent, created_at) WHERE sent = false;

-- RLS for notification_queue
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

-- Only service role can access (via Edge Functions)
CREATE POLICY "Service role only" ON notification_queue
  FOR ALL USING (false);

-- Create trigger on service_requests
DROP TRIGGER IF EXISTS trigger_notify_service_status ON service_requests;
CREATE TRIGGER trigger_notify_service_status
  AFTER UPDATE ON service_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_service_status_change();

-- Also notify operator when new service is assigned to them
CREATE OR REPLACE FUNCTION notify_operator_new_assignment()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when operator_id is set for the first time
  IF OLD.operator_id IS NULL AND NEW.operator_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      NEW.operator_id,
      'Nuevo Servicio Asignado',
      'Se te ha asignado un nuevo servicio de grúa.',
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_operator_assignment ON service_requests;
CREATE TRIGGER trigger_notify_operator_assignment
  AFTER UPDATE ON service_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_operator_new_assignment();
