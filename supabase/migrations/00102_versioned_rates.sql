-- =====================================================
-- 00102 — Tarifas versionadas (comisiones y tarifa MOPT)
--
-- El problema: lo que Budi le debe a cada quien NO se guarda, se deriva
-- (ledger_obligations, 00099; liquidacion, 00079/00091). Y se derivaba con la
-- tasa de HOY. Cambiar la comision de una empresa del 20% al 15% reescribia en
-- silencio lo que se le debia por todos sus servicios de meses anteriores —
-- incluidos los ya pagados, con lo que el saldo del libro quedaba descuadrado.
-- Lo mismo con la tarifa del MOPT, con el default de plataforma (hardcodeado en
-- 20) y con la comision propia del operador independiente, que ademas se
-- BORRABA al entrar a una empresa (00080), cambiando retroactivamente la
-- retencion de todo lo que ese operador hizo como independiente.
--
-- La solucion (patron de "parametros de negocio versionados"):
-- * `rate_versions`: una fila por cambio, con `valid_from`. Nunca se edita ni
--   se borra una version que ya entro en vigencia. Lo unico borrable es un
--   cambio PROGRAMADO que todavia no empezo: ningun numero se calculo con el.
-- * La vigencia no se guarda (`valid_until`): se deriva de la version
--   siguiente. Guardarla obligaria a editar la version anterior al crear una
--   nueva, que es justo lo que el invariante prohibe.
-- * Todo consumidor pasa la FECHA DEL HECHO (`completed_at` del servicio),
--   nunca "hoy". Recalcular un servicio de hace un año trae la tasa de ese año.
-- * No se permite fijar un cambio hacia atras: seria la misma reescritura de la
--   historia por otra puerta.
--
-- De paso: `provider_commissions` y `profiles.commission_rate` desaparecen.
-- Guardar ademas "la tasa actual" seria una segunda fuente de verdad que se
-- desfasa sola cuando entra en vigencia un cambio programado.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- platform_default  la comision que aplica cuando no hay una negociada
  -- provider          comision de una empresa (NULL = vuelve al default)
  -- operator          comision de un operador independiente (NULL = default)
  -- mopt_fee          lo que Budi le cobra a un programa MOPT por servicio
  kind            TEXT NOT NULL
                  CHECK (kind IN ('platform_default', 'provider', 'operator', 'mopt_fee')),
  -- Sin FK a proposito: la historia de tarifas es un registro financiero y no
  -- puede desaparecer en cascada si se borra la empresa o se anonimiza al
  -- operador (00101).
  subject_id      UUID,
  rate            NUMERIC(5,2),
  valid_from      TIMESTAMPTZ NOT NULL,
  note            TEXT,
  created_by      UUID,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT rate_versions_rate_range CHECK (rate IS NULL OR (rate >= 0 AND rate <= 100)),
  CONSTRAINT rate_versions_subject CHECK ((kind = 'platform_default') = (subject_id IS NULL)),
  -- "Volver al default" solo tiene sentido donde hay un default detras.
  CONSTRAINT rate_versions_null_rate CHECK (rate IS NOT NULL OR kind IN ('provider', 'operator'))
);

COMMENT ON TABLE public.rate_versions IS
  '00102: historia de tarifas. La vigente para una fecha es la de mayor '
  'valid_from <= fecha. Append-only salvo cambios programados que aun no '
  'empezaron. Leer siempre por rate_at_*(), nunca a mano.';

-- Dos versiones con el mismo inicio harian ambigua la eleccion.
CREATE UNIQUE INDEX IF NOT EXISTS rate_versions_one_per_instant
  ON public.rate_versions (kind, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), valid_from);

CREATE INDEX IF NOT EXISTS rate_versions_lookup
  ON public.rate_versions (kind, subject_id, valid_from DESC);

ALTER TABLE public.rate_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_versions: admin lee" ON public.rate_versions;
CREATE POLICY "rate_versions: admin lee" ON public.rate_versions
  FOR SELECT TO authenticated
  USING (is_admin());

-- Se escribe solo por las RPC de abajo (SECURITY DEFINER).
REVOKE ALL ON public.rate_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rate_versions TO authenticated;

-- El invariante, en la base y no solo en las RPC: ni el service_role ni una
-- migracion futura pueden reescribir una tarifa que ya se aplico.
CREATE OR REPLACE FUNCTION public.rate_versions_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Una version de tarifa no se edita: se programa una nueva';
  END IF;
  IF OLD.valid_from <= now() THEN
    RAISE EXCEPTION 'Esta tarifa ya entro en vigencia y no se puede borrar';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_versions_immutable ON public.rate_versions;
CREATE TRIGGER trg_rate_versions_immutable
  BEFORE UPDATE OR DELETE ON public.rate_versions
  FOR EACH ROW EXECUTE FUNCTION public.rate_versions_immutable();

