-- =====================================================
-- 00114 — Registro de socios operadores (backlog AGT-01, AGT-02, AGT-03)
--
-- Propuesta por defecto de la decision D2 de Jose: el "agente libre" es un
-- socio operador independiente.
--
-- AGT-01 Captacion: `partner_leads` (pre-registro publico desde /socios) y una
--        bandeja `outbound_messages` con la bienvenida lista para enviar por
--        WhatsApp o correo. No hay proveedor de mensajeria conectado: el panel
--        la envia con un clic (wa.me con el texto) y la marca como enviada.
-- AGT-02 Registro completo: `operator_profiles` guarda DUI, NIT, servicios que
--        presta y cuenta bancaria del socio. Tabla APARTE de profile_sensitive
--        a proposito: el DUI de profile_sensitive es el que cruza con el padron
--        de afiliados (cobertura de seguro, fraude de la 00059/00062). Un socio
--        no debe poder "afiliarse" escribiendo un DUI ajeno.
--        Documentos: se suman NIT y la foto de la unidad y el seguro pasan a
--        obligatorios; licencia, circulacion y seguro llevan vencimiento.
--        `my_partner_application()` da el avance por pasos (guardar y seguir).
-- AGT-03 Revision por documento (aprobar/rechazar con nota), vencimientos con
--        aviso 15 dias antes y SUSPENSION automatica al vencer; se reactiva
--        sola cuando el admin aprueba el documento renovado.
--
-- Agujeros cerrados de paso:
--   * Un socio aprobado podia sobrescribir en Storage su tarjeta de
--     circulacion, seguro o foto (vehicle-documents no se congelaba).
--   * upsert_operator_document no validaba que la ruta fuera de quien llama ni
--     que el bucket fuera el del tipo de documento.
--   * operator_can_serve dejaba a un independiente atender CUALQUIER servicio:
--     ahora respeta los que declaro.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Captacion (AGT-01)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_leads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT,
  service_types TEXT[] NOT NULL DEFAULT '{}',
  zone          TEXT,
  vehicle_type  TEXT,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'registered', 'discarded')),
  notes         TEXT,
  profile_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.partner_leads IS
  '00114 (AGT-01): pre-registros de socios desde /socios. Se escribe por RPC.';

CREATE INDEX IF NOT EXISTS partner_leads_phone ON public.partner_leads (phone);
CREATE INDEX IF NOT EXISTS partner_leads_status ON public.partner_leads (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel     TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  to_address  TEXT NOT NULL,
  subject     TEXT,
  body        TEXT NOT NULL,
  lead_id     UUID REFERENCES public.partner_leads(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ,
  sent_by     UUID
);

COMMENT ON TABLE public.outbound_messages IS
  '00114: mensajes salientes (bienvenida a socios). Sin proveedor conectado, el '
  'panel los envia con un clic y los marca; un proveedor futuro drenaria esta tabla.';

ALTER TABLE public.partner_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_leads, public.outbound_messages FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS update_partner_leads_updated_at ON public.partner_leads;
CREATE TRIGGER update_partner_leads_updated_at
  BEFORE UPDATE ON public.partner_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_audit ON public.partner_leads;
CREATE TRIGGER trg_audit
  AFTER UPDATE ON public.partner_leads
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'status,notes');

