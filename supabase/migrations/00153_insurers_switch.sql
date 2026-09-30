-- =====================================================
-- Interruptor de aseguradoras (apagado por ahora)
--
-- Walter (2026-09-30): "ocultá lo de las aseguradoras por el momento, yo te
-- aviso cuando tenga que aparecer". Un solo interruptor en la base, que:
--   * apaga la cobertura de seguro (check_member_coverage devuelve 'none'):
--     el pedido va como particular o cortesía MOPT, y el precio que ve el
--     Usuario coincide con lo que se cobra;
--   * cierra los portales de aseguradora y reaseguradora (sus miembros no
--     tienen organización activa en my_organization / auth_org);
--   * lo leen la web y la app (platform_features) para ocultar sus pantallas.
-- No se borra nada: prenderlo deja todo como estaba.
--   UPDATE platform_features SET insurers_enabled = true;   -- o desde el admin
-- =====================================================

CREATE TABLE IF NOT EXISTS public.platform_features (
  id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  insurers_enabled  BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
INSERT INTO public.platform_features (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.platform_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_features FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.insurers_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT insurers_enabled FROM platform_features WHERE id = 1), false);
$$;
REVOKE ALL ON FUNCTION public.insurers_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insurers_enabled() TO authenticated;

-- Lo que la web y la app necesitan saber (no es secreto: se ve igual en pantalla).
CREATE OR REPLACE FUNCTION public.platform_features()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('insurers', insurers_enabled());
$$;
REVOKE ALL ON FUNCTION public.platform_features() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_features() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_insurers_enabled(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  UPDATE platform_features SET insurers_enabled = p_enabled, updated_at = now(), updated_by = auth.uid() WHERE id = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_insurers_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_insurers_enabled(boolean) TO authenticated;

DROP TRIGGER IF EXISTS trg_audit ON public.platform_features;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.platform_features
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Portales: con el interruptor apagado, una aseguradora o reaseguradora no es
-- una organización activa para nadie (MOPT no cambia).
CREATE OR REPLACE FUNCTION public.auth_org()
RETURNS TABLE(organization_id uuid, type text, name text, member_role text, insurer_id uuid, provider_id uuid)
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
     -- 00113 (POR-02): owner y admin solo con segundo factor verificado.
     AND (NOT org_role_requires_mfa(m.role) OR session_has_mfa())
     -- 00153: aseguradoras apagadas.
     AND (o.type NOT IN ('INSURER', 'REINSURER') OR insurers_enabled())
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.my_organization()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
           'id', o.id, 'type', o.type, 'name', o.name, 'member_role', m.role,
           'mfa_required', org_role_requires_mfa(m.role),
           'mfa_ok', NOT org_role_requires_mfa(m.role) OR session_has_mfa())
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
   WHERE m.profile_id = auth.uid()
     AND m.status = 'active'
     AND o.status = 'active'
     -- 00153: aseguradoras apagadas.
     AND (o.type NOT IN ('INSURER', 'REINSURER') OR insurers_enabled())
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.check_member_coverage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id  UUID;
  v_dui      TEXT;
  v_member   RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'reason', 'No autenticado');
  END IF;

  -- 00153: con las aseguradoras apagadas nadie tiene cobertura: el pedido va
  -- como particular (o cortesía MOPT) y la app no habla de pólizas.
  IF NOT insurers_enabled() THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  -- (a) Vinculacion diferida: la aseguradora carga su padron (B-10) antes de que
  -- el afiliado se instale la app, asi que `members.profile_id` suele venir NULL
  -- y el match se hace por documento. Se vincula la PRIMERA vez que coincide.
  -- Solo se toman filas con profile_id NULL: nunca se le roba un afiliado ya
  -- vinculado a otra cuenta.
  SELECT member_document_key(dui_number) INTO v_dui
    FROM profile_sensitive
   WHERE profile_id = v_user_id;

  IF v_dui IS NOT NULL THEN
    UPDATE members
       SET profile_id = v_user_id,
           updated_at = NOW()
     WHERE profile_id IS NULL
       AND member_document_key(document_number) = v_dui;
  END IF;

  -- (b) Elegir la afiliacion. Una persona puede figurar en mas de una poliza
  -- (p. ej. titular en una y beneficiario en otra): se prefiere la que este
  -- vigente hoy, y entre esas la que caduca mas tarde. El ORDER BY es
  -- determinista para que dos llamadas seguidas no devuelvan cosas distintas.
  SELECT m.id            AS member_id,
         m.relationship,
         m.is_active     AS member_active,
         m.starts_on     AS member_starts_on,
         m.ends_on       AS member_ends_on,
         p.id            AS policy_id,
         p.policy_number,
         p.status        AS policy_status,
         p.starts_on     AS policy_starts_on,
         p.ends_on       AS policy_ends_on,
         cp.id           AS plan_id,
         cp.code         AS plan_code,
         cp.name         AS plan_name,
         i.name          AS insurer_name,
         (m.is_active
           AND m.starts_on <= sv_today()
           AND (m.ends_on IS NULL OR m.ends_on >= sv_today())
           AND p.status = 'active'
           AND p.starts_on <= sv_today()
           AND (p.ends_on IS NULL OR p.ends_on >= sv_today())) AS vigente
    INTO v_member
    FROM members m
    JOIN policies p        ON p.id  = m.policy_id
    JOIN coverage_plans cp ON cp.id = p.plan_id
    JOIN insurers i        ON i.id  = p.insurer_id
   WHERE m.profile_id = v_user_id
   ORDER BY vigente DESC,
            COALESCE(p.ends_on, DATE '9999-12-31') DESC,
            m.created_at ASC
   LIMIT 1;

  IF v_member.member_id IS NULL THEN
    -- No es afiliado. NO es un error: paga como cliente particular.
    RETURN jsonb_build_object('status', 'none');
  END IF;

  IF v_member.vigente THEN
    RETURN jsonb_build_object(
      'status',        'covered',
      'member_id',     v_member.member_id,
      'policy_id',     v_member.policy_id,
      'plan_id',       v_member.plan_id,
      'policy_number', v_member.policy_number,
      'plan_code',     v_member.plan_code,
      'plan_name',     v_member.plan_name,
      'insurer_name',  v_member.insurer_name,
      'relationship',  v_member.relationship
    );
  END IF;

  -- Vencida/suspendida: se dice POR QUE. Un "no tenes cobertura" a secas frente
  -- a una poliza que el usuario cree vigente es el peor mensaje posible.
  RETURN jsonb_build_object(
    'status',        'inactive',
    'member_id',     v_member.member_id,
    'policy_id',     v_member.policy_id,
    'policy_number', v_member.policy_number,
    'plan_name',     v_member.plan_name,
    'insurer_name',  v_member.insurer_name,
    'reason',        CASE
      WHEN NOT v_member.member_active                    THEN 'Tu afiliacion esta dada de baja'
      WHEN v_member.member_starts_on > sv_today()      THEN 'Tu afiliacion aun no entra en vigencia'
      WHEN v_member.member_ends_on < sv_today()        THEN 'Tu afiliacion vencio'
      WHEN v_member.policy_status = 'suspended'          THEN 'La poliza esta suspendida'
      WHEN v_member.policy_status = 'cancelled'          THEN 'La poliza fue cancelada'
      WHEN v_member.policy_status = 'expired'            THEN 'La poliza vencio'
      WHEN v_member.policy_starts_on > sv_today()      THEN 'La poliza aun no entra en vigencia'
      WHEN v_member.policy_ends_on < sv_today()        THEN 'La poliza vencio'
      ELSE 'La cobertura no esta vigente'
    END
  );
END;
$$;