REVOKE TRUNCATE ON public.rate_versions FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_audit ON public.rate_versions;
CREATE TRIGGER trg_audit
  AFTER INSERT OR DELETE ON public.rate_versions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('created_by,created_by_name');

-- ---------------------------------------------------------------
-- 2. Backfill: lo vigente hoy pasa a ser la version "desde siempre"
-- ---------------------------------------------------------------
-- '-infinity' y no la fecha de hoy: hasta ahora la tasa actual se aplicaba a
-- todos los servicios pasados, asi que "desde siempre" deja los numeros
-- exactamente como estaban. Ningun reporte cambia con esta migracion.
INSERT INTO public.rate_versions (kind, subject_id, rate, valid_from, note)
VALUES ('platform_default', NULL, 20.00, '-infinity', 'Tarifa vigente al activar el versionado (00102)')
ON CONFLICT DO NOTHING;

INSERT INTO public.rate_versions (kind, subject_id, rate, valid_from, note)
SELECT CASE WHEN p.is_mopt THEN 'mopt_fee' ELSE 'provider' END,
       pc.provider_id, pc.commission_rate, '-infinity',
       'Tarifa vigente al activar el versionado (00102)'
  FROM public.provider_commissions pc
  JOIN public.providers p ON p.id = pc.provider_id
ON CONFLICT DO NOTHING;

INSERT INTO public.rate_versions (kind, subject_id, rate, valid_from, note)
SELECT 'operator', pr.id, pr.commission_rate, '-infinity',
       'Tarifa vigente al activar el versionado (00102)'
  FROM public.profiles pr
 WHERE pr.commission_rate IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------
