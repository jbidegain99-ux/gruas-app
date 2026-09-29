-- 00127: autoservicio de la aseguradora — pólizas, planes y afiliados (backlog ASE-02)
--
-- Hasta ahora el alta de pólizas, planes y el padrón era del admin de Budi.
-- Desde el portal, acotado SIEMPRE a su propia aseguradora (auth_insurer_id):
--   - dueño y administradores del portal: crean y editan planes y pólizas;
--   - además, la analista: importa afiliados por CSV y da de baja o reactiva;
--   - solo lectura: consulta.
-- Las REGLAS de cobertura de cada plan (qué servicios, cuántos, montos) siguen
-- en manos de Budi: definen lo que se le factura a la aseguradora.
--
-- La baja corta la cobertura al instante: check_member_coverage mira
-- `is_active` al pedir el servicio.
--
-- Carga de 10 000 afiliados: el portal parte el archivo en lotes (el rol
-- authenticated tiene 8 s por consulta) y la base informa el error por fila
-- con su número real en el archivo (p_row_offset).

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;

-- Vincular por DUI al importar: sin índice era un recorrido completo por fila.
CREATE INDEX IF NOT EXISTS profile_sensitive_document_key_idx
  ON public.profile_sensitive (member_document_key(dui_number));

-- Quién puede hacer qué en el portal de su aseguradora.
CREATE OR REPLACE FUNCTION public.insurer_portal_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.member_role FROM auth_org() o WHERE o.type = 'INSURER' AND o.insurer_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.insurer_portal_role() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.require_insurer_role(p_roles TEXT[])
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_role TEXT := insurer_portal_role();
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Necesitas una sesión en el portal de tu aseguradora (con 2FA si eres dueño o administrador)';
  END IF;
  IF NOT (v_role = ANY (p_roles)) THEN
    RAISE EXCEPTION 'Tu rol en el portal no permite esta acción';
  END IF;
  RETURN auth_insurer_id();
END;
$$;
REVOKE ALL ON FUNCTION public.require_insurer_role(TEXT[]) FROM PUBLIC, anon, authenticated;

-- ─── Lectura ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_insurer_catalog()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ins UUID := require_insurer_role(ARRAY['owner', 'admin', 'analyst', 'viewer']);
BEGIN
  RETURN jsonb_build_object(
    'role', insurer_portal_role(),
    'plans', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'code', p.code, 'name', p.name, 'description', p.description, 'is_active', p.is_active,
               'services', (SELECT COALESCE(jsonb_agg(DISTINCT r.service_type), '[]'::jsonb)
                              FROM coverage_rules r WHERE r.plan_id = p.id))
               ORDER BY p.name) FROM coverage_plans p WHERE p.insurer_id = v_ins), '[]'::jsonb),
    'policies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'id', po.id, 'policy_number', po.policy_number, 'holder_name', po.holder_name,
               'plan_id', po.plan_id, 'plan_name', pl.name, 'starts_on', po.starts_on, 'ends_on', po.ends_on,
               'status', po.status,
               'members_active', (SELECT count(*) FROM members m WHERE m.policy_id = po.id AND m.is_active),
               'members_total', (SELECT count(*) FROM members m WHERE m.policy_id = po.id))
               ORDER BY po.policy_number) FROM policies po JOIN coverage_plans pl ON pl.id = po.plan_id
              WHERE po.insurer_id = v_ins), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_policy_members(p_policy UUID, p_search TEXT DEFAULT NULL,
                                                        p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins UUID := require_insurer_role(ARRAY['owner', 'admin', 'analyst', 'viewer']);
  v_q TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM policies WHERE id = p_policy AND insurer_id = v_ins) THEN
    RAISE EXCEPTION 'Póliza no encontrada';
  END IF;
  RETURN (
    WITH f AS (
      SELECT m.* FROM members m
       WHERE m.policy_id = p_policy
         AND (v_q IS NULL OR m.full_name ILIKE '%' || v_q || '%'
              OR member_document_key(m.document_number) = member_document_key(v_q))
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM f),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', id, 'document_number', document_number, 'full_name', full_name, 'phone', phone,
                'relationship', relationship, 'starts_on', starts_on, 'ends_on', ends_on,
                'is_active', is_active, 'has_app', profile_id IS NOT NULL,
                'deactivated_at', deactivated_at, 'deactivation_reason', deactivation_reason)
                ORDER BY full_name)
              FROM (SELECT * FROM f ORDER BY full_name LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)) x),
              '[]'::jsonb)));
END;
$$;

