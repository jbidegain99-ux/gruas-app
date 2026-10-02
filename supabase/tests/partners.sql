-- =====================================================
-- Registro de socios operadores (migr. 00114, backlog AGT-01/02/03)
--
-- Correr contra la base LOCAL:  pnpm db:test partners
-- Todo corre en una transaccion que se revierte: no deja datos.
--
--   A. Pre-registro público (lead + bienvenida), trampa para bots, sin fuga.
--   B. Registro completo por pasos, validaciones y congelado en revisión.
--   C. Revisión por documento, rechazo y corrección, aprobación.
--   D. Servicios del independiente, vencimientos, suspensión y reactivación.
--   E. Storage congelado, datos bancarios, borrado de cuenta.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- 00153: el interruptor de aseguradoras viene apagado; estas pruebas las ejercitan.
UPDATE platform_features SET insurers_enabled = true;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- Desde la 00115 las funciones nuevas nacen sin EXECUTE para PUBLIC.
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

CREATE TEMP TABLE t ON COMMIT DROP AS SELECT
  '7d7d7d7d-0000-4000-8000-000000000001'::uuid AS socio,
  (SELECT id FROM profiles WHERE role = 'ADMIN' LIMIT 1) AS admin;
GRANT SELECT ON t TO PUBLIC;