-- 3. "Cual version manda": una sola definicion por tipo
-- ---------------------------------------------------------------
-- Busca la ultima version con inicio <= p_at. Devuelve la FILA encontrada
-- (found = true) aunque su tasa sea NULL: "volvio al default" no es lo mismo
-- que "nunca tuvo tarifa propia", y el llamador necesita distinguirlos.
CREATE OR REPLACE FUNCTION public.rate_version_at(p_kind TEXT, p_subject UUID, p_at TIMESTAMPTZ)
RETURNS TABLE (found BOOLEAN, rate NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT true, rv.rate
    FROM rate_versions rv
   WHERE rv.kind = p_kind
     AND rv.subject_id IS NOT DISTINCT FROM p_subject
     AND rv.valid_from <= p_at
   ORDER BY rv.valid_from DESC
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.rate_version_at(TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Default de plataforma para una fecha. El 20 fijo es el ultimo recurso por si
-- la tabla quedara vacia (no deberia: el backfill siembra la version inicial).
CREATE OR REPLACE FUNCTION public.platform_commission_at(p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT v.rate FROM rate_version_at('platform_default', NULL, p_at) v), 20.00)
$$;

REVOKE ALL ON FUNCTION public.platform_commission_at(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Deja de ser una constante: ahora es "el default vigente ahora". STABLE, ya no
-- IMMUTABLE — su valor cambia cuando entra en vigencia una version nueva.
CREATE OR REPLACE FUNCTION public.default_commission_rate()
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT platform_commission_at(now()) $$;

COMMENT ON FUNCTION public.default_commission_rate() IS
  'Comision de plataforma por defecto vigente AHORA. Para calcular un servicio '
  'usar commission_rate_at(..., completed_at), nunca esta.';

-- La comision de un servicio. Misma precedencia de dos escalones que la 00089:
--   con empresa -> la de la empresa, o el default
--   sin empresa -> la del operador independiente, o el default
-- ...pero todo evaluado en p_at.
CREATE OR REPLACE FUNCTION public.commission_rate_at(
  p_provider UUID,
  p_operator UUID,
  p_at       TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    CASE
      WHEN p_provider IS NOT NULL THEN (SELECT v.rate FROM rate_version_at('provider', p_provider, p_at) v)
      WHEN p_operator IS NOT NULL THEN (SELECT v.rate FROM rate_version_at('operator', p_operator, p_at) v)
    END,
    platform_commission_at(p_at)
  )
$$;

COMMENT ON FUNCTION public.commission_rate_at(UUID, UUID, TIMESTAMPTZ) IS
  'Comision (%) que retiene Budi por un servicio completado en p_at. Unica '
  'fuente de la precedencia empresa > operador independiente > default.';

REVOKE ALL ON FUNCTION public.commission_rate_at(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Lo que Budi le cobra a un programa MOPT. Sin version = 0%, NO el default de
-- las empresas privadas (mismo criterio que la 00098).
CREATE OR REPLACE FUNCTION public.mopt_fee_rate_at(p_mopt UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT v.rate FROM rate_version_at('mopt_fee', p_mopt, p_at) v), 0)
$$;

REVOKE ALL ON FUNCTION public.mopt_fee_rate_at(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- 4. Consumidores: todos pasan la fecha del hecho
-- ---------------------------------------------------------------
-- Donde una fila agrupa servicios de periodos con tasas distintas, el
-- porcentaje informado es NULL ("varias"): mostrar uno solo seria inventar un
-- numero que no explica la comision sumada al lado.

CREATE OR REPLACE FUNCTION public.admin_settlement_by_provider(p_from date, p_to date)
 RETURNS TABLE(provider_id uuid, destinatario text, es_independiente boolean, comision_pct numeric, servicios bigint, sin_precio bigint, bruto numeric, comision numeric, a_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    pr.id,
    COALESCE(pr.name, MAX(ope.full_name), 'Sin asignar'),
    pr.id IS NULL,
    CASE WHEN MIN(cr.rate) = MAX(cr.rate) THEN MIN(cr.rate) END,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE sr.total_price IS NULL)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- 00081: se suman las lineas ya redondeadas, no se redondea el total.
    COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0)
  FROM service_requests sr
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  CROSS JOIN LATERAL (SELECT commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS rate) cr
  WHERE sr.status = 'completed'
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  GROUP BY COALESCE(pr.id, ope.id), pr.id, pr.name
  ORDER BY 9 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_settlement_by_operator(p_from date, p_to date)
 RETURNS TABLE(operator_id uuid, operador text, empresa text, comision_pct numeric, servicios bigint, bruto numeric, comision numeric, a_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    ope.id,
    COALESCE(ope.full_name, 'Sin operador'),
    COALESCE(pr.name, 'Independiente'),
    CASE WHEN MIN(cr.rate) = MAX(cr.rate) THEN MIN(cr.rate) END,
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0)
  FROM service_requests sr
  LEFT JOIN profiles ope  ON ope.id = sr.operator_id
  LEFT JOIN providers pr  ON pr.id = sr.provider_id
  CROSS JOIN LATERAL (SELECT commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS rate) cr
  WHERE sr.status = 'completed'
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  GROUP BY ope.id, ope.full_name, pr.id, pr.name
  ORDER BY 8 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_settlement_detail(p_from date, p_to date)
 RETURNS TABLE(folio text, completado timestamp with time zone, servicio text, destinatario text, operador text, comision_pct numeric, bruto numeric, comision numeric, a_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    c.folio,
    sr.completed_at,
    sr.service_type,
    COALESCE(pr.name, ope.full_name, 'Sin asignar'),
    COALESCE(ope.full_name, 'Sin operador'),
    cr.rate,
    COALESCE(sr.total_price, 0),
    ROUND(COALESCE(sr.total_price, 0) * cr.rate / 100, 2),
    COALESCE(sr.total_price, 0)
      - ROUND(COALESCE(sr.total_price, 0) * cr.rate / 100, 2)
  FROM service_requests sr
  LEFT JOIN cases c      ON c.request_id = sr.id
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  CROSS JOIN LATERAL (SELECT commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS rate) cr
  WHERE sr.status = 'completed'
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  ORDER BY sr.completed_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_operator_earnings(p_from date, p_to date)
 RETURNS TABLE(servicios bigint, bruto numeric, comision_pct numeric, comision numeric, a_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_op UUID := auth.uid();
BEGIN
  IF v_op IS NULL THEN
    RAISE EXCEPTION 'Se necesita una sesion';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- Sin servicios en el periodo: la tasa que le aplicaria hoy. Con tasas
    -- distintas dentro del periodo: NULL, la pantalla dice "varias".
    CASE
      WHEN COUNT(*) = 0 THEN commission_rate_at(
        (SELECT provider_id FROM profiles WHERE id = v_op), v_op, now())
      WHEN MIN(cr.rate) = MAX(cr.rate) THEN MIN(cr.rate)
    END,
    COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * cr.rate / 100, 2)), 0)
  FROM service_requests sr
  -- Los servicios del MOPT no tienen comision de Budi.
  CROSS JOIN LATERAL (
    SELECT CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 0::numeric
                ELSE commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) END AS rate
  ) cr
  WHERE sr.operator_id = v_op
    AND sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ledger_obligations()
