-- =====================================================
-- 00106 — Organizaciones y membresias (backlog POR-01)
--
-- Hasta aca el acceso a los portales salia de un ROL de perfil: INSURER para
-- /portal (00068) y MOPT para /mopt (00097). El backlog de lanzamiento pide lo
-- contrario: "el acceso lo da la membresia a una organizacion", para que una
-- misma persona pueda tener su cuenta de Usuario y ademas trabajar en el portal
-- de su aseguradora, y para que cada organizacion tenga su propio equipo con
-- roles internos (owner / admin / analyst / viewer).
--
-- Diseno:
-- * `organizations` es la cuenta institucional. Enlaza (1:1) con la entidad de
--   dominio que ya existia: `insurers` para una aseguradora, `providers` para un
--   programa MOPT o una empresa proveedora. Asi no se reescribe nada de
--   cobertura, zonas, tarifas ni libro: todo eso sigue colgando de insurers /
--   providers.
-- * `organization_members` da el acceso. Por ahora una persona tiene a lo sumo
--   UNA membresia activa (indice unico parcial): los portales no tienen selector
--   de organizacion todavia.
-- * auth_insurer_id() y auth_mopt_id() pasan a leer la membresia. TODAS las
--   politicas y RPC de los portales pasan por esas dos funciones (00068, 00098,
--   00099, 00100), asi que el cambio de modelo no toca ninguna de ellas.
-- * Los perfiles con rol INSURER o MOPT pasan a USER + membresia. Los valores
--   del enum quedan (Postgres no borra valores de un enum) pero nadie los usa.
-- * REINSURER queda previsto en el tipo; su acceso (D3) se construye aparte.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('MOPT', 'INSURER', 'REINSURER', 'PROVIDER')),
  name        TEXT NOT NULL,
  parent_id   UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  insurer_id  UUID UNIQUE REFERENCES public.insurers(id) ON DELETE CASCADE,
  provider_id UUID UNIQUE REFERENCES public.providers(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organizations_domain_link CHECK (
    (type = 'INSURER'   AND insurer_id IS NOT NULL AND provider_id IS NULL) OR
    (type IN ('MOPT', 'PROVIDER') AND provider_id IS NOT NULL AND insurer_id IS NULL) OR
    (type = 'REINSURER' AND insurer_id IS NULL AND provider_id IS NULL)
  )
);

COMMENT ON TABLE public.organizations IS
  '00106: cliente institucional (MOPT, aseguradora, reaseguradora, empresa). '
  'El acceso a su portal lo da organization_members, no un rol de perfil.';

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  added_by        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, profile_id)
);

COMMENT ON TABLE public.organization_members IS
  '00106: quien trabaja en el portal de una organizacion y con que rol interno. '
  'Una membresia activa por persona (sin selector de organizacion todavia).';

CREATE UNIQUE INDEX IF NOT EXISTS organization_members_one_active
  ON public.organization_members (profile_id) WHERE status = 'active';

DROP TRIGGER IF EXISTS update_organizations_updated_at ON public.organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_organization_members_updated_at ON public.organization_members;
CREATE TRIGGER update_organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------
-- 2. Backfill
-- ---------------------------------------------------------------
INSERT INTO public.organizations (type, name, status, insurer_id)
SELECT 'INSURER', i.name, CASE WHEN i.is_active THEN 'active' ELSE 'suspended' END, i.id
  FROM public.insurers i
ON CONFLICT (insurer_id) DO NOTHING;

INSERT INTO public.organizations (type, name, status, provider_id)
SELECT CASE WHEN p.is_mopt THEN 'MOPT' ELSE 'PROVIDER' END, p.name,
       CASE WHEN p.is_active THEN 'active' ELSE 'suspended' END, p.id
  FROM public.providers p
ON CONFLICT (provider_id) DO NOTHING;

-- Quien hoy entra al portal por su rol pasa a ser owner de su organizacion.
INSERT INTO public.organization_members (organization_id, profile_id, role)
SELECT o.id, pr.id, 'owner'
  FROM public.profiles pr
  JOIN public.organizations o ON o.insurer_id = pr.insurer_id
 WHERE pr.role::text = 'INSURER' AND pr.insurer_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.organization_members (organization_id, profile_id, role)
SELECT o.id, pr.id, 'owner'
  FROM public.profiles pr
  JOIN public.organizations o ON o.provider_id = pr.provider_id AND o.type = 'MOPT'
 WHERE pr.role::text = 'MOPT' AND pr.provider_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ...y deja de necesitar el rol: queda como USER (puede usar la app como
-- cualquier Usuario). El vinculo a la aseguradora/programa ya vive en la
-- membresia.
UPDATE public.profiles
   SET role = 'USER', insurer_id = NULL, updated_at = now()
 WHERE role::text = 'INSURER';