-- ─── Planes y pólizas (dueño / administrador) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_save_plan(p_id UUID, p_code TEXT, p_name TEXT, p_description TEXT, p_is_active BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins UUID := require_insurer_role(ARRAY['owner', 'admin']);
  v_id UUID;
BEGIN
  IF NULLIF(btrim(COALESCE(p_code, '')), '') IS NULL OR NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el código y el nombre del plan';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO coverage_plans (insurer_id, code, name, description, is_active)
    VALUES (v_ins, btrim(p_code), btrim(p_name), NULLIF(btrim(COALESCE(p_description, '')), ''), COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE coverage_plans
       SET code = btrim(p_code), name = btrim(p_name), description = NULLIF(btrim(COALESCE(p_description, '')), ''),
           is_active = COALESCE(p_is_active, is_active), updated_at = now()
     WHERE id = p_id AND insurer_id = v_ins
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Plan no encontrado';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_save_policy(p_id UUID, p_policy_number TEXT, p_holder_name TEXT, p_plan UUID,
                                                     p_starts_on DATE, p_ends_on DATE, p_status TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins UUID := require_insurer_role(ARRAY['owner', 'admin']);
  v_id UUID;
BEGIN
  IF NULLIF(btrim(COALESCE(p_policy_number, '')), '') IS NULL OR NULLIF(btrim(COALESCE(p_holder_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el número de póliza y el contratante';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM coverage_plans WHERE id = p_plan AND insurer_id = v_ins) THEN
    RAISE EXCEPTION 'Elige uno de tus planes';
  END IF;
  IF p_starts_on IS NULL OR (p_ends_on IS NOT NULL AND p_ends_on < p_starts_on) THEN
    RAISE EXCEPTION 'Revisa la vigencia de la póliza';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO policies (insurer_id, plan_id, policy_number, holder_name, starts_on, ends_on, status)
    VALUES (v_ins, p_plan, btrim(p_policy_number), btrim(p_holder_name), p_starts_on, p_ends_on, COALESCE(p_status, 'active'))
    RETURNING id INTO v_id;
  ELSE
    UPDATE policies
       SET plan_id = p_plan, policy_number = btrim(p_policy_number), holder_name = btrim(p_holder_name),
           starts_on = p_starts_on, ends_on = p_ends_on, status = COALESCE(p_status, status), updated_at = now()
     WHERE id = p_id AND insurer_id = v_ins
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Póliza no encontrada';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- ─── Afiliados (dueño, administrador o analista) ───────────────────────────
CREATE OR REPLACE FUNCTION public.portal_import_members(p_policy UUID, p_members JSONB, p_row_offset INT DEFAULT 0)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins UUID := require_insurer_role(ARRAY['owner', 'admin', 'analyst']);
  r JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM policies WHERE id = p_policy AND insurer_id = v_ins) THEN
    RAISE EXCEPTION 'Póliza no encontrada';
  END IF;
  IF jsonb_typeof(p_members) <> 'array' OR jsonb_array_length(p_members) > 2000 THEN
    RAISE EXCEPTION 'Envía los afiliados en lotes de hasta 2000 filas';
  END IF;
  r := _import_members(p_policy, p_members);
  -- El número de fila del archivo completo, no del lote.
  RETURN r || jsonb_build_object('errors', COALESCE((
    SELECT jsonb_agg(e || jsonb_build_object('row', (e->>'row')::int + GREATEST(p_row_offset, 0)))
      FROM jsonb_array_elements(r->'errors') e), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_set_member_active(p_member UUID, p_active BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ins UUID := require_insurer_role(ARRAY['owner', 'admin', 'analyst']);
BEGIN
  IF NOT p_active AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el motivo de la baja';
  END IF;
  UPDATE members m
     SET is_active = p_active,
         deactivated_at = CASE WHEN p_active THEN NULL ELSE now() END,
         deactivated_by = CASE WHEN p_active THEN NULL ELSE auth.uid() END,
         deactivation_reason = CASE WHEN p_active THEN NULL ELSE btrim(p_reason) END,
         updated_at = now()
   WHERE m.id = p_member
     AND m.policy_id IN (SELECT id FROM policies WHERE insurer_id = v_ins);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Afiliado no encontrado';
  END IF;
END;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'portal_insurer_catalog()', 'portal_policy_members(uuid,text,integer,integer)',
    'portal_save_plan(uuid,text,text,text,boolean)', 'portal_save_policy(uuid,text,text,uuid,date,date,text)',
    'portal_import_members(uuid,jsonb,integer)', 'portal_set_member_active(uuid,boolean,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Lo que hace la aseguradora en su portal queda en la bitácora (00094).
DROP TRIGGER IF EXISTS trg_audit ON public.members;
CREATE TRIGGER trg_audit
  AFTER UPDATE OF is_active ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('', 'is_active,deactivation_reason');
