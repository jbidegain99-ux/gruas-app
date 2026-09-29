-- =====================================================
-- ASE-05 · Marca blanca de la aseguradora (B-27)
--
-- La aseguradora pone su logo, nombre comercial y color:
--   * en su portal (cabecera y pestañas), y
--   * en la app de SUS afiliados: "Asistencia Vial XYZ, con tecnología Budi".
--
-- La edita el dueño o un administrador del portal (con 2FA) o el admin de Budi.
-- Los logos van en el bucket público `insurer-branding`, en la carpeta de la
-- aseguradora (<insurer_id>/...), solo PNG/JPG/WEBP de hasta 512 KB: SVG no,
-- porque abierto directo puede ejecutar scripts.
-- Nada cambia hasta que la marca se activa (`brand_enabled`).
-- =====================================================

ALTER TABLE public.insurers
  ADD COLUMN IF NOT EXISTS brand_enabled    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS brand_name       TEXT,
  ADD COLUMN IF NOT EXISTS brand_color      TEXT,
  ADD COLUMN IF NOT EXISTS brand_logo_path  TEXT,
  ADD COLUMN IF NOT EXISTS brand_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurers_brand_color_hex') THEN
    ALTER TABLE public.insurers ADD CONSTRAINT insurers_brand_color_hex
      CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('insurer-branding', 'insurer-branding', true, 524288, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 524288,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

-- ¿De qué aseguradora puede subir logo quien llama? Dueño/admin del portal (con
-- 2FA, lo exige auth_org); NULL si no.
CREATE OR REPLACE FUNCTION public.branding_insurer_for_caller()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.insurer_id FROM auth_org() o
   WHERE o.type = 'INSURER' AND o.member_role IN ('owner', 'admin');
$$;
REVOKE ALL ON FUNCTION public.branding_insurer_for_caller() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branding_insurer_for_caller() TO authenticated;

DROP POLICY IF EXISTS "marca: sube su aseguradora" ON storage.objects;
CREATE POLICY "marca: sube su aseguradora" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'insurer-branding'
    AND (public.is_admin() OR (storage.foldername(name))[1] = public.branding_insurer_for_caller()::text));
DROP POLICY IF EXISTS "marca: cambia su aseguradora" ON storage.objects;
CREATE POLICY "marca: cambia su aseguradora" ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'insurer-branding'
    AND (public.is_admin() OR (storage.foldername(name))[1] = public.branding_insurer_for_caller()::text));
DROP POLICY IF EXISTS "marca: borra su aseguradora" ON storage.objects;
CREATE POLICY "marca: borra su aseguradora" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'insurer-branding'
    AND (public.is_admin() OR (storage.foldername(name))[1] = public.branding_insurer_for_caller()::text));

-- ─── Guardar ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._save_insurer_branding(p_insurer UUID, p_enabled BOOLEAN, p_name TEXT,
                                                        p_color TEXT, p_logo_path TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_logo TEXT := NULLIF(btrim(COALESCE(p_logo_path, '')), '');
BEGIN
  IF p_color IS NOT NULL AND p_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'El color debe ser hexadecimal, p. ej. #1F4E79';
  END IF;
  IF v_name IS NOT NULL AND length(v_name) > 60 THEN
    RAISE EXCEPTION 'El nombre comercial admite hasta 60 caracteres';
  END IF;
  -- El logo solo puede ser de SU carpeta (nada de apuntar al de otra).
  IF v_logo IS NOT NULL AND v_logo NOT LIKE p_insurer::text || '/%' THEN
    RAISE EXCEPTION 'Logo inválido';
  END IF;
  IF COALESCE(p_enabled, false) AND v_name IS NULL THEN
    RAISE EXCEPTION 'Para activar la marca indica el nombre comercial';
  END IF;
  UPDATE insurers
     SET brand_enabled = COALESCE(p_enabled, false), brand_name = v_name, brand_color = p_color,
         brand_logo_path = v_logo, brand_updated_at = now(), updated_at = now()
   WHERE id = p_insurer;
END;
$$;
REVOKE ALL ON FUNCTION public._save_insurer_branding(UUID, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_save_branding(p_enabled BOOLEAN, p_name TEXT, p_color TEXT, p_logo_path TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM _save_insurer_branding(require_insurer_role(ARRAY['owner', 'admin']), p_enabled, p_name, p_color, p_logo_path);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_insurer_branding(p_insurer UUID, p_enabled BOOLEAN, p_name TEXT, p_color TEXT, p_logo_path TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  PERFORM _save_insurer_branding(p_insurer, p_enabled, p_name, p_color, p_logo_path);
END;
$$;

-- ─── Leer ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._insurer_branding_json(p_insurer UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('insurer_id', i.id, 'insurer_name', i.name, 'enabled', i.brand_enabled,
                            'brand_name', i.brand_name, 'color', i.brand_color, 'logo_path', i.brand_logo_path,
                            'updated_at', i.brand_updated_at)
    FROM insurers i WHERE i.id = p_insurer;
$$;
REVOKE ALL ON FUNCTION public._insurer_branding_json(UUID) FROM PUBLIC, anon, authenticated;

-- El portal (cualquier rol) y el admin.
CREATE OR REPLACE FUNCTION public.portal_branding()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _insurer_branding_json(require_insurer_role(ARRAY['owner', 'admin', 'analyst', 'viewer']))
      || jsonb_build_object('can_edit', insurer_portal_role() IN ('owner', 'admin'));
$$;

CREATE OR REPLACE FUNCTION public.admin_insurer_branding(p_insurer UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  RETURN _insurer_branding_json(p_insurer);
END;
$$;

-- La app del afiliado: la marca de la aseguradora de su afiliación vigente,
-- si la activó. NULL para todos los demás.
CREATE OR REPLACE FUNCTION public.my_insurer_branding()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('brand_name', i.brand_name, 'color', i.brand_color, 'logo_path', i.brand_logo_path,
                            'insurer_name', i.name)
    FROM members m
    JOIN policies po ON po.id = m.policy_id
    JOIN insurers i  ON i.id = po.insurer_id
   WHERE m.profile_id = auth.uid()
     AND m.is_active AND m.starts_on <= sv_today() AND (m.ends_on IS NULL OR m.ends_on >= sv_today())
     AND po.status = 'active' AND po.starts_on <= sv_today() AND (po.ends_on IS NULL OR po.ends_on >= sv_today())
     AND i.is_active AND i.brand_enabled
   ORDER BY po.ends_on DESC NULLS FIRST, m.id
   LIMIT 1;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['portal_save_branding(boolean,text,text,text)',
                           'admin_save_insurer_branding(uuid,boolean,text,text,text)',
                           'portal_branding()', 'admin_insurer_branding(uuid)', 'my_insurer_branding()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Cambios de marca a la bitácora (ya hay trg_audit sobre insurers, 00094).
