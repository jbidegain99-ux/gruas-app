-- =====================================================
-- LAN-01 · Exportar mis datos (Decreto 144, derecho de acceso)
--
-- `export_my_data()` devuelve en un JSON todo lo que Budi guarda de quien lo
-- pide: perfil, documento, vehículos, servicios (como Usuario y como socio),
-- cobros y comprobantes, afiliaciones, calificaciones, mensajes que envió,
-- consentimientos, contrato aceptado, documentos de socio (sin los archivos)
-- y membresías de portales. Nunca datos de otras personas: de los servicios
-- sale el nombre del otro participante, no sus datos de contacto; de las
-- calificaciones recibidas, la nota y el comentario, no quién calificó.
-- =====================================================

CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me   UUID := auth.uid();
  v_prof RECORD;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Se necesita una sesión';
  END IF;
  SELECT * INTO v_prof FROM profiles WHERE id = v_me;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'notice', 'Copia de tus datos personales en Budi (Decreto 144, derecho de acceso). Para corregirlos o borrarlos usa la app o escribe a soporte.',
    'profile', jsonb_build_object(
      'id', v_prof.id, 'role', v_prof.role, 'full_name', v_prof.full_name, 'email', v_prof.email,
      'phone', v_prof.phone, 'created_at', v_prof.created_at, 'privacy_accepted_at', v_prof.privacy_accepted_at,
      'marketing_opt_in', v_prof.marketing_opt_in, 'verification_status', v_prof.verification_status),
    'identity_document', (SELECT jsonb_build_object('dui_number', ps.dui_number, 'has_document_image', ps.id_doc_path IS NOT NULL)
                            FROM profile_sensitive ps WHERE ps.profile_id = v_me),
    'vehicles', COALESCE((SELECT jsonb_agg(jsonb_build_object('make', v.make, 'model', v.model, 'plate', v.plate,
                                                             'color', v.color, 'is_default', v.is_default, 'created_at', v.created_at)
                                          ORDER BY v.created_at) FROM vehicles v WHERE v.user_id = v_me), '[]'::jsonb),
    'services_requested', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'folio', c.folio, 'status', sr.status, 'service_type', COALESCE(sr.service_type, 'tow'),
        'incident_type', sr.incident_type, 'pickup_address', sr.pickup_address, 'dropoff_address', sr.dropoff_address,
        'vehicle_plate', sr.vehicle_plate, 'created_at', sr.created_at, 'completed_at', sr.completed_at,
        'cancelled_at', sr.cancelled_at, 'cancellation_reason', sr.cancellation_reason, 'total_price', sr.total_price,
        'operator_name', op.full_name,
        'coverage', (SELECT jsonb_build_object('covered', cu.amount_covered, 'copay', cu.amount_copay)
                       FROM coverage_usage cu WHERE cu.request_id = sr.id),
        'payment', (SELECT jsonb_build_object('amount', sp.amount, 'status', sp.status, 'method', sp.method,
                                              'paid_at', sp.paid_at, 'receipt_number', sp.receipt_number)
                      FROM service_payments sp WHERE sp.request_id = sr.id)) ORDER BY sr.created_at)
      FROM service_requests sr
      LEFT JOIN cases c ON c.request_id = sr.id
      LEFT JOIN profiles op ON op.id = sr.operator_id
     WHERE sr.user_id = v_me), '[]'::jsonb),
    'insurance_memberships', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'insurer', i.name, 'policy_number', po.policy_number, 'relationship', m.relationship,
        'document_number', m.document_number, 'starts_on', m.starts_on, 'ends_on', m.ends_on, 'is_active', m.is_active))
      FROM members m JOIN policies po ON po.id = m.policy_id JOIN insurers i ON i.id = po.insurer_id
     WHERE m.profile_id = v_me), '[]'::jsonb),
    'ratings_given', COALESCE((SELECT jsonb_agg(jsonb_build_object('stars', r.stars, 'comment', r.comment, 'created_at', r.created_at)
                                               ORDER BY r.created_at)
                                 FROM ratings r WHERE r.rater_user_id = v_me), '[]'::jsonb),
    'messages_sent', COALESCE((SELECT jsonb_agg(jsonb_build_object('folio', c.folio, 'message', rm.message, 'created_at', rm.created_at)
                                               ORDER BY rm.created_at)
                                 FROM request_messages rm LEFT JOIN cases c ON c.request_id = rm.request_id
                                WHERE rm.sender_id = v_me), '[]'::jsonb),
    'terms_accepted', COALESCE((SELECT jsonb_agg(jsonb_build_object('terms_id', ta.terms_id, 'accepted_at', ta.accepted_at, 'ip', ta.ip))
                                  FROM terms_acceptances ta WHERE ta.profile_id = v_me), '[]'::jsonb),
    'portal_memberships', COALESCE((SELECT jsonb_agg(jsonb_build_object('organization', o.name, 'type', o.type, 'role', om.role,
                                                                       'status', om.status, 'since', om.created_at))
                                      FROM organization_members om JOIN organizations o ON o.id = om.organization_id
                                     WHERE om.profile_id = v_me), '[]'::jsonb),
    'as_partner', CASE WHEN v_prof.role::text <> 'OPERATOR' THEN NULL ELSE jsonb_build_object(
      'registration', (SELECT jsonb_build_object('dui_number', p.dui_number, 'nit', p.nit, 'service_types', p.service_types,
                                                 'bank_name', p.bank_name, 'bank_account_type', p.bank_account_type,
                                                 'bank_account_number', p.bank_account_number, 'bank_account_holder', p.bank_account_holder)
                         FROM operator_profiles p WHERE p.operator_id = v_me),
      'vehicles', COALESCE((SELECT jsonb_agg(jsonb_build_object('plate', ov.plate, 'vehicle_type', ov.vehicle_type,
                                                               'capacity_m3', ov.capacity_m3, 'is_active', ov.is_active))
                              FROM operator_vehicles ov WHERE ov.operator_id = v_me), '[]'::jsonb),
      'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', d.doc_type, 'uploaded_at', d.uploaded_at,
                                                                'expires_on', d.expires_on, 'review_status', d.review_status,
                                                                'review_note', d.review_note))
                               FROM operator_documents d WHERE d.operator_id = v_me), '[]'::jsonb),
      'training', jsonb_build_object('guide_seen_at', v_prof.partner_guide_seen_at, 'practice_done_at', v_prof.partner_practice_done_at),
      'services_provided', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'folio', c.folio, 'status', sr.status, 'service_type', COALESCE(sr.service_type, 'tow'),
          'created_at', sr.created_at, 'completed_at', sr.completed_at, 'total_price', sr.total_price,
          'user_name', us.full_name) ORDER BY sr.created_at)
        FROM service_requests sr LEFT JOIN cases c ON c.request_id = sr.id LEFT JOIN profiles us ON us.id = sr.user_id
       WHERE sr.operator_id = v_me), '[]'::jsonb),
      'ratings_received', COALESCE((SELECT jsonb_agg(jsonb_build_object('stars', r.stars, 'comment', r.comment, 'created_at', r.created_at)
                                                    ORDER BY r.created_at)
                                      FROM ratings r WHERE r.rated_operator_id = v_me), '[]'::jsonb),
      'payouts', my_payouts()) END);
END;
$$;
REVOKE ALL ON FUNCTION public.export_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO authenticated;
