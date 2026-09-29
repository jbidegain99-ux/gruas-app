-- =====================================================
-- VEN-03 · Alta de un cliente institucional en ≤ 1 día
--
-- Checklist en el admin (/admin/altas) que junta, para una aseguradora o un
-- programa MOPT, los pasos del alta y dice cuál falta:
--   1. Organización creada          (admin_create_institution)
--   2. Contrato y tarifas            (organization_contracts; MOPT: + tarifa Budi)
--   3. Dueño del portal              (admin_invite_org_member: invitación por correo
--                                     aunque la persona aún no tenga cuenta)
--   4. Afiliados / elegibilidad      (aseguradora: plan con reglas, póliza vigente y
--                                     afiliados; MOPT: zona activa)
--   5. Caso de prueba                (admin_preview_eligibility, sin crear servicios)
-- Al final `admin_complete_onboarding` cierra el alta y registra cuánto tardó.
--
-- Todo solo ADMIN. Nada de esto cambia el comportamiento de cobro o cobertura:
-- el caso de prueba usa los mismos motores (evaluate_coverage, mopt_program_for)
-- en modo lectura.
-- =====================================================

-- ─── Estado del alta por organización ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_onboarding (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  test_passed_at  TIMESTAMPTZ,
  test_input      JSONB,
  test_result     JSONB,
  completed_at    TIMESTAMPTZ,
  completed_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes           TEXT
);
ALTER TABLE public.org_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_onboarding FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit ON public.org_onboarding;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE ON public.org_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('test_input,test_result');

COMMENT ON TABLE public.org_onboarding IS
  'VEN-03: seguimiento del alta de un cliente institucional (caso de prueba y cierre).';

