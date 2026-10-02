-- =====================================================================
-- 00162 — La pausa que pone Budi solo la levanta Budi
--
-- Un socio queda "suspended" por dos caminos: la tarea diaria que lo pausa por
-- un documento vencido (check_operator_document_expiry) y la pausa a mano de
-- Verificaciones → "Pausar cuenta" (admin_set_operator_verification). El
-- registro trataba igual a los dos, y la pausa a mano se podía saltar:
--
--   1. El socio entraba a su registro y tocaba "Enviar a revisión":
--      submit_operator_verification lo pasaba a 'pending' y BORRABA el motivo.
--      Quien revisaba veía un registro nuevo, sin rastro de la pausa.
--   2. Subía cualquier documento y, al aprobarlo, partner_try_reactivate lo
--      reactivaba solo (está pensado para el documento vencido).
--
-- Ahora la pausa a mano queda marcada (verification_paused_by_staff): con ella
-- el socio no edita ni reenvía su registro y aprobar un documento no lo
-- reactiva. La levanta el admin con "Activar cuenta". La pausa por documento
-- vencido sigue igual: sube la renovación y se reactiva al aprobarla.
--
-- La columna no se agrega a los permisos por columna de `authenticated`
-- (00054): el socio no puede escribirla ni leerla directo.
-- =====================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_paused_by_staff BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.verification_paused_by_staff IS
  '00162: la pausa la puso Budi a mano (no un documento vencido). Solo la levanta el admin.';

-- El registro no se edita mientras dura una pausa de Budi.
CREATE OR REPLACE FUNCTION public.partner_can_edit(p_operator uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT ((verification_status = 'pending' AND verification_submitted_at IS NULL)
             OR verification_status IN ('rejected', 'suspended'))
            AND NOT verification_paused_by_staff
       FROM profiles WHERE id = p_operator AND role = 'OPERATOR'),
    false)
$function$;

-- Reenviar: con la pausa de Budi, el mensaje dice qué hacer.
CREATE OR REPLACE FUNCTION public.submit_operator_verification()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_missing TEXT[];
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND verification_paused_by_staff) THEN
    RAISE EXCEPTION 'Budi pausó tu cuenta. Escríbenos a soporte para reactivarla.';
  END IF;
  IF NOT partner_can_edit(auth.uid()) THEN
    RAISE EXCEPTION 'Tu registro ya está en revisión o aprobado';
  END IF;
  v_missing := partner_missing(auth.uid());
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'Falta completar: %', array_to_string(v_missing, ', ');
  END IF;

  UPDATE profiles
     SET verification_status = 'pending', verification_submitted_at = now(), verification_rejection_reason = NULL
   WHERE id = auth.uid() AND role = 'OPERATOR';

  INSERT INTO notification_queue (user_id, title, body, data, created_at)
  SELECT p.id, 'Nuevo socio operador por verificar', 'Un socio operador envió su registro para revisión.',
         jsonb_build_object('type', 'verification_submitted', 'role', 'admin'), now()
    FROM profiles p WHERE p.role = 'ADMIN';
END;
$function$;

-- Aprobar un documento no levanta una pausa de Budi.
CREATE OR REPLACE FUNCTION public.partner_try_reactivate(p_operator uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT verification_status <> 'suspended' OR verification_paused_by_staff
        FROM profiles WHERE id = p_operator) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(partner_required_docs()) rt
              WHERE NOT EXISTS (SELECT 1 FROM operator_documents d
                                 WHERE d.operator_id = p_operator AND d.doc_type = rt
                                   AND d.review_status = 'approved'
                                   AND (d.expires_on IS NULL OR d.expires_on > sv_today()))) THEN
    RETURN false;
  END IF;
  UPDATE profiles SET verification_status = 'approved', verification_rejection_reason = NULL,
                      verification_reviewed_at = now(), verification_reviewed_by = auth.uid()
   WHERE id = p_operator;
  INSERT INTO notification_queue (user_id, title, body, data, created_at)
  VALUES (p_operator, 'Cuenta reactivada', 'Aprobamos tu documento renovado. Ya puedes volver a recibir solicitudes.',
          jsonb_build_object('type', 'verification_result', 'status', 'approved', 'role', 'operator'), now());
  RETURN true;
END;
$function$;

-- La decisión del personal: pausar marca; cualquier otra decisión desmarca.
-- (El resto, igual que en 00158.)
CREATE OR REPLACE FUNCTION public.admin_set_operator_verification(p_operator_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pending TEXT[];
  v_reason  TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el personal de Budi verifica socios';
  END IF;
  IF p_status NOT IN ('pending', 'approved', 'rejected', 'suspended') THEN
    RAISE EXCEPTION 'Estado de verificación inválido';
  END IF;

  IF p_status = 'approved' THEN
    SELECT array_agg(partner_doc_label(rt)) INTO v_pending FROM unnest(partner_required_docs()) rt
     WHERE NOT EXISTS (SELECT 1 FROM operator_documents d
                        WHERE d.operator_id = p_operator_id AND d.doc_type = rt AND d.review_status = 'approved'
                          AND (d.expires_on IS NULL OR d.expires_on > sv_today()));
    IF v_pending IS NOT NULL THEN
      RAISE EXCEPTION 'Antes de aprobar, revisa y aprueba cada documento. Faltan: %', array_to_string(v_pending, ', ');
    END IF;
  END IF;

  IF p_status IN ('rejected', 'suspended') AND v_reason IS NULL THEN
    SELECT string_agg(partner_doc_label(doc_type) || ': ' || review_note, '; ' ORDER BY doc_type) INTO v_reason
      FROM operator_documents WHERE operator_id = p_operator_id AND review_status = 'rejected';
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Indica el motivo';
    END IF;
  END IF;

  UPDATE public.profiles
  SET verification_status = p_status,
      verification_reviewed_at = now(),
      verification_reviewed_by = auth.uid(),
      verification_rejection_reason = CASE WHEN p_status IN ('rejected', 'suspended') THEN v_reason END,
      verification_paused_by_staff = (p_status = 'suspended')
  WHERE id = p_operator_id AND role = 'OPERATOR';

  IF p_status IN ('approved', 'rejected', 'suspended') THEN
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      p_operator_id,
      CASE p_status WHEN 'approved' THEN 'Cuenta verificada' WHEN 'rejected' THEN 'Revisa tu registro' ELSE 'Cuenta en pausa' END,
      CASE p_status
        WHEN 'approved' THEN 'Tu cuenta fue aprobada. Ya puedes ponerte en línea y recibir solicitudes.'
        WHEN 'rejected' THEN 'Hay documentos por corregir. Entra a tu registro, corrígelos y vuelve a enviarlo.'
        ELSE 'Tu cuenta quedó en pausa: ' || v_reason END,
      jsonb_build_object('type', 'verification_result', 'status', p_status, 'role', 'operator'),
      now()
    );
  END IF;
END;
$function$;

-- Las pausas a mano que ya existen: las que no vienen de un documento vencido.
UPDATE public.profiles
   SET verification_paused_by_staff = true
 WHERE verification_status = 'suspended'
   AND COALESCE(verification_rejection_reason, '') !~* '^Documento vencido';
