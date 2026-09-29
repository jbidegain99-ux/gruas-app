-- 00120: lo que le faltaba a la operación según el runbook (docs/RUNBOOK_OPERACION.md §9)
--
-- 1. PIN perdido: el PIN de confirmación vive solo en el teléfono del
--    Usuario. Si reinstaló la app o cambió de teléfono, no había forma de
--    iniciar el servicio. Ahora el Usuario (y solo él) genera uno nuevo, hasta
--    3 veces por servicio. Nadie de Budi lo ve nunca.
-- 2. PIN bloqueado: tras 5 intentos fallidos el socio espera 15 min. Soporte
--    puede desbloquearlo cuando confirmó por teléfono que el Usuario está ahí.
--    Los intentos borrados quedan contados en el evento.
-- 3. Notas internas por solicitud: llamadas, incidentes, acuerdos. Solo el
--    personal las ve; no salen en la línea de tiempo (que ve la aseguradora).
--    No se editan ni se borran: son el registro de lo que se hizo.
-- 4. Soporte ve el chat y el recorrido GPS de un servicio (disputas,
--    incidentes, "el socio no llega"). Antes solo ADMIN.
-- 5. Restablecer el 2FA de una persona que perdió su teléfono (solo ADMIN,
--    queda en la bitácora y cierra sus sesiones).
--
-- El cargo por cancelación tardía NO está acá: es una decisión de negocio
-- (monto, desde qué estado) y necesita pasarela de pago.

-- ─── 1. PIN nuevo, por el propio Usuario ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.regenerate_my_request_pin(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_req  service_requests;
  v_used INTEGER;
  v_pin  TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_request_id::text));

  SELECT * INTO v_req FROM service_requests WHERE id = p_request_id;
  IF v_req.id IS NULL OR v_req.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  IF v_req.status NOT IN ('initiated', 'assigned', 'en_route') THEN
    RAISE EXCEPTION 'Este servicio ya no necesita PIN de confirmación';
  END IF;

  SELECT count(*) INTO v_used FROM request_events
   WHERE request_id = p_request_id AND event_type = 'PIN_REGENERATED';
  IF v_used >= 3 THEN
    RAISE EXCEPTION 'Ya generaste 3 PIN nuevos para este servicio. Escríbenos a soporte.';
  END IF;

  v_pin := generate_secure_pin();

  -- Testigo del guardián de estados (00059): el cambio viene de una RPC.
  PERFORM set_config('app.sr_rpc', p_request_id::text, true);
  UPDATE service_requests SET pin_hash = hash_pin(v_pin), updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (p_request_id, auth.uid(), 'USER', 'PIN_REGENERATED', jsonb_build_object('count', v_used + 1));

  -- El socio que ya viene en camino tiene que saber que el PIN cambió.
  IF v_req.operator_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (v_req.operator_id, 'El PIN de confirmación cambió',
            'El Usuario generó un PIN nuevo. Pídeselo al llegar; el anterior ya no sirve.',
            jsonb_build_object('type', 'pin_regenerated', 'service_request_id', p_request_id, 'role', 'operator'),
            now());
  END IF;

  RETURN jsonb_build_object('pin', v_pin, 'remaining', 3 - (v_used + 1));
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_my_request_pin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_my_request_pin(UUID) TO authenticated;