UPDATE public.profiles
   SET role = 'USER', provider_id = NULL, updated_at = now()
 WHERE role::text = 'MOPT';

-- Toda aseguradora o empresa nueva nace con su organizacion.
CREATE OR REPLACE FUNCTION public.ensure_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'insurers' THEN
    INSERT INTO organizations (type, name, status, insurer_id)
    VALUES ('INSURER', NEW.name, CASE WHEN NEW.is_active THEN 'active' ELSE 'suspended' END, NEW.id)
    ON CONFLICT (insurer_id) DO UPDATE
      SET name = EXCLUDED.name, status = EXCLUDED.status;
  ELSE
    INSERT INTO organizations (type, name, status, provider_id)
    VALUES (CASE WHEN NEW.is_mopt THEN 'MOPT' ELSE 'PROVIDER' END, NEW.name,
            CASE WHEN NEW.is_active THEN 'active' ELSE 'suspended' END, NEW.id)
    ON CONFLICT (provider_id) DO UPDATE
      SET name = EXCLUDED.name, status = EXCLUDED.status, type = EXCLUDED.type;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_organization() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ensure_organization ON public.insurers;
CREATE TRIGGER trg_ensure_organization
  AFTER INSERT OR UPDATE OF name, is_active ON public.insurers
  FOR EACH ROW EXECUTE FUNCTION public.ensure_organization();

DROP TRIGGER IF EXISTS trg_ensure_organization ON public.providers;
CREATE TRIGGER trg_ensure_organization
  AFTER INSERT OR UPDATE OF name, is_active, is_mopt ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.ensure_organization();

-- ---------------------------------------------------------------
-- 3. "Mi organizacion": la unica definicion del alcance
-- ---------------------------------------------------------------
-- La membresia activa de quien consulta, en una organizacion activa.
CREATE OR REPLACE FUNCTION public.auth_org()
RETURNS TABLE (
  organization_id UUID,
  type            TEXT,
  name            TEXT,
  member_role     TEXT,
  insurer_id      UUID,
  provider_id     UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.id, o.type, o.name, m.role, o.insurer_id, o.provider_id
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
   WHERE m.profile_id = auth.uid()
     AND m.status = 'active'
     AND o.status = 'active'
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.auth_org() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_org() TO authenticated;

-- Las dos puertas de los portales, ahora por membresia. Firmas iguales: las
-- politicas y RPC que las usan no cambian.
CREATE OR REPLACE FUNCTION public.auth_insurer_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.insurer_id FROM auth_org() o WHERE o.type = 'INSURER'
$$;

CREATE OR REPLACE FUNCTION public.auth_mopt_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.provider_id
    FROM auth_org() o
    JOIN providers pr ON pr.id = o.provider_id AND pr.is_mopt
   WHERE o.type = 'MOPT'
$$;

-- Para la web: a que portal va quien inicia sesion.
CREATE OR REPLACE FUNCTION public.my_organization()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('id', o.organization_id, 'type', o.type, 'name', o.name, 'member_role', o.member_role)
    FROM auth_org() o
$$;

REVOKE ALL ON FUNCTION public.my_organization() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_organization() TO authenticated;

-- ---------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organizations, public.organization_members FROM PUBLIC, anon;
GRANT SELECT ON public.organizations, public.organization_members TO authenticated;
-- Se escribe solo por las RPC de abajo.

DROP POLICY IF EXISTS "organizations: admin lee" ON public.organizations;
CREATE POLICY "organizations: admin lee" ON public.organizations
  FOR SELECT TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "organizations: miembro ve la suya" ON public.organizations;
CREATE POLICY "organizations: miembro ve la suya" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT organization_id FROM auth_org()));

DROP POLICY IF EXISTS "organization_members: admin lee" ON public.organization_members;
CREATE POLICY "organization_members: admin lee" ON public.organization_members
  FOR SELECT TO authenticated USING (is_admin());

-- Un miembro ve el equipo de SU organizacion (base de POR-02).
DROP POLICY IF EXISTS "organization_members: equipo propio" ON public.organization_members;
CREATE POLICY "organization_members: equipo propio" ON public.organization_members
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM auth_org()));