-- ─── 1. Crear el cliente ────────────────────────────────────────────────────
-- Inserta la aseguradora o el programa MOPT; el trigger ensure_organization
-- (00106) crea su organización. Devuelve el id de la organización.
CREATE OR REPLACE FUNCTION public.admin_create_institution(
  p_type TEXT, p_name TEXT, p_tax_id TEXT, p_contact_name TEXT, p_contact_email TEXT, p_contact_phone TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_id   UUID;
  v_org  UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede dar de alta clientes';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Indica el nombre del cliente';
  END IF;
  IF p_contact_email IS NOT NULL AND btrim(p_contact_email) <> ''
     AND btrim(p_contact_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Correo de contacto inválido';
  END IF;

  IF p_type = 'INSURER' THEN
    IF EXISTS (SELECT 1 FROM insurers WHERE lower(name) = lower(v_name)) THEN
      RAISE EXCEPTION 'Ya existe una aseguradora con ese nombre';
    END IF;
    INSERT INTO insurers (name, tax_id, contact_name, contact_email, contact_phone)
    VALUES (v_name, NULLIF(btrim(COALESCE(p_tax_id, '')), ''), NULLIF(btrim(COALESCE(p_contact_name, '')), ''),
            NULLIF(lower(btrim(COALESCE(p_contact_email, ''))), ''), NULLIF(btrim(COALESCE(p_contact_phone, '')), ''))
    RETURNING id INTO v_id;
    SELECT id INTO v_org FROM organizations WHERE insurer_id = v_id;
  ELSIF p_type = 'MOPT' THEN
    IF EXISTS (SELECT 1 FROM providers WHERE is_mopt AND lower(name) = lower(v_name)) THEN
      RAISE EXCEPTION 'Ya existe un programa MOPT con ese nombre';
    END IF;
    INSERT INTO providers (name, contact_email, contact_phone, business_type, is_mopt, is_active)
    VALUES (v_name, NULLIF(lower(btrim(COALESCE(p_contact_email, ''))), ''), NULLIF(btrim(COALESCE(p_contact_phone, '')), ''),
            'roadside', true, true)
    RETURNING id INTO v_id;
    SELECT id INTO v_org FROM organizations WHERE provider_id = v_id;
  ELSE
    RAISE EXCEPTION 'Tipo de cliente desconocido: %', p_type;
  END IF;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No se creó la organización del cliente';
  END IF;
  INSERT INTO org_onboarding (organization_id, started_by) VALUES (v_org, auth.uid())
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN v_org;
END;
$$;

-- Clientes que ya existían (creados por /admin/insurers o /admin/mopt) entran al
-- checklist la primera vez que se abren.
CREATE OR REPLACE FUNCTION public._ensure_onboarding(p_org UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO org_onboarding (organization_id, started_at, started_by)
  SELECT o.id, o.created_at, NULL FROM organizations o WHERE o.id = p_org
  ON CONFLICT (organization_id) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public._ensure_onboarding(UUID) FROM PUBLIC, anon, authenticated;

-- ─── 3. Invitar al dueño desde el admin ─────────────────────────────────────
-- Igual que org_invite (00113) pero para cualquier organización y sin sesión de
-- portal. La web manda el correo con el token (sendInvitationEmail).
CREATE OR REPLACE FUNCTION public.admin_invite_org_member(p_org UUID, p_email TEXT, p_role TEXT DEFAULT 'owner')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_email TEXT := lower(btrim(COALESCE(p_email, '')));
  v_token TEXT;
  v_id    UUID;
  v_role  user_role;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede invitar desde el panel';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org AND type IN ('INSURER', 'MOPT')) THEN
    RAISE EXCEPTION 'Organización no encontrada';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Correo inválido';
  END IF;
  IF p_role NOT IN ('owner', 'admin', 'analyst', 'viewer') THEN
    RAISE EXCEPTION 'Rol desconocido: %', p_role;
  END IF;

  SELECT role INTO v_role FROM profiles WHERE lower(email) = v_email;
  IF v_role::text IN ('ADMIN', 'SUPPORT', 'OPERATOR') THEN
    RAISE EXCEPTION 'Esa cuenta no puede ser miembro de un portal cliente';
  END IF;
  IF EXISTS (SELECT 1 FROM organization_members om JOIN profiles p ON p.id = om.profile_id
              WHERE lower(p.email) = v_email AND om.status = 'active') THEN
    RAISE EXCEPTION 'Esa persona ya trabaja en un portal';
  END IF;

  UPDATE organization_invitations SET revoked_at = now()
   WHERE organization_id = p_org AND lower(email) = v_email
     AND accepted_at IS NULL AND revoked_at IS NULL;

  v_token := encode(gen_random_bytes(24), 'hex');
  INSERT INTO organization_invitations (organization_id, email, role, token_hash, invited_by, invited_by_name)
  VALUES (p_org, v_email, p_role, encode(digest(v_token, 'sha256'), 'hex'), auth.uid(),
          (SELECT full_name FROM profiles WHERE id = auth.uid()))
  RETURNING id INTO v_id;

  PERFORM _ensure_onboarding(p_org);
  RETURN jsonb_build_object('id', v_id, 'token', v_token, 'email', v_email, 'role', p_role,
                            'expires_at', now() + interval '7 days');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_org_invitation(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  UPDATE organization_invitations SET revoked_at = now()
   WHERE id = p_id AND accepted_at IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa invitación no existe o ya se usó';
  END IF;
END;
$$;

-- ─── 5. Caso de prueba ──────────────────────────────────────────────────────
-- Aseguradora: ¿el documento es afiliado vigente de ESTA aseguradora y el plan
-- cubre el servicio? Devuelve el desglose de evaluate_coverage.
-- MOPT: ¿un servicio en ese punto, ahora, lo absorbe ESTE programa?
-- No crea servicios ni consume cobertura. Si da positivo, marca el paso.
CREATE OR REPLACE FUNCTION public.admin_preview_eligibility(
  p_org UUID, p_service_type TEXT, p_document TEXT DEFAULT NULL,
  p_lat DOUBLE PRECISION DEFAULT NULL, p_lng DOUBLE PRECISION DEFAULT NULL, p_total NUMERIC DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o        RECORD;
  m        RECORD;
  v_eval   JSONB;
  v_prog   UUID;
  v_zones  JSONB;
  v_result JSONB;
  v_ok     BOOLEAN := false;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  SELECT * INTO o FROM organizations WHERE id = p_org;
  IF NOT FOUND OR o.type NOT IN ('INSURER', 'MOPT') THEN
    RAISE EXCEPTION 'Organización no encontrada';
  END IF;
  IF NULLIF(btrim(COALESCE(p_service_type, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Elige el servicio';
  END IF;

  IF o.type = 'INSURER' THEN
    IF NULLIF(btrim(COALESCE(p_document, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Indica el DUI o documento del afiliado';
    END IF;
    -- Misma preferencia que check_member_coverage: la afiliación vigente hoy.
    SELECT mm.id, mm.full_name, po.policy_number, cp.name AS plan_name, po.plan_id,
           (mm.is_active AND mm.starts_on <= sv_today() AND (mm.ends_on IS NULL OR mm.ends_on >= sv_today())
            AND po.status = 'active' AND po.starts_on <= sv_today() AND (po.ends_on IS NULL OR po.ends_on >= sv_today())) AS vigente
      INTO m
      FROM members mm
      JOIN policies po ON po.id = mm.policy_id
      JOIN coverage_plans cp ON cp.id = po.plan_id
     WHERE po.insurer_id = o.insurer_id
       AND member_document_key(mm.document_number) = member_document_key(p_document)
     ORDER BY 6 DESC, po.ends_on DESC NULLS FIRST, mm.id
     LIMIT 1;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'Ese documento no está en el padrón de esta aseguradora');
    ELSIF NOT m.vigente THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'El afiliado o su póliza no están vigentes hoy',
                                     'member', m.full_name, 'policy_number', m.policy_number);
    ELSIF NOT plan_cubre_servicio(m.plan_id, p_service_type) THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'El plan no cubre este servicio',
                                     'member', m.full_name, 'policy_number', m.policy_number, 'plan', m.plan_name);
    ELSE
      v_eval := evaluate_coverage(m.id, p_service_type, COALESCE(p_total, 100), NULL, 'light', NULL);
      v_ok := COALESCE((v_eval->>'covered')::boolean, false);
      v_result := jsonb_build_object('ok', v_ok, 'reason', CASE WHEN v_ok THEN NULL ELSE v_eval->>'reason' END,
                                     'member', m.full_name, 'policy_number', m.policy_number, 'plan', m.plan_name,
                                     'amount_total', v_eval->'amount_total', 'amount_covered', v_eval->'amount_covered',
                                     'amount_copay', v_eval->'amount_copay', 'events_used', v_eval->'events_used',
                                     'services_per_year', v_eval->'services_per_year');
    END IF;
  ELSE
    IF p_lat IS NULL OR p_lng IS NULL THEN
      RAISE EXCEPTION 'Indica el punto del servicio (latitud y longitud)';
    END IF;
    v_prog := mopt_program_for(p_lat, p_lng, p_service_type);
    -- Por qué no: qué zonas del programa contienen el punto y si están abiertas.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'zone', z.name, 'is_active', z.is_active,
             'serves', (z.service_types IS NULL OR p_service_type = ANY (z.service_types)),
             'open_now', mopt_zone_open_now(z.hours_from, z.hours_to, z.active_days))), '[]'::jsonb)
      INTO v_zones
      FROM mopt_zones z
     WHERE z.provider_id = o.provider_id
       AND point_in_polygon(p_lat, p_lng, z.polygon);
    v_ok := v_prog IS NOT DISTINCT FROM o.provider_id;
    v_result := jsonb_build_object(
      'ok', v_ok,
      'reason', CASE
        WHEN v_ok THEN NULL
        WHEN v_prog IS NOT NULL THEN 'Ese punto lo cubre otro programa MOPT: ' || (SELECT name FROM providers WHERE id = v_prog)
        WHEN jsonb_array_length(v_zones) = 0 THEN 'El punto no cae en ninguna zona del programa'
        WHEN NOT mopt_program_has_budget(o.provider_id) THEN 'El programa agotó su tope mensual o su contrato no está vigente'
        ELSE 'La zona no está activa, no atiende este servicio o está fuera de horario' END,
      'zones', v_zones);
  END IF;

  PERFORM _ensure_onboarding(p_org);
  UPDATE org_onboarding
     SET test_input = jsonb_build_object('service_type', p_service_type, 'document', p_document,
                                         'lat', p_lat, 'lng', p_lng, 'total', p_total),
         test_result = v_result,
         test_passed_at = CASE WHEN v_ok THEN now() ELSE test_passed_at END
   WHERE organization_id = p_org;
  RETURN v_result;
END;
$$;

-- ─── Checklist ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_onboarding_status(p_org UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o   RECORD;
  ob  RECORD;
  c   RECORD;
  v_owner    JSONB;
  v_invites  JSONB;
  v_plans    INT := 0;
  v_rules    INT := 0;
  v_policies INT := 0;
  v_members  INT := 0;
  v_zones    INT := 0;
  v_fee      NUMERIC;
  v_fee_set  BOOLEAN := false;
  v_sla_a    INT;
  v_sla_l    INT;
  v_steps    JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  SELECT og.*, COALESCE(i.name, pr.name) AS client_name,
         COALESCE(i.is_active, pr.is_active) AS client_active
    INTO o
    FROM organizations og
    LEFT JOIN insurers i   ON i.id = og.insurer_id
    LEFT JOIN providers pr ON pr.id = og.provider_id
   WHERE og.id = p_org AND og.type IN ('INSURER', 'MOPT');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organización no encontrada';
  END IF;

  PERFORM _ensure_onboarding(p_org);
  SELECT * INTO ob FROM org_onboarding WHERE organization_id = p_org;
  SELECT * INTO c FROM organization_contracts WHERE organization_id = p_org;

  SELECT jsonb_build_object('name', p.full_name, 'email', p.email, 'since', om.created_at)
    INTO v_owner
    FROM organization_members om JOIN profiles p ON p.id = om.profile_id
   WHERE om.organization_id = p_org AND om.role = 'owner' AND om.status = 'active'
   ORDER BY om.created_at LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', inv.id, 'email', inv.email, 'role', inv.role,
                                               'created_at', inv.created_at, 'expires_at', inv.expires_at,
                                               'expired', inv.expires_at <= now())
                            ORDER BY inv.created_at DESC), '[]'::jsonb)
    INTO v_invites
    FROM organization_invitations inv
   WHERE inv.organization_id = p_org AND inv.accepted_at IS NULL AND inv.revoked_at IS NULL;

  IF o.type = 'INSURER' THEN
    SELECT count(*) FILTER (WHERE cp.is_active),
           (SELECT count(*) FROM coverage_rules r JOIN coverage_plans cp2 ON cp2.id = r.plan_id
             WHERE cp2.insurer_id = o.insurer_id AND cp2.is_active)
      INTO v_plans, v_rules
      FROM coverage_plans cp WHERE cp.insurer_id = o.insurer_id;
    SELECT count(*) INTO v_policies FROM policies po
     WHERE po.insurer_id = o.insurer_id AND po.status = 'active'
       AND po.starts_on <= sv_today() AND (po.ends_on IS NULL OR po.ends_on >= sv_today());
    SELECT count(*) INTO v_members FROM members mm JOIN policies po ON po.id = mm.policy_id
     WHERE po.insurer_id = o.insurer_id AND mm.is_active;
    SELECT sla_assignment_minutes, sla_arrival_minutes INTO v_sla_a, v_sla_l FROM insurers WHERE id = o.insurer_id;
  ELSE
    SELECT count(*) INTO v_zones FROM mopt_zones WHERE provider_id = o.provider_id AND is_active;
    v_fee := mopt_fee_rate_at(o.provider_id, now());
    v_fee_set := EXISTS (SELECT 1 FROM rate_versions WHERE kind = 'mopt_fee' AND subject_id = o.provider_id);
    v_sla_a := COALESCE(o.sla_assignment_minutes, 10);
    v_sla_l := COALESCE(o.sla_arrival_minutes, 45);
  END IF;

  v_steps := jsonb_build_array(
    jsonb_build_object('key', 'org', 'done', o.client_active AND o.status = 'active',
      'detail', CASE WHEN o.client_active THEN 'Activa' ELSE 'Creada pero inactiva: actívala para que su portal abra' END),
    jsonb_build_object('key', 'contract',
      'done', c.organization_id IS NOT NULL AND c.valid_from <= sv_today() AND (c.valid_to IS NULL OR c.valid_to >= sv_today())
              AND (o.type = 'INSURER' OR v_fee_set),
      'contract', CASE WHEN c.organization_id IS NULL THEN NULL ELSE jsonb_build_object(
                    'reference', c.reference, 'valid_from', c.valid_from, 'valid_to', c.valid_to,
                    'monthly_cap', c.monthly_cap) END,
      'fee', v_fee, 'fee_set', v_fee_set,
      'sla_assignment_minutes', v_sla_a, 'sla_arrival_minutes', v_sla_l),
    jsonb_build_object('key', 'owner', 'done', v_owner IS NOT NULL, 'owner', v_owner, 'invitations', v_invites),
    CASE WHEN o.type = 'INSURER' THEN
      jsonb_build_object('key', 'members', 'done', v_plans > 0 AND v_rules > 0 AND v_policies > 0 AND v_members > 0,
        'plans', v_plans, 'rules', v_rules, 'policies', v_policies, 'members', v_members)
    ELSE
      jsonb_build_object('key', 'zones', 'done', v_zones > 0, 'zones', v_zones)
    END,
    jsonb_build_object('key', 'test', 'done', ob.test_passed_at IS NOT NULL,
      'passed_at', ob.test_passed_at, 'last_input', ob.test_input, 'last_result', ob.test_result));

  RETURN jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'type', o.type, 'name', o.client_name, 'status', o.status,
                                       'insurer_id', o.insurer_id, 'provider_id', o.provider_id),
    'started_at', ob.started_at,
    'completed_at', ob.completed_at,
    'hours', round(EXTRACT(EPOCH FROM (COALESCE(ob.completed_at, now()) - ob.started_at)) / 3600, 1),
    'notes', ob.notes,
    'steps', v_steps,
    'ready', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_steps) s WHERE NOT (s->>'done')::boolean));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_onboarding_overview()
