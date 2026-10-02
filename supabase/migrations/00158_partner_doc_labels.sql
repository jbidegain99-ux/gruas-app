-- =====================================================================
-- 00158 — Nombres de documento en español en el motivo de rechazo
--
-- Al devolver un registro sin escribir motivo, admin_set_operator_verification
-- (00114) arma el motivo con las notas de los documentos rechazados, pero lo
-- prefijaba con la clave interna: el socio leía "nit: …", "dui_front: …",
-- "circulation: …". Lo mismo en el error que ve el admin al intentar activar
-- con documentos pendientes ("Faltan: dui_front, nit").
--
-- partner_doc_label() da el nombre que ya usan la web y la app
-- (DOC_LABEL en partner-application.ts).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.partner_doc_label(p_doc_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_doc_type
    WHEN 'dui_front'   THEN 'DUI (frente)'
    WHEN 'dui_back'    THEN 'DUI (reverso)'
    WHEN 'license'     THEN 'Licencia de conducir'
    WHEN 'nit'         THEN 'NIT'
    WHEN 'circulation' THEN 'Tarjeta de circulación'
    WHEN 'tow_photo'   THEN 'Foto de tu unidad'
    WHEN 'insurance'   THEN 'Seguro del vehículo'
    ELSE p_doc_type
  END;
$$;

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
      verification_rejection_reason = CASE WHEN p_status IN ('rejected', 'suspended') THEN v_reason END
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
