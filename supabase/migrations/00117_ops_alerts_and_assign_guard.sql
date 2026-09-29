-- 00117: alertas operativas para el equipo y asignación solo a socios aprobados
-- (backlog LAN-03 y hallazgos del runbook de operación, LAN-04)
--
-- 1. `admin_assign_request` dejaba asignar a cualquier OPERATOR: suspendido
--    (documento vencido), rechazado o sin revisar. El pool ya los excluye; la
--    asignación manual era el atajo. Que el socio no declare el servicio
--    sigue permitido (con aviso en el panel): es la salida de emergencia.
--
-- 2. `alert_stale_pool_requests` avisaba solo a los ADMIN por push, pero el
--    personal no usa la app móvil (solo admite Usuario y Socio operador): la
--    alerta no le llegaba a nadie. Ahora:
--      a) `staff_ops_alerts()` resume lo que necesita atención ya, para el
--         aviso fijo del panel (ADMIN y SUPPORT);
--      b) `notify_ops()` publica en un webhook del equipo (Slack, Teams,
--         Google Chat...) si existe el secreto de Vault `ops_alert_webhook_url`.
--         Sin el secreto no hace nada: es opcional.

-- ─── 1. Asignación manual ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_assign_request(p_request_id uuid, p_operator_id uuid)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
  v_operator profiles;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de Budi puede asignar solicitudes';
  END IF;

  SELECT * INTO v_operator FROM profiles WHERE id = p_operator_id;

  IF v_operator.id IS NULL OR v_operator.role <> 'OPERATOR' THEN
    RAISE EXCEPTION 'Ese usuario no es un socio operador';
  END IF;

  -- 00117: el mismo filtro que el pool. Un socio suspendido (documento
  -- vencido), rechazado o sin revisar no recibe servicios.
  IF v_operator.verification_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Ese socio operador no está aprobado (estado: %). Revisa Verificaciones antes de asignarle servicios.',
      COALESCE(v_operator.verification_status, 'sin estado');
  END IF;

  -- 00098: ni el equipo cruza la flota del MOPT con la privada.
  IF NOT operator_fits_program(
       p_operator_id,
       (SELECT mopt_provider_id FROM service_requests WHERE id = p_request_id)) THEN
    RAISE EXCEPTION 'Ese socio operador no pertenece al programa de este servicio';
  END IF;

  -- 00112: testigo del guardián de estados (00059).
  PERFORM set_config('app.sr_rpc', p_request_id::text, true);

  -- Se permite reasignar mientras la solicitud no esté activada, completada o
  -- cancelada (una vez activa hay un PIN verificado en curso).
  UPDATE service_requests
  SET
    operator_id = p_operator_id,
    provider_id = v_operator.provider_id,
    status = 'assigned',
    assigned_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id
    AND status IN ('initiated', 'assigned', 'en_route')
  RETURNING * INTO v_request;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'La solicitud no existe o ya no se puede asignar';
  END IF;

  RETURN v_request;
END;
$function$;

