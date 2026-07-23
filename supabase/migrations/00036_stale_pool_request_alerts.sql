-- Migration: alerta cuando una solicitud lleva demasiado tiempo sin operador
--
-- Problema: si ningun operador acepta, la solicitud queda 'initiated' para
-- siempre y el usuario espera sin ninguna senal. Nadie del lado admin se
-- entera tampoco.
--
-- Solucion: un job de pg_cron (cada minuto, mismo patron que 00033) busca
-- solicitudes 'initiated' cuya ultima actividad (updated_at) tiene mas de
-- 10 minutos y encola notificaciones push:
--   - al USUARIO: "seguimos buscando operador"
--   - a los ADMIN: "solicitud sin atender" (para intervenir con
--     admin_assign_request / assign_nearest_operator desde el panel web)
--
-- Se usa updated_at (no created_at) para que una solicitud liberada al pool
-- por un operador (00035, pone updated_at=NOW()) reinicie su reloj de espera.
-- pool_alerted_at evita re-alertar en cada corrida: solo se alerta si nunca
-- se alerto o si la solicitud volvio a tener actividad despues de la ultima
-- alerta (pool_alerted_at < updated_at). El propio UPDATE de pool_alerted_at
-- bumpea updated_at al MISMO NOW() de la transaccion, por lo que la condicion
-- estricta '<' no re-dispara.

ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pool_alerted_at TIMESTAMPTZ;

COMMENT ON COLUMN service_requests.pool_alerted_at IS
  'Ultima vez que se alerto (usuario+admins) que la solicitud seguia sin operador. NULL = nunca.';

CREATE OR REPLACE FUNCTION public.alert_stale_pool_requests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold CONSTANT INTERVAL := INTERVAL '10 minutes';
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, user_id, updated_at
    FROM service_requests
    WHERE status = 'initiated'
      AND updated_at < NOW() - v_threshold
      AND (pool_alerted_at IS NULL OR pool_alerted_at < updated_at)
  LOOP
    -- Aviso al usuario que sigue esperando
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      r.user_id,
      'Seguimos buscando operador',
      'Tu solicitud esta tardando mas de lo normal. Seguimos buscando un operador disponible; tambien puedes cancelar sin costo si lo prefieres.',
      jsonb_build_object(
        'type', 'stale_request',
        'service_request_id', r.id,
        'role', 'user'
      ),
      NOW()
    );

    -- Aviso a todos los ADMIN para que intervengan (asignacion manual)
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    SELECT
      p.id,
      'Solicitud sin atender',
      'Una solicitud lleva mas de 10 minutos sin que ningun operador la acepte. Revisa el panel para asignarla manualmente.',
      jsonb_build_object(
        'type', 'stale_request',
        'service_request_id', r.id,
        'role', 'admin'
      ),
      NOW()
    FROM profiles p
    WHERE p.role = 'ADMIN';

    UPDATE service_requests SET pool_alerted_at = NOW() WHERE id = r.id;
  END LOOP;
END;
$$;

-- Solo el cron (postgres) debe poder ejecutarla.
REVOKE ALL ON FUNCTION public.alert_stale_pool_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.alert_stale_pool_requests() FROM anon, authenticated;

COMMENT ON FUNCTION public.alert_stale_pool_requests() IS
  'Encola avisos (usuario + admins) para solicitudes initiated con >10 min sin actividad. La agenda pg_cron cada minuto.';

-- Agenda (idempotente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alert-stale-pool-requests') THEN
    PERFORM cron.unschedule('alert-stale-pool-requests');
  END IF;

  PERFORM cron.schedule(
    'alert-stale-pool-requests',
    '* * * * *',
    $cron$SELECT public.alert_stale_pool_requests();$cron$
  );
END;
$$;
