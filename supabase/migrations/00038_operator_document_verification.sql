-- 00038_operator_document_verification.sql
-- Verificación de operadores POR DOCUMENTOS.
-- El operador sube DUI (frente/reverso), licencia y tarjeta de circulación
-- (opcionalmente foto de la grúa y póliza) a los buckets privados que ya existen
-- (id-documents / vehicle-documents, ver 00010). El admin revisa las imágenes y
-- aprueba/rechaza al operador COMPLETO (aprobación global), con motivo si rechaza.
-- Enchufa en verification_status (00031): 'approved' sigue siendo el requisito
-- para ponerse en línea y ser despachado; NO se tocan los gates existentes.
--
-- Distinción "pendiente sin enviar" vs "en revisión": se deriva de
-- verification_submitted_at (NULL = aún no envió; NOT NULL + status 'pending' =
-- esperando revisión). Así no hay que ampliar el CHECK del enum ni tocar los
-- gates que comparan contra 'approved'.

-- ─── 1. Metadatos de revisión en profiles ───────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_reviewed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS verification_rejection_reason text;

-- ─── 2. Documentos del operador ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operator_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (
    doc_type IN ('dui_front','dui_back','license','circulation','tow_photo','insurance')
  ),
  bucket text NOT NULL,
  path text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  -- Un archivo "vigente" por tipo: re-subir reemplaza (no se acumula basura).
  UNIQUE (operator_id, doc_type)
);

ALTER TABLE public.operator_documents ENABLE ROW LEVEL SECURITY;

-- El operador gestiona SOLO sus propios documentos.
DROP POLICY IF EXISTS "operator manages own documents" ON public.operator_documents;
CREATE POLICY "operator manages own documents"
  ON public.operator_documents FOR ALL
  USING (operator_id = auth.uid())
  WITH CHECK (operator_id = auth.uid());

-- El admin puede leer todos (para el panel de revisión).
DROP POLICY IF EXISTS "admin reads all documents" ON public.operator_documents;
CREATE POLICY "admin reads all documents"
  ON public.operator_documents FOR SELECT
  USING (public.is_admin());

-- ─── 3. Registrar un documento subido (upsert por tipo) ─────────────────────
-- El archivo ya se subió al bucket privado vía RLS de storage (00010); aquí solo
-- se registra el path. SECURITY DEFINER + auth.uid(): el operador no pasa su id.
CREATE OR REPLACE FUNCTION public.upsert_operator_document(
  p_doc_type text,
  p_bucket text,
  p_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_doc_type NOT IN ('dui_front','dui_back','license','circulation','tow_photo','insurance') THEN
    RAISE EXCEPTION 'Invalid document type';
  END IF;

  INSERT INTO public.operator_documents (operator_id, doc_type, bucket, path)
  VALUES (auth.uid(), p_doc_type, p_bucket, p_path)
  ON CONFLICT (operator_id, doc_type)
  DO UPDATE SET bucket = EXCLUDED.bucket, path = EXCLUDED.path, uploaded_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_operator_document(text, text, text) TO authenticated;

-- ─── 4. Enviar a revisión ───────────────────────────────────────────────────
-- Exige que estén los obligatorios (DUI frente/reverso, licencia, circulación).
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
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_operator_verification() TO authenticated;

-- ─── 5. Admin aprueba/rechaza (con motivo y auditoría) ──────────────────────
-- Reemplaza la versión de 2 args de 00031 por una de 3 (motivo opcional).
DROP FUNCTION IF EXISTS public.admin_set_operator_verification(uuid, text);
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
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_operator_verification(uuid, text, text) TO authenticated;
