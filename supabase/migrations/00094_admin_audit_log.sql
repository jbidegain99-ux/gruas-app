-- 00094: bitacora de cambios del panel ("quien cambio que").
--
-- Hasta aca, lo unico con historia era el ciclo de un servicio (`request_events`).
-- Todo lo demas —cambiarle el rol a alguien, aprobar un operador, tocar una
-- tarifa, la comision de una empresa, las reglas de cobertura de una
-- aseguradora— se editaba en sitio y no dejaba rastro: si un precio aparecia
-- cambiado, no habia forma de saber quien, cuando, ni cual era el valor de antes.
--
-- Diseno (adaptado del panel de plataforma de TalentOS):
--
-- * Un trigger AFTER por fila sobre las tablas de configuracion y personas.
--   Diffea OLD contra NEW y guarda SOLO los campos que cambiaron, como
--   {columna: {old, new}}. Da igual por donde entre la escritura (una RPC, un
--   update directo del panel, un script): si hay actor, queda registrada.
-- * El actor es `auth.uid()`. Sin actor (migraciones, cron, service_role de una
--   edge function) NO se registra nada: el mantenimiento no ensucia el rastro.
-- * Si un UPDATE no cambio nada visible, tampoco se registra.
-- * Del actor se guarda una FOTO (rol, nombre, email) al momento del cambio:
--   si mas tarde le cambian el rol o borran la cuenta, la bitacora sigue
--   diciendo quien era cuando lo hizo. Sin FK a profiles a proposito — una FK
--   impediria borrar la cuenta de quien alguna vez toco algo (derecho de
--   supresion, Decreto 144).
-- * Append-only reforzado con permisos: ni `authenticated` ni `service_role`
--   pueden insertar, editar ni borrar filas. Solo el trigger (SECURITY DEFINER)
--   escribe. La app no puede alterar su propio rastro aunque quisiera.
--
-- Que NO se audita, y por que:
-- * `members` (padron): se carga de a miles por CSV/API y trae el DUI. Un dato
--   personal en una tabla append-only es un dato perpetuo.
-- * `profile_sensitive`, `pin_attempts`: secretos / datos personales.
-- * `service_requests`: ya tiene su historia en `request_events`, y guarda el
--   hash del PIN.
-- * De `profiles` solo las columnas de gobierno (rol, empresa, aseguradora,
--   verificacion, comision). Nombre y telefono los edita el propio usuario y no
--   son decisiones del panel.
-- * De `insurer_api_keys`, el `key_hash` nunca.

-- ---------------------------------------------------------------
-- 1. Tabla
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id     UUID NOT NULL,
  actor_role   TEXT,
  actor_name   TEXT,
  actor_email  TEXT,
  table_name   TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id    TEXT,
  -- Nombre legible del registro al momento del cambio (nombre de la empresa,
  -- numero de poliza...), para no depender de que la fila siga existiendo.
  record_label TEXT,
  changes      JSONB NOT NULL
);

COMMENT ON TABLE public.audit_log IS
  '00094: bitacora append-only de cambios hechos por usuarios autenticados sobre '
  'tablas de configuracion y personas. La escribe solo audit_row_change().';
