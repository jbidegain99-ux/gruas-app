-- =====================================================
-- 00046 — Importacion masiva de afiliados + API para la aseguradora  (B-10)
--
-- Dos formas de cargar un padron, una sola implementacion:
--   · el admin sube un CSV desde el panel,
--   · la aseguradora llama a una API con su propia clave.
-- Ambas terminan en `_import_members()`, que es donde vive la validacion. Si la
-- logica estuviera duplicada, las dos vias divergirian en la primera correccion.
--
-- El control de acceso, en cambio, SI es distinto por via, y por eso son dos
-- envoltorios separados: el del panel exige `is_admin()`; el de la API recibe la
-- aseguradora ya autenticada por la Edge Function y comprueba que la poliza sea
-- realmente suya. Una aseguradora no puede tocar el padron de otra.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Claves de API por aseguradora
-- ---------------------------------------------------------------
-- Se guarda solo el SHA-256 de la clave. El valor en claro se muestra una unica
-- vez, al crearla: si se pierde, se revoca y se emite otra. `key_prefix` guarda
-- los primeros caracteres para poder identificarla en pantalla sin exponerla.
CREATE TABLE IF NOT EXISTS public.insurer_api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id   UUID NOT NULL REFERENCES public.insurers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS insurer_api_keys_insurer_idx ON public.insurer_api_keys (insurer_id);

ALTER TABLE public.insurer_api_keys ENABLE ROW LEVEL SECURITY;

-- Solo el admin. Ni siquiera la aseguradora lee sus propias claves: las usa,
-- no las consulta. Y `key_hash` nunca sale de la base por PostgREST.
CREATE POLICY "Admin gestiona claves de API"
  ON public.insurer_api_keys FOR ALL USING (is_admin()) WITH CHECK (is_admin());

REVOKE ALL ON public.insurer_api_keys FROM anon;

-- ---------------------------------------------------------------
-- 2. Nucleo de la importacion
-- ---------------------------------------------------------------
-- Recibe un array JSON de afiliados y los inserta o actualiza contra
-- (policy_id, document_number). No comprueba permisos: eso es tarea de los
-- envoltorios del punto 3. Nunca lanza por una fila mala — devuelve el detalle
-- para que quien llama pueda mostrar que salio mal en cada linea, que es lo que
-- necesita alguien que acaba de subir un CSV de 500 filas.
CREATE OR REPLACE FUNCTION public._import_members(
  p_policy_id UUID,
  p_members   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row        JSONB;
  v_idx        INT := 0;
  v_inserted   INT := 0;
  v_updated    INT := 0;
  v_errors     JSONB := '[]'::jsonb;
  v_doc        TEXT;
  v_name       TEXT;
  v_rel        TEXT;
  v_starts     DATE;
  v_ends       DATE;
  v_profile    UUID;
  v_existing   UUID;
BEGIN
  IF jsonb_typeof(p_members) <> 'array' THEN
    RAISE EXCEPTION 'Se esperaba un arreglo de afiliados';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_members) LOOP
    v_idx := v_idx + 1;

    BEGIN
      v_doc  := nullif(btrim(v_row->>'document_number'), '');
      v_name := nullif(btrim(v_row->>'full_name'), '');
      v_rel  := lower(coalesce(nullif(btrim(v_row->>'relationship'), ''), 'beneficiary'));

      IF v_doc IS NULL THEN
        RAISE EXCEPTION 'Falta el numero de documento';
      END IF;
      IF v_name IS NULL THEN
        RAISE EXCEPTION 'Falta el nombre completo';
      END IF;
      IF v_rel NOT IN ('holder', 'beneficiary') THEN
        RAISE EXCEPTION 'Relacion invalida: "%". Use holder o beneficiary', v_rel;
      END IF;

      v_starts := coalesce(nullif(btrim(v_row->>'starts_on'), '')::date, CURRENT_DATE);
      v_ends   := nullif(btrim(v_row->>'ends_on'), '')::date;

      IF v_ends IS NOT NULL AND v_ends < v_starts THEN
        RAISE EXCEPTION 'La fecha de baja es anterior a la de alta';
      END IF;

      -- Vinculacion con una cuenta existente por documento. Casi siempre da
      -- NULL: el padron se carga antes de que la gente descargue la app.
      SELECT ps.profile_id INTO v_profile
        FROM profile_sensitive ps
       WHERE ps.dui_number = v_doc
       LIMIT 1;

      SELECT m.id INTO v_existing
        FROM members m
       WHERE m.policy_id = p_policy_id AND m.document_number = v_doc;

      IF v_existing IS NOT NULL THEN
        UPDATE members
           SET full_name  = v_name,
               phone      = nullif(btrim(v_row->>'phone'), ''),
               relationship = v_rel,
               starts_on  = v_starts,
               ends_on    = v_ends,
               -- Solo se rellena; nunca se desvincula una cuenta ya asociada.
               profile_id = coalesce(members.profile_id, v_profile),
               updated_at = NOW()
         WHERE id = v_existing;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO members (policy_id, profile_id, document_number, full_name,
                             phone, relationship, starts_on, ends_on)
        VALUES (p_policy_id, v_profile, v_doc, v_name,
                nullif(btrim(v_row->>'phone'), ''), v_rel, v_starts, v_ends);
        v_inserted := v_inserted + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Una fila mala no debe tumbar el lote entero: se anota y se sigue.
      v_errors := v_errors || jsonb_build_object(
        'row', v_idx,
        'document_number', coalesce(v_doc, ''),
        'message', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated',  v_updated,
    'failed',   jsonb_array_length(v_errors),
    'errors',   v_errors
  );
