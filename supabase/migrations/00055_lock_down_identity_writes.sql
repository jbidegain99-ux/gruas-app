-- =====================================================
-- 00055 — La identidad deja de ser auto-declarable
--
-- Continuacion de 00054, mismo cedazo aplicado a las seis tablas que faltaban:
-- `vehicles`, `device_tokens`, `operator_locations`, `operator_documents`,
-- `profile_sensitive` y `ratings`. Dos de las seis tenian un problema real.
--
-- LAS CUATRO QUE ESTAN BIEN, Y POR QUE
--  · `vehicles`, `device_tokens`, `operator_locations`: el cliente escribe
--    columnas que describen SUS PROPIAS cosas (marca del carro, token del
--    telefono, su ubicacion). Ninguna decide dinero ni permisos, asi que que el
--    dueño las escriba es justamente lo correcto.
--  · `ratings`: la politica de INSERT ya exige que la solicitud sea del que
--    califica y que este completada, hay UNIQUE (request_id) contra el spam, y
--    NO existe politica de UPDATE ni de DELETE, asi que una calificacion no se
--    puede retocar despues. Es la tabla mejor cerrada del esquema.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. profile_sensitive: el DUI no se lo pone uno mismo (FRAUDE)
-- ---------------------------------------------------------------
-- `Titular gestiona sus datos sensibles` es `ALL USING (profile_id = auth.uid())`,
-- o sea que cualquiera podia escribir su propio `dui_number`. Y
-- `check_member_coverage` vincula al afiliado comparando ese DUI contra el
-- padron, tomando las filas con `profile_id IS NULL` — que son casi todas,
-- porque el padron se carga antes de que la gente instale la app.
--
-- FRAUDE VERIFICADO, en dos pasos y sin ninguna ayuda: una cuenta sin poliza
-- inserto el DUI de una afiliada del Plan Oro, pidio una grua y salio
-- `covered`, con el servicio facturado a la aseguradora. Peor: la afiliacion de
-- esa persona quedo atada a la cuenta del atacante PARA SIEMPRE, porque la
-- vinculacion nunca se deshace — la titular real ya no puede reclamarla nunca.
--
-- NO SE ROMPE NADA: hoy no hay un solo escritor de esta tabla. Ni las apps
-- (solo la leen), ni ninguna funcion de la base (`check_member_coverage` y
-- `_import_members` solo consultan). El permiso era superficie de ataque pura.
--
-- ⚠ HUECO DE PRODUCTO QUE ESTO DEJA A LA VISTA, no lo crea esta migracion:
-- nadie recoge el DUI del usuario, asi que la vinculacion diferida por DUI de
-- B-11 no se dispara nunca; hoy un afiliado solo queda ligado si el admin o la
-- importacion le ponen el `profile_id`. Cuando se implemente la captura del DUI
-- TIENE que ser por una via verificada (revision de documento, o el admin que
-- ya vio el DUI fisico). Auto-declararlo ES el fraude de arriba: no se puede
-- regalar cobertura de una aseguradora a quien escriba un numero en un campo.
DROP POLICY IF EXISTS "Titular gestiona sus datos sensibles" ON public.profile_sensitive;

CREATE POLICY "Titular lee sus datos sensibles"
  ON public.profile_sensitive FOR SELECT
  USING (profile_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.profile_sensitive FROM authenticated, anon;

COMMENT ON TABLE public.profile_sensitive IS
  'Datos de identidad. SOLO LECTURA para el cliente (00055): el DUI decide la '
  'cobertura de seguro, asi que auto-declararlo permitia reclamar la poliza de '
  'otra persona. Escribirlo exige una via verificada, nunca el propio usuario.';

-- ---------------------------------------------------------------
-- 2. operator_documents: la evidencia se congela al enviarse
-- ---------------------------------------------------------------
-- `operator manages own documents` es `ALL USING (operator_id = auth.uid())`.
-- Verificado: un operador YA APROBADO cambio el `path` de su DUI por
-- 'otra/persona/dui.jpg', y despues borro sus cuatro documentos de un golpe —
-- y siguio con `verification_status = 'approved'`. La prueba de a quien se
-- verifico se puede reescribir o hacer desaparecer despues del hecho.
--
-- Las apps NUNCA escriben esta tabla directamente: el operador sube por
-- `upsert_operator_document` y tanto la pantalla del operador como la del admin
-- solo hacen SELECT. Asi que se le quita la escritura al cliente y la regla de
-- congelado vive en la RPC (punto 3), que es el unico camino que queda.
DROP POLICY IF EXISTS "operator manages own documents" ON public.operator_documents;

CREATE POLICY "operator lee sus documentos"
  ON public.operator_documents FOR SELECT
  USING (operator_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.operator_documents FROM authenticated, anon;

COMMENT ON TABLE public.operator_documents IS
  'Evidencia de la verificacion del operador. SOLO LECTURA para el cliente '
  '(00055); se sube con upsert_operator_document(), que la congela una vez '
  'enviada a revision o aprobada.';

-- ---------------------------------------------------------------
-- 3. La RPC de subida respeta el congelado
-- ---------------------------------------------------------------
-- Hace falta ademas de los permisos del punto 2, porque la RPC es SECURITY
-- DEFINER: corre como `postgres` y los GRANT del cliente no la frenan. Sin este
-- guardia, un operador aprobado seguia pudiendo cambiar su DUI llamandola.
--
-- Se deja mutable en 'rejected' (tiene que poder corregir y reenviar) y en
-- 'pending' sin enviar todavia (esta armando el expediente). Se congela en
-- 'approved' y en 'pending' ya enviado, que es la ventana en la que el cambio
-- seria invisible para quien esta revisando.
--
-- Reconstruida por SUSTITUCION EXACTA sobre `pg_get_functiondef`: lo unico que
-- se agrega es el bloque del guardia.
CREATE OR REPLACE FUNCTION public.upsert_operator_document(p_doc_type text, p_bucket text, p_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_doc_type NOT IN ('dui_front','dui_back','license','circulation','tow_photo','insurance') THEN
    RAISE EXCEPTION 'Invalid document type';
  END IF;

  -- 00055: los documentos se congelan en cuanto salen de las manos del operador.
  -- Sin esto, un operador YA APROBADO podia cambiar el archivo de su DUI por el
  -- de otra persona, o borrarlos, y seguir apareciendo como verificado: la
  -- evidencia de a quien se verifico se evaporaba. Tambien cubre la ventana en
  -- que el expediente esta en revision, que es donde el cambio seria invisible
  -- para quien lo esta mirando.
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (p.verification_status = 'approved'
            OR (p.verification_status = 'pending' AND p.verification_submitted_at IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Los documentos no se pueden cambiar mientras la verificacion esta en revision o ya aprobada';
  END IF;

  INSERT INTO public.operator_documents (operator_id, doc_type, bucket, path)
  VALUES (auth.uid(), p_doc_type, p_bucket, p_path)
  ON CONFLICT (operator_id, doc_type)
  DO UPDATE SET bucket = EXCLUDED.bucket, path = EXCLUDED.path, uploaded_at = now();
END;
$function$

;