-- ─── 2. Estado y desbloqueo del PIN, para el personal ───────────────────────
CREATE OR REPLACE FUNCTION public.staff_pin_status(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fail INTEGER;
  v_last TIMESTAMPTZ;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de Budi';
  END IF;
  -- La misma ventana que verify_request_pin (00054): 5 fallos en 15 min.
  SELECT count(*), max(attempted_at) INTO v_fail, v_last
    FROM pin_attempts
   WHERE request_id = p_request_id AND NOT success
     AND attempted_at > now() - interval '15 minutes';
  RETURN jsonb_build_object(
    'recent_failures', v_fail,
    'locked', v_fail >= 5,
    'unlocks_at', CASE WHEN v_fail >= 5 THEN v_last + interval '15 minutes' END,
    'regenerated', (SELECT count(*) FROM request_events
                     WHERE request_id = p_request_id AND event_type = 'PIN_REGENERATED')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_reset_pin_lockout(p_request_id UUID, p_note TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_note    TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_cleared INTEGER;
  v_role    TEXT;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de Budi';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'Anota qué confirmaste antes de desbloquear (por ejemplo: "hablé con el Usuario, está con el socio")';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM service_requests WHERE id = p_request_id
                  AND status IN ('assigned', 'en_route')) THEN
    RAISE EXCEPTION 'Solo se desbloquea el PIN de un servicio asignado o en camino';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_request_id::text));
  DELETE FROM pin_attempts
   WHERE request_id = p_request_id AND NOT success
     AND attempted_at > now() - interval '15 minutes';
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  SELECT role::text INTO v_role FROM profiles WHERE id = auth.uid();
  -- `note`, no `reason`: la línea de tiempo muestra `reason` y la ve la
  -- aseguradora; la nota del personal es interna.
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (p_request_id, auth.uid(), v_role::user_role, 'PIN_LOCKOUT_RESET',
          jsonb_build_object('cleared_failures', v_cleared, 'note', v_note));
  RETURN v_cleared;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_pin_status(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_reset_pin_lockout(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_pin_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_reset_pin_lockout(UUID, TEXT) TO authenticated;

-- Etiquetas de la línea de tiempo para los dos eventos nuevos.
DO $$
DECLARE v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.get_case_timeline(text)'::regprocedure) INTO v_def;
  IF position('PIN_REGENERATED' IN v_def) = 0 THEN
    v_def := replace(v_def,
      $a$      WHEN 'ADMIN_CANCELLED'      THEN 'Cancelado por Budi (soporte o administración)'$a$,
      $b$      WHEN 'ADMIN_CANCELLED'      THEN 'Cancelado por Budi (soporte o administración)'
      WHEN 'PIN_REGENERATED'      THEN 'El Usuario generó un PIN de confirmación nuevo'
      WHEN 'PIN_LOCKOUT_RESET'    THEN 'Budi desbloqueó el PIN de confirmación'$b$);
    v_def := replace(v_def,
      $a$      WHEN 'PIN_VERIFIED'          THEN 5$a$,
      $b$      WHEN 'PIN_REGENERATED'       THEN 4
      WHEN 'PIN_LOCKOUT_RESET'     THEN 4
      WHEN 'PIN_VERIFIED'          THEN 5$b$);
    IF position('Budi desbloqueó' IN v_def) = 0
       OR position($c$WHEN 'PIN_REGENERATED'       THEN 4$c$ IN v_def) = 0 THEN
      RAISE EXCEPTION 'get_case_timeline cambió: no se pudieron agregar las etiquetas del PIN';
    END IF;
    EXECUTE v_def;
  END IF;
END $$;

-- ─── 3. Notas internas ──────────────────────────────────────────────────────
CREATE TABLE public.request_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  body       TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX request_notes_request_idx ON public.request_notes (request_id, created_at);
ALTER TABLE public.request_notes ENABLE ROW LEVEL SECURITY;
-- Sin políticas: se lee y escribe solo por las RPC de abajo.
REVOKE ALL ON public.request_notes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_add_request_note(p_request_id UUID, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de Budi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM service_requests WHERE id = p_request_id) THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  IF p_body IS NULL OR char_length(btrim(p_body)) = 0 THEN
    RAISE EXCEPTION 'La nota está vacía';
  END IF;
  IF char_length(btrim(p_body)) > 2000 THEN
    RAISE EXCEPTION 'La nota es muy larga (máximo 2000 caracteres)';
  END IF;
  INSERT INTO request_notes (request_id, author_id, body)
  VALUES (p_request_id, auth.uid(), btrim(p_body))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_request_notes(p_request_id UUID)
RETURNS TABLE (id UUID, body TEXT, created_at TIMESTAMPTZ, author_name TEXT, author_role TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de Budi';
  END IF;
  RETURN QUERY
  SELECT n.id, n.body, n.created_at,
         COALESCE(NULLIF(btrim(p.full_name), ''), p.email, 'Cuenta eliminada'),
         p.role::text
    FROM request_notes n
    LEFT JOIN profiles p ON p.id = n.author_id
   WHERE n.request_id = p_request_id
   ORDER BY n.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_add_request_note(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_request_notes(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_add_request_note(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_request_notes(UUID) TO authenticated;

-- ─── 4. Soporte ve chat y recorrido ─────────────────────────────────────────
CREATE POLICY "support: lee mensajes" ON public.request_messages
  FOR SELECT TO authenticated USING (is_support());
CREATE POLICY "support: lee recorrido" ON public.service_location_trail
  FOR SELECT TO authenticated USING (is_support());

-- ─── 5. Restablecer el 2FA (solo ADMIN) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_mfa(p_profile_id UUID, p_reason TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_reason  TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_factors INTEGER;
  v_actor   profiles;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador restablece el 2FA';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Indica cómo verificaste que es la persona (por ejemplo: videollamada con su DUI)';
  END IF;
  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes restablecer tu propio 2FA: pídeselo a otro administrador';
  END IF;

  DELETE FROM auth.mfa_factors WHERE user_id = p_profile_id;
  GET DIAGNOSTICS v_factors = ROW_COUNT;
  IF v_factors = 0 THEN
    RAISE EXCEPTION 'Esa persona no tiene 2FA configurado';
  END IF;
  -- Las sesiones abiertas conservaban el nivel aal2: se cierran todas.
  DELETE FROM auth.sessions WHERE user_id = p_profile_id;

  SELECT * INTO v_actor FROM profiles WHERE id = auth.uid();
  INSERT INTO audit_log (actor_id, actor_role, actor_name, actor_email,
                         table_name, action, record_id, record_label, changes)
  VALUES (auth.uid(), v_actor.role::text, v_actor.full_name, v_actor.email,
          'mfa_factors', 'DELETE', p_profile_id::text,
          (SELECT COALESCE(NULLIF(btrim(full_name), ''), email) FROM profiles WHERE id = p_profile_id),
          jsonb_build_object('2fa_restablecido', jsonb_build_object('old', v_factors, 'new', 0),
                             'motivo', jsonb_build_object('old', NULL, 'new', v_reason)));
  RETURN v_factors;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_mfa(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_mfa(UUID, TEXT) TO authenticated;