RETURNS TABLE (organization_id UUID, type TEXT, name TEXT, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
               steps_done INT, steps_total INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  s JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  FOR r IN SELECT og.id FROM organizations og WHERE og.type IN ('INSURER', 'MOPT') LOOP
    s := admin_onboarding_status(r.id);
    organization_id := r.id;
    type := s->'organization'->>'type';
    name := s->'organization'->>'name';
    started_at := (s->>'started_at')::timestamptz;
    completed_at := (s->>'completed_at')::timestamptz;
    steps_done := (SELECT count(*) FROM jsonb_array_elements(s->'steps') x WHERE (x->>'done')::boolean);
    steps_total := jsonb_array_length(s->'steps');
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_complete_onboarding(p_org UUID, p_notes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE s JSONB := admin_onboarding_status(p_org);
BEGIN
  IF NOT (s->>'ready')::boolean THEN
    RAISE EXCEPTION 'Faltan pasos del alta: %',
      (SELECT string_agg(x->>'key', ', ') FROM jsonb_array_elements(s->'steps') x WHERE NOT (x->>'done')::boolean);
  END IF;
  UPDATE org_onboarding
     SET completed_at = COALESCE(completed_at, now()), completed_by = COALESCE(completed_by, auth.uid()),
         notes = COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), notes)
   WHERE organization_id = p_org;
  RETURN admin_onboarding_status(p_org);
END;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_create_institution(text,text,text,text,text,text)',
    'admin_invite_org_member(uuid,text,text)', 'admin_revoke_org_invitation(uuid)',
    'admin_preview_eligibility(uuid,text,text,double precision,double precision,numeric)',
    'admin_onboarding_status(uuid)', 'admin_onboarding_overview()', 'admin_complete_onboarding(uuid,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
