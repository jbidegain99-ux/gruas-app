-- =====================================================
-- 00113 — Equipo del portal: invitaciones, roles, 2FA y bitacora (POR-02)
--
-- Backlog POR-02: "El owner de una organizacion invita a su equipo por correo,
-- asigna roles y desactiva usuarios. 2FA (TOTP) obligatorio para roles admin
-- del portal. Bitacora de accesos."
--
-- * Invitaciones: el owner o un admin de la organizacion invita por correo con
--   un rol. El token viaja solo en el enlace del correo; en la base se guarda su
--   hash (sha256). Vence a los 7 dias. Solo la persona de ESE correo puede
--   aceptarla.
-- * Roles: el owner maneja a todos; un admin solo a analistas y lectores. Nadie
--   se modifica a si mismo y la organizacion nunca queda sin un owner activo
--   (mismo patron que "nunca sin admin", 00095: candado + conteo).
-- * 2FA: owner y admin de un portal solo acceden a los datos con una sesion
--   verificada con TOTP (aal2 en el JWT). Se exige en auth_org(), la puerta de
--   TODAS las politicas y RPC de los portales: una sesion sin 2FA no ve nada
--   aunque intente saltarse la pantalla. my_organization() le dice a la web
--   que falta el segundo factor, para mandarlo a activarlo.
-- * Bitacora: los inicios de sesion salen del registro de Supabase Auth
--   (auth.audit_log_entries) y los cambios del equipo de audit_log (00094).
--   No se rastrea nada nuevo.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. 2FA en la puerta de los portales
-- ---------------------------------------------------------------
-- aal2 = la sesion paso un segundo factor. Se lee del JWT de la peticion.
CREATE OR REPLACE FUNCTION public.session_has_mfa()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$ SELECT COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2' $$;

CREATE OR REPLACE FUNCTION public.org_role_requires_mfa(p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$ SELECT p_role IN ('owner', 'admin') $$;

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
     -- 00113 (POR-02): owner y admin solo con segundo factor verificado.
     AND (NOT org_role_requires_mfa(m.role) OR session_has_mfa())
   LIMIT 1
$$;

-- Para la web: la membresia AUNQUE falte el 2FA, con la bandera para mandarlo
-- a activarlo. No da acceso a datos (eso es auth_org).
CREATE OR REPLACE FUNCTION public.my_organization()
RETURNS JSONB
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
   LIMIT 1
$$;

-- La bitacora (00094) identifica cada fila por `id`; organization_members no
-- lo tiene y sus cambios de rol/estado quedaban sin a quien atribuirse.
CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor   UUID := auth.uid();
  v_old     JSONB;
  v_new     JSONB;
  v_row     JSONB;
  v_ignore  TEXT[] := ARRAY['created_at', 'updated_at'];
  v_only    TEXT[];
  v_changes JSONB := '{}'::jsonb;
  v_prof    RECORD;
  k         TEXT;
BEGIN
  -- Sin actor = migracion, cron o service_role: no es una decision de nadie.
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
  v_row := COALESCE(v_new, v_old);

  IF TG_NARGS > 0 AND TG_ARGV[0] <> '' THEN
    v_ignore := v_ignore || string_to_array(TG_ARGV[0], ',');
  END IF;
  IF TG_NARGS > 1 AND TG_ARGV[1] <> '' THEN
    v_only := string_to_array(TG_ARGV[1], ',');
  END IF;

  FOR k IN SELECT jsonb_object_keys(v_row) LOOP
    CONTINUE WHEN k = ANY (v_ignore);
    CONTINUE WHEN v_only IS NOT NULL AND NOT (k = ANY (v_only));
    -- COALESCE a 'null' para que un INSERT no registre las columnas vacias
    -- (SQL NULL de v_old contra el jsonb null de v_new serian "distintos").
    IF COALESCE(v_old -> k, 'null'::jsonb) IS DISTINCT FROM COALESCE(v_new -> k, 'null'::jsonb) THEN
      v_changes := v_changes || jsonb_build_object(
        k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k)
      );
    END IF;
  END LOOP;

  -- Un UPDATE que no cambio nada visible no es un evento.
  IF v_changes = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  SELECT role::text AS role, full_name, email
    INTO v_prof
    FROM profiles
   WHERE id = v_actor;

  INSERT INTO audit_log (
    actor_id, actor_role, actor_name, actor_email,
    table_name, action, record_id, record_label, changes
  ) VALUES (
    v_actor, v_prof.role, v_prof.full_name, v_prof.email,
    TG_TABLE_NAME, TG_OP,
    -- provider_commissions no tiene `id`: su clave es provider_id.
    -- 00113: organization_members no tiene `id`; su clave natural es la persona.
    COALESCE(v_row ->> 'id', v_row ->> 'provider_id', v_row ->> 'profile_id'),
    COALESCE(
      v_row ->> 'name', v_row ->> 'name_es', v_row ->> 'full_name',
      v_row ->> 'policy_number', v_row ->> 'code', v_row ->> 'rule_key'
    ),
    v_changes
  );

  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------