-- ---------------------------------------------------------------
-- A. Pre-registro
-- ---------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  PERFORM submit_partner_lead('Pedro Pérez Grúas', '7012-3456', ARRAY['tow', 'winch', 'inventado'], 'La Libertad', 'tow_light', 'pedro@test.invalid');
  -- Mismo teléfono al rato: no duplica.
  PERFORM submit_partner_lead('Pedro Pérez', '+503 7012 3456', ARRAY['tow'], 'La Libertad', 'tow_light');
  -- Bot: llena la trampa.
  PERFORM submit_partner_lead('Bot', '7999-9999', ARRAY['tow'], 'San Salvador', 'tow_light', NULL, 'http://spam');
  BEGIN PERFORM submit_partner_lead('X', '123', ARRAY['tow'], 'San Salvador', 'tow_light'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'A1: aceptó un teléfono inválido';
  ok := false;
  BEGIN PERFORM 1 FROM partner_leads; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'A2: los leads son legibles sin sesión';
END $$;
RESET ROLE;

DO $$
DECLARE n INT; v_types TEXT[];
BEGIN
  SELECT count(*), max(service_types) INTO n, v_types FROM partner_leads WHERE phone = '+50370123456';
  ASSERT n = 1, format('A3: el mismo teléfono generó %s leads', n);
  ASSERT v_types = ARRAY['tow'], 'A4: no actualizó el lead existente: ' || v_types::text;
  ASSERT NOT EXISTS (SELECT 1 FROM partner_leads WHERE phone = '+50379999999'), 'A5: el bot creó un lead';
  SELECT count(*) INTO n FROM outbound_messages m JOIN partner_leads l ON l.id = m.lead_id WHERE l.phone = '+50370123456';
  ASSERT n = 2, format('A6: se esperaban 2 bienvenidas (WhatsApp + correo), hay %s', n);
  RAISE NOTICE 'A. pre-registro: lead único, bienvenida lista, bot descartado, nada legible sin sesión: OK';
END $$;

-- El socio crea su cuenta con el mismo teléfono: el lead queda "registrado".
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', socio, 'authenticated', 'authenticated', 'pedro@test.invalid',
       '{"full_name": "Pedro", "role": "OPERATOR", "phone": "70123456"}', now(), now() FROM t;
UPDATE profiles SET phone = '+50370123456' WHERE id = (SELECT socio FROM t);

DO $$ BEGIN
  ASSERT (SELECT status FROM partner_leads WHERE phone = '+50370123456') = 'registered', 'A7: el lead no quedó registrado';
  ASSERT (SELECT verification_status FROM profiles WHERE id = (SELECT socio FROM t)) = 'pending', 'A8: el socio no nació pendiente';
  RAISE NOTICE 'A7. al registrarse, su lead queda enlazado: OK';
END $$;

-- ---------------------------------------------------------------
-- B. Registro por pasos
-- ---------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT socio FROM t));
DO $$
DECLARE v JSONB; ok BOOLEAN := false; s TEXT := (SELECT socio FROM t)::text;
BEGIN
  v := my_partner_application();
  ASSERT v->>'state' = 'draft' AND (v->'missing') ? 'identidad', 'B1: estado inicial inesperado: ' || v::text;

  BEGIN PERFORM partner_save_identity('Pedro Pérez', '7012-3456', '123', '0614-010190-101-1'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B2: aceptó un DUI inválido';
  PERFORM partner_save_identity('Pedro Pérez', '7012-3456', '01234567-8', '06140101901011');
  PERFORM partner_save_services(ARRAY['tow', 'winch']);
  PERFORM partner_save_bank('Banco Agrícola', 'ahorro', '0123-4567-8901', 'Pedro Pérez');
  PERFORM partner_save_vehicle('p 123-456', 'tow_light');

  -- Documentos: ruta ajena, bucket equivocado y vencimiento faltante se rechazan.
  ok := false;
  BEGIN PERFORM upsert_operator_document('dui_front', 'id-documents', '00000000-0000-0000-0000-000000000000/dui.jpg'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B3: aceptó un archivo en la carpeta de otra persona';
  ok := false;
  BEGIN PERFORM upsert_operator_document('dui_front', 'vehicle-documents', s || '/dui.jpg'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B4: aceptó el DUI en el bucket de vehículos';
  ok := false;
  BEGIN PERFORM upsert_operator_document('license', 'id-documents', s || '/lic.jpg'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B5: aceptó la licencia sin fecha de vencimiento';

  PERFORM upsert_operator_document('dui_front', 'id-documents', s || '/dui_front-1.jpg');
  PERFORM upsert_operator_document('dui_back', 'id-documents', s || '/dui_back-1.jpg');
  PERFORM upsert_operator_document('license', 'id-documents', s || '/license-1.jpg', sv_today() + 400);
  PERFORM upsert_operator_document('nit', 'id-documents', s || '/nit-1.jpg');
  PERFORM upsert_operator_document('circulation', 'vehicle-documents', s || '/circulation-1.jpg', sv_today() + 300);
  PERFORM upsert_operator_document('tow_photo', 'vehicle-documents', s || '/tow_photo-1.jpg');

  -- Falta el seguro: no se puede enviar.
  ok := false;
  BEGIN PERFORM submit_operator_verification(); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B6: se envió sin el seguro';
  ASSERT (my_partner_application()->'missing') ? 'documento:insurance', 'B7: no reporta el seguro como faltante';

  PERFORM upsert_operator_document('insurance', 'vehicle-documents', s || '/insurance-1.jpg', sv_today() + 200);

  -- 00126 (AGT-04): sin aceptar el contrato vigente no se envía.
  v := my_partner_application();
  ASSERT v->'missing' = '["contrato"]'::jsonb AND (v->>'terms_pending')::boolean, 'B8a: el contrato no figura pendiente: ' || v::text;
  ok := false;
  BEGIN PERFORM submit_operator_verification(); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B8b: se envió sin aceptar el contrato';
  -- Como llega por el gateway: la primera IP de X-Forwarded-For es la del cliente.
  PERFORM set_config('request.headers', '{"x-forwarded-for": "190.86.1.2, 10.0.0.1", "user-agent": "Budi test"}', true);
  ASSERT (accept_terms((v->'terms'->>'id')::uuid)->>'version') IS NOT NULL, 'B8c: no registró la aceptación';
  PERFORM accept_terms((v->'terms'->>'id')::uuid);  -- idempotente

  v := my_partner_application();
  ASSERT v->'terms'->>'accepted_at' IS NOT NULL AND NOT (v->>'terms_pending')::boolean, 'B8d: la aceptación no se ve';
  ASSERT jsonb_array_length(v->'missing') = 0, 'B8: todavía falta algo: ' || (v->'missing')::text;
  ASSERT v->'identity'->>'nit' = '0614-010190-101-1' AND v->'vehicle'->>'plate' = 'P123-456', 'B9: formato guardado inesperado: ' || v::text;
  ASSERT v->'bank'->>'account_last4' = '8901' AND NOT (v->'bank' ? 'account_number'), 'B10: la app recibe el número de cuenta completo';

  PERFORM submit_operator_verification();
  ASSERT my_partner_application()->>'state' = 'in_review', 'B11: no quedó en revisión';

  ok := false;
  BEGIN PERFORM partner_save_bank('Otro', 'ahorro', '99999999', 'Otro'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B12: cambió la cuenta bancaria estando en revisión';
  ok := false;
  BEGIN PERFORM upsert_operator_document('tow_photo', 'vehicle-documents', s || '/tow_photo-2.jpg'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B13: cambió un documento estando en revisión';
  RAISE NOTICE 'B. registro por pasos, validaciones y congelado en revisión: OK';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------
-- C. Revisión por documento
-- ---------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT admin FROM t));
DO $$
DECLARE s UUID := (SELECT socio FROM t); ok BOOLEAN := false; d TEXT; msg TEXT;
BEGIN
  FOREACH d IN ARRAY ARRAY['dui_front', 'dui_back', 'license', 'nit', 'circulation', 'insurance'] LOOP
    PERFORM admin_review_document(s, d, 'approved');
  END LOOP;
  BEGIN PERFORM admin_review_document(s, 'tow_photo', 'rejected'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'C1: rechazó un documento sin decir qué corregir';
  PERFORM admin_review_document(s, 'tow_photo', 'rejected', 'La foto está borrosa, no se ve la placa');
  ok := false;
  BEGIN PERFORM admin_set_operator_verification(s, 'approved'); EXCEPTION WHEN OTHERS THEN ok := true; msg := SQLERRM; END;
  ASSERT ok, 'C2: aprobó con un documento rechazado';
  -- 00158: el admin y el socio leen el nombre del documento, no la clave interna.
  ASSERT msg LIKE '%Faltan: Foto de tu unidad%', 'C2b: el error no nombra el documento en español: ' || msg;
  PERFORM admin_set_operator_verification(s, 'rejected');
  ASSERT (SELECT verification_rejection_reason FROM profiles WHERE id = s) LIKE 'Foto de tu unidad: La foto está borrosa%', 'C3: el motivo no se armó de las notas: '
    || (SELECT verification_rejection_reason FROM profiles WHERE id = s);
  RAISE NOTICE 'C1. revisión por documento; no aprueba con pendientes; motivo automático: OK';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM notification_queue WHERE user_id = (SELECT socio FROM t) AND data->>'status' = 'rejected'),
    'C4: no se avisó al socio';
  RAISE NOTICE 'C1b. el socio recibe el aviso del rechazo: OK';
END $$;
SET LOCAL ROLE authenticated;

-- El socio corrige solo lo rechazado y reenvía.
SELECT pg_temp.como((SELECT socio FROM t));
DO $$
DECLARE s TEXT := (SELECT socio FROM t)::text; v JSONB;
BEGIN
  v := my_partner_application();
  ASSERT v->>'state' = 'rejected' AND v->'documents'->'tow_photo'->>'review_note' LIKE 'La foto está borrosa%', 'C5: ' || (v->'documents'->'tow_photo')::text;
  ASSERT (v->'missing') ? 'documento:tow_photo', 'C6: el documento rechazado no figura como pendiente';
  PERFORM upsert_operator_document('tow_photo', 'vehicle-documents', s || '/tow_photo-2.jpg');
  PERFORM submit_operator_verification();
  ASSERT (SELECT review_status FROM operator_documents WHERE operator_id = s::uuid AND doc_type = 'license') = 'approved',
    'C7: reenviar borró la aprobación de los documentos que estaban bien';
  RAISE NOTICE 'C2. el socio corrige solo lo rechazado y reenvía: OK';
END $$;

SELECT pg_temp.como((SELECT admin FROM t));
DO $$
DECLARE s UUID := (SELECT socio FROM t); v JSONB;
BEGIN
  PERFORM admin_review_document(s, 'tow_photo', 'approved');
  PERFORM admin_set_operator_verification(s, 'approved');
  ASSERT (SELECT verification_status FROM profiles WHERE id = s) = 'approved', 'C8: no quedó aprobado';
  v := admin_partner_application(s);
  ASSERT v->'bank'->>'account_number' = '012345678901', 'C9: el admin no ve la cuenta completa';
  ASSERT (v->'bank'->>'holder_matches')::boolean, 'C10: el titular no coincide con el nombre';
  RAISE NOTICE 'C3. aprobado con todo revisado; el admin ve la cuenta completa: OK';
END $$;
RESET ROLE;

-- Soporte revisa pero ve la cuenta enmascarada.
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '7d7d7d7d-0000-4000-8000-00000000500e', 'authenticated', 'authenticated',
        'soporte.socios@test.invalid', '{}', now(), now());
UPDATE profiles SET role = 'SUPPORT' WHERE id = '7d7d7d7d-0000-4000-8000-00000000500e';
SET LOCAL ROLE authenticated;
SELECT pg_temp.como('7d7d7d7d-0000-4000-8000-00000000500e');
DO $$ BEGIN
  ASSERT admin_partner_application((SELECT socio FROM t))->'bank'->>'account_number' = '••••8901', 'C11: soporte ve la cuenta completa';
  ASSERT jsonb_array_length(admin_list_partner_leads()) > 0, 'C12: soporte no ve los interesados';
  RAISE NOTICE 'C4. soporte revisa con la cuenta enmascarada y ve los interesados: OK';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------
-- D. Servicios, vencimientos, suspensión y reactivación
-- ---------------------------------------------------------------
DO $$ DECLARE s UUID := (SELECT socio FROM t); BEGIN
  ASSERT operator_can_serve(s, 'tow') AND operator_can_serve(s, 'winch'), 'D1: no atiende lo que declaró';
  ASSERT NOT operator_can_serve(s, 'water_truck'), 'D2: un independiente atiende una pipa que no declaró';
  RAISE NOTICE 'D1. el independiente atiende solo lo que declaró: OK';
END $$;

-- El seguro vence en 10 días: aviso (una sola vez).
UPDATE operator_documents SET expires_on = sv_today() + 10 WHERE operator_id = (SELECT socio FROM t) AND doc_type = 'insurance';
SELECT check_operator_document_expiry();
SELECT check_operator_document_expiry();
DO $$ DECLARE n INT; BEGIN
  SELECT count(*) INTO n FROM notification_queue WHERE user_id = (SELECT socio FROM t) AND data->>'type' = 'document_expiring';
  ASSERT n = 1, format('D3: se enviaron %s avisos de vencimiento (esperado 1)', n);
  RAISE NOTICE 'D2. aviso 15 días antes, una sola vez: OK';
END $$;

-- El seguro vence: suspensión automática y sale de línea.
INSERT INTO operator_locations (operator_id, lat, lng, is_online, updated_at)
SELECT socio, 13.69, -89.21, true, now() FROM t
ON CONFLICT (operator_id) DO UPDATE SET is_online = true;
UPDATE operator_documents SET expires_on = sv_today() WHERE operator_id = (SELECT socio FROM t) AND doc_type = 'insurance';
SELECT check_operator_document_expiry();
DO $$ DECLARE s UUID := (SELECT socio FROM t); BEGIN
  ASSERT (SELECT verification_status FROM profiles WHERE id = s) = 'suspended', 'D4: no se suspendió con el seguro vencido';
  ASSERT NOT (SELECT is_online FROM operator_locations WHERE operator_id = s), 'D5: sigue en línea suspendido';
  ASSERT (SELECT verification_rejection_reason FROM profiles WHERE id = s) LIKE '%seguro del vehículo%', 'D6: motivo inesperado';
  RAISE NOTICE 'D3. documento vencido: suspensión automática y fuera de línea: OK';
END $$;

-- El socio sube el seguro renovado; el admin lo aprueba y la cuenta se reactiva sola.
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT socio FROM t));
SELECT upsert_operator_document('insurance', 'vehicle-documents', (SELECT socio FROM t)::text || '/insurance-2.jpg', sv_today() + 365);
SELECT pg_temp.como((SELECT admin FROM t));
DO $$ DECLARE r JSONB; BEGIN
  r := admin_review_document((SELECT socio FROM t), 'insurance', 'approved');
  ASSERT (r->>'reactivated')::boolean, 'D7: no se reactivó';
  ASSERT (SELECT verification_status FROM profiles WHERE id = (SELECT socio FROM t)) = 'approved', 'D8: no volvió a aprobado';
  RAISE NOTICE 'D4. renueva el documento y se reactiva al aprobarlo: OK';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------
-- F. Contrato versionado (00126, AGT-04)
-- ---------------------------------------------------------------
RESET ROLE;
CREATE TEMP TABLE t_terms ON COMMIT DROP AS SELECT current_terms_id('partner') AS old;
GRANT SELECT ON t_terms TO PUBLIC;
DO $$
DECLARE ok BOOLEAN := false; v_old UUID := current_terms_id('partner');
BEGIN
  -- Lo publicado no se edita.
  BEGIN
    UPDATE terms_documents SET body = body || ' (cambiado)' WHERE id = v_old;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Los términos publicados%';
  END;
  ASSERT ok, 'F1: un contrato publicado se pudo editar';
  -- Queda registrada la IP del gateway.
  ASSERT (SELECT ip = '190.86.1.2' AND user_agent = 'Budi test' FROM terms_acceptances
           WHERE profile_id = (SELECT socio FROM t) AND terms_id = v_old),
    'F2: la aceptacion no guardo la IP del cliente ni el navegador';
  -- Versión nueva: el socio (ya aprobado) la tiene pendiente y la vieja no se acepta.
  INSERT INTO terms_documents (kind, version, title, body, published_at)
  VALUES ('partner', 'test-v2', 'Contrato v2 (prueba)', repeat('Texto de prueba. ', 20), now() + interval '1 second');
  ASSERT partner_terms_pending((SELECT socio FROM t)), 'F3: la version nueva no quedo pendiente';
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT socio FROM t));
DO $$
DECLARE ok BOOLEAN := false; v JSONB;
BEGIN
  v := my_partner_application();
  ASSERT (v->>'terms_pending')::boolean AND v->'terms'->>'version' = 'test-v2', 'F4: la app no ve la version nueva: ' || (v->'terms')::text;
  BEGIN
    PERFORM accept_terms((SELECT old FROM t_terms));
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Esa versión ya no es la vigente%';
  END;
  ASSERT ok, 'F5: se acepto una version vieja';
  PERFORM accept_terms((v->'terms'->>'id')::uuid);
  ASSERT NOT (my_partner_application()->>'terms_pending')::boolean, 'F6: aceptada la nueva sigue pendiente';
  RAISE NOTICE 'F. contrato versionado: inmutable, con IP, la version nueva queda pendiente: OK';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------
