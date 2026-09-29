-- =====================================================
-- REA-01 / REA-02 · Portal de reaseguradoras
--
-- Decisión D3 (propuesta por defecto del backlog, pendiente de confirmar con
-- Jose): la reaseguradora ve SOLO agregados y SLA por aseguradora cedente, sin
-- datos personales del Usuario, y no paga.
--
-- REA-01: `reinsurer_cedents` vincula una reaseguradora con N aseguradoras y
--   una vigencia (lo hace el admin). La aseguradora debe AUTORIZAR desde su
--   portal (dueño, con 2FA) que su reaseguradora vea sus agregados; cada
--   autorización o revocación queda como evidencia (quién, cuándo, IP).
--   Sin autorización la reaseguradora no ve nada de esa aseguradora.
-- REA-02: `reinsurer_dashboard(desde, hasta)` devuelve solo agregados:
--   servicios, costo, costo promedio, frecuencia por 1 000 afiliados, SLA,
--   tipo de servicio y tendencia mensual. Toda celda con menos de 5 casos se
--   suprime, y los totales suman solo celdas publicadas (así no se deduce una
--   celda suprimida restando). La reaseguradora no tiene grants sobre tablas
--   de casos: no existe forma de pedir un caso individual.
-- Además: la reaseguradora se da de alta desde el checklist de VEN-03 (00130).
-- =====================================================

-- ─── REA-01: vínculos y consentimiento ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reinsurer_cedents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reinsurer_org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  insurer_org_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  valid_from       DATE NOT NULL,
  valid_to         DATE,
  consent_status   TEXT NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending', 'granted', 'revoked')),
  consent_at       TIMESTAMPTZ,
  consent_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reinsurer_org_id, insurer_org_id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
ALTER TABLE public.reinsurer_cedents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reinsurer_cedents FROM PUBLIC, anon, authenticated;

-- Evidencia del consentimiento B2B: solo se agregan filas.
CREATE TABLE IF NOT EXISTS public.reinsurer_consent_events (
  id         BIGSERIAL PRIMARY KEY,
  link_id    UUID NOT NULL REFERENCES public.reinsurer_cedents(id) ON DELETE CASCADE,
  action     TEXT NOT NULL CHECK (action IN ('granted', 'revoked')),
  actor      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name TEXT,
  reason     TEXT,
  ip         TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reinsurer_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reinsurer_consent_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reinsurer_consent_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La evidencia de consentimiento no se modifica ni se borra';
END;
$$;
DROP TRIGGER IF EXISTS trg_immutable ON public.reinsurer_consent_events;
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON public.reinsurer_consent_events
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.reinsurer_consent_events_immutable();

DROP TRIGGER IF EXISTS trg_audit ON public.reinsurer_cedents;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.reinsurer_cedents
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at');

COMMENT ON TABLE public.reinsurer_cedents IS
  'REA-01: reaseguradora ↔ aseguradora cedente con vigencia y consentimiento de la aseguradora.';

-- Admin: crear o cambiar la vigencia del vínculo (no toca el consentimiento).
CREATE OR REPLACE FUNCTION public.admin_set_reinsurer_link(p_reinsurer_org UUID, p_insurer_org UUID,
                                                          p_valid_from DATE, p_valid_to DATE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_reinsurer_org AND type = 'REINSURER') THEN
    RAISE EXCEPTION 'Reaseguradora no encontrada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_insurer_org AND type = 'INSURER') THEN
    RAISE EXCEPTION 'Aseguradora no encontrada';
  END IF;
  IF p_valid_from IS NULL OR (p_valid_to IS NOT NULL AND p_valid_to < p_valid_from) THEN
    RAISE EXCEPTION 'Vigencia inválida';
  END IF;
  INSERT INTO reinsurer_cedents (reinsurer_org_id, insurer_org_id, valid_from, valid_to, created_by)
  VALUES (p_reinsurer_org, p_insurer_org, p_valid_from, p_valid_to, auth.uid())
  ON CONFLICT (reinsurer_org_id, insurer_org_id)
  DO UPDATE SET valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reinsurers()
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
  RETURN jsonb_build_object(
    'reinsurers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'status', r.status,
        'members', (SELECT count(*) FROM organization_members om WHERE om.organization_id = r.id AND om.status = 'active'),
        'links', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', rc.id, 'insurer_org_id', rc.insurer_org_id, 'insurer_name', io.name,
            'valid_from', rc.valid_from, 'valid_to', rc.valid_to,
            'consent_status', rc.consent_status, 'consent_at', rc.consent_at) ORDER BY io.name)
          FROM reinsurer_cedents rc JOIN organizations io ON io.id = rc.insurer_org_id
         WHERE rc.reinsurer_org_id = r.id), '[]'::jsonb))
        ORDER BY r.name) FROM organizations r WHERE r.type = 'REINSURER'), '[]'::jsonb),
    'insurers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) ORDER BY o.name)
                            FROM organizations o WHERE o.type = 'INSURER' AND o.status = 'active'), '[]'::jsonb));
