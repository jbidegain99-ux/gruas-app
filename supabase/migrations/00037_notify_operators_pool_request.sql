-- Migration: avisar a los operadores DISPONIBLES cuando una solicitud entra al pool
--
-- Problema: hoy solo se notifica a un operador cuando se le ASIGNA
-- (notify_operator_new_assignment, 00018, AFTER UPDATE con operator_id NULL->no
-- NULL). Las solicitudes que caen al pool (nuevas via create_service_request, o
-- liberadas por un operador via 00035) no notifican a nadie: dependen de que el
-- operador tenga la app abierta mirando la lista. Eso hace lento el primer
-- "aceptar".
--
-- Solucion: un trigger AFTER INSERT OR UPDATE que, cuando la solicitud ENTRA al
-- estado de pool (status='initiated' AND operator_id IS NULL), encola una push
-- a cada operador disponible. Downstream ya existe: pg_cron (00033) -> Edge
-- Function process-notification-queue -> device_tokens -> Expo.
--
-- "Disponible" replica el criterio de assign_nearest_operator (00031):
--   role='OPERATOR', verification_status='approved', is_online=true,
--   operator_locations.updated_at > NOW()-5min, y SIN servicio activo.
-- Ademas se excluye al operador que acaba de soltar ESTA solicitud (evento
-- OPERATOR_CANCELLED en request_events, mismo criterio que
-- get_available_requests_for_operator en 00035) para no re-ofrecersela.

CREATE OR REPLACE FUNCTION public.notify_operators_pool_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo cuando la solicitud esta (o acaba de quedar) en el pool.
  IF NEW.status <> 'initiated' OR NEW.operator_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- En UPDATE, solo al ENTRAR a 'initiated' (evita re-notificar en cada
  -- UPDATE mientras sigue initiated, p.ej. el sello de pool_alerted_at de 00036).
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'initiated' THEN
    RETURN NEW;
  END IF;

  INSERT INTO notification_queue (user_id, title, body, data, created_at)
  SELECT
    ol.operator_id,
    'Nueva solicitud disponible',
    'Hay una nueva solicitud de servicio cerca. Abre la app para aceptarla.',
    jsonb_build_object(
      'type', 'new_pool_request',
      'service_request_id', NEW.id,
      'role', 'operator'
    ),
    NOW()
  FROM operator_locations ol
  JOIN profiles p
    ON p.id = ol.operator_id
   AND p.role = 'OPERATOR'
   AND p.verification_status = 'approved'
  WHERE ol.is_online = true
    AND ol.updated_at > NOW() - INTERVAL '5 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.operator_id = ol.operator_id
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
    AND NOT EXISTS (
      SELECT 1 FROM request_events re
      WHERE re.request_id = NEW.id
        AND re.actor_id = ol.operator_id
        AND re.event_type = 'OPERATOR_CANCELLED'
    );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_operators_pool_request() IS
  'Encola push a operadores disponibles cuando una solicitud entra al pool (initiated, sin operador). Cubre solicitudes nuevas y liberadas (00035).';

DROP TRIGGER IF EXISTS trigger_notify_operators_pool_request ON service_requests;
CREATE TRIGGER trigger_notify_operators_pool_request
  AFTER INSERT OR UPDATE ON service_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_operators_pool_request();