-- Auditoria (00094).
DROP TRIGGER IF EXISTS trg_audit ON public.organizations;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit ON public.organization_members;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- ---------------------------------------------------------------
-- 5. Administrar miembros (admin de Budi)
-- ---------------------------------------------------------------
-- Agrega (o reactiva) a una persona YA registrada por su correo. La invitacion
-- por correo del owner a su equipo es POR-02.
CREATE OR REPLACE FUNCTION public.admin_add_org_member(
  p_organization_id UUID,
  p_email           TEXT,
  p_role            TEXT DEFAULT 'viewer'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile UUID;
  v_role    user_role;
  v_other   TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede agregar miembros';
  END IF;
  IF p_role NOT IN ('owner', 'admin', 'analyst', 'viewer') THEN
    RAISE EXCEPTION 'Rol interno desconocido: %', p_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'La organizacion no existe';
  END IF;

  SELECT id, role INTO v_profile, v_role
    FROM profiles WHERE lower(email) = lower(btrim(p_email));
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'No hay una cuenta registrada con ese correo';
  END IF;
  -- Personal de Budi y socios operadores no se mezclan con un portal cliente.
  IF v_role::text IN ('ADMIN', 'SUPPORT', 'OPERATOR') THEN
    RAISE EXCEPTION 'Esa cuenta es de %: no puede ser miembro de un cliente', v_role;
  END IF;

  SELECT o.name INTO v_other
    FROM organization_members m JOIN organizations o ON o.id = m.organization_id
   WHERE m.profile_id = v_profile AND m.status = 'active'
     AND m.organization_id <> p_organization_id;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'Esa cuenta ya trabaja en %', v_other;
  END IF;

  INSERT INTO organization_members (organization_id, profile_id, role, status, added_by)
  VALUES (p_organization_id, v_profile, p_role, 'active', auth.uid())
  ON CONFLICT (organization_id, profile_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active';

  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_org_member(
  p_organization_id UUID,
  p_profile_id      UUID,
  p_role            TEXT DEFAULT NULL,
  p_status          TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar miembros';
  END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('owner', 'admin', 'analyst', 'viewer') THEN
    RAISE EXCEPTION 'Rol interno desconocido: %', p_role;
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'Estado desconocido: %', p_status;
  END IF;

  UPDATE organization_members
     SET role = COALESCE(p_role, role),
         status = COALESCE(p_status, status)
   WHERE organization_id = p_organization_id AND profile_id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa persona no es miembro de la organizacion';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_org_members(p_organization_id UUID)
RETURNS TABLE (
  profile_id UUID,
  full_name  TEXT,
  email      TEXT,
  role       TEXT,
  status     TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver los miembros';
  END IF;
  RETURN QUERY
  SELECT m.profile_id, p.full_name, p.email, m.role, m.status, m.created_at
    FROM organization_members m JOIN profiles p ON p.id = m.profile_id
   WHERE m.organization_id = p_organization_id
   ORDER BY m.status, array_position(ARRAY['owner', 'admin', 'analyst', 'viewer'], m.role), p.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_org_member(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_org_member(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_org_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_org_member(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_org_member(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_org_members(UUID) TO authenticated;

-- Las dos RPC viejas del panel de Usuarios (00093/00098) quedan como atajos:
-- ahora agregan una membresia de owner en vez de cambiar el rol. Nadie mas
-- recibe el rol INSURER ni MOPT.
CREATE OR REPLACE FUNCTION public.admin_link_insurer_user(p_user_id UUID, p_insurer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org   UUID;
  v_email TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede vincular cuentas';
  END IF;
  SELECT id INTO v_org FROM organizations WHERE insurer_id = p_insurer_id;
  SELECT email INTO v_email FROM profiles WHERE id = p_user_id;
  IF v_org IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'La aseguradora o la cuenta no existen';
  END IF;
  PERFORM admin_add_org_member(v_org, v_email, 'owner');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_link_mopt_user(p_user_id UUID, p_provider_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org   UUID;
  v_email TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede vincular cuentas';
  END IF;
  SELECT id INTO v_org FROM organizations WHERE provider_id = p_provider_id AND type = 'MOPT';
  SELECT email INTO v_email FROM profiles WHERE id = p_user_id;
  IF v_org IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'El programa MOPT o la cuenta no existen';
  END IF;
  PERFORM admin_add_org_member(v_org, v_email, 'owner');
END;
$$;

-- Lista de organizaciones para el panel (con cuantos miembros activos tienen).
CREATE OR REPLACE FUNCTION public.admin_list_organizations()
RETURNS TABLE (
  id          UUID,
  type        TEXT,
  name        TEXT,
  status      TEXT,
  insurer_id  UUID,
  provider_id UUID,
  members     BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las organizaciones';
  END IF;
  RETURN QUERY
  SELECT o.id, o.type, o.name, o.status, o.insurer_id, o.provider_id,
         (SELECT count(*) FROM organization_members m WHERE m.organization_id = o.id AND m.status = 'active')
    FROM organizations o
   ORDER BY array_position(ARRAY['MOPT', 'INSURER', 'REINSURER', 'PROVIDER'], o.type), o.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_organizations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations() TO authenticated;