-- E. Storage congelado y borrado de cuenta
-- ---------------------------------------------------------------
INSERT INTO storage.objects (bucket_id, name, owner, metadata)
SELECT 'vehicle-documents', socio::text || '/circulation-1.jpg', socio, '{}' FROM t;
SET LOCAL ROLE authenticated;
SELECT pg_temp.como((SELECT socio FROM t));
DO $$ DECLARE n INT; BEGIN
  UPDATE storage.objects SET metadata = '{"x": 1}'
   WHERE bucket_id = 'vehicle-documents' AND name = (SELECT socio FROM t)::text || '/circulation-1.jpg';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'E1: un socio aprobado sobrescribió su tarjeta de circulación en Storage';
  RAISE NOTICE 'E1. un socio aprobado no puede sobrescribir sus documentos en Storage: OK';
END $$;
RESET ROLE;

SELECT anonymize_account((SELECT socio FROM t));
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM operator_profiles WHERE operator_id = (SELECT socio FROM t)), 'E2: quedaron el DUI, NIT o la cuenta del socio';
  ASSERT NOT EXISTS (SELECT 1 FROM partner_leads WHERE profile_id = (SELECT socio FROM t)), 'E3: quedó su pre-registro';
  RAISE NOTICE 'E2. eliminar la cuenta borra DUI, NIT, cuenta bancaria y pre-registro: OK';
END $$;

DO $$ BEGIN RAISE NOTICE 'TODO VERDE'; END $$;
ROLLBACK;