-- 2. Invitaciones
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  token_hash      TEXT NOT NULL UNIQUE,
  invited_by      UUID,
  invited_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  accepted_at     TIMESTAMPTZ,
  accepted_by     UUID,
  revoked_at      TIMESTAMPTZ
);

COMMENT ON TABLE public.organization_invitations IS
  '00113 (POR-02): invitaciones al equipo de un portal. El token solo viaja en el '
  'correo; aqui su hash. Se leen y escriben solo por RPC.';

-- Una invitacion pendiente por correo y organizacion.
CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_one_pending
  ON public.organization_invitations (organization_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_invitations FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit ON public.organization_invitations;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE ON public.organization_invitations
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('token_hash,invited_by,invited_by_name');

-- Quien puede administrar el equipo: owner (todo) o admin (analistas y lectores).
-- Devuelve la organizacion y el rol de quien llama, o lanza.
CREATE OR REPLACE FUNCTION public.org_manager()
RETURNS TABLE (organization_id UUID, member_role TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org  UUID;
  v_role TEXT;
BEGIN
  SELECT o.organization_id, o.member_role INTO v_org, v_role FROM auth_org() o;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Necesitas una sesión en el portal de tu organización (con 2FA si eres dueño o administrador)';
  END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Solo el dueño o un administrador del portal administra el equipo';
  END IF;
  RETURN QUERY SELECT v_org, v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.org_manager() FROM PUBLIC, anon, authenticated;

-- Invitar. Devuelve el token en claro UNA vez: la web lo pone en el enlace del
-- correo (y lo ofrece para copiar). No se puede volver a leer.
CREATE OR REPLACE FUNCTION public.org_invite(p_email TEXT, p_role TEXT DEFAULT 'viewer')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_org    UUID;
  v_me     TEXT;
  v_email  TEXT := lower(btrim(COALESCE(p_email, '')));
  v_token  TEXT;
  v_id     UUID;
  v_role   user_role;
BEGIN
  SELECT m.organization_id, m.member_role INTO v_org, v_me FROM org_manager() m;

  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Correo inválido';
  END IF;
  IF p_role NOT IN ('owner', 'admin', 'analyst', 'viewer') THEN
    RAISE EXCEPTION 'Rol desconocido: %', p_role;
  END IF;
  IF v_me = 'admin' AND p_role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Un administrador solo invita analistas o lectores';
  END IF;

  -- Personal de Budi y socios operadores no entran a un portal cliente.
  SELECT role INTO v_role FROM profiles WHERE lower(email) = v_email;
  IF v_role::text IN ('ADMIN', 'SUPPORT', 'OPERATOR') THEN
    RAISE EXCEPTION 'Esa cuenta no puede ser miembro de un portal cliente';
  END IF;
  IF EXISTS (SELECT 1 FROM organization_members om JOIN profiles p ON p.id = om.profile_id
              WHERE lower(p.email) = v_email AND om.status = 'active') THEN
    RAISE EXCEPTION 'Esa persona ya trabaja en un portal';
  END IF;

  -- Reinvitar reemplaza la pendiente (nuevo token, nuevo plazo).
  UPDATE organization_invitations SET revoked_at = now()
   WHERE organization_id = v_org AND lower(email) = v_email
     AND accepted_at IS NULL AND revoked_at IS NULL;

  v_token := encode(gen_random_bytes(24), 'hex');
  INSERT INTO organization_invitations (organization_id, email, role, token_hash, invited_by, invited_by_name)
  VALUES (v_org, v_email, p_role, encode(digest(v_token, 'sha256'), 'hex'), auth.uid(),
          (SELECT full_name FROM profiles WHERE id = auth.uid()))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'token', v_token, 'email', v_email, 'role', p_role,
                            'expires_at', now() + interval '7 days');
END;
$$;

CREATE OR REPLACE FUNCTION public.org_revoke_invitation(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org UUID;
  v_me  TEXT;
BEGIN
  SELECT m.organization_id, m.member_role INTO v_org, v_me FROM org_manager() m;
  UPDATE organization_invitations SET revoked_at = now()
   WHERE id = p_id AND organization_id = v_org
     AND accepted_at IS NULL AND revoked_at IS NULL
     AND (v_me = 'owner' OR role IN ('analyst', 'viewer'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa invitación no existe, ya se usó o no te corresponde';
  END IF;
END;
$$;

-- Aceptar: la sesion tiene que ser del correo invitado.
CREATE OR REPLACE FUNCTION public.accept_org_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_inv   organization_invitations;
  v_email TEXT;
  v_role  user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión con el correo invitado para aceptar';
  END IF;

  SELECT * INTO v_inv FROM organization_invitations
   WHERE token_hash = encode(digest(COALESCE(p_token, ''), 'sha256'), 'hex')
   FOR UPDATE;
  IF v_inv.id IS NULL OR v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta invitación no es válida o fue anulada';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta invitación ya se usó';
  END IF;
  IF v_inv.expires_at < now() THEN
    RAISE EXCEPTION 'Esta invitación venció; pide que te inviten de nuevo';
  END IF;

  SELECT lower(email), role INTO v_email, v_role FROM profiles WHERE id = auth.uid();
  IF v_email IS DISTINCT FROM lower(v_inv.email) THEN
    RAISE EXCEPTION 'Esta invitación es para otro correo';
  END IF;
  IF v_role::text IN ('ADMIN', 'SUPPORT', 'OPERATOR') THEN
    RAISE EXCEPTION 'Esta cuenta no puede ser miembro de un portal cliente';
  END IF;
  IF EXISTS (SELECT 1 FROM organization_members
              WHERE profile_id = auth.uid() AND status = 'active'
                AND organization_id <> v_inv.organization_id) THEN
    RAISE EXCEPTION 'Tu cuenta ya trabaja en otro portal';
  END IF;

  INSERT INTO organization_members (organization_id, profile_id, role, status, added_by)
  VALUES (v_inv.organization_id, auth.uid(), v_inv.role, 'active', v_inv.invited_by)
  ON CONFLICT (organization_id, profile_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';

  UPDATE organization_invitations SET accepted_at = now(), accepted_by = auth.uid() WHERE id = v_inv.id;

  RETURN (SELECT jsonb_build_object('organization', o.name, 'type', o.type, 'role', v_inv.role,
                                    'mfa_required', org_role_requires_mfa(v_inv.role))
            FROM organizations o WHERE o.id = v_inv.organization_id);
END;
$$;

-- ---------------------------------------------------------------
-- 3. El equipo: verlo y administrarlo
-- ---------------------------------------------------------------
-- Cualquier miembro ve a su equipo (nombre, correo, rol, estado). Las
-- invitaciones pendientes solo las ve quien administra.
CREATE OR REPLACE FUNCTION public.org_team()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org  UUID;
  v_role TEXT;
BEGIN
  SELECT o.organization_id, o.member_role INTO v_org, v_role FROM auth_org() o;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Necesitas una sesión en el portal de tu organización';
  END IF;

  RETURN jsonb_build_object(
    'my_role', v_role,
    'can_manage', v_role IN ('owner', 'admin'),
    'members', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'profile_id', m.profile_id, 'full_name', p.full_name, 'email', p.email,
                    'role', m.role, 'status', m.status, 'created_at', m.created_at,
                    'is_me', m.profile_id = auth.uid(),
                    'has_mfa', EXISTS (SELECT 1 FROM auth.mfa_factors f
                                        WHERE f.user_id = m.profile_id AND f.status = 'verified'))
                  ORDER BY m.status, array_position(ARRAY['owner', 'admin', 'analyst', 'viewer'], m.role), p.full_name), '[]'::jsonb)
                  FROM organization_members m JOIN profiles p ON p.id = m.profile_id
                 WHERE m.organization_id = v_org),
    'invitations', CASE WHEN v_role IN ('owner', 'admin') THEN
                     (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'id', i.id, 'email', i.email, 'role', i.role, 'invited_by_name', i.invited_by_name,
                         'created_at', i.created_at, 'expires_at', i.expires_at,
                         'expired', i.expires_at < now()) ORDER BY i.created_at DESC), '[]'::jsonb)
                        FROM organization_invitations i
                       WHERE i.organization_id = v_org AND i.accepted_at IS NULL AND i.revoked_at IS NULL)
                   ELSE '[]'::jsonb END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.org_update_member(p_profile_id UUID, p_role TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org     UUID;
  v_me      TEXT;
  v_target  organization_members;
  v_owners  INT;
BEGIN
  SELECT m.organization_id, m.member_role INTO v_org, v_me FROM org_manager() m;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio acceso';
  END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('owner', 'admin', 'analyst', 'viewer') THEN
    RAISE EXCEPTION 'Rol desconocido: %', p_role;
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'Estado desconocido: %', p_status;
  END IF;

  -- Serializa los cambios del equipo: dos owners quitandose el rol a la vez no
  -- pueden dejar la organizacion sin dueño (mismo caso que 00095).
  PERFORM pg_advisory_xact_lock(hashtext('org_owners:' || v_org::text));

  SELECT * INTO v_target FROM organization_members
   WHERE organization_id = v_org AND profile_id = p_profile_id;
  IF v_target.profile_id IS NULL THEN
    RAISE EXCEPTION 'Esa persona no es parte de tu equipo';
  END IF;
  IF v_me = 'admin' AND (v_target.role IN ('owner', 'admin') OR p_role IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'Un administrador solo maneja analistas y lectores';
  END IF;

  UPDATE organization_members
     SET role = COALESCE(p_role, role), status = COALESCE(p_status, status)
   WHERE organization_id = v_org AND profile_id = p_profile_id;

  SELECT count(*) INTO v_owners FROM organization_members
   WHERE organization_id = v_org AND role = 'owner' AND status = 'active';
  IF v_owners = 0 THEN
    RAISE EXCEPTION 'La organización no puede quedar sin un dueño activo';
  END IF;
END;
$$;

-- ---------------------------------------------------------------
-- 4. Bitacora de accesos (para quien administra)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_access_log(p_limit INT DEFAULT 100)
RETURNS TABLE (
  occurred_at TIMESTAMPTZ,
  kind        TEXT,     -- 'acceso' | 'equipo'
  who         TEXT,
  what        TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT m.organization_id INTO v_org FROM org_manager() m;

  RETURN QUERY
  SELECT * FROM (
    -- Inicios y cierres de sesion de los miembros (registro de Supabase Auth).
    SELECT e.created_at,
           'acceso'::text,
           -- Sin nombre cargado (p. ej. entró por el enlace del correo): su correo.
           COALESCE(NULLIF(btrim(p.full_name), ''), e.payload ->> 'actor_username'),
           CASE e.payload ->> 'action'
             WHEN 'login'  THEN 'Inició sesión'
             WHEN 'logout' THEN 'Cerró sesión'
             -- GoTrue registra así también el pedido del enlace de acceso por correo.
             WHEN 'user_recovery_requested' THEN 'Pidió un enlace de acceso por correo'
             ELSE e.payload ->> 'action' END
      FROM auth.audit_log_entries e
      JOIN organization_members m ON m.profile_id = (e.payload ->> 'actor_id')::uuid
                                 AND m.organization_id = v_org
      LEFT JOIN profiles p ON p.id = m.profile_id
     WHERE e.payload ->> 'action' IN ('login', 'logout', 'user_recovery_requested')
    UNION ALL
    -- Cambios del equipo e invitaciones (bitacora 00094).
    SELECT a.occurred_at,
           'equipo'::text,
           COALESCE(NULLIF(btrim(a.actor_name), ''), a.actor_email, 'Budi'),
           CASE
             WHEN a.table_name = 'organization_invitations' AND a.action = 'INSERT'
               THEN 'Invitó a ' || COALESCE(a.changes -> 'email' ->> 'new', 'alguien') || ' como '
                    || CASE a.changes -> 'role' ->> 'new' WHEN 'owner' THEN 'dueño' WHEN 'admin' THEN 'administrador'
                         WHEN 'analyst' THEN 'analista' ELSE 'solo lectura' END
             WHEN a.table_name = 'organization_invitations' AND a.changes ? 'accepted_at'
               THEN 'Aceptó la invitación'
             WHEN a.table_name = 'organization_invitations' AND a.changes ? 'revoked_at'
               THEN 'Anuló una invitación'
             WHEN a.table_name = 'organization_members' AND a.action = 'INSERT'
                  AND a.actor_id::text = a.changes -> 'profile_id' ->> 'new'
               THEN 'Se unió al equipo como ' || CASE a.changes -> 'role' ->> 'new' WHEN 'owner' THEN 'dueño'
                      WHEN 'admin' THEN 'administrador' WHEN 'analyst' THEN 'analista' ELSE 'solo lectura' END
             WHEN a.table_name = 'organization_members' AND a.action = 'INSERT'
               THEN 'Sumó a ' || COALESCE((SELECT COALESCE(NULLIF(btrim(full_name), ''), email) FROM profiles
                                            WHERE id::text = a.changes -> 'profile_id' ->> 'new'), 'una persona') || ' al equipo'
             WHEN a.table_name = 'organization_members' AND a.changes ? 'status'
               THEN CASE WHEN a.changes -> 'status' ->> 'new' = 'disabled' THEN 'Quitó el acceso a ' ELSE 'Devolvió el acceso a ' END
                    || COALESCE((SELECT COALESCE(NULLIF(btrim(full_name), ''), email) FROM profiles WHERE id::text = a.record_id), 'alguien')
             WHEN a.table_name = 'organization_members' AND a.changes ? 'role'
               THEN 'Cambió el rol de ' || COALESCE((SELECT COALESCE(NULLIF(btrim(full_name), ''), email) FROM profiles WHERE id::text = a.record_id), 'alguien')
                    || ' a ' || CASE a.changes -> 'role' ->> 'new' WHEN 'owner' THEN 'dueño' WHEN 'admin' THEN 'administrador'
                                  WHEN 'analyst' THEN 'analista' ELSE 'solo lectura' END
             ELSE 'Cambio en el equipo' END
      FROM audit_log a
     WHERE (a.table_name = 'organization_invitations'
            AND a.record_id IN (SELECT id::text FROM organization_invitations WHERE organization_id = v_org))
        OR (a.table_name = 'organization_members'
            AND (a.changes -> 'organization_id' ->> 'new' = v_org::text
                 OR a.record_id IN (SELECT profile_id::text FROM organization_members WHERE organization_id = v_org)))
  ) x
  ORDER BY 1 DESC
  LIMIT LEAST(COALESCE(p_limit, 100), 500);
END;
$$;

REVOKE ALL ON FUNCTION public.org_invite(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_revoke_invitation(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_org_invitation(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_team() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_update_member(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_access_log(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_invite(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_revoke_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_org_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_team() TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_update_member(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_access_log(INT) TO authenticated;