END;
$$;

-- Aseguradora: sus reaseguradoras y el estado del permiso (cualquier rol lo ve).
CREATE OR REPLACE FUNCTION public.portal_reinsurer_links()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins UUID := require_insurer_role(ARRAY['owner', 'admin', 'analyst', 'viewer']);
BEGIN
  RETURN jsonb_build_object(
    'role', insurer_portal_role(),
    'links', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', rc.id, 'reinsurer_name', r.name, 'valid_from', rc.valid_from, 'valid_to', rc.valid_to,
        'consent_status', rc.consent_status, 'consent_at', rc.consent_at,
        'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', e.action, 'actor_name', e.actor_name,
                                                                  'reason', e.reason, 'at', e.created_at) ORDER BY e.id DESC)
                               FROM reinsurer_consent_events e WHERE e.link_id = rc.id), '[]'::jsonb))
        ORDER BY r.name)
      FROM reinsurer_cedents rc
      JOIN organizations r  ON r.id = rc.reinsurer_org_id
      JOIN organizations io ON io.id = rc.insurer_org_id
     WHERE io.insurer_id = v_ins), '[]'::jsonb));
END;
$$;

-- Solo el dueño (con 2FA) autoriza o revoca. Queda la evidencia.
CREATE OR REPLACE FUNCTION public.portal_set_reinsurer_consent(p_link UUID, p_grant BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins     UUID := require_insurer_role(ARRAY['owner']);
  v_headers JSON;
  v_ip      TEXT;
BEGIN
  IF NOT p_grant AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el motivo de la revocación';
  END IF;
  UPDATE reinsurer_cedents rc
     SET consent_status = CASE WHEN p_grant THEN 'granted' ELSE 'revoked' END,
         consent_at = now(), consent_by = auth.uid(), updated_at = now()
    FROM organizations io
   WHERE rc.id = p_link AND io.id = rc.insurer_org_id AND io.insurer_id = v_ins
     AND rc.consent_status <> CASE WHEN p_grant THEN 'granted' ELSE 'revoked' END;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vínculo no encontrado o ya estaba así';
  END IF;

  BEGIN
    v_headers := current_setting('request.headers', true)::json;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;
  v_ip := btrim(split_part(COALESCE(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip', ''), ',', 1));

  INSERT INTO reinsurer_consent_events (link_id, action, actor, actor_name, reason, ip, user_agent)
  VALUES (p_link, CASE WHEN p_grant THEN 'granted' ELSE 'revoked' END, auth.uid(),
          (SELECT full_name FROM profiles WHERE id = auth.uid()),
          NULLIF(btrim(COALESCE(p_reason, '')), ''), NULLIF(v_ip, ''), left(v_headers->>'user-agent', 300));
END;
$$;

-- ─── REA-02: tablero agregado ───────────────────────────────────────────────
-- Mínimo de casos para publicar una celda.
CREATE OR REPLACE FUNCTION public.reinsurer_min_cell()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

CREATE OR REPLACE FUNCTION public.auth_reinsurer_org()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.organization_id FROM auth_org() o WHERE o.type = 'REINSURER';
$$;
REVOKE ALL ON FUNCTION public.auth_reinsurer_org() FROM PUBLIC, anon, authenticated;

-- Casos completados y cubiertos de las cedentes que autorizaron, dentro de la
-- vigencia del vínculo y del rango pedido. Uso interno: nunca sale tal cual.
CREATE OR REPLACE FUNCTION public._reinsurer_cases(p_reinsurer UUID, p_from DATE, p_to DATE)
RETURNS TABLE (insurer_org_id UUID, insurer_name TEXT, service_type TEXT, month TEXT, covered NUMERIC,
               assignment_met BOOLEAN, arrival_met BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT io.id, io.name, COALESCE(sr.service_type, 'tow'),
         to_char(sr.created_at AT TIME ZONE 'America/El_Salvador', 'YYYY-MM'),
         COALESCE(cu.amount_covered, 0),
         CASE WHEN sr.assigned_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (sr.assigned_at - sr.created_at)) <= i.sla_assignment_minutes * 60 END,
         CASE WHEN sr.activated_at IS NULL OR sr.assigned_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (sr.activated_at - sr.assigned_at)) <= i.sla_arrival_minutes * 60 END
    FROM reinsurer_cedents rc
    JOIN organizations io ON io.id = rc.insurer_org_id AND io.status = 'active'
    JOIN insurers i       ON i.id = io.insurer_id
    JOIN policies po      ON po.insurer_id = i.id
    JOIN members m        ON m.policy_id = po.id
    JOIN coverage_usage cu ON cu.member_id = m.id
    JOIN service_requests sr ON sr.id = cu.request_id
   WHERE rc.reinsurer_org_id = p_reinsurer
     AND rc.consent_status = 'granted'
     AND sr.status = 'completed'
     AND plan_cubre_servicio(po.plan_id, sr.service_type)
     AND sr.created_at >= sv_day_start(GREATEST(p_from, rc.valid_from))
     AND sr.created_at <  sv_day_start(LEAST(p_to, COALESCE(rc.valid_to, p_to)) + 1);
$$;
REVOKE ALL ON FUNCTION public._reinsurer_cases(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;

-- Una celda: si tiene menos del mínimo, solo dice que está suprimida.
CREATE OR REPLACE FUNCTION public._rea_cell(p_n BIGINT, p_cost NUMERIC, p_asig_ok BIGINT, p_asig_n BIGINT,
                                           p_lleg_ok BIGINT, p_lleg_n BIGINT, p_members BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_n < reinsurer_min_cell() THEN jsonb_build_object('suppressed', true)
  ELSE jsonb_build_object(
    'suppressed', false,
    'services', p_n,
    'cost', round(p_cost, 2),
    'avg_cost', round(p_cost / p_n, 2),
    'per_1000_members', CASE WHEN COALESCE(p_members, 0) > 0 THEN round(1000.0 * p_n / p_members, 2) END,
    'assignment_on_time_pct', CASE WHEN p_asig_n > 0 THEN round(100.0 * p_asig_ok / p_asig_n, 1) END,
    'arrival_on_time_pct', CASE WHEN p_lleg_n > 0 THEN round(100.0 * p_lleg_ok / p_lleg_n, 1) END) END;
$$;

CREATE OR REPLACE FUNCTION public.reinsurer_dashboard(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org UUID := auth_reinsurer_org();
  v_by_insurer JSONB;
  v_by_service JSONB;
  v_by_month   JSONB;
  v_total      JSONB;
  v_cedents    JSONB;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Necesitas una sesión en el portal de tu reaseguradora (con 2FA si eres dueño o administrador)';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 800 THEN
    RAISE EXCEPTION 'Rango de fechas inválido (máximo 2 años)';
  END IF;

  -- Cedentes: nombre y estado del permiso (sin cifras si no autorizó).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', io.name, 'consent_status', rc.consent_status,
           'valid_from', rc.valid_from, 'valid_to', rc.valid_to) ORDER BY io.name), '[]'::jsonb)
    INTO v_cedents
    FROM reinsurer_cedents rc JOIN organizations io ON io.id = rc.insurer_org_id
   WHERE rc.reinsurer_org_id = v_org;

  -- Por aseguradora (con frecuencia por 1 000 afiliados activos).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('insurer', x.insurer_name) || _rea_cell(
           x.n, x.cost, x.asig_ok, x.asig_n, x.lleg_ok, x.lleg_n, x.members) ORDER BY x.insurer_name), '[]'::jsonb)
    INTO v_by_insurer
    FROM (
      SELECT rc.insurer_org_id, io.name AS insurer_name,
             count(c.insurer_org_id) AS n, COALESCE(sum(c.covered), 0) AS cost,
             count(*) FILTER (WHERE c.assignment_met) AS asig_ok, count(c.assignment_met) AS asig_n,
             count(*) FILTER (WHERE c.arrival_met) AS lleg_ok, count(c.arrival_met) AS lleg_n,
             (SELECT count(*) FROM members mm JOIN policies pp ON pp.id = mm.policy_id
               WHERE pp.insurer_id = io.insurer_id AND mm.is_active) AS members
        FROM reinsurer_cedents rc
        JOIN organizations io ON io.id = rc.insurer_org_id
        LEFT JOIN _reinsurer_cases(v_org, p_from, p_to) c ON c.insurer_org_id = rc.insurer_org_id
       WHERE rc.reinsurer_org_id = v_org AND rc.consent_status = 'granted'
       GROUP BY rc.insurer_org_id, io.name, io.insurer_id) x;

  -- Por tipo de servicio (todas las cedentes).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('service_type', service_type) || _rea_cell(
           n, cost, asig_ok, asig_n, lleg_ok, lleg_n) ORDER BY n DESC), '[]'::jsonb)
    INTO v_by_service
    FROM (SELECT service_type, count(*) n, sum(covered) cost,
                 count(*) FILTER (WHERE assignment_met) asig_ok, count(assignment_met) asig_n,
                 count(*) FILTER (WHERE arrival_met) lleg_ok, count(arrival_met) lleg_n
            FROM _reinsurer_cases(v_org, p_from, p_to) GROUP BY service_type) s;

  -- Tendencia mensual.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('month', month) || _rea_cell(
           n, cost, asig_ok, asig_n, lleg_ok, lleg_n) ORDER BY month), '[]'::jsonb)
    INTO v_by_month
    FROM (SELECT month, count(*) n, sum(covered) cost,
                 count(*) FILTER (WHERE assignment_met) asig_ok, count(assignment_met) asig_n,
                 count(*) FILTER (WHERE arrival_met) lleg_ok, count(arrival_met) lleg_n
            FROM _reinsurer_cases(v_org, p_from, p_to) GROUP BY month) s;

  -- Total: solo lo publicado por aseguradora (restar no revela una celda suprimida).
  SELECT jsonb_build_object(
           'services', COALESCE(sum((e->>'services')::int), 0),
           'cost', COALESCE(sum((e->>'cost')::numeric), 0),
           'avg_cost', CASE WHEN sum((e->>'services')::int) > 0
                            THEN round(sum((e->>'cost')::numeric) / sum((e->>'services')::int), 2) END,
           'suppressed_insurers', count(*) FILTER (WHERE (e->>'suppressed')::boolean))
    INTO v_total
    FROM jsonb_array_elements(v_by_insurer) e;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'min_cell', reinsurer_min_cell(),
    'cedents', v_cedents,
    'total', v_total,
    'by_insurer', v_by_insurer,
    'by_service', v_by_service,
    'by_month', v_by_month);
