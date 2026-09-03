-- =====================================================
-- 00061 — El archivo del documento de identidad tambien se congela
--
-- EL HUECO QUE DEJO 00055
-- 00055 congelo la FILA `operator_documents` (el puntero) cuando el operador
-- esta aprobado o en revision. Pero el ARCHIVO en el bucket `id-documents`
-- seguia con las politicas `Users can update/delete own ID documents`, que solo
-- exigen ser el dueño (carpeta = su uid). La app sube a `<uid>/<doc_type>.jpg`
-- con `upsert: true`, y ese upload toca Storage ANTES de llamar a la RPC:
--
--   1. `storage.upload(..., { upsert: true })`  -> UPDATE del objeto (permitido)
--   2. `upsert_operator_document(...)`           -> RPC (00055 la bloquea)
--
-- Resultado: un operador YA APROBADO reemplaza el JPG de su DUI por el de otra
-- persona —el paso 1 tiene exito— y aunque el paso 2 falle, la EVIDENCIA FISICA
-- ya quedo cambiada. O lo borra con DELETE. El congelado de 00055 era, en la
-- practica, esquivable por la capa de Storage.
--
-- EL ARREGLO
-- Se replica en Storage el mismo criterio de 00055: el dueño puede modificar o
-- borrar su documento SOLO mientras esta armando el expediente ('pending' sin
-- enviar) o corrigiendo tras un rechazo ('rejected'). En 'approved' y en
-- 'pending' ya enviado —la ventana en que el cambio seria invisible para quien
-- revisa, o posterior a la revision— queda congelado.
--
--  · INSERT no se toca: subir por primera vez es parte de armar el expediente, y
--    re-subir un doc_type que ya existe es un UPDATE (upsert), no un INSERT.
--  · Solo aplica a `id-documents` (evidencia de identidad del operador). Los
--    docs del vehiculo del usuario (`vehicle-documents`) son otra cosa; se dejan
--    como estan (ver nota al final).
-- =====================================================

-- Helper: ¿los documentos de identidad de ESTE operador estan congelados?
-- Encapsula el criterio para no repetirlo en las dos politicas, y es el mismo
-- que usa upsert_operator_document (00055).
CREATE OR REPLACE FUNCTION public.id_documents_frozen()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (p.verification_status = 'approved'
            OR (p.verification_status = 'pending'
                AND p.verification_submitted_at IS NOT NULL))
  );
$$;

REVOKE ALL ON FUNCTION public.id_documents_frozen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.id_documents_frozen() TO authenticated;

COMMENT ON FUNCTION public.id_documents_frozen() IS
  'true si los id-documents del operador que llama estan congelados (aprobado o '
  'en revision). Usada por las politicas de Storage de 00061; mismo criterio que '
  'upsert_operator_document (00055).';

-- Reemplaza UPDATE: dueño Y no congelado.
DROP POLICY IF EXISTS "Users can update own ID documents" ON storage.objects;
CREATE POLICY "Users can update own ID documents"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'id-documents'
    AND (auth.uid())::text = (storage.foldername(name))[1]
    AND NOT public.id_documents_frozen()
  );

-- Reemplaza DELETE: dueño Y no congelado.
DROP POLICY IF EXISTS "Users can delete own ID documents" ON storage.objects;
CREATE POLICY "Users can delete own ID documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'id-documents'
    AND (auth.uid())::text = (storage.foldername(name))[1]
    AND NOT public.id_documents_frozen()
  );

-- NOTA sobre `vehicle-documents`: sus politicas UPDATE/DELETE tienen la misma
-- forma (solo dueño), pero son documentos del vehiculo del USUARIO, no evidencia
-- de la identidad de un operador verificado, y no hay un momento de "aprobacion"
-- que congelar. Se dejan como estan a proposito; si se decidiera que tampoco
-- deben reescribirse tras usarse en un servicio, seria otra migracion con su
-- propio criterio.