-- Pre-registro publico (sin sesion). Defensas: campo trampa para bots, datos
-- validados, un mismo telefono no genera leads nuevos en 24 h (actualiza el
-- que ya hay) y un tope global por minuto contra inundaciones.
CREATE OR REPLACE FUNCTION public.submit_partner_lead(
  p_full_name     TEXT,
  p_phone         TEXT,
  p_service_types TEXT[],
  p_zone          TEXT,
  p_vehicle_type  TEXT,
  p_email         TEXT DEFAULT NULL,
  p_website       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_name  TEXT := btrim(COALESCE(p_full_name, ''));
  v_email TEXT := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
  v_types TEXT[];
  v_id    UUID;
  v_body  TEXT;
BEGIN
  -- Bot: llenó el campo invisible. Se responde como si nada.
  IF COALESCE(p_website, '') <> '' THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF v_phone ~ '^503\d{8}$' THEN v_phone := substr(v_phone, 4); END IF;
  IF v_phone !~ '^[267]\d{7}$' THEN
    RAISE EXCEPTION 'Escribe un teléfono de El Salvador de 8 dígitos';
  END IF;
  v_phone := '+503' || v_phone;
  IF length(v_name) < 3 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Escribe tu nombre completo';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Correo inválido';
  END IF;
  SELECT array_agg(DISTINCT t) INTO v_types
    FROM unnest(COALESCE(p_service_types, '{}')) t
   WHERE t IN (SELECT slug FROM services WHERE is_active);
  IF v_types IS NULL THEN
    RAISE EXCEPTION 'Elige al menos un servicio';
  END IF;
  IF p_vehicle_type NOT IN ('tow_light', 'tow_heavy', 'water_truck', 'service') THEN
    RAISE EXCEPTION 'Elige tu tipo de vehículo';
  END IF;

  IF (SELECT count(*) FROM partner_leads WHERE created_at > now() - interval '1 minute') >= 30 THEN
    RAISE EXCEPTION 'Estamos recibiendo muchos registros. Intenta de nuevo en un minuto.';
  END IF;

  SELECT id INTO v_id FROM partner_leads
   WHERE phone = v_phone AND created_at > now() - interval '24 hours'
   ORDER BY created_at DESC LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE partner_leads
       SET full_name = v_name, email = COALESCE(v_email, email), service_types = v_types,
           zone = left(p_zone, 60), vehicle_type = p_vehicle_type
     WHERE id = v_id;
    RETURN jsonb_build_object('ok', true);
  END IF;

  INSERT INTO partner_leads (full_name, phone, email, service_types, zone, vehicle_type)
  VALUES (v_name, v_phone, v_email, v_types, left(p_zone, 60), p_vehicle_type)
  RETURNING id INTO v_id;

  -- La bienvenida queda lista en la bandeja.
  v_body := 'Hola ' || split_part(v_name, ' ', 1) || ', gracias por tu interés en ser socio operador de Budi. '
         || 'Completa tu registro y sube tus documentos aquí: https://budi.sv/socios/registro '
         || '— si tienes dudas, responde este mensaje y te ayudamos.';
  INSERT INTO outbound_messages (channel, to_address, body, lead_id)
  VALUES ('whatsapp', v_phone, v_body, v_id);
  IF v_email IS NOT NULL THEN
    INSERT INTO outbound_messages (channel, to_address, subject, body, lead_id)
    VALUES ('email', v_email, 'Bienvenido a Budi', v_body, v_id);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_partner_lead(TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_partner_lead(TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_partner_leads(p_status TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el personal de Budi ve los socios interesados';
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', l.id, 'full_name', l.full_name, 'phone', l.phone, 'email', l.email,
             'service_types', l.service_types, 'zone', l.zone, 'vehicle_type', l.vehicle_type,
             'status', l.status, 'notes', l.notes, 'profile_id', l.profile_id, 'created_at', l.created_at,
             'messages', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                             'id', m.id, 'channel', m.channel, 'to', m.to_address, 'body', m.body,
                             'status', m.status, 'sent_at', m.sent_at) ORDER BY m.channel), '[]'::jsonb)
                            FROM outbound_messages m WHERE m.lead_id = l.id)
           ) ORDER BY l.created_at DESC), '[]'::jsonb)
      FROM partner_leads l
     WHERE p_status IS NULL OR l.status = p_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_partner_lead(p_id UUID, p_status TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el personal de Budi gestiona socios interesados';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('new', 'contacted', 'registered', 'discarded') THEN
    RAISE EXCEPTION 'Estado desconocido: %', p_status;
  END IF;
  UPDATE partner_leads SET status = COALESCE(p_status, status), notes = COALESCE(p_notes, notes) WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese registro no existe'; END IF;
END;
$$;

-- Marcar un mensaje como enviado (tras enviarlo por WhatsApp/correo). El lead
-- pasa a "contactado".
CREATE OR REPLACE FUNCTION public.admin_mark_message_sent(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_lead UUID;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el personal de Budi envía mensajes';
  END IF;
  UPDATE outbound_messages SET status = 'sent', sent_at = now(), sent_by = auth.uid()
   WHERE id = p_id AND status = 'pending'
   RETURNING lead_id INTO v_lead;
  UPDATE partner_leads SET status = 'contacted' WHERE id = v_lead AND status = 'new';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_partner_leads(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_partner_lead(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_mark_message_sent(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_partner_leads(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_partner_lead(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_message_sent(UUID) TO authenticated;

-- Cuando alguien del embudo crea su cuenta de socio, su lead queda "registrado".
CREATE OR REPLACE FUNCTION public.link_partner_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'OPERATOR' THEN
    UPDATE partner_leads
       SET status = 'registered', profile_id = NEW.id
     WHERE status IN ('new', 'contacted')
       AND ((NEW.email IS NOT NULL AND lower(email) = lower(NEW.email))
         OR (NEW.phone IS NOT NULL AND right(regexp_replace(phone, '\D', '', 'g'), 8)
                                     = right(regexp_replace(NEW.phone, '\D', '', 'g'), 8)));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.link_partner_lead() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_link_partner_lead ON public.profiles;
CREATE TRIGGER trg_link_partner_lead
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.link_partner_lead();

-- ---------------------------------------------------------------
-- 2. Datos del socio (AGT-02)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operator_profiles (
  operator_id          UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  dui_number           TEXT CHECK (dui_number IS NULL OR dui_number ~ '^\d{8}-\d$'),
  nit                  TEXT CHECK (nit IS NULL OR nit ~ '^\d{4}-\d{6}-\d{3}-\d$'),
  service_types        TEXT[],
  bank_name            TEXT,
  bank_account_type    TEXT CHECK (bank_account_type IS NULL OR bank_account_type IN ('ahorro', 'corriente')),
  bank_account_number  TEXT CHECK (bank_account_number IS NULL OR bank_account_number ~ '^\d{6,24}$'),
  bank_account_holder  TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operator_profiles IS
  '00114 (AGT-02): datos del socio para operar y cobrar. Aparte de profile_sensitive '
  'para que el DUI de un socio no cruce con el padrón de afiliados. Solo por RPC; '
  'la cuenta bancaria solo la ven el socio y el admin (soporte la ve enmascarada).';

ALTER TABLE public.operator_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_profiles FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS update_operator_profiles_updated_at ON public.operator_profiles;
CREATE TRIGGER update_operator_profiles_updated_at
  BEFORE UPDATE ON public.operator_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auditoría sin los datos bancarios completos (solo que cambiaron).
DROP TRIGGER IF EXISTS trg_audit ON public.operator_profiles;
CREATE TRIGGER trg_audit
  AFTER UPDATE ON public.operator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('dui_number,nit,bank_account_number');

-- Documentos: NIT nuevo; vencimiento y revisión por documento.
ALTER TABLE public.operator_documents DROP CONSTRAINT IF EXISTS operator_documents_doc_type_check;
ALTER TABLE public.operator_documents ADD CONSTRAINT operator_documents_doc_type_check
  CHECK (doc_type IN ('dui_front', 'dui_back', 'license', 'nit', 'circulation', 'tow_photo', 'insurance'));

ALTER TABLE public.operator_documents
  ADD COLUMN IF NOT EXISTS expires_on       DATE,
  ADD COLUMN IF NOT EXISTS review_status    TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS review_note      TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by      UUID,
  ADD COLUMN IF NOT EXISTS expiry_warned_at TIMESTAMPTZ;
ALTER TABLE public.operator_documents DROP CONSTRAINT IF EXISTS operator_documents_review_status_check;
ALTER TABLE public.operator_documents ADD CONSTRAINT operator_documents_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'rejected'));

-- Lo ya aprobado en bloque queda aprobado documento por documento.
UPDATE public.operator_documents d SET review_status = 'approved'
  FROM public.profiles p
 WHERE p.id = d.operator_id AND p.verification_status = 'approved' AND d.review_status = 'pending';

-- Estado nuevo: suspendido (documento vencido). Pool y aceptar exigen
-- 'approved' (00058), así que suspender ya corta los servicios.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_verification_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_verification_status_check
  CHECK (verification_status IN ('pending', 'approved', 'rejected', 'suspended'));

CREATE OR REPLACE FUNCTION public.partner_required_docs()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY['dui_front', 'dui_back', 'license', 'nit', 'circulation', 'tow_photo', 'insurance'] $$;

CREATE OR REPLACE FUNCTION public.partner_expiring_docs()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY['license', 'circulation', 'insurance'] $$;

CREATE OR REPLACE FUNCTION public.partner_doc_bucket(p_doc_type TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN p_doc_type IN ('dui_front', 'dui_back', 'license', 'nit') THEN 'id-documents' ELSE 'vehicle-documents' END $$;

-- ¿Puede el socio editar su registro? Mientras arma (pendiente sin enviar), si
-- se lo rechazaron o si está suspendido. Enviado o aprobado: congelado.
CREATE OR REPLACE FUNCTION public.partner_can_edit(p_operator UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT (verification_status = 'pending' AND verification_submitted_at IS NULL)
            OR verification_status IN ('rejected', 'suspended')
       FROM profiles WHERE id = p_operator AND role = 'OPERATOR'),
    false)
$$;

REVOKE ALL ON FUNCTION public.partner_can_edit(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.partner_save_identity(p_full_name TEXT, p_phone TEXT, p_dui TEXT, p_nit TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_dui   TEXT := regexp_replace(COALESCE(p_dui, ''), '\D', '', 'g');
  v_nit   TEXT := regexp_replace(COALESCE(p_nit, ''), '\D', '', 'g');
BEGIN
  IF NOT partner_can_edit(auth.uid()) THEN
    RAISE EXCEPTION 'Tu registro está en revisión o ya fue aprobado: no se puede cambiar desde aquí';
  END IF;
  IF length(btrim(COALESCE(p_full_name, ''))) < 3 THEN RAISE EXCEPTION 'Escribe tu nombre completo'; END IF;
  IF v_phone ~ '^503\d{8}$' THEN v_phone := substr(v_phone, 4); END IF;
  IF v_phone !~ '^[267]\d{7}$' THEN RAISE EXCEPTION 'Teléfono de El Salvador de 8 dígitos'; END IF;
  IF length(v_dui) <> 9 THEN RAISE EXCEPTION 'El DUI tiene 9 dígitos (########-#)'; END IF;
  IF length(v_nit) <> 14 THEN RAISE EXCEPTION 'El NIT tiene 14 dígitos (####-######-###-#)'; END IF;

  UPDATE profiles SET full_name = btrim(p_full_name), phone = '+503' || v_phone, updated_at = now()
   WHERE id = auth.uid();
  INSERT INTO operator_profiles (operator_id, dui_number, nit)
  VALUES (auth.uid(), substr(v_dui, 1, 8) || '-' || substr(v_dui, 9, 1),
          substr(v_nit, 1, 4) || '-' || substr(v_nit, 5, 6) || '-' || substr(v_nit, 11, 3) || '-' || substr(v_nit, 14, 1))
  ON CONFLICT (operator_id) DO UPDATE SET dui_number = EXCLUDED.dui_number, nit = EXCLUDED.nit;
END;
$$;

CREATE OR REPLACE FUNCTION public.partner_save_services(p_service_types TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_types TEXT[];
BEGIN
  IF NOT partner_can_edit(auth.uid()) THEN
    RAISE EXCEPTION 'Tu registro está en revisión o ya fue aprobado: no se puede cambiar desde aquí';
  END IF;
  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_types
    FROM unnest(COALESCE(p_service_types, '{}')) t
   WHERE t IN (SELECT slug FROM services WHERE is_active);
  IF v_types IS NULL THEN RAISE EXCEPTION 'Elige al menos un servicio'; END IF;
  INSERT INTO operator_profiles (operator_id, service_types) VALUES (auth.uid(), v_types)
  ON CONFLICT (operator_id) DO UPDATE SET service_types = EXCLUDED.service_types;
END;
$$;

CREATE OR REPLACE FUNCTION public.partner_save_bank(p_bank_name TEXT, p_account_type TEXT, p_account_number TEXT, p_holder TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_num TEXT := regexp_replace(COALESCE(p_account_number, ''), '\D', '', 'g');
BEGIN
  IF NOT partner_can_edit(auth.uid()) THEN
    RAISE EXCEPTION 'Tu registro está en revisión o ya fue aprobado: para cambiar tu cuenta escríbele a soporte';
  END IF;
  IF length(btrim(COALESCE(p_bank_name, ''))) < 2 THEN RAISE EXCEPTION 'Indica el banco'; END IF;
  IF p_account_type NOT IN ('ahorro', 'corriente') THEN RAISE EXCEPTION 'Tipo de cuenta: ahorro o corriente'; END IF;
  IF v_num !~ '^\d{6,24}$' THEN RAISE EXCEPTION 'Número de cuenta inválido'; END IF;
  IF length(btrim(COALESCE(p_holder, ''))) < 3 THEN RAISE EXCEPTION 'Indica el titular de la cuenta'; END IF;
  INSERT INTO operator_profiles (operator_id, bank_name, bank_account_type, bank_account_number, bank_account_holder)
  VALUES (auth.uid(), btrim(p_bank_name), p_account_type, v_num, btrim(p_holder))
  ON CONFLICT (operator_id) DO UPDATE SET bank_name = EXCLUDED.bank_name, bank_account_type = EXCLUDED.bank_account_type,
    bank_account_number = EXCLUDED.bank_account_number, bank_account_holder = EXCLUDED.bank_account_holder;
END;
$$;

-- La unidad del socio (00107), ahora también desde su registro.
CREATE OR REPLACE FUNCTION public.partner_save_vehicle(p_plate TEXT, p_vehicle_type TEXT, p_capacity_m3 NUMERIC DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_plate TEXT := upper(regexp_replace(COALESCE(p_plate, ''), '\s+', '', 'g'));
BEGIN
  IF NOT partner_can_edit(auth.uid()) THEN
    RAISE EXCEPTION 'Tu registro está en revisión o ya fue aprobado: para cambiar tu unidad escríbele a soporte';
  END IF;
  IF v_plate !~ '^[A-Z0-9-]{3,12}$' THEN RAISE EXCEPTION 'Placa inválida'; END IF;
  IF p_vehicle_type NOT IN ('tow_light', 'tow_heavy', 'water_truck', 'service') THEN RAISE EXCEPTION 'Tipo de unidad inválido'; END IF;
  IF p_vehicle_type = 'water_truck' AND (p_capacity_m3 IS NULL OR p_capacity_m3 <= 0) THEN
    RAISE EXCEPTION 'Indica la capacidad de la pipa en m³';
  END IF;

  UPDATE operator_vehicles SET is_active = false WHERE operator_id = auth.uid() AND is_active;
  INSERT INTO operator_vehicles (operator_id, plate, vehicle_type, capacity_m3)
  VALUES (auth.uid(), v_plate, p_vehicle_type, CASE WHEN p_vehicle_type = 'water_truck' THEN p_capacity_m3 END);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'La placa % ya está registrada por otro socio', v_plate;
END;
$$;

-- Subir/cambiar un documento. Reemplaza la versión de 3 argumentos (00055):
-- el cuarto (vencimiento) tiene default, así la app vieja sigue llamándola.
DROP FUNCTION IF EXISTS public.upsert_operator_document(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.upsert_operator_document(
  p_doc_type   TEXT,
  p_bucket     TEXT,
  p_path       TEXT,
  p_expires_on DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc     operator_documents;
  v_renewal BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'OPERATOR') THEN
    RAISE EXCEPTION 'Solo un socio operador sube documentos';
  END IF;
  IF NOT (p_doc_type = ANY (partner_required_docs())) THEN
    RAISE EXCEPTION 'Tipo de documento inválido';
  END IF;
  -- 00114: el archivo tiene que estar en SU carpeta y en el bucket del tipo.
  IF p_bucket IS DISTINCT FROM partner_doc_bucket(p_doc_type) THEN
    RAISE EXCEPTION 'Ese documento va en otro almacenamiento';
  END IF;
  IF p_path IS NULL OR split_part(p_path, '/', 1) <> auth.uid()::text THEN
    RAISE EXCEPTION 'Ruta de archivo inválida';
  END IF;
  IF p_doc_type = ANY (partner_expiring_docs()) AND (p_expires_on IS NULL OR p_expires_on <= sv_today()) THEN
    RAISE EXCEPTION 'Indica la fecha de vencimiento (tiene que estar vigente)';
  END IF;

  SELECT * INTO v_doc FROM operator_documents WHERE operator_id = auth.uid() AND doc_type = p_doc_type;
  -- Renovación: un documento que vence en 30 días o menos (o ya venció) se puede
  -- reemplazar aunque la cuenta esté aprobada; vuelve a revisión solo ese.
  v_renewal := v_doc.id IS NOT NULL AND v_doc.expires_on IS NOT NULL AND v_doc.expires_on <= sv_today() + 30;
  IF NOT partner_can_edit(auth.uid()) AND NOT v_renewal THEN
    RAISE EXCEPTION 'Los documentos no se pueden cambiar mientras la verificación está en revisión o ya aprobada';
  END IF;

  INSERT INTO operator_documents (operator_id, doc_type, bucket, path, expires_on, review_status)
  VALUES (auth.uid(), p_doc_type, p_bucket, p_path,
          CASE WHEN p_doc_type = ANY (partner_expiring_docs()) THEN p_expires_on END, 'pending')
  ON CONFLICT (operator_id, doc_type) DO UPDATE
    SET bucket = EXCLUDED.bucket, path = EXCLUDED.path, uploaded_at = now(),
        expires_on = EXCLUDED.expires_on, review_status = 'pending', review_note = NULL,
        reviewed_at = NULL, reviewed_by = NULL, expiry_warned_at = NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_operator_document(TEXT, TEXT, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_operator_document(TEXT, TEXT, TEXT, DATE) TO authenticated;

-- Qué falta para enviar. Una sola definición, usada por el avance y por el envío.
CREATE OR REPLACE FUNCTION public.partner_missing(p_operator UUID)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH p AS (SELECT * FROM profiles WHERE id = p_operator),
       op AS (SELECT * FROM operator_profiles WHERE operator_id = p_operator),
       indep AS (SELECT (SELECT provider_id FROM p) IS NULL AS v)
  SELECT array_remove(ARRAY[
    CASE WHEN length(btrim(COALESCE((SELECT full_name FROM p), ''))) < 3 OR (SELECT phone FROM p) IS NULL
              OR (SELECT dui_number FROM op) IS NULL OR (SELECT nit FROM op) IS NULL THEN 'identidad' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM operator_vehicles WHERE operator_id = p_operator AND is_active) THEN 'unidad' END,
    CASE WHEN (SELECT v FROM indep) AND COALESCE(cardinality((SELECT service_types FROM op)), 0) = 0 THEN 'servicios' END,
    CASE WHEN (SELECT v FROM indep) AND (SELECT bank_account_number FROM op) IS NULL THEN 'cuenta_bancaria' END
  ] || ARRAY(
    SELECT 'documento:' || rt FROM unnest(partner_required_docs()) rt
     WHERE NOT EXISTS (SELECT 1 FROM operator_documents d
                        WHERE d.operator_id = p_operator AND d.doc_type = rt
                          AND d.review_status <> 'rejected'
                          AND (d.expires_on IS NULL OR d.expires_on > sv_today()))
  ), NULL)
$$;

REVOKE ALL ON FUNCTION public.partner_missing(UUID) FROM PUBLIC, anon, authenticated;

-- El avance del registro, para la web y la app.
CREATE OR REPLACE FUNCTION public.my_partner_application()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p  profiles;
  v_op operator_profiles;
  v_state TEXT;
BEGIN
  SELECT * INTO v_p FROM profiles WHERE id = auth.uid() AND role = 'OPERATOR';
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no es de un socio operador';
  END IF;
  SELECT * INTO v_op FROM operator_profiles WHERE operator_id = auth.uid();

  v_state := CASE
    WHEN v_p.verification_status = 'approved' THEN 'approved'
    WHEN v_p.verification_status = 'rejected' THEN 'rejected'
    WHEN v_p.verification_status = 'suspended' THEN 'suspended'
    WHEN v_p.verification_submitted_at IS NOT NULL THEN 'in_review'
    ELSE 'draft' END;

  RETURN jsonb_build_object(
    'state', v_state,
    'rejection_reason', v_p.verification_rejection_reason,
    'can_edit', partner_can_edit(auth.uid()),
    'independent', v_p.provider_id IS NULL,
    'identity', jsonb_build_object('full_name', v_p.full_name, 'phone', v_p.phone,
                                   'dui', v_op.dui_number, 'nit', v_op.nit),
    'services', COALESCE(to_jsonb(v_op.service_types), '[]'::jsonb),
    'bank', CASE WHEN v_op.bank_account_number IS NULL THEN NULL ELSE jsonb_build_object(
              'bank_name', v_op.bank_name, 'account_type', v_op.bank_account_type,
              'account_last4', right(v_op.bank_account_number, 4), 'holder', v_op.bank_account_holder) END,
    'vehicle', (SELECT jsonb_build_object('plate', plate, 'vehicle_type', vehicle_type, 'capacity_m3', capacity_m3)
                  FROM operator_vehicles WHERE operator_id = auth.uid() AND is_active),
    'documents', (SELECT COALESCE(jsonb_object_agg(d.doc_type, jsonb_build_object(
                     'path', d.path, 'bucket', d.bucket, 'uploaded_at', d.uploaded_at, 'expires_on', d.expires_on,
                     'review_status', d.review_status, 'review_note', d.review_note,
                     'expired', d.expires_on IS NOT NULL AND d.expires_on <= sv_today(),
                     'expiring_soon', d.expires_on IS NOT NULL AND d.expires_on <= sv_today() + 30)), '{}'::jsonb)
                    FROM operator_documents d WHERE d.operator_id = auth.uid()),
    'missing', to_jsonb(partner_missing(auth.uid()))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_partner_application() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_partner_application() TO authenticated;

-- Enviar a revisión (misma firma que la app ya usa).
CREATE OR REPLACE FUNCTION public.submit_operator_verification()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_missing TEXT[];
BEGIN
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
$$;

-- ---------------------------------------------------------------
-- 3. Revisión (AGT-03)
-- ---------------------------------------------------------------
-- Si un socio suspendido ya tiene todo aprobado y vigente, vuelve a estar activo.
CREATE OR REPLACE FUNCTION public.partner_try_reactivate(p_operator UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (SELECT verification_status FROM profiles WHERE id = p_operator) <> 'suspended' THEN
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
$$;

REVOKE ALL ON FUNCTION public.partner_try_reactivate(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_document(
  p_operator_id UUID,
  p_doc_type    TEXT,
  p_status      TEXT,
  p_note        TEXT DEFAULT NULL,
  p_expires_on  DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el personal de Budi revisa documentos';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;
  IF p_status = 'rejected' AND length(btrim(COALESCE(p_note, ''))) < 3 THEN
    RAISE EXCEPTION 'Indica qué hay que corregir en el documento';
  END IF;

  UPDATE operator_documents
     SET review_status = p_status,
         review_note = CASE WHEN p_status = 'rejected' THEN btrim(p_note) END,
         reviewed_at = now(), reviewed_by = auth.uid(),
         -- El revisor puede corregir la fecha de vencimiento leída del documento.
         expires_on = CASE WHEN doc_type = ANY (partner_expiring_docs()) THEN COALESCE(p_expires_on, expires_on) END
   WHERE operator_id = p_operator_id AND doc_type = p_doc_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese documento no está cargado';
  END IF;

  RETURN jsonb_build_object('reactivated', partner_try_reactivate(p_operator_id));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_document(UUID, TEXT, TEXT, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_document(UUID, TEXT, TEXT, TEXT, DATE) TO authenticated;

-- Decisión global. Aprobar exige cada documento obligatorio aprobado y vigente;
-- rechazar sin motivo arma el motivo con las notas de los documentos rechazados.
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
    SELECT array_agg(rt) INTO v_pending FROM unnest(partner_required_docs()) rt
     WHERE NOT EXISTS (SELECT 1 FROM operator_documents d
                        WHERE d.operator_id = p_operator_id AND d.doc_type = rt AND d.review_status = 'approved'
                          AND (d.expires_on IS NULL OR d.expires_on > sv_today()));
    IF v_pending IS NOT NULL THEN
      RAISE EXCEPTION 'Antes de aprobar, revisa y aprueba cada documento. Faltan: %', array_to_string(v_pending, ', ');
    END IF;
  END IF;

  IF p_status IN ('rejected', 'suspended') AND v_reason IS NULL THEN
    SELECT string_agg(doc_type || ': ' || review_note, '; ') INTO v_reason
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

-- Ficha completa del registro para quien revisa. La cuenta bancaria completa
-- solo para el admin; soporte la ve enmascarada (00104: soporte no ve dinero).
CREATE OR REPLACE FUNCTION public.admin_partner_application(p_operator_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p  profiles;
  v_op operator_profiles;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el personal de Budi revisa socios';
  END IF;
  SELECT * INTO v_p FROM profiles WHERE id = p_operator_id AND role = 'OPERATOR';
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'No es un socio operador'; END IF;
  SELECT * INTO v_op FROM operator_profiles WHERE operator_id = p_operator_id;

  RETURN jsonb_build_object(
    'identity', jsonb_build_object('full_name', v_p.full_name, 'phone', v_p.phone, 'email', v_p.email,
                                   'dui', v_op.dui_number, 'nit', v_op.nit),
    'independent', v_p.provider_id IS NULL,
    'provider', (SELECT name FROM providers WHERE id = v_p.provider_id),
    'services', COALESCE(to_jsonb(v_op.service_types), '[]'::jsonb),
    'bank', CASE WHEN v_op.bank_account_number IS NULL THEN NULL ELSE jsonb_build_object(
              'bank_name', v_op.bank_name, 'account_type', v_op.bank_account_type,
              'account_number', CASE WHEN is_admin() THEN v_op.bank_account_number
                                     ELSE '••••' || right(v_op.bank_account_number, 4) END,
              'holder', v_op.bank_account_holder,
              'holder_matches', lower(unaccent_simple(v_op.bank_account_holder)) = lower(unaccent_simple(v_p.full_name))) END,
    'vehicle', (SELECT jsonb_build_object('plate', plate, 'vehicle_type', vehicle_type, 'capacity_m3', capacity_m3)
                  FROM operator_vehicles WHERE operator_id = p_operator_id AND is_active),
    'missing', to_jsonb(partner_missing(p_operator_id)),
    'documents', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'doc_type', d.doc_type, 'bucket', d.bucket, 'path', d.path, 'uploaded_at', d.uploaded_at,
                     'expires_on', d.expires_on, 'review_status', d.review_status, 'review_note', d.review_note,
                     'expired', d.expires_on IS NOT NULL AND d.expires_on <= sv_today())
                   ORDER BY array_position(partner_required_docs(), d.doc_type)), '[]'::jsonb)
                    FROM operator_documents d WHERE d.operator_id = p_operator_id)
  );
END;
$$;

-- Comparar nombres sin tildes (titular de la cuenta contra el nombre del socio).
CREATE OR REPLACE FUNCTION public.unaccent_simple(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT translate(btrim(regexp_replace(COALESCE(p, ''), '\s+', ' ', 'g')), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU') $$;

REVOKE ALL ON FUNCTION public.admin_partner_application(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_partner_application(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.partner_save_identity(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_save_services(TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_save_bank(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_save_vehicle(TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_save_identity(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_save_services(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_save_bank(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_save_vehicle(TEXT, TEXT, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------
-- 4. Vencimientos: aviso 15 días antes y suspensión automática
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_operator_document_expiry()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_warned    INT;
  v_suspended INT := 0;
  r RECORD;
  v_label JSONB := '{"license": "licencia de conducir", "circulation": "tarjeta de circulación", "insurance": "seguro del vehículo"}';
BEGIN
  -- Aviso: vence en 15 días o menos y todavía no se avisó por este documento.
  WITH avisar AS (
    UPDATE operator_documents d SET expiry_warned_at = now()
      FROM profiles p
     WHERE p.id = d.operator_id AND p.verification_status = 'approved'
       AND d.expires_on IS NOT NULL AND d.expires_on > sv_today() AND d.expires_on <= sv_today() + 15
       AND d.expiry_warned_at IS NULL
    RETURNING d.operator_id, d.doc_type, d.expires_on
  )
  INSERT INTO notification_queue (user_id, title, body, data, created_at)
  SELECT operator_id, 'Un documento está por vencer',
         'Tu ' || (v_label ->> doc_type) || ' vence el ' || to_char(expires_on, 'DD/MM/YYYY')
         || '. Sube el documento renovado para no quedar en pausa.',
         jsonb_build_object('type', 'document_expiring', 'doc_type', doc_type, 'role', 'operator'), now()
    FROM avisar;
  GET DIAGNOSTICS v_warned = ROW_COUNT;

  -- Vencido: se suspende al socio aprobado.
  FOR r IN
    SELECT p.id, string_agg(v_label ->> d.doc_type, ', ') AS docs
      FROM profiles p JOIN operator_documents d ON d.operator_id = p.id
     WHERE p.verification_status = 'approved' AND d.expires_on IS NOT NULL AND d.expires_on <= sv_today()
     GROUP BY p.id
  LOOP
    UPDATE profiles SET verification_status = 'suspended',
                        verification_rejection_reason = 'Documento vencido: ' || r.docs,
                        verification_reviewed_at = now()
     WHERE id = r.id;
    -- Si estaba en línea, deja de recibir solicitudes ya.
    UPDATE operator_locations SET is_online = false WHERE operator_id = r.id;
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (r.id, 'Cuenta en pausa', 'Se venció tu ' || r.docs || '. Sube el documento renovado para volver a recibir solicitudes.',
            jsonb_build_object('type', 'verification_result', 'status', 'suspended', 'role', 'operator'), now());
    v_suspended := v_suspended + 1;
  END LOOP;

  RETURN jsonb_build_object('warned', v_warned, 'suspended', v_suspended, 'ran_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.check_operator_document_expiry() FROM PUBLIC, anon, authenticated;

-- Todos los días a las 06:00 de El Salvador (12:00 UTC).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-operator-document-expiry') THEN
    PERFORM cron.unschedule('check-operator-document-expiry');
  END IF;
  PERFORM cron.schedule('check-operator-document-expiry', '0 12 * * *',
                        $cron$SELECT public.check_operator_document_expiry();$cron$);
END;
$$;

-- ---------------------------------------------------------------
-- 5. Servicios del independiente y Storage
-- ---------------------------------------------------------------
-- Un independiente atiende lo que declaró. Sin declaración (socios de antes
-- de 00114) se mantiene el comportamiento anterior.
CREATE OR REPLACE FUNCTION public.operator_can_serve(p_operator uuid, p_service_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH empresa AS (
    SELECT provider_id FROM profiles WHERE id = p_operator
  ),
  declarados AS (
    SELECT s.slug
      FROM provider_services ps
      JOIN services s ON s.id = ps.service_id
     WHERE ps.provider_id = (SELECT provider_id FROM empresa)
       AND ps.is_available
       AND s.is_active
  ),
  propios AS (
    SELECT service_types FROM operator_profiles WHERE operator_id = p_operator
  )
  SELECT CASE
    WHEN (SELECT provider_id FROM empresa) IS NULL THEN
      COALESCE(cardinality((SELECT service_types FROM propios)), 0) = 0
      OR COALESCE(p_service_type, 'tow') = ANY (COALESCE((SELECT service_types FROM propios), '{}'::text[]))
    ELSE
      NOT EXISTS (SELECT 1 FROM declarados)
      OR COALESCE(p_service_type, 'tow') IN (SELECT slug FROM declarados)
  END;
$function$;

-- vehicle-documents se congelaba solo en id-documents (00061): un socio aprobado
-- podía sobrescribir su tarjeta de circulación, seguro o foto. Para los
-- Usuarios (id_documents_frozen() es falso) no cambia nada.
DROP POLICY IF EXISTS "Users can update own vehicle documents" ON storage.objects;
CREATE POLICY "Users can update own vehicle documents" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vehicle-documents' AND (auth.uid())::text = (storage.foldername(name))[1] AND NOT id_documents_frozen());

DROP POLICY IF EXISTS "Users can delete own vehicle documents" ON storage.objects;
CREATE POLICY "Users can delete own vehicle documents" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'vehicle-documents' AND (auth.uid())::text = (storage.foldername(name))[1] AND NOT id_documents_frozen());

-- ---------------------------------------------------------------
-- 6. Datos personales nuevos en la eliminación de cuenta y la retención
-- ---------------------------------------------------------------
-- anonymize_account (00101): también los datos del socio y su pre-registro.
CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role::text INTO v_role FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'La cuenta no existe';
  END IF;

  -- Las cuentas de gestion (admin, aseguradora, MOPT) las da de alta y de baja
  -- Budi: no son cuentas de consumidor, y borrar una se lleva el acceso de una
  -- organizacion entera.
  IF v_role NOT IN ('USER', 'OPERATOR') THEN
    RAISE EXCEPTION 'Esta cuenta la administra Budi. Pedi la baja a soporte.';
  END IF;

  -- Con un servicio en curso, borrar la cuenta dejaria a alguien varado (o a un
  -- operador sin poder cerrar el servicio).
  IF EXISTS (
    SELECT 1 FROM service_requests
     WHERE (user_id = p_user_id OR operator_id = p_user_id)
       AND status IN ('initiated', 'assigned', 'en_route', 'active')
  ) THEN
    RAISE EXCEPTION 'Tienes un servicio en curso. Termínalo o cancélalo antes de eliminar tu cuenta.';
  END IF;

  -- Login: primero auth.users, porque el trigger on_auth_user_email_updated
  -- copia el email al perfil y lo pisaria si fuera al reves.
  UPDATE auth.users
     SET email = 'eliminada+' || p_user_id || '@cuentas.budi.invalid',
         phone = NULL,
         encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
         raw_user_meta_data = '{}'::jsonb,
         -- 100 anos y no 'infinity': GoTrue (Go) no sabe leer una fecha infinita
         -- y responde 500 a toda operacion sobre el usuario, incluido el logout.
         -- Es la misma duracion que usa la API admin de Supabase para banear.
         banned_until = now() + interval '100 years',
         updated_at = now()
   WHERE id = p_user_id;
  DELETE FROM auth.sessions        WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens  WHERE user_id = p_user_id::text;
  DELETE FROM auth.identities      WHERE user_id = p_user_id;
  DELETE FROM auth.mfa_factors     WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;

  -- Perfil. El rol se conserva: los registros historicos dicen "un cliente" o
  -- "un operador", no quien.
  UPDATE profiles
     SET full_name = 'Cuenta eliminada',
         phone = '',
         email = NULL,
         marketing_opt_in = false,
         provider_id = NULL,
         insurer_id = NULL,
         verification_status = CASE WHEN role = 'OPERATOR' THEN 'rejected' END,
         verification_rejection_reason = CASE WHEN role = 'OPERATOR' THEN 'Cuenta eliminada por su titular' END,
         updated_at = now()
   WHERE id = p_user_id;

  DELETE FROM profile_sensitive  WHERE profile_id = p_user_id;
  -- 00114: DUI, NIT y cuenta bancaria del socio, y su pre-registro.
  DELETE FROM operator_profiles  WHERE operator_id = p_user_id;
  DELETE FROM partner_leads      WHERE profile_id = p_user_id;
  DELETE FROM vehicles           WHERE user_id = p_user_id;
  DELETE FROM device_tokens      WHERE user_id = p_user_id;
  DELETE FROM notification_queue WHERE user_id = p_user_id;
  DELETE FROM operator_documents WHERE operator_id = p_user_id;
  DELETE FROM operator_locations WHERE operator_id = p_user_id;
  DELETE FROM pin_attempts       WHERE operator_id = p_user_id;

  UPDATE members SET profile_id = NULL, updated_at = now() WHERE profile_id = p_user_id;

  -- En sus servicios queda el hecho (que, donde, cuanto), no el vehiculo.
  UPDATE service_requests
     SET vehicle_plate = NULL, vehicle_make = NULL, vehicle_model = NULL, vehicle_color = NULL,
         vehicle_photo_url = NULL, vehicle_doc_path = NULL, notes = NULL
   WHERE user_id = p_user_id;

  UPDATE request_messages SET message = '[mensaje eliminado]' WHERE sender_id = p_user_id;
  UPDATE ratings SET comment = NULL WHERE rater_user_id = p_user_id;

  INSERT INTO account_deletions (user_id, role) VALUES (p_user_id, v_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'role', v_role);
END;
$function$;

-- purge_expired_personal_data (00111): pre-registros no convertidos, 12 meses.
CREATE OR REPLACE FUNCTION public.purge_expired_personal_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_trail_cutoff TIMESTAMPTZ := now() - interval '90 days';
  v_chat_cutoff  TIMESTAMPTZ := now() - interval '12 months';
  v_trail INT;
  v_chat  INT;
  r RECORD;
BEGIN
  -- Servicios cerrados hace mas de 90 dias: primero los km, despues el recorrido.
  FOR r IN
    SELECT sr.id
      FROM service_requests sr
      JOIN cases c ON c.request_id = sr.id
     WHERE sr.status = 'completed'
       AND sr.completed_at < v_trail_cutoff
       AND c.km_computed_at IS NULL
       AND EXISTS (SELECT 1 FROM service_location_trail t WHERE t.request_id = sr.id)
  LOOP
    PERFORM compute_case_km(r.id);
  END LOOP;

  DELETE FROM service_location_trail t
   USING service_requests sr
   WHERE sr.id = t.request_id
     AND sr.status IN ('completed', 'cancelled')
     AND COALESCE(sr.completed_at, sr.cancelled_at, sr.updated_at) < v_trail_cutoff;
  GET DIAGNOSTICS v_trail = ROW_COUNT;

  DELETE FROM request_messages WHERE created_at < v_chat_cutoff;
  -- 00114: pre-registros de socios que no se registraron en 12 meses.
  DELETE FROM partner_leads WHERE status IN ('new', 'contacted', 'discarded') AND created_at < v_chat_cutoff;
  GET DIAGNOSTICS v_chat = ROW_COUNT;

  RETURN jsonb_build_object('trail_points', v_trail, 'chat_messages', v_chat, 'ran_at', now());
END;
$function$;
