-- 00118: política de versión mínima de la app móvil (backlog APP-09)
--
-- Las actualizaciones por aire (expo-updates, canales por ambiente en
-- eas.json) cubren los cambios de JavaScript. Lo que no cubren: un binario
-- viejo cuyo código ya no es compatible con la API (una RPC que cambió de
-- firma, un permiso nativo nuevo). Para eso la app pregunta al arrancar, antes
-- de iniciar sesión, si su versión sigue siendo aceptable:
--   - por debajo de `min_version`     -> pantalla "Actualiza la app" (bloquea)
--   - por debajo de `latest_version`  -> aviso que se puede cerrar
-- La consulta es pública (sin sesión): es lo primero que hace la app.

CREATE TABLE public.app_release_policy (
  platform       TEXT PRIMARY KEY CHECK (platform IN ('android', 'ios')),
  min_version    TEXT NOT NULL DEFAULT '1.0.0' CHECK (min_version ~ '^\d+\.\d+\.\d+$'),
  latest_version TEXT NOT NULL DEFAULT '1.0.0' CHECK (latest_version ~ '^\d+\.\d+\.\d+$'),
  store_url      TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.app_release_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_release_policy FROM anon, authenticated;

INSERT INTO public.app_release_policy (platform, store_url) VALUES
  ('android', 'https://play.google.com/store/apps/details?id=com.budisv.app'),
  ('ios', NULL);  -- se completa cuando la app esté publicada en App Store

-- Quién movió la versión mínima queda en la bitácora (00094).
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.app_release_policy
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at,updated_by');

-- '1.10.0' > '1.9.3': compara número por número, no como texto.
CREATE OR REPLACE FUNCTION public.semver_cmp(a TEXT, b TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN va < vb THEN -1
    WHEN va > vb THEN 1
    ELSE 0
  END
  FROM (SELECT string_to_array(a, '.')::int[] AS va, string_to_array(b, '.')::int[] AS vb) x;
$$;

CREATE OR REPLACE FUNCTION public.app_version_check(p_platform TEXT, p_version TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v app_release_policy;
BEGIN
  SELECT * INTO v FROM app_release_policy WHERE platform = p_platform;

  -- Plataforma desconocida (web) o versión ilegible: no se bloquea a nadie.
  IF v.platform IS NULL OR p_version IS NULL OR p_version !~ '^\d+\.\d+\.\d+$' THEN
    RETURN jsonb_build_object('status', 'ok');
  END IF;

  RETURN jsonb_build_object(
    'status', CASE
      WHEN semver_cmp(p_version, v.min_version) < 0 THEN 'update_required'
      WHEN semver_cmp(p_version, v.latest_version) < 0 THEN 'update_available'
      ELSE 'ok'
    END,
    'min_version', v.min_version,
    'latest_version', v.latest_version,
    'store_url', v.store_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_version_check(TEXT, TEXT) FROM PUBLIC;
-- Pública a propósito (00115 cerró el resto): la app pregunta antes del login.
GRANT EXECUTE ON FUNCTION public.app_version_check(TEXT, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.semver_cmp(TEXT, TEXT) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_app_release_policy()
RETURNS SETOF public.app_release_policy
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  RETURN QUERY SELECT * FROM app_release_policy ORDER BY platform;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_app_release_policy(
  p_platform       TEXT,
  p_min_version    TEXT,
  p_latest_version TEXT,
  p_store_url      TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  IF p_min_version !~ '^\d+\.\d+\.\d+$' OR p_latest_version !~ '^\d+\.\d+\.\d+$' THEN
    RAISE EXCEPTION 'Las versiones van en formato 1.2.3';
  END IF;
  IF semver_cmp(p_min_version, p_latest_version) > 0 THEN
    RAISE EXCEPTION 'La versión mínima no puede ser mayor que la última publicada';
  END IF;
  IF p_store_url IS NOT NULL AND p_store_url <> '' AND p_store_url !~ '^https://' THEN
    RAISE EXCEPTION 'El enlace a la tienda debe empezar con https://';
  END IF;

  UPDATE app_release_policy
     SET min_version = p_min_version,
         latest_version = p_latest_version,
         store_url = NULLIF(p_store_url, ''),
         updated_at = now(),
         updated_by = auth.uid()
   WHERE platform = p_platform;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plataforma desconocida: %', p_platform;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_app_release_policy() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_app_release_policy(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_app_release_policy() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_app_release_policy(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- La bitácora identifica la fila por id/provider_id/profile_id; esta tabla se
-- identifica por plataforma. Se agrega al final de la lista.
DO $$
DECLARE v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.audit_row_change()'::regprocedure) INTO v_def;
  IF position('v_row ->> ''profile_id''),' IN v_def) > 0 THEN
    EXECUTE replace(v_def, 'v_row ->> ''profile_id''),', 'v_row ->> ''profile_id'', v_row ->> ''platform''),');
  END IF;
END $$;