RETURNS TABLE (
  request_id    UUID,
  completed_at  TIMESTAMPTZ,
  service_type  TEXT,
  concept       TEXT,
  debtor_kind   TEXT,
  debtor_id     UUID,
  creditor_kind TEXT,
  creditor_id   UUID,
  amount        NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT sr.id, sr.completed_at, COALESCE(sr.service_type, 'tow') AS service_type,
           sr.total_price, sr.provider_id, sr.operator_id, sr.mopt_provider_id,
           -- 00102: la tasa vigente cuando se completo el servicio, no la de hoy.
           commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) AS commission_rate,
           mopt_fee_rate_at(sr.mopt_provider_id, sr.completed_at) AS mopt_fee_rate
      FROM service_requests sr
     WHERE sr.status = 'completed'
       AND sr.total_price IS NOT NULL
  )
  SELECT b.id, b.completed_at, b.service_type, 'cobertura',
         'insurer', po.insurer_id, 'budi', NULL::UUID, cu.amount_covered
    FROM base b
    JOIN coverage_usage cu ON cu.request_id = b.id
    JOIN members m         ON m.id = cu.member_id
    JOIN policies po       ON po.id = m.policy_id
   WHERE b.mopt_provider_id IS NULL
     AND cu.amount_covered > 0

  UNION ALL
  SELECT b.id, b.completed_at, b.service_type, 'servicio',
         'budi', NULL::UUID,
         CASE WHEN b.provider_id IS NOT NULL THEN 'provider' ELSE 'operator' END,
         COALESCE(b.provider_id, b.operator_id),
         b.total_price - ROUND(b.total_price * b.commission_rate / 100, 2)
    FROM base b
   WHERE b.mopt_provider_id IS NULL
     AND b.operator_id IS NOT NULL

  UNION ALL
  SELECT b.id, b.completed_at, b.service_type, 'servicio',
         'mopt', b.mopt_provider_id, 'operator', b.operator_id, b.total_price
    FROM base b
   WHERE b.mopt_provider_id IS NOT NULL
     AND b.operator_id IS NOT NULL

  UNION ALL
  SELECT b.id, b.completed_at, b.service_type, 'tarifa_plataforma',
         'mopt', b.mopt_provider_id, 'budi', NULL::UUID,
         ROUND(b.total_price * b.mopt_fee_rate / 100, 2)
    FROM base b
   WHERE b.mopt_provider_id IS NOT NULL
     AND b.mopt_fee_rate > 0;
$$;