END;
$$;

-- ---------------------------------------------------------------
-- 3. Envoltorios con su control de acceso
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_policy_members(
  p_policy_id UUID,
  p_members   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede importar afiliados';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM policies WHERE id = p_policy_id) THEN
    RAISE EXCEPTION 'La poliza no existe';
  END IF;

  RETURN _import_members(p_policy_id, p_members);
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_policy_members(UUID, JSONB) TO authenticated;

-- Para la API. La Edge Function ya valido la clave y pasa la aseguradora; aqui
-- se comprueba que la poliza le pertenezca, que es la frontera que impide que
-- una aseguradora escriba en el padron de otra.
CREATE OR REPLACE FUNCTION public.import_members_for_insurer(
  p_insurer_id    UUID,
  p_policy_number TEXT,
  p_members       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy_id UUID;
BEGIN
  SELECT id INTO v_policy_id
    FROM policies
   WHERE insurer_id = p_insurer_id AND policy_number = p_policy_number;

  IF v_policy_id IS NULL THEN
    RAISE EXCEPTION 'No existe la poliza % para esta aseguradora', p_policy_number;
  END IF;

  RETURN _import_members(v_policy_id, p_members);
END;
$$;

-- ---------------------------------------------------------------
-- 4. Alta, validacion y revocacion de claves
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_insurer_api_key(
  p_insurer_id UUID,
  p_name       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key    TEXT;
  v_prefix TEXT;
  v_id     UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede emitir claves de API';
  END IF;

  -- 32 bytes en base64url: suficiente entropia y copiable de un tiron.
  v_key := 'budi_' || translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_prefix := left(v_key, 12);

  INSERT INTO insurer_api_keys (insurer_id, name, key_hash, key_prefix, created_by)
  VALUES (
    p_insurer_id,
    p_name,
    encode(extensions.digest(v_key, 'sha256'), 'hex'),
    v_prefix,
    auth.uid()
  )
  RETURNING id INTO v_id;

  -- Unica vez que la clave sale en claro.
  RETURN jsonb_build_object('id', v_id, 'key', v_key, 'key_prefix', v_prefix);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_insurer_api_key(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_insurer_api_key(p_key_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede revocar claves de API';
  END IF;

  UPDATE insurer_api_keys SET revoked_at = NOW()
   WHERE id = p_key_id AND revoked_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_insurer_api_key(UUID) TO authenticated;

-- Devuelve la aseguradora dueña de la clave, o NULL si no vale. La llama la
-- Edge Function con service_role; no se concede a `authenticated`, que no tiene
-- por que poder probar claves contra la base.
CREATE OR REPLACE FUNCTION public.verify_insurer_api_key(p_key TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_insurer UUID;
BEGIN
  UPDATE insurer_api_keys k
     SET last_used_at = NOW()
   WHERE k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
     AND k.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM insurers i WHERE i.id = k.insurer_id AND i.is_active)
  RETURNING k.insurer_id INTO v_insurer;

  RETURN v_insurer;
END;
$$;

COMMENT ON TABLE public.insurer_api_keys IS
  'Claves de API por aseguradora para la carga de padron (B-10). Se guarda solo el SHA-256; el valor en claro se muestra una vez al crearla.';