COMMENT ON COLUMN public.audit_log.changes IS
  '{columna: {"old": valor, "new": valor}} solo con las columnas que cambiaron. '
  'En INSERT old es null; en DELETE new es null.';

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred ON public.audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_table    ON public.audit_log (table_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor    ON public.audit_log (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_record   ON public.audit_log (table_name, record_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log: admin lee" ON public.audit_log;
CREATE POLICY "audit_log: admin lee" ON public.audit_log
  FOR SELECT TO authenticated
  USING (is_admin());

-- Append-only: nadie mas que el dueno (el trigger SECURITY DEFINER) escribe.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------
-- 2. Trigger generico
-- ---------------------------------------------------------------
-- Argumentos del trigger (opcionales):
--   TG_ARGV[0] = columnas a IGNORAR, separadas por coma (se suman a
--                created_at/updated_at, que nunca se registran).
--   TG_ARGV[1] = si viene, SOLO estas columnas se registran.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    COALESCE(v_row ->> 'id', v_row ->> 'provider_id'),
    COALESCE(
      v_row ->> 'name', v_row ->> 'name_es', v_row ->> 'full_name',
      v_row ->> 'policy_number', v_row ->> 'code', v_row ->> 'rule_key'
    ),
    v_changes
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- 3. Tablas auditadas
-- ---------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit ON public.profiles;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(
    '',
    'role,provider_id,insurer_id,verification_status,verification_rejection_reason,commission_rate'
  );

DROP TRIGGER IF EXISTS trg_audit ON public.providers;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit ON public.provider_commissions;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.provider_commissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit ON public.provider_services;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.provider_services
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit ON public.services;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit ON public.pricing_rules;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit ON public.insurers;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.insurers
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit ON public.insurer_api_keys;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.insurer_api_keys
  -- last_used_at lo toca cada llamada a la API: ruido, no una decision.
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('key_hash,last_used_at');

DROP TRIGGER IF EXISTS trg_audit ON public.coverage_plans;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.coverage_plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit ON public.coverage_rules;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.coverage_rules
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit ON public.policies;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- ---------------------------------------------------------------
-- 4. Lectura para el panel
-- ---------------------------------------------------------------
-- El rango de fechas se resuelve a bordes de dia en El Salvador (sv_day_start,
-- 00082): comparar contra medianoche UTC corria la ventana seis horas.
-- `p_to` es inclusivo (el dia entero).
CREATE OR REPLACE FUNCTION public.admin_audit_log(
  p_table   TEXT DEFAULT NULL,
  p_action  TEXT DEFAULT NULL,
  p_actor   UUID DEFAULT NULL,
  p_record  TEXT DEFAULT NULL,
  p_from    DATE DEFAULT NULL,
  p_to      DATE DEFAULT NULL,
  p_limit   INT  DEFAULT 50,
  p_offset  INT  DEFAULT 0
)
RETURNS TABLE (
  id           BIGINT,
  occurred_at  TIMESTAMPTZ,
  actor_id     UUID,
  actor_role   TEXT,
  actor_name   TEXT,
  actor_email  TEXT,
  table_name   TEXT,
  action       TEXT,
  record_id    TEXT,
  record_label TEXT,
  changes      JSONB,
  total_count  BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la bitacora';
  END IF;

  RETURN QUERY
  SELECT a.id, a.occurred_at, a.actor_id, a.actor_role, a.actor_name, a.actor_email,
         a.table_name, a.action, a.record_id, a.record_label, a.changes,
         count(*) OVER () AS total_count
    FROM audit_log a
   WHERE (p_table  IS NULL OR a.table_name = p_table)
     AND (p_action IS NULL OR a.action = p_action)
     AND (p_actor  IS NULL OR a.actor_id = p_actor)
     AND (p_record IS NULL OR a.record_id = p_record)
     AND (p_from   IS NULL OR a.occurred_at >= sv_day_start(p_from))
     AND (p_to     IS NULL OR a.occurred_at <  sv_day_start(p_to + 1))
   ORDER BY a.occurred_at DESC, a.id DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 200)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_audit_log(TEXT, TEXT, UUID, TEXT, DATE, DATE, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_audit_log(TEXT, TEXT, UUID, TEXT, DATE, DATE, INT, INT) TO authenticated;

-- Opciones de los filtros, derivadas de los datos reales (GROUP BY) y no de una
-- lista fija: una tabla o un actor nuevo nunca queda invisible en el filtro.
CREATE OR REPLACE FUNCTION public.admin_audit_log_facets()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la bitacora';
  END IF;

  RETURN jsonb_build_object(
    'tables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', table_name, 'count', n) ORDER BY table_name)
        FROM (SELECT table_name, count(*) AS n FROM audit_log GROUP BY table_name) t
    ), '[]'::jsonb),
    'actions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', action, 'count', n) ORDER BY action)
        FROM (SELECT action, count(*) AS n FROM audit_log GROUP BY action) t
    ), '[]'::jsonb),
    -- El nombre mas reciente de cada actor (pudo cambiarlo entre un cambio y otro).
    'actors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', actor_id, 'label', label, 'count', n) ORDER BY label)
        FROM (
          SELECT actor_id,
                 (array_agg(COALESCE(actor_name, actor_email, actor_id::text) ORDER BY occurred_at DESC))[1] AS label,
                 count(*) AS n
            FROM audit_log
           GROUP BY actor_id
        ) t
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_audit_log_facets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_audit_log_facets() TO authenticated;