REVOKE ALL ON FUNCTION public.ledger_obligations() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_provider_commissions()
 RETURNS TABLE(provider_id uuid, commission_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las comisiones';
  END IF;

  -- La tarifa efectiva hoy de cada empresa (MOPT: su tarifa de plataforma).
  RETURN QUERY
  SELECT p.id,
         CASE WHEN p.is_mopt THEN mopt_fee_rate_at(p.id, now())
              ELSE commission_rate_at(p.id, NULL, now()) END
    FROM providers p;
END;
$function$;

-- ---------------------------------------------------------------
-- 5. Escribir: programar un cambio
-- ---------------------------------------------------------------
-- p_effective es un DIA de El Salvador. NULL u hoy = desde ya (now(), no el
-- inicio del dia: eso tocaria los servicios completados esta mañana). Un dia
-- pasado se rechaza. Si el cambio no cambia nada, no se crea version (las
-- pantallas guardan la comision cada vez que se guarda la empresa).
CREATE OR REPLACE FUNCTION public.admin_schedule_rate(
  p_kind      TEXT,
  p_subject   UUID,
  p_rate      NUMERIC,
  p_effective DATE DEFAULT NULL,
  p_note      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from     TIMESTAMPTZ;
  v_prev     RECORD;
  v_is_mopt  BOOLEAN;
  v_role     user_role;
  v_provider UUID;
  v_id       UUID;
  v_actor    TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar tarifas';
  END IF;

  IF p_kind NOT IN ('platform_default', 'provider', 'operator', 'mopt_fee') THEN
    RAISE EXCEPTION 'Tipo de tarifa desconocido: %', p_kind;
  END IF;
  IF p_rate IS NOT NULL AND (p_rate < 0 OR p_rate > 100) THEN
    RAISE EXCEPTION 'La tarifa debe estar entre 0 y 100';
  END IF;
  IF p_rate IS NULL AND p_kind NOT IN ('provider', 'operator') THEN
    RAISE EXCEPTION 'Falta la tarifa';
  END IF;

  IF p_kind = 'platform_default' THEN
    IF p_subject IS NOT NULL THEN
      RAISE EXCEPTION 'El default de plataforma no lleva sujeto';
    END IF;
  ELSIF p_kind IN ('provider', 'mopt_fee') THEN
    SELECT is_mopt INTO v_is_mopt FROM providers WHERE id = p_subject;
    IF v_is_mopt IS NULL THEN
      RAISE EXCEPTION 'El proveedor no existe';
    END IF;
    IF p_kind = 'provider' AND v_is_mopt THEN
      RAISE EXCEPTION 'Es un programa MOPT: su tarifa se configura en Programas MOPT';
    END IF;
    IF p_kind = 'mopt_fee' AND NOT v_is_mopt THEN
      RAISE EXCEPTION 'El programa MOPT no existe';
    END IF;
  ELSE
    SELECT role, provider_id INTO v_role, v_provider FROM profiles WHERE id = p_subject;
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Usuario no encontrado';
    END IF;
    IF v_role <> 'OPERATOR' THEN
      RAISE EXCEPTION 'La comision propia es de los operadores';
    END IF;
    IF v_provider IS NOT NULL AND p_rate IS NOT NULL THEN
      RAISE EXCEPTION 'Este operador pertenece a una empresa: la comision se configura en la empresa';
    END IF;
  END IF;

  IF p_effective IS NULL OR p_effective = sv_today() THEN
    v_from := now();
  ELSIF p_effective < sv_today() THEN
    RAISE EXCEPTION 'Una tarifa no se cambia hacia atras: reescribiria lo que ya se liquido';
  ELSE
    v_from := sv_day_start(p_effective);
  END IF;

  -- Serializa los cambios del mismo sujeto: dos admins guardando a la vez no
  -- pueden leer el mismo "anterior" y dejar dos versiones.
  PERFORM pg_advisory_xact_lock(hashtext('rate_versions:' || p_kind || ':' || COALESCE(p_subject::text, '')));

  SELECT * INTO v_prev FROM rate_version_at(p_kind, p_subject, v_from);

  -- Sin cambio real y sin nada programado despues: no hay nada que versionar.
  IF COALESCE(v_prev.found, false)
     AND v_prev.rate IS NOT DISTINCT FROM p_rate
     AND NOT EXISTS (SELECT 1 FROM rate_versions
                      WHERE kind = p_kind AND subject_id IS NOT DISTINCT FROM p_subject
                        AND valid_from > v_from) THEN
    RETURN NULL;
  END IF;
  -- Nunca tuvo version propia y le piden "el default": tampoco hay cambio.
  IF NOT COALESCE(v_prev.found, false) AND p_rate IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM rate_versions
              WHERE kind = p_kind AND subject_id IS NOT DISTINCT FROM p_subject
                AND valid_from = v_from) THEN
    RAISE EXCEPTION 'Ya hay un cambio programado para ese dia; cancelalo primero';
  END IF;

  SELECT full_name INTO v_actor FROM profiles WHERE id = auth.uid();

  INSERT INTO rate_versions (kind, subject_id, rate, valid_from, note, created_by, created_by_name)
  VALUES (p_kind, p_subject, p_rate, v_from, NULLIF(btrim(p_note), ''), auth.uid(), v_actor)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_schedule_rate(TEXT, UUID, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_schedule_rate(TEXT, UUID, NUMERIC, DATE, TEXT) TO authenticated;

-- Cancelar un cambio programado que todavia no empezo. El trigger rechaza el
-- resto; aca solo se da un mensaje claro.
CREATE OR REPLACE FUNCTION public.admin_cancel_rate_version(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from TIMESTAMPTZ;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar tarifas';
  END IF;
  SELECT valid_from INTO v_from FROM rate_versions WHERE id = p_id;
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'Ese cambio no existe';
  END IF;
  IF v_from <= now() THEN
    RAISE EXCEPTION 'Esta tarifa ya entro en vigencia: para cambiarla programa una nueva';
  END IF;
  DELETE FROM rate_versions WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_rate_version(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_rate_version(UUID) TO authenticated;

-- Los setters que ya usa el panel, ahora como "cambio desde ya". Mantienen la
-- firma para que las pantallas existentes sigan andando.
CREATE OR REPLACE FUNCTION public.admin_set_provider_commission(p_provider_id uuid, p_rate numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar comisiones';
  END IF;
  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La comision debe estar entre 0 y 100');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM providers WHERE id = p_provider_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'El proveedor no existe');
  END IF;
  IF EXISTS (SELECT 1 FROM providers WHERE id = p_provider_id AND is_mopt) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Es un programa MOPT: su tarifa se configura en Programas MOPT');
  END IF;

  -- Si ya esta en esa tasa (propia o por default) no se versiona nada.
  IF commission_rate_at(p_provider_id, NULL, now()) = p_rate THEN
    RETURN jsonb_build_object('success', true, 'provider_id', p_provider_id, 'commission_rate', p_rate);
  END IF;

  PERFORM admin_schedule_rate('provider', p_provider_id, p_rate, NULL, NULL);
  RETURN jsonb_build_object('success', true, 'provider_id', p_provider_id, 'commission_rate', p_rate);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_operator_commission(p_operator_id uuid, p_rate numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM admin_schedule_rate('operator', p_operator_id, p_rate, NULL, NULL);
  RETURN jsonb_build_object('success', true, 'operator_id', p_operator_id, 'commission_rate', p_rate);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_mopt_fee(p_provider_id UUID, p_rate NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM admin_schedule_rate('mopt_fee', p_provider_id, p_rate, NULL, NULL);
END;
$$;

-- ---------------------------------------------------------------
-- 6. Leer: panorama y historia
-- ---------------------------------------------------------------
-- Una fila por sujeto que puede tener tarifa: el default, cada empresa, cada
-- programa MOPT y cada operador independiente (o con historia propia).
CREATE OR REPLACE FUNCTION public.admin_rate_overview()
RETURNS TABLE (
  kind         TEXT,
  subject_id   UUID,
  subject_name TEXT,
  current_rate NUMERIC,   -- la que se aplica hoy (ya resuelto el default)
  own_rate     BOOLEAN,   -- false = hereda el default de plataforma
  next_rate    NUMERIC,
  next_is_default BOOLEAN,
  next_from    TIMESTAMPTZ,
  versions     BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las tarifas';
  END IF;

  RETURN QUERY
  WITH subjects AS (
    SELECT 'platform_default'::text AS kind, NULL::uuid AS subject_id, 'Default de plataforma'::text AS subject_name
    UNION ALL
    SELECT CASE WHEN p.is_mopt THEN 'mopt_fee' ELSE 'provider' END, p.id, p.name FROM providers p
    UNION ALL
    SELECT 'operator', pr.id, COALESCE(pr.full_name, 'Operador')
      FROM profiles pr
     WHERE (pr.role = 'OPERATOR' AND pr.provider_id IS NULL)
        OR EXISTS (SELECT 1 FROM rate_versions rv WHERE rv.kind = 'operator' AND rv.subject_id = pr.id)
  )
  SELECT s.kind, s.subject_id, s.subject_name,
         CASE s.kind
           WHEN 'platform_default' THEN platform_commission_at(now())
           WHEN 'mopt_fee'         THEN mopt_fee_rate_at(s.subject_id, now())
           WHEN 'provider'         THEN commission_rate_at(s.subject_id, NULL, now())
           ELSE commission_rate_at(NULL, s.subject_id, now())
         END,
         s.kind IN ('platform_default', 'mopt_fee')
           OR (SELECT v.rate FROM rate_version_at(s.kind, s.subject_id, now()) v) IS NOT NULL,
         nx.rate,
         nx.id IS NOT NULL AND nx.rate IS NULL,
         nx.valid_from,
         (SELECT count(*) FROM rate_versions rv
           WHERE rv.kind = s.kind AND rv.subject_id IS NOT DISTINCT FROM s.subject_id)
    FROM subjects s
    LEFT JOIN LATERAL (
      SELECT rv.id, rv.rate, rv.valid_from
        FROM rate_versions rv
       WHERE rv.kind = s.kind AND rv.subject_id IS NOT DISTINCT FROM s.subject_id
         AND rv.valid_from > now()
       ORDER BY rv.valid_from
       LIMIT 1
    ) nx ON true
   ORDER BY array_position(ARRAY['platform_default', 'provider', 'mopt_fee', 'operator'], s.kind), s.subject_name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_rate_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rate_overview() TO authenticated;

-- Historia de un sujeto, con la vigencia derivada de la version siguiente.
CREATE OR REPLACE FUNCTION public.admin_rate_history(p_kind TEXT, p_subject UUID)
RETURNS TABLE (
  id              UUID,
  rate            NUMERIC,
  valid_from      TIMESTAMPTZ,
  valid_until     TIMESTAMPTZ,
  status          TEXT,        -- 'programada' | 'vigente' | 'anterior'
  note            TEXT,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las tarifas';
  END IF;

  RETURN QUERY
  WITH h AS (
    SELECT rv.*, lead(rv.valid_from) OVER (ORDER BY rv.valid_from) AS until
      FROM rate_versions rv
     WHERE rv.kind = p_kind AND rv.subject_id IS NOT DISTINCT FROM p_subject
  )
  SELECT h.id, h.rate, h.valid_from, h.until,
         CASE WHEN h.valid_from > now() THEN 'programada'
              WHEN h.until IS NULL OR h.until > now() THEN 'vigente'
              ELSE 'anterior' END,
         h.note, h.created_by_name, h.created_at
    FROM h
   ORDER BY h.valid_from DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_rate_history(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rate_history(TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------
-- 7. Fuera las tasas "actuales" guardadas
-- ---------------------------------------------------------------
DROP FUNCTION IF EXISTS public.effective_commission_rate(UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.mopt_fee_rate(UUID);
DROP TABLE IF EXISTS public.provider_commissions;

-- La comision del operador ya vive en rate_versions. Ademas, la 00080 la
-- BORRABA al entrar a una empresa, cambiando hacia atras la retencion de todo
-- lo que hizo como independiente; con versiones su historia queda y solo
-- aplica a los servicios sin empresa, que es lo correcto.
CREATE OR REPLACE FUNCTION public.admin_update_user_role(p_user_id uuid, p_new_role user_role, p_provider_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_profile profiles;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can update user roles';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;

  -- 00093: una cuenta de aseguradora necesita SU aseguradora; eso lo hace
  -- admin_link_insurer_user.
  -- 00098: una cuenta MOPT necesita SU programa; eso lo hace admin_link_mopt_user.
  IF p_new_role::text = 'MOPT' THEN
    RAISE EXCEPTION 'Para vincular una cuenta al MOPT usa admin_link_mopt_user';
  END IF;

  IF p_new_role = 'INSURER' THEN
    RAISE EXCEPTION 'Para convertir en aseguradora usa admin_link_insurer_user';
  END IF;

  IF p_new_role = 'OPERATOR' AND p_provider_id IS NULL THEN
    RAISE NOTICE 'Warning: Operator without provider assignment';
  END IF;

  IF p_new_role != 'OPERATOR' THEN
    p_provider_id := NULL;
  END IF;

  UPDATE profiles
     SET role = p_new_role,
         provider_id = p_provider_id,
         -- 00076: misma logica que `provider_id` justo arriba — al dejar de ser
         -- operador se limpia, y al pasar a serlo entra como 'pending' salvo que
         -- ya traiga una revision hecha.
         verification_status = CASE
           WHEN p_new_role = 'OPERATOR' THEN COALESCE(verification_status, 'pending')
           ELSE NULL
         END,
         -- 00093: el destino nunca es INSURER, asi que el vinculo se va.
         insurer_id = NULL,
         updated_at = NOW()
   WHERE id = p_user_id
  RETURNING * INTO v_profile;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'new_role', p_new_role,
    'provider_id', p_provider_id,
    'full_name', v_profile.full_name
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_link_insurer_user(p_user_id uuid, p_insurer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede vincular una cuenta de aseguradora';
  END IF;
  -- 00093: igual que admin_update_user_role — un admin no se cambia el rol a si
  -- mismo (se quedaria fuera del panel).
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio rol';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM insurers WHERE id = p_insurer_id) THEN
    RAISE EXCEPTION 'La aseguradora no existe';
  END IF;

  -- 00093: lo que es solo de operador se limpia (CHECKs de 00076/00080).
  UPDATE profiles
     SET role = 'INSURER',
         insurer_id = p_insurer_id,
         provider_id = NULL,
         verification_status = NULL,
         updated_at = now()
   WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_link_mopt_user(p_user_id uuid, p_provider_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede vincular una cuenta del MOPT';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio rol';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM providers WHERE id = p_provider_id AND is_mopt) THEN
    RAISE EXCEPTION 'El programa MOPT no existe';
  END IF;

  -- Lo que es solo de operador o de aseguradora se limpia (CHECKs 00076/00080/00093).
  UPDATE profiles
     SET role = 'MOPT',
         provider_id = p_provider_id,
         insurer_id = NULL,
         verification_status = NULL,
         updated_at = now()
   WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role::text INTO v_role FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'La cuenta no existe';
  END IF;

  -- Las cuentas de gestion (admin, aseguradora, MOPT) las da de alta y de baja
  -- Budi: no son cuentas de consumidor, y borrar una se lleva el acceso de una
  -- organizacion entera.
  IF v_role NOT IN ('USER', 'OPERATOR') THEN
    RAISE EXCEPTION 'Esta cuenta la administra Budi. Pedi la baja a soporte.';
  END IF;

  -- Con un servicio en curso, borrar la cuenta dejaria a alguien varado (o a un
  -- operador sin poder cerrar el servicio).
  IF EXISTS (
    SELECT 1 FROM service_requests
     WHERE (user_id = p_user_id OR operator_id = p_user_id)
       AND status IN ('initiated', 'assigned', 'en_route', 'active')
  ) THEN
    RAISE EXCEPTION 'Tenes un servicio en curso. Terminalo o cancelalo antes de eliminar tu cuenta.';
  END IF;

  -- Login: primero auth.users, porque el trigger on_auth_user_email_updated
  -- copia el email al perfil y lo pisaria si fuera al reves.
  UPDATE auth.users
     SET email = 'eliminada+' || p_user_id || '@cuentas.budi.invalid',
         phone = NULL,
         encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
         raw_user_meta_data = '{}'::jsonb,
         -- 100 anos y no 'infinity': GoTrue (Go) no sabe leer una fecha infinita
         -- y responde 500 a toda operacion sobre el usuario, incluido el logout.
         -- Es la misma duracion que usa la API admin de Supabase para banear.
         banned_until = now() + interval '100 years',
         updated_at = now()
   WHERE id = p_user_id;
  DELETE FROM auth.sessions        WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens  WHERE user_id = p_user_id::text;
  DELETE FROM auth.identities      WHERE user_id = p_user_id;
  DELETE FROM auth.mfa_factors     WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;

  -- Perfil. El rol se conserva: los registros historicos dicen "un cliente" o
  -- "un operador", no quien.
  UPDATE profiles
     SET full_name = 'Cuenta eliminada',
         phone = '',
         email = NULL,
         marketing_opt_in = false,
         provider_id = NULL,
         insurer_id = NULL,
         verification_status = CASE WHEN role = 'OPERATOR' THEN 'rejected' END,
         verification_rejection_reason = CASE WHEN role = 'OPERATOR' THEN 'Cuenta eliminada por su titular' END,
         updated_at = now()
   WHERE id = p_user_id;

  DELETE FROM profile_sensitive  WHERE profile_id = p_user_id;
  DELETE FROM vehicles           WHERE user_id = p_user_id;
  DELETE FROM device_tokens      WHERE user_id = p_user_id;
  DELETE FROM notification_queue WHERE user_id = p_user_id;
  DELETE FROM operator_documents WHERE operator_id = p_user_id;
  DELETE FROM operator_locations WHERE operator_id = p_user_id;
  DELETE FROM pin_attempts       WHERE operator_id = p_user_id;

  UPDATE members SET profile_id = NULL, updated_at = now() WHERE profile_id = p_user_id;

  -- En sus servicios queda el hecho (que, donde, cuanto), no el vehiculo.
  UPDATE service_requests
     SET vehicle_plate = NULL, vehicle_make = NULL, vehicle_model = NULL, vehicle_color = NULL,
         vehicle_photo_url = NULL, vehicle_doc_path = NULL, notes = NULL
   WHERE user_id = p_user_id;

  UPDATE request_messages SET message = '[mensaje eliminado]' WHERE sender_id = p_user_id;
  UPDATE ratings SET comment = NULL WHERE rater_user_id = p_user_id;

  INSERT INTO account_deletions (user_id, role) VALUES (p_user_id, v_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'role', v_role);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mopt_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mopt UUID := auth_mopt_id();
  v_mes_desde TIMESTAMPTZ := sv_day_start(date_trunc('month', sv_today())::date);
BEGIN
  IF v_mopt IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a un programa MOPT';
  END IF;

  RETURN jsonb_build_object(
    'program_name', (SELECT name FROM providers WHERE id = v_mopt),
    'fee_rate', mopt_fee_rate_at(v_mopt, now()),
    'operators_total', (SELECT count(*) FROM profiles WHERE provider_id = v_mopt AND role = 'OPERATOR'),
    'operators_approved', (SELECT count(*) FROM profiles WHERE provider_id = v_mopt AND role = 'OPERATOR' AND verification_status = 'approved'),
    'zones_active', (SELECT count(*) FROM mopt_zones WHERE provider_id = v_mopt AND is_active),
    'in_progress', (SELECT count(*) FROM service_requests WHERE mopt_provider_id = v_mopt AND status IN ('initiated', 'assigned', 'en_route', 'active')),
    'completed_month', (SELECT count(*) FROM service_requests WHERE mopt_provider_id = v_mopt AND status = 'completed' AND completed_at >= v_mes_desde),
    'amount_month', (SELECT COALESCE(sum(total_price), 0) FROM service_requests WHERE mopt_provider_id = v_mopt AND status = 'completed' AND completed_at >= v_mes_desde),
    'owed_to_operators', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all() WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'operator'),
    'owed_to_budi', (SELECT COALESCE(sum(balance), 0) FROM ledger_balances_all() WHERE debtor_kind = 'mopt' AND debtor_id = v_mopt AND creditor_kind = 'budi')
  );
END;
$function$
;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS commission_rate;

-- El trigger de auditoria de profiles listaba commission_rate entre las
-- columnas de gobierno; ya no existe.
DROP TRIGGER IF EXISTS trg_audit ON public.profiles;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(
    '',
    'role,provider_id,insurer_id,verification_status,verification_rejection_reason'
  );

-- ---------------------------------------------------------------
-- 8. Neto por servicio para el historial del operador
-- ---------------------------------------------------------------
-- El historial movil calculaba "lo que cobras" de cada linea con UN porcentaje
-- (el del total). Con tasas versionadas cada servicio tiene la suya, y ya antes
-- fallaba con los servicios del MOPT (0% de comision). Misma cuenta que
-- my_operator_earnings, linea por linea.
CREATE OR REPLACE FUNCTION public.my_operator_service_earnings(p_request_ids UUID[])
RETURNS TABLE (request_id UUID, bruto NUMERIC, comision_pct NUMERIC, comision NUMERIC, a_cobrar NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_op UUID := auth.uid();
BEGIN
  IF v_op IS NULL THEN
    RAISE EXCEPTION 'Se necesita una sesion';
  END IF;

  RETURN QUERY
  SELECT sr.id, sr.total_price, cr.rate,
         ROUND(sr.total_price * cr.rate / 100, 2),
         sr.total_price - ROUND(sr.total_price * cr.rate / 100, 2)
    FROM service_requests sr
    CROSS JOIN LATERAL (
      SELECT CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 0::numeric
                  ELSE commission_rate_at(sr.provider_id, sr.operator_id, sr.completed_at) END AS rate
    ) cr
   WHERE sr.id = ANY (p_request_ids)
     AND sr.operator_id = v_op
     AND sr.status = 'completed'
     AND sr.total_price IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.my_operator_service_earnings(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_operator_service_earnings(UUID[]) TO authenticated;
