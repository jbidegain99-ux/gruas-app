-- 00126: contrato digital del socio operador (backlog AGT-04)
--
-- Términos versionados: una versión publicada no se edita ni se borra; un
-- cambio es una versión nueva. La aceptación queda con fecha, versión, IP y
-- navegador (evidencia por versión). Sin aceptar la versión vigente, el
-- registro del socio no se puede enviar a revisión (`partner_missing` suma
-- 'contrato'); si se publica una versión nueva, el socio ya aprobado la ve
-- pendiente (`terms_pending`) y la acepta desde su registro.
--
-- El texto de la v1 es un BORRADOR para revisión legal (dice así en el título).

CREATE TABLE public.terms_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL CHECK (kind IN ('partner')),
  version      TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (kind, version)
);

CREATE TABLE public.terms_acceptances (
  profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  terms_id    UUID NOT NULL REFERENCES public.terms_documents(id),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  user_agent  TEXT,
  PRIMARY KEY (profile_id, terms_id)
);

ALTER TABLE public.terms_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.terms_documents, public.terms_acceptances FROM anon, authenticated;

-- Evidencia: ni un documento publicado ni una aceptación se modifican.
CREATE OR REPLACE FUNCTION public.terms_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Los términos publicados y sus aceptaciones no se modifican: publica una versión nueva';
END;
$$;
CREATE TRIGGER trg_terms_documents_immutable BEFORE UPDATE ON public.terms_documents
  FOR EACH ROW EXECUTE FUNCTION public.terms_immutable();
CREATE TRIGGER trg_terms_acceptances_immutable BEFORE UPDATE ON public.terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.terms_immutable();

