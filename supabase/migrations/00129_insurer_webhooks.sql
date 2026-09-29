-- =====================================================
-- ASE-04 · API y webhooks para aseguradoras (B-28)
--
-- 1. Webhooks de eventos del caso hacia el sistema de la aseguradora:
--      case.created · case.assigned · case.unassigned · case.arrived ·
--      case.completed · case.cancelled  (+ ping de prueba)
--    Firmados con HMAC-SHA256 (cabecera X-Budi-Signature: t=<unix>,v1=<hex>
--    sobre "<t>.<cuerpo>") y con reintentos exponenciales (6 intentos en ~9 h).
--    Salen con pg_net desde la base: la primera entrega va al hacer commit del
--    cambio de estado; el job `process-webhook-deliveries` (cada 30 s) recoge
--    las respuestas y reintenta las fallidas.
--
-- 2. Claves de API desde el portal: el dueño/administrador (con 2FA) crea,
--    revoca y ROTA sus claves. Rotar emite una clave nueva y deja la anterior
--    viva 24 h (`expires_at`) para cambiarla sin cortar la integración.
--
-- Mismo alcance que el portal (00086/00121): un caso le llega a la aseguradora
-- solo si su afiliado lo consumió y el plan cubre ese servicio. El cuerpo no
-- lleva datos del socio operador ni del Usuario más allá de lo que la
-- aseguradora ya tiene (su póliza y el documento de su afiliado).
--
-- SSRF: la URL debe ser https y no apuntar a localhost ni a IPs privadas. En
-- local, para probar contra un receptor en la máquina:
--   ALTER DATABASE postgres SET app.webhooks_allow_local = 'on';
-- (no resuelve DNS: un dominio que resuelva a una IP interna no se detecta
-- aquí; en el managed pg_net sale a internet, no a la red del proyecto).
-- =====================================================