END;
$$;

-- ─── Alta de reaseguradoras en el checklist (00130) ─────────────────────────
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
  ELSIF p_type = 'REINSURER' THEN
    IF EXISTS (SELECT 1 FROM organizations WHERE type = 'REINSURER' AND lower(name) = lower(v_name)) THEN
      RAISE EXCEPTION 'Ya existe una reaseguradora con ese nombre';
    END IF;
    INSERT INTO organizations (type, name) VALUES ('REINSURER', v_name) RETURNING id INTO v_org;
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

-- La invitación del admin también sirve para reaseguradoras.
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
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org AND type IN ('INSURER', 'MOPT', 'REINSURER')) THEN
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

-- El checklist de 00130 queda como núcleo de aseguradoras/MOPT; este despacha.
ALTER FUNCTION public.admin_onboarding_status(UUID) RENAME TO _onboarding_status_core;
REVOKE ALL ON FUNCTION public._onboarding_status_core(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_onboarding_status(p_org UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o  RECORD;
  ob RECORD;
  v_owner   JSONB;
  v_invites JSONB;
  v_links   INT;
  v_granted INT;
  v_steps   JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  SELECT * INTO o FROM organizations WHERE id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organización no encontrada';
  END IF;
  IF o.type <> 'REINSURER' THEN
    RETURN _onboarding_status_core(p_org);
  END IF;

  PERFORM _ensure_onboarding(p_org);
  SELECT * INTO ob FROM org_onboarding WHERE organization_id = p_org;

  SELECT jsonb_build_object('name', p.full_name, 'email', p.email, 'since', om.created_at) INTO v_owner
    FROM organization_members om JOIN profiles p ON p.id = om.profile_id
   WHERE om.organization_id = p_org AND om.role = 'owner' AND om.status = 'active'
   ORDER BY om.created_at LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', inv.id, 'email', inv.email, 'role', inv.role,
                                               'created_at', inv.created_at, 'expires_at', inv.expires_at,
                                               'expired', inv.expires_at <= now()) ORDER BY inv.created_at DESC), '[]'::jsonb)
    INTO v_invites
    FROM organization_invitations inv
   WHERE inv.organization_id = p_org AND inv.accepted_at IS NULL AND inv.revoked_at IS NULL;
  SELECT count(*), count(*) FILTER (WHERE consent_status = 'granted') INTO v_links, v_granted
    FROM reinsurer_cedents WHERE reinsurer_org_id = p_org
     AND valid_from <= sv_today() AND (valid_to IS NULL OR valid_to >= sv_today());

  v_steps := jsonb_build_array(
    jsonb_build_object('key', 'org', 'done', o.status = 'active',
                       'detail', CASE WHEN o.status = 'active' THEN 'Activa' ELSE 'Suspendida' END),
    jsonb_build_object('key', 'owner', 'done', v_owner IS NOT NULL, 'owner', v_owner, 'invitations', v_invites),
    jsonb_build_object('key', 'cedents', 'done', v_granted > 0, 'links', v_links, 'granted', v_granted));

  RETURN jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'type', o.type, 'name', o.name, 'status', o.status,
                                       'insurer_id', NULL, 'provider_id', NULL),
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
  FOR r IN SELECT og.id FROM organizations og WHERE og.type IN ('INSURER', 'MOPT', 'REINSURER') LOOP
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

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_set_reinsurer_link(uuid,uuid,date,date)', 'admin_reinsurers()',
    'portal_reinsurer_links()', 'portal_set_reinsurer_consent(uuid,boolean,text)',
    'reinsurer_dashboard(date,date)', 'admin_onboarding_status(uuid)', 'admin_onboarding_overview()',
    'admin_create_institution(text,text,text,text,text,text)', 'admin_invite_org_member(uuid,text,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['_rea_cell(bigint,numeric,bigint,bigint,bigint,bigint,bigint)', 'reinsurer_min_cell()',
                           'reinsurer_consent_events_immutable()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