-- La vigente de cada tipo: la última publicada.
CREATE OR REPLACE FUNCTION public.current_terms_id(p_kind TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM terms_documents WHERE kind = p_kind ORDER BY published_at DESC, id DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_terms_id(TEXT) FROM PUBLIC, anon, authenticated;

-- Pública: la landing de socios muestra el contrato antes de registrarse.
CREATE OR REPLACE FUNCTION public.current_terms(p_kind TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('id', id, 'version', version, 'title', title, 'body', body, 'published_at', published_at)
    FROM terms_documents WHERE id = current_terms_id(p_kind);
$$;
REVOKE ALL ON FUNCTION public.current_terms(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_terms(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_terms(p_terms_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t terms_documents;
  v_headers JSON;
  v_ip TEXT;
  v_ua TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesión';
  END IF;
  SELECT * INTO t FROM terms_documents WHERE id = p_terms_id;
  IF t.id IS NULL OR t.id IS DISTINCT FROM current_terms_id(t.kind) THEN
    RAISE EXCEPTION 'Esa versión ya no es la vigente: recarga la página y lee la actual';
  END IF;
  IF t.kind = 'partner' AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'OPERATOR') THEN
    RAISE EXCEPTION 'Este contrato es para socios operadores';
  END IF;

  -- La IP y el navegador los pone el gateway (PostgREST expone las cabeceras).
  BEGIN
    v_headers := current_setting('request.headers', true)::json;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;
  v_ip := btrim(split_part(COALESCE(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip', ''), ',', 1));
  v_ua := left(v_headers->>'user-agent', 300);

  INSERT INTO terms_acceptances (profile_id, terms_id, ip, user_agent)
  VALUES (auth.uid(), p_terms_id, NULLIF(v_ip, ''), v_ua)
  ON CONFLICT (profile_id, terms_id) DO NOTHING;

  RETURN (SELECT jsonb_build_object('version', t.version, 'accepted_at', a.accepted_at)
            FROM terms_acceptances a WHERE a.profile_id = auth.uid() AND a.terms_id = p_terms_id);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_terms(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_terms(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_publish_terms(p_kind TEXT, p_version TEXT, p_title TEXT, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador publica términos';
  END IF;
  IF NULLIF(btrim(COALESCE(p_version, '')), '') IS NULL OR NULLIF(btrim(COALESCE(p_title, '')), '') IS NULL
     OR char_length(btrim(COALESCE(p_body, ''))) < 200 THEN
    RAISE EXCEPTION 'Indica versión, título y el texto completo';
  END IF;
  INSERT INTO terms_documents (kind, version, title, body, published_by)
  VALUES (p_kind, btrim(p_version), btrim(p_title), btrim(p_body), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_publish_terms(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publish_terms(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ¿Aceptó la vigente? (sin términos publicados, no hay nada que aceptar)
CREATE OR REPLACE FUNCTION public.partner_terms_pending(p_operator UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT current_terms_id('partner') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM terms_acceptances
                      WHERE profile_id = p_operator AND terms_id = current_terms_id('partner'));
$$;
REVOKE ALL ON FUNCTION public.partner_terms_pending(UUID) FROM PUBLIC, anon, authenticated;

-- partner_missing (00114) + 'contrato'.
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
    CASE WHEN (SELECT v FROM indep) AND (SELECT bank_account_number FROM op) IS NULL THEN 'cuenta_bancaria' END,
    -- 00126 (AGT-04): el contrato vigente, aceptado.
    CASE WHEN partner_terms_pending(p_operator) THEN 'contrato' END
  ] || ARRAY(
    SELECT 'documento:' || rt FROM unnest(partner_required_docs()) rt
     WHERE NOT EXISTS (SELECT 1 FROM operator_documents d
                        WHERE d.operator_id = p_operator AND d.doc_type = rt
                          AND d.review_status <> 'rejected'
                          AND (d.expires_on IS NULL OR d.expires_on > sv_today()))
  ), NULL)
$$;

-- my_partner_application y admin_partner_application: la aceptación.
DO $$
DECLARE v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.my_partner_application()'::regprocedure) INTO v_def;
  IF position('terms_pending' IN v_def) = 0 THEN
    v_def := replace(v_def, $a$    'missing', to_jsonb(partner_missing(auth.uid()))$a$,
      $b$    -- 00126 (AGT-04): contrato vigente y si el socio ya lo aceptó.
    'terms', (SELECT jsonb_build_object('id', t.id, 'version', t.version, 'title', t.title,
                                        'accepted_at', (SELECT accepted_at FROM terms_acceptances
                                                         WHERE profile_id = auth.uid() AND terms_id = t.id))
                FROM terms_documents t WHERE t.id = current_terms_id('partner')),
    'terms_pending', partner_terms_pending(auth.uid()),
    'missing', to_jsonb(partner_missing(auth.uid()))$b$);
    IF position('terms_pending' IN v_def) = 0 THEN
      RAISE EXCEPTION 'my_partner_application cambió: no se pudo agregar el contrato';
    END IF;
    EXECUTE v_def;
  END IF;
END $$;

-- Para la revisión: qué versión aceptó, cuándo y desde qué IP.
CREATE OR REPLACE FUNCTION public.admin_partner_terms(p_operator UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de Budi';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('version', t.version, 'title', t.title, 'accepted_at', a.accepted_at,
                                        'ip', a.ip, 'user_agent', a.user_agent,
                                        'current', t.id = current_terms_id('partner'))
                     ORDER BY a.accepted_at DESC)
      FROM terms_acceptances a JOIN terms_documents t ON t.id = a.terms_id
     WHERE a.profile_id = p_operator), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_partner_terms(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_partner_terms(UUID) TO authenticated;

-- ─── Texto v1 (borrador para revisión legal) ────────────────────────────────
INSERT INTO public.terms_documents (kind, version, title, body) VALUES (
  'partner', '2026-09-v1',
  'Términos y condiciones para socios operadores (borrador para revisión legal)',
  $txt$Estos términos regulan tu relación con Budi como socio operador: la persona o empresa que presta servicios de asistencia vial (grúa, winche, batería, llanta, combustible, cerrajería, mecánica o pipa de agua) a los Usuarios que los piden por la plataforma Budi en El Salvador.

1. Relación independiente
Eres un prestador independiente. Aceptar estos términos no crea una relación laboral, de subordinación ni de exclusividad con Budi. Tú decides cuándo te pones en línea y qué solicitudes aceptas. Eres responsable de tus obligaciones tributarias, de seguridad social y de las de tu personal, si lo tienes.

2. Requisitos para operar
Mantienes vigentes y cargados en tu registro tu DUI, NIT, licencia de conducir, tarjeta de circulación, seguro del vehículo y la foto de tu unidad. Si un documento vence, tu cuenta queda en pausa hasta que el documento renovado sea aprobado. Budi puede pausar tu cuenta por incumplimiento, quejas graves o sospecha de fraude, y te avisará el motivo.

3. Cómo se presta el servicio
Llegas al lugar indicado, verificas el PIN de confirmación que te dicta el Usuario antes de iniciar y completas el servicio en la app. Nunca inicias un servicio sin el PIN. Tratas al Usuario con respeto, cuidas su vehículo y cumples las normas de tránsito.

4. Precio y comisión
El precio de cada servicio lo calcula la plataforma con las tarifas vigentes y lo ves antes de aceptar. Budi retiene una comisión por el uso de la plataforma; el porcentaje vigente es el que ves en tu app al momento de completar cada servicio. Un cambio de comisión aplica solo a los servicios completados después de su fecha de vigencia. En los servicios de cortesía del MOPT o cubiertos por una aseguradora, no le cobras nada al Usuario salvo el copago que indique la app.

5. Pagos
Budi te paga por transferencia a la cuenta bancaria que registraste, en lotes periódicos, con el detalle de los servicios que cubre cada pago. Puedes ver tus pagos y lo pendiente en la app. Los servicios de la flota del MOPT los paga el MOPT.

6. Datos personales
Usas los datos del Usuario (nombre, teléfono, ubicación) solo para prestar el servicio y no los guardas ni compartes. Budi trata tus datos según su aviso de privacidad y la Ley de Protección de Datos Personales (Decreto 144).

7. Terminación
Puedes dejar de usar la plataforma cuando quieras. Budi puede terminar la relación por incumplimiento de estos términos. Los servicios completados antes de la terminación se pagan igual.

8. Cambios
Si estos términos cambian, publicaremos una versión nueva y te pediremos aceptarla en la app para seguir recibiendo solicitudes.$txt$
);