-- ─── 2a. Webhook del equipo ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_ops(p_text TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'ops_alert_webhook_url';
  IF v_url IS NULL OR v_url = '' THEN
    RETURN;
  END IF;
  -- `text` lo entienden Slack, Google Chat y Mattermost; `content`, Discord.
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('text', p_text, 'content', p_text),
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  -- Un webhook caído no debe frenar el job que avisa.
  RAISE WARNING 'notify_ops: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_ops(TEXT) FROM PUBLIC, anon, authenticated;

-- ─── 2b. Pool estancado: Usuario, equipo (push + webhook) ───────────────────
CREATE OR REPLACE FUNCTION public.alert_stale_pool_requests()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_threshold CONSTANT INTERVAL := INTERVAL '10 minutes';
  r RECORD;
BEGIN
  FOR r IN
    SELECT sr.id, sr.user_id, sr.updated_at, sr.service_type,
           c.folio
    FROM service_requests sr
    LEFT JOIN cases c ON c.request_id = sr.id
    WHERE sr.status = 'initiated'
      AND sr.updated_at < NOW() - v_threshold
      AND (sr.pool_alerted_at IS NULL OR sr.pool_alerted_at < sr.updated_at)
  LOOP
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      r.user_id,
      'Seguimos buscando un socio operador',
      'Tu solicitud está tardando más de lo normal. Seguimos buscando un socio operador disponible; también puedes cancelar sin costo si lo prefieres.',
      jsonb_build_object('type', 'stale_request', 'service_request_id', r.id, 'role', 'user'),
      NOW()
    );

    -- Push al equipo (ADMIN y SUPPORT). Llega a quien tenga un dispositivo
    -- registrado; el aviso fijo del panel (staff_ops_alerts) y el webhook no
    -- dependen de eso.
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    SELECT p.id,
      'Solicitud sin atender',
      'Una solicitud lleva más de 10 minutos sin que ningún socio operador la acepte. Revisa el panel para asignarla manualmente.',
      jsonb_build_object('type', 'stale_request', 'service_request_id', r.id, 'role', 'admin'),
      NOW()
    FROM profiles p
    WHERE p.role IN ('ADMIN', 'SUPPORT')
      AND EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = p.id);

    -- Sin datos personales en el canal del equipo: solo folio y servicio.
    PERFORM notify_ops(format(
      '⚠️ Budi: %s (%s) lleva más de 10 min sin socio operador. Asígnalo desde el panel: /admin/requests',
      COALESCE(r.folio, 'una solicitud'),
      COALESCE(r.service_type, 'tow')
    ));

    UPDATE service_requests SET pool_alerted_at = NOW() WHERE id = r.id;
  END LOOP;
END;
$function$;

-- ─── 2c. Resumen para el aviso fijo del panel ───────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_ops_alerts()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v JSONB;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de Budi';
  END IF;

  SELECT jsonb_build_object(
    -- Nadie la aceptó en 10 min: hay que asignarla a mano.
    'stale_pool', (SELECT count(*) FROM service_requests
                    WHERE status = 'initiated' AND created_at < now() - interval '10 minutes'),
    'oldest_pool_minutes', (SELECT floor(extract(epoch FROM now() - min(created_at)) / 60)::int
                              FROM service_requests
                             WHERE status = 'initiated' AND created_at < now() - interval '10 minutes'),
    -- Asignada hace más de 45 min (objetivo de llegada por defecto) y sin PIN.
    'late_arrivals', (SELECT count(*) FROM service_requests
                       WHERE status IN ('assigned', 'en_route')
                         AND assigned_at < now() - interval '45 minutes'),
    -- Socios que enviaron su registro y esperan revisión.
    'pending_verifications', (SELECT count(*) FROM profiles
                               WHERE role = 'OPERATOR' AND verification_status = 'pending'
                                 AND verification_submitted_at IS NOT NULL),
    -- Push que no salen: la cola no se está drenando.
    'stuck_notifications', (SELECT count(*) FROM notification_queue
                             WHERE NOT sent AND error IS NULL AND created_at < now() - interval '10 minutes'),
    -- Jobs programados que fallaron en la última hora (solo ADMIN: es técnico).
    'failed_jobs', CASE WHEN is_admin() THEN
                     (SELECT count(*) FROM cron.job_run_details
                       WHERE status = 'failed' AND start_time > now() - interval '1 hour')
                   END,
    'checked_at', now()
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_ops_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_ops_alerts() TO authenticated;

-- ─── 3. Tuteo que quedó en la 00114 ─────────────────────────────────────────
DO $$
DECLARE v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.anonymize_account(uuid)'::regprocedure) INTO v_def;
  IF position('Pedi la baja' IN v_def) > 0 THEN
    EXECUTE replace(v_def, 'Pedi la baja a soporte.', 'Pide la baja a soporte.');
  END IF;
END $$;