-- ─── 1. Claves con vencimiento (rotación con gracia) ─────────────────────────
ALTER TABLE public.insurer_api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.verify_insurer_api_key(p_key TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_insurer UUID;
BEGIN
  UPDATE insurer_api_keys k
     SET last_used_at = NOW()
   WHERE k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
     AND k.revoked_at IS NULL
     AND (k.expires_at IS NULL OR k.expires_at > NOW())
     AND EXISTS (SELECT 1 FROM insurers i WHERE i.id = k.insurer_id AND i.is_active)
  RETURNING k.insurer_id INTO v_insurer;

  RETURN v_insurer;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_insurer_api_key(TEXT) FROM PUBLIC, anon, authenticated;

-- Núcleo compartido por el admin y el portal: emite y devuelve la clave en claro
-- (única vez). Sin chequeo de permisos: lo hacen los envoltorios.
CREATE OR REPLACE FUNCTION public._issue_insurer_api_key(p_insurer UUID, p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key TEXT := 'budi_' || translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_id  UUID;
BEGIN
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Ponle un nombre a la clave (p. ej. el sistema que la usará)';
  END IF;
  INSERT INTO insurer_api_keys (insurer_id, name, key_hash, key_prefix, created_by)
  VALUES (p_insurer, btrim(p_name), encode(extensions.digest(v_key, 'sha256'), 'hex'), left(v_key, 12), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'key', v_key, 'key_prefix', left(v_key, 12));
END;
$$;
REVOKE ALL ON FUNCTION public._issue_insurer_api_key(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ─── 2. Webhooks y entregas ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.webhook_event_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['case.created', 'case.assigned', 'case.unassigned', 'case.arrived', 'case.completed', 'case.cancelled'];
$$;
GRANT EXECUTE ON FUNCTION public.webhook_event_types() TO authenticated;

CREATE TABLE IF NOT EXISTS public.insurer_webhooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id  UUID NOT NULL REFERENCES public.insurers(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  description TEXT,
  events      TEXT[] NOT NULL,
  -- En claro: hace falta para firmar. Ningún rol de la API lee esta tabla; se
  -- entrega una sola vez al crearlo o rotarlo.
  secret      TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT insurer_webhooks_events_ok CHECK (cardinality(events) > 0 AND events <@ webhook_event_types())
);
CREATE INDEX IF NOT EXISTS insurer_webhooks_insurer_idx ON public.insurer_webhooks (insurer_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id       UUID NOT NULL REFERENCES public.insurer_webhooks(id) ON DELETE CASCADE,
  event            TEXT NOT NULL,
  folio            TEXT,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'sending', 'delivered', 'failed')),
  attempts         INT NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  net_request_id   BIGINT,
  sent_at          TIMESTAMPTZ,
  last_status_code INT,
  last_error       TEXT,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON public.webhook_deliveries (next_attempt_at) WHERE status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_idx
  ON public.webhook_deliveries (webhook_id, created_at DESC);

-- Solo por RPC. RLS sin políticas = nadie lee por PostgREST, ni el admin.
ALTER TABLE public.insurer_webhooks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.insurer_webhooks, public.webhook_deliveries FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit ON public.insurer_webhooks;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.insurer_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('secret');

COMMENT ON TABLE public.insurer_webhooks IS
  'ASE-04: endpoints de la aseguradora que reciben eventos del caso, firmados con HMAC-SHA256 (secret).';
COMMENT ON TABLE public.webhook_deliveries IS
  'ASE-04: cada evento por endpoint, con reintentos. Se purgan a los 30 días.';

-- ¿La URL es aceptable? https y ni localhost ni IP privada/reservada, salvo que
-- la base permita destinos locales (solo en desarrollo).
CREATE OR REPLACE FUNCTION public.webhook_url_ok(p_url TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_host TEXT;
  v_ip   INET;
BEGIN
  IF p_url IS NULL OR length(p_url) > 2000 THEN
    RETURN false;
  END IF;
  IF COALESCE(current_setting('app.webhooks_allow_local', true), '') = 'on' THEN
    RETURN p_url ~* '^https?://[^\s/]+';
  END IF;
  IF p_url !~* '^https://[^\s/?#@]+(/[^\s]*)?$' THEN
    RETURN false;
  END IF;
  v_host := lower(substring(p_url FROM '^https://([^/:?#]+)'));
  IF v_host IS NULL OR v_host IN ('localhost', 'host.docker.internal', 'kong', 'db', 'metadata.google.internal')
     OR v_host LIKE '%.localhost' OR v_host LIKE '%.internal' OR v_host LIKE '%.local' OR v_host !~ '\.' THEN
    RETURN false;
  END IF;
  -- IP literal: solo si es pública.
  IF v_host ~ '^[0-9.]+$' OR v_host ~ '^\[' THEN
    BEGIN
      v_ip := trim(both '[]' FROM v_host)::inet;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
    IF v_ip << '10.0.0.0/8' OR v_ip << '172.16.0.0/12' OR v_ip << '192.168.0.0/16'
       OR v_ip << '127.0.0.0/8' OR v_ip << '169.254.0.0/16' OR v_ip << '100.64.0.0/10'
       OR v_ip << '0.0.0.0/8' OR family(v_ip) = 6 THEN
      RETURN false;
    END IF;
  END IF;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.webhook_url_ok(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public._new_webhook_secret()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public, extensions
AS $$
  SELECT 'whsec_' || translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
$$;
REVOKE ALL ON FUNCTION public._new_webhook_secret() FROM PUBLIC, anon, authenticated;

-- ─── 3. Envío ────────────────────────────────────────────────────────────────
-- Firma y encola una entrega en pg_net. pg_net manda `payload::text` tal cual,
-- que es exactamente lo que se firma.
CREATE OR REPLACE FUNCTION public._webhook_send(p_delivery UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  d   RECORD;
  v_t TEXT := extract(epoch FROM clock_timestamp())::bigint::text;
  v_req BIGINT;
BEGIN
  SELECT wd.id, wd.event, wd.payload, w.url, w.secret, w.is_active
    INTO d
    FROM webhook_deliveries wd JOIN insurer_webhooks w ON w.id = wd.webhook_id
   WHERE wd.id = p_delivery;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT d.is_active OR NOT webhook_url_ok(d.url) THEN
    UPDATE webhook_deliveries
       SET status = 'failed', last_error = CASE WHEN d.is_active THEN 'URL no permitida' ELSE 'Webhook desactivado' END
     WHERE id = p_delivery;
    RETURN;
  END IF;

  v_req := net.http_post(
    url := d.url,
    body := d.payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'User-Agent', 'Budi-Webhooks/1.0',
      'X-Budi-Event', d.event,
      'X-Budi-Delivery', d.id::text,
      'X-Budi-Signature', 't=' || v_t || ',v1=' ||
        encode(extensions.hmac(v_t || '.' || d.payload::text, d.secret, 'sha256'), 'hex')),
    timeout_milliseconds := 10000
  );

  UPDATE webhook_deliveries
     SET status = 'sending', net_request_id = v_req, sent_at = now(), attempts = attempts + 1
   WHERE id = p_delivery;
END;
$$;
REVOKE ALL ON FUNCTION public._webhook_send(UUID) FROM PUBLIC, anon, authenticated;

-- Crea la entrega (con su id dentro del cuerpo) y la manda.
CREATE OR REPLACE FUNCTION public._webhook_enqueue(p_webhook UUID, p_event TEXT, p_folio TEXT, p_data JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO webhook_deliveries (id, webhook_id, event, folio, payload)
  VALUES (v_id, p_webhook, p_event, p_folio,
          jsonb_build_object('id', v_id, 'type', p_event, 'created_at', now(), 'data', p_data));
  PERFORM _webhook_send(v_id);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._webhook_enqueue(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- Lo que viaja de un caso. Mismo contenido que la aseguradora ve en su portal.
CREATE OR REPLACE FUNCTION public._webhook_case_data(p_request UUID, p_insurer UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'folio', c.folio,
    'status', sr.status::text,
    'service_type', COALESCE(sr.service_type, 'tow'),
    'zone', sv_department(sr.pickup_lat, sr.pickup_lng),
    'requested_at', sr.created_at,
    'assigned_at', sr.assigned_at,
    'arrived_at', sr.activated_at,
    'completed_at', sr.completed_at,
    'cancelled_at', sr.cancelled_at,
    'policy_number', po.policy_number,
    'member_document', m.document_number,
    'coverage', jsonb_build_object('status', sr.coverage_status,
                                   'covered', cu.amount_covered, 'copay', cu.amount_copay),
    'total_price', sr.total_price)
    FROM service_requests sr
    LEFT JOIN cases c ON c.request_id = sr.id
    JOIN coverage_usage cu ON cu.request_id = sr.id
    JOIN members m   ON m.id = cu.member_id
    JOIN policies po ON po.id = m.policy_id AND po.insurer_id = p_insurer
   WHERE sr.id = p_request
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._webhook_case_data(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ─── 4. Disparador: cambio de estado → evento ───────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_case_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event TEXT;
  v_folio TEXT;
  r RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := 'case.created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_event := CASE NEW.status::text
      WHEN 'assigned'  THEN 'case.assigned'
      WHEN 'initiated' THEN 'case.unassigned'   -- el socio soltó el servicio (00035)
      WHEN 'active'    THEN 'case.arrived'      -- PIN verificado = llegó
      WHEN 'completed' THEN 'case.completed'
      WHEN 'cancelled' THEN 'case.cancelled'
    END;
  END IF;
  IF v_event IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT folio INTO v_folio FROM cases WHERE request_id = NEW.id;

  FOR r IN
    SELECT DISTINCT w.id, po.insurer_id
      FROM coverage_usage cu
      JOIN members m   ON m.id = cu.member_id
      JOIN policies po ON po.id = m.policy_id
      JOIN insurers i  ON i.id = po.insurer_id AND i.is_active
      JOIN insurer_webhooks w ON w.insurer_id = po.insurer_id AND w.is_active AND v_event = ANY (w.events)
     WHERE cu.request_id = NEW.id
       AND plan_cubre_servicio(po.plan_id, NEW.service_type)
  LOOP
    PERFORM _webhook_enqueue(r.id, v_event, v_folio, _webhook_case_data(NEW.id, r.insurer_id));
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Un webhook no puede tumbar la solicitud del Usuario.
  RAISE WARNING 'enqueue_case_webhooks: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_case_webhooks() FROM PUBLIC, anon, authenticated;

-- Diferido: la cobertura (coverage_usage) y el folio se escriben después del
-- INSERT, en la misma transacción.
DROP TRIGGER IF EXISTS trg_enqueue_case_webhooks ON public.service_requests;
CREATE CONSTRAINT TRIGGER trg_enqueue_case_webhooks
  AFTER INSERT OR UPDATE OF status ON public.service_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_case_webhooks();

-- ─── 5. Job: respuestas, reintentos y purga ─────────────────────────────────
-- Reintentos tras el intento n: 1 min, 5 min, 30 min, 2 h, 6 h. Al 6.º, falla.
CREATE OR REPLACE FUNCTION public.process_webhook_deliveries()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_delivered INT := 0;
  v_retried INT := 0;
  v_sent INT := 0;
  v_backoff INTERVAL[] := ARRAY['1 minute', '5 minutes', '30 minutes', '2 hours', '6 hours']::interval[];
BEGIN
  -- a) Resultado de lo que está en vuelo.
  FOR r IN
    SELECT d.id, d.attempts, d.sent_at, h.status_code, h.error_msg, h.timed_out, (h.id IS NOT NULL) AS answered
      FROM webhook_deliveries d
      LEFT JOIN net._http_response h ON h.id = d.net_request_id
     WHERE d.status = 'sending'
     FOR UPDATE OF d SKIP LOCKED
  LOOP
    IF r.answered AND r.status_code BETWEEN 200 AND 299 THEN
      UPDATE webhook_deliveries
         SET status = 'delivered', delivered_at = now(), last_status_code = r.status_code, last_error = NULL
       WHERE id = r.id;
      v_delivered := v_delivered + 1;
    ELSIF r.answered OR r.sent_at < now() - interval '2 minutes' THEN
      UPDATE webhook_deliveries
         SET status = CASE WHEN r.attempts >= 6 THEN 'failed' ELSE 'pending' END,
             next_attempt_at = now() + v_backoff[LEAST(r.attempts, 5)],
             last_status_code = r.status_code,
             last_error = CASE
               WHEN NOT r.answered THEN 'Sin respuesta'
               WHEN r.timed_out THEN 'Tiempo de espera agotado (10 s)'
               WHEN r.status_code IS NULL THEN left(COALESCE(r.error_msg, 'Error de conexión'), 300)
               ELSE 'HTTP ' || r.status_code END
       WHERE id = r.id;
      v_retried := v_retried + 1;
    END IF;
  END LOOP;

  -- b) Reintentos que ya tocan.
  FOR r IN
    SELECT id FROM webhook_deliveries
     WHERE status = 'pending' AND next_attempt_at <= now()
     ORDER BY next_attempt_at LIMIT 200
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM _webhook_send(r.id);
    v_sent := v_sent + 1;
  END LOOP;

  -- c) Historial de 30 días.
  DELETE FROM webhook_deliveries
   WHERE status IN ('delivered', 'failed') AND created_at < now() - interval '30 days';

  RETURN jsonb_build_object('delivered', v_delivered, 'retry_scheduled', v_retried, 'sent', v_sent);
END;
$$;
REVOKE ALL ON FUNCTION public.process_webhook_deliveries() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('process-webhook-deliveries')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-webhook-deliveries');
  PERFORM cron.schedule('process-webhook-deliveries', '30 seconds', 'SELECT public.process_webhook_deliveries()');
END $$;

-- ─── 6. Portal: integraciones (dueño y administrador, con 2FA) ──────────────
CREATE OR REPLACE FUNCTION public.portal_integrations()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ins UUID := require_insurer_role(ARRAY['owner', 'admin']);
BEGIN
  RETURN jsonb_build_object(
    'events', to_jsonb(webhook_event_types()),
    'api_keys', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', k.id, 'name', k.name, 'key_prefix', k.key_prefix, 'created_at', k.created_at,
        'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at, 'expires_at', k.expires_at)
        ORDER BY (k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())) DESC, k.created_at DESC)
      FROM insurer_api_keys k WHERE k.insurer_id = v_ins), '[]'::jsonb),
    'webhooks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', w.id, 'url', w.url, 'description', w.description, 'events', to_jsonb(w.events),
        'is_active', w.is_active, 'created_at', w.created_at,
        'delivered_24h', (SELECT count(*) FROM webhook_deliveries d
                           WHERE d.webhook_id = w.id AND d.status = 'delivered' AND d.created_at > now() - interval '24 hours'),
        'failing', (SELECT count(*) FROM webhook_deliveries d
                     WHERE d.webhook_id = w.id AND (d.status = 'failed' OR (d.status = 'pending' AND d.attempts > 0))
                       AND d.created_at > now() - interval '24 hours'))
        ORDER BY w.created_at) FROM insurer_webhooks w WHERE w.insurer_id = v_ins), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_create_api_key(p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ins UUID := require_insurer_role(ARRAY['owner', 'admin']);
BEGIN
  IF (SELECT count(*) FROM insurer_api_keys
       WHERE insurer_id = v_ins AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) >= 10 THEN
    RAISE EXCEPTION 'Tienes 10 claves activas: revoca alguna antes de crear otra';
  END IF;
  RETURN _issue_insurer_api_key(v_ins, p_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_revoke_api_key(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ins UUID := require_insurer_role(ARRAY['owner', 'admin']);
BEGIN
  UPDATE insurer_api_keys SET revoked_at = now()
   WHERE id = p_id AND insurer_id = v_ins AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clave no encontrada o ya revocada';
  END IF;
END;
$$;

-- Rotar: clave nueva con el mismo nombre; la anterior sigue viva p_grace_hours
-- (0 = se corta ya, p. ej. si se filtró).
CREATE OR REPLACE FUNCTION public.portal_rotate_api_key(p_id UUID, p_grace_hours INT DEFAULT 24)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins  UUID := require_insurer_role(ARRAY['owner', 'admin']);
  v_name TEXT;
BEGIN
  IF p_grace_hours IS NULL OR p_grace_hours < 0 OR p_grace_hours > 168 THEN
    RAISE EXCEPTION 'La gracia va de 0 a 168 horas';
  END IF;
  UPDATE insurer_api_keys
     SET expires_at = LEAST(COALESCE(expires_at, 'infinity'), now() + make_interval(hours => p_grace_hours)),
         revoked_at = CASE WHEN p_grace_hours = 0 THEN now() END
   WHERE id = p_id AND insurer_id = v_ins AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
  RETURNING name INTO v_name;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Clave no encontrada o ya inactiva';
  END IF;
  RETURN _issue_insurer_api_key(v_ins, v_name);
END;
$$;

-- Crear (p_id NULL, devuelve el secreto una vez) o editar un webhook.
CREATE OR REPLACE FUNCTION public.portal_save_webhook(p_id UUID, p_url TEXT, p_events TEXT[], p_description TEXT, p_is_active BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins    UUID := require_insurer_role(ARRAY['owner', 'admin']);
  v_url    TEXT := btrim(COALESCE(p_url, ''));
  v_secret TEXT;
  v_id     UUID;
BEGIN
  IF NOT webhook_url_ok(v_url) THEN
    RAISE EXCEPTION 'La URL debe ser https y pública (no localhost ni una IP privada)';
  END IF;
  IF p_events IS NULL OR cardinality(p_events) = 0 OR NOT (p_events <@ webhook_event_types()) THEN
    RAISE EXCEPTION 'Elige al menos un evento válido';
  END IF;

  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM insurer_webhooks WHERE insurer_id = v_ins) >= 5 THEN
      RAISE EXCEPTION 'Máximo 5 webhooks por aseguradora';
    END IF;
    v_secret := _new_webhook_secret();
    INSERT INTO insurer_webhooks (insurer_id, url, description, events, secret, is_active, created_by)
    VALUES (v_ins, v_url, NULLIF(btrim(COALESCE(p_description, '')), ''), p_events, v_secret,
            COALESCE(p_is_active, true), auth.uid())
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id, 'secret', v_secret);
  END IF;

  UPDATE insurer_webhooks
     SET url = v_url, description = NULLIF(btrim(COALESCE(p_description, '')), ''), events = p_events,
         is_active = COALESCE(p_is_active, is_active), updated_at = now()
   WHERE id = p_id AND insurer_id = v_ins
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Webhook no encontrado';
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_rotate_webhook_secret(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins    UUID := require_insurer_role(ARRAY['owner', 'admin']);
  v_secret TEXT := _new_webhook_secret();
BEGIN
  UPDATE insurer_webhooks SET secret = v_secret, updated_at = now()
   WHERE id = p_id AND insurer_id = v_ins;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Webhook no encontrado';
  END IF;
  RETURN jsonb_build_object('secret', v_secret);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_delete_webhook(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ins UUID := require_insurer_role(ARRAY['owner', 'admin']);
BEGIN
  DELETE FROM insurer_webhooks WHERE id = p_id AND insurer_id = v_ins;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Webhook no encontrado';
  END IF;
END;
$$;

-- Evento de prueba con datos ficticios.
CREATE OR REPLACE FUNCTION public.portal_test_webhook(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ins UUID := require_insurer_role(ARRAY['owner', 'admin']);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM insurer_webhooks WHERE id = p_id AND insurer_id = v_ins) THEN
    RAISE EXCEPTION 'Webhook no encontrado';
  END IF;
  IF (SELECT count(*) FROM webhook_deliveries
       WHERE webhook_id = p_id AND event = 'ping' AND created_at > now() - interval '1 minute') >= 5 THEN
    RAISE EXCEPTION 'Espera un minuto antes de otra prueba';
  END IF;
  RETURN _webhook_enqueue(p_id, 'ping', 'BUDI-000000', jsonb_build_object(
    'folio', 'BUDI-000000', 'status', 'assigned', 'service_type', 'tow', 'zone', 'San Salvador',
    'requested_at', now() - interval '5 minutes', 'assigned_at', now(),
    'arrived_at', NULL, 'completed_at', NULL, 'cancelled_at', NULL,
    'policy_number', 'POL-PRUEBA', 'member_document', '000000000',
    'coverage', jsonb_build_object('status', 'covered', 'covered', 50, 'copay', 0),
    'total_price', 50, 'test', true));
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_webhook_deliveries(p_webhook UUID, p_limit INT DEFAULT 50)
RETURNS TABLE (id UUID, event TEXT, folio TEXT, status TEXT, attempts INT, next_attempt_at TIMESTAMPTZ,
               last_status_code INT, last_error TEXT, created_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, payload JSONB)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ins UUID := require_insurer_role(ARRAY['owner', 'admin']);
BEGIN
  RETURN QUERY
  SELECT d.id, d.event, d.folio, d.status, d.attempts, d.next_attempt_at, d.last_status_code, d.last_error,
         d.created_at, d.delivered_at, d.payload
    FROM webhook_deliveries d JOIN insurer_webhooks w ON w.id = d.webhook_id
   WHERE d.webhook_id = p_webhook AND w.insurer_id = v_ins
   ORDER BY d.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

-- Reenviar una entrega (fallida o no): vuelve a la cola con intentos en cero.
CREATE OR REPLACE FUNCTION public.portal_redeliver_webhook(p_delivery UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ins UUID := require_insurer_role(ARRAY['owner', 'admin']);
BEGIN
  UPDATE webhook_deliveries d
     SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL
    FROM insurer_webhooks w
   WHERE d.id = p_delivery AND w.id = d.webhook_id AND w.insurer_id = v_ins
     AND d.status IN ('delivered', 'failed');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrega no encontrada o todavía en curso';
  END IF;
  PERFORM _webhook_send(p_delivery);
END;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'portal_integrations()', 'portal_create_api_key(text)', 'portal_revoke_api_key(uuid)',
    'portal_rotate_api_key(uuid,integer)',
    'portal_save_webhook(uuid,text,text[],text,boolean)', 'portal_rotate_webhook_secret(uuid)',
    'portal_delete_webhook(uuid)', 'portal_test_webhook(uuid)', 'portal_webhook_deliveries(uuid,integer)',
    'portal_redeliver_webhook(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
