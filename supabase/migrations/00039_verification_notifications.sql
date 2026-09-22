-- 00039_verification_notifications.sql
-- Notificaciones del flujo de verificación por documentos (Fase 4).
-- Recrea submit_operator_verification (00038) para avisar a los ADMIN cuando un
-- operador envía sus documentos, y admin_set_operator_verification (00038) para
-- avisar al OPERADOR cuando lo aprueban o rechazan.
--
-- Downstream ya existe: notification_queue -> pg_cron (00033) -> Edge Function
-- process-notification-queue -> device_tokens -> Expo. El campo data.type guía la
-- navegación en la app (usePushNotifications): 'verification_result' -> perfil
-- del operador. 'verification_submitted' es best-effort (los admin usan la web;
-- se encola por si alguno tiene la app, pero no navega).

-- ─── submit_operator_verification: + aviso a admins ─────────────────────────
CREATE OR REPLACE FUNCTION public.submit_operator_verification()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required text[] := ARRAY['dui_front','dui_back','license','circulation'];
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM unnest(v_required) rt
  WHERE NOT EXISTS (
    SELECT 1 FROM public.operator_documents d
    WHERE d.operator_id = auth.uid() AND d.doc_type = rt
  );

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Faltan documentos obligatorios';
  END IF;

  UPDATE public.profiles
  SET verification_status = 'pending',
      verification_submitted_at = now(),
      verification_rejection_reason = NULL
  WHERE id = auth.uid() AND role = 'OPERATOR';

  -- Aviso a los administradores (best-effort: solo llega a quien tenga la app).
  INSERT INTO notification_queue (user_id, title, body, data, created_at)
  SELECT
    p.id,
    'Nuevo operador por verificar',
    'Un operador envió sus documentos para revisión.',
    jsonb_build_object('type', 'verification_submitted', 'role', 'admin'),
    now()
  FROM public.profiles p
  WHERE p.role = 'ADMIN';
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_operator_verification() TO authenticated;

-- ─── admin_set_operator_verification: + aviso al operador ───────────────────
CREATE OR REPLACE FUNCTION public.admin_set_operator_verification(
  p_operator_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can verify operators';
  END IF;
  IF p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid verification status';
  END IF;

  UPDATE public.profiles
  SET verification_status = p_status,
      verification_reviewed_at = now(),
      verification_reviewed_by = auth.uid(),
      verification_rejection_reason =
        CASE WHEN p_status = 'rejected' THEN p_reason ELSE NULL END
  WHERE id = p_operator_id AND role = 'OPERATOR';

  -- Aviso al operador cuando se resuelve su verificación.
  IF p_status IN ('approved', 'rejected') THEN
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      p_operator_id,
      CASE WHEN p_status = 'approved' THEN 'Cuenta verificada' ELSE 'Verificación rechazada' END,
      CASE WHEN p_status = 'approved'
        THEN 'Tu cuenta fue aprobada. Ya puedes ponerte en línea y recibir solicitudes.'
        ELSE 'Tu verificación fue rechazada. Revisa el motivo y vuelve a enviar tus documentos.'
      END,
      jsonb_build_object('type', 'verification_result', 'status', p_status, 'role', 'operator'),
      now()
    );
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_operator_verification(uuid, text, text) TO authenticated;
