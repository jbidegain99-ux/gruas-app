-- 00033_drain_notification_queue.sql
--
-- Conecta la cola de notificaciones con el que las envía.
--
-- Hasta ahora `notify_service_status_change` (00018) INSERTABA en
-- `notification_queue` y ahí moría todo: nada invocaba nunca la Edge Function
-- `process-notification-queue`, así que ningún push salía jamás.
--
-- Solución: pg_cron dispara cada minuto una función que, si hay pendientes,
-- llama a la Edge Function vía pg_net (HTTP asíncrono, no bloquea el cron).
--
-- Los secretos NO viven en esta migración: se leen de Vault. Hay que
-- registrarlos una vez por entorno (ver `docs/NOTIFICACIONES.md`).

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- =====================================================
-- Función que drena la cola
-- =====================================================
CREATE OR REPLACE FUNCTION public.drain_notification_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
  v_pending integer;
BEGIN
  -- Nada que hacer: evita una petición HTTP por minuto en vacío.
  SELECT count(*) INTO v_pending FROM public.notification_queue WHERE sent = false;
  IF v_pending = 0 THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'edge_functions_url';
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    -- Sin secretos no se puede llamar: se avisa y la cola queda intacta
    -- (se enviará cuando se registren, sin perder nada).
    RAISE WARNING 'drain_notification_queue: faltan los secretos de Vault (edge_functions_url / service_role_key); % notificaciones siguen pendientes', v_pending;
    RETURN;
  END IF;

  -- `apikey` además de `Authorization`: el gateway de Supabase rechaza la
  -- petición con "Missing authorization header" si sólo va el Bearer.
  PERFORM net.http_post(
    url := v_url || '/process-notification-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_key,
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
END;
$$;

-- SECURITY DEFINER: sólo el cron (postgres) debe poder ejecutarla.
REVOKE ALL ON FUNCTION public.drain_notification_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.drain_notification_queue() FROM anon, authenticated;

COMMENT ON FUNCTION public.drain_notification_queue() IS
  'Invoca la Edge Function process-notification-queue si hay notificaciones sin enviar. La agenda pg_cron cada minuto.';

-- =====================================================
-- Agenda (idempotente)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-notification-queue') THEN
    PERFORM cron.unschedule('drain-notification-queue');
  END IF;

  PERFORM cron.schedule(
    'drain-notification-queue',
    '* * * * *',
    $cron$SELECT public.drain_notification_queue();$cron$
  );
END;
$$;
