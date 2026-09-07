-- =====================================================
-- 00089 — La comision sale de `providers` a su propia tabla
--
-- Cierra el residuo que quedo abierto en la 00088. Ahi se saco a `anon` de
-- `providers`, pero `commission_rate` seguia siendo legible por CUALQUIER
-- usuario con sesion —y cualquiera se registra solo desde /register—. Es el
-- porcentaje que Budi le retiene a cada socio: las condiciones comerciales de
-- cada acuerdo, en manos de cualquier cliente.
--
-- Por que no se arreglo con un REVOKE de columna: la RLS filtra filas, no
-- columnas, y el admin y el cliente son los dos el mismo rol de Postgres
-- (`authenticated`). Un `REVOKE SELECT (commission_rate)` habria dejado ciego
-- tambien al admin. Y ademas los grants de columna no aparecen en `pg_policy`:
-- alguien auditando la RLS de `providers` no veria nada raro, que es
-- exactamente como se nos escaparon los dos agujeros de la 00070 y la 00088.
--
-- Con la columna en su propia tabla, la proteccion vuelve a estar donde el
-- resto del esquema la tiene —una politica RLS— y `select('*')` sobre
-- `providers` sigue funcionando para siempre, porque la columna ya no esta.
--
-- De paso se centraliza la precedencia de la comision, que estaba copiada doce
-- veces en cuatro funciones.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------
-- Una fila por proveedor, y la ausencia de fila significa "la tarifa por
-- defecto". Asi un proveedor recien creado no necesita que nadie se acuerde de
-- insertarle la comision, y no puede quedar uno sin tarifa.
CREATE TABLE IF NOT EXISTS public.provider_commissions (
  provider_id     UUID PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  commission_rate NUMERIC(5,2) NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_commissions_rate_check
    CHECK (commission_rate >= 0 AND commission_rate <= 100)
);

COMMENT ON TABLE public.provider_commissions IS
  'Condiciones comerciales por proveedor: el porcentaje del bruto que retiene '
  'Budi. Vive aparte de `providers` porque esa tabla la leen todos los usuarios '
  'con sesion (la movil la necesita para el nombre de la empresa) y esto no lo '
  'puede ver nadie mas que un admin. Sin fila = default_commission_rate().';

COMMENT ON COLUMN public.provider_commissions.commission_rate IS
  'Porcentaje (0-100) del bruto de cada servicio que retiene Budi.';

ALTER TABLE public.provider_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Solo admin gestiona comisiones" ON public.provider_commissions;
CREATE POLICY "Solo admin gestiona comisiones"
  ON public.provider_commissions FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

REVOKE ALL ON public.provider_commissions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_commissions TO authenticated;

DROP TRIGGER IF EXISTS update_provider_commissions_updated_at ON public.provider_commissions;
CREATE TRIGGER update_provider_commissions_updated_at
  BEFORE UPDATE ON public.provider_commissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------
-- 2. Backfill antes de soltar la columna
-- ---------------------------------------------------------------
-- Solo lo que se aparta del default: si la empresa tiene el 20% no hace falta
-- fila, y asi la tabla dice unicamente lo que se negocio de verdad.
INSERT INTO public.provider_commissions (provider_id, commission_rate)
SELECT p.id, p.commission_rate
  FROM public.providers p
 WHERE p.commission_rate IS DISTINCT FROM default_commission_rate()
ON CONFLICT (provider_id) DO NOTHING;

-- ---------------------------------------------------------------
-- 3. La precedencia, en un solo lugar
-- ---------------------------------------------------------------
-- Estaba escrita como `COALESCE(pr.commission_rate, ope.commission_rate,
-- default_commission_rate())` repetida doce veces entre las cuatro funciones de
-- liquidacion. La regla real es en dos escalones, no tres:
--
--   · con empresa       -> manda la tarifa de la empresa (o el default)
--   · sin empresa       -> manda la del operador independiente (o el default)
--
-- El COALESCE de tres niveles daba lo mismo solo porque `commission_rate` era
-- NOT NULL en `providers`. Con la tarifa en una tabla aparte eso deja de ser
-- cierto —la fila puede no existir— y un COALESCE plano se caeria al escalon
-- del operador cuando la empresa simplemente cobra el default. Por eso el CASE.
--
-- SECURITY DEFINER: la llaman funciones que corren para el operador
-- (`my_operator_earnings`), y `provider_commissions` es solo para admins.
CREATE OR REPLACE FUNCTION public.effective_commission_rate(
  p_provider_id   UUID,
  p_operator_rate NUMERIC DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_provider_id IS NOT NULL THEN COALESCE(
      (SELECT pc.commission_rate FROM provider_commissions pc WHERE pc.provider_id = p_provider_id),
      default_commission_rate()
    )
    ELSE COALESCE(p_operator_rate, default_commission_rate())
  END
$$;

COMMENT ON FUNCTION public.effective_commission_rate(UUID, NUMERIC) IS
  'Comision que aplica a un servicio: la de la empresa si la hay, si no la del '
  'operador independiente, si no el default. Unica fuente de esta precedencia.';

REVOKE ALL ON FUNCTION public.effective_commission_rate(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_commission_rate(UUID, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------
-- 4. Las cuatro funciones de liquidacion, apuntando al helper
-- ---------------------------------------------------------------
-- Cambia solo de donde sale el porcentaje. El redondeo linea por linea de la
-- 00081 y el `a_pagar` derivado por resta se dejan intactos.

CREATE OR REPLACE FUNCTION public.admin_settlement_by_provider(p_from date, p_to date)
RETURNS TABLE(provider_id uuid, destinatario text, es_independiente boolean, comision_pct numeric, servicios bigint, sin_precio bigint, bruto numeric, comision numeric, a_pagar numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    pr.id,
    -- Sin empresa, el destinatario es el operador: es su propia liquidacion.
    COALESCE(pr.name, ope.full_name, 'Sin asignar'),
    pr.id IS NULL,
    effective_commission_rate(pr.id, ope.commission_rate),
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE sr.total_price IS NULL)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- 00081: se suman las lineas ya redondeadas, no se redondea el total. El
    -- detalle que se exporta redondea servicio a servicio, y redondear aparte el
    -- agregado los separaba: con tres servicios de $33.33 al 20%, la pantalla
    -- decia $20.00 y el CSV sumaba $20.01. Un export que no cuadra con lo que se
    -- vio antes de transferir no sirve para justificar el pago.
    COALESCE(SUM(ROUND(sr.total_price * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)), 0),
    -- `a pagar` se deriva restando, nunca sumando lineas por su cuenta: asi
    -- comision + a_pagar = bruto siempre, exacto.
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)), 0)
  FROM service_requests sr
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  -- `ope.commission_rate` sigue en el GROUP BY porque el helper la recibe como
  -- argumento y `ope.id` no esta agrupado (se agrupa por nombre).
  GROUP BY pr.id, pr.name, ope.full_name, ope.commission_rate
  ORDER BY 9 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_settlement_by_operator(p_from date, p_to date)
RETURNS TABLE(operator_id uuid, operador text, empresa text, comision_pct numeric, servicios bigint, bruto numeric, comision numeric, a_pagar numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    effective_commission_rate(pr.id, ope.commission_rate),
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- 00081: se suman las lineas ya redondeadas, no se redondea el total.
    COALESCE(SUM(ROUND(sr.total_price * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)), 0)
  FROM service_requests sr
  LEFT JOIN profiles ope  ON ope.id = sr.operator_id
  LEFT JOIN providers pr  ON pr.id = sr.provider_id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  -- Entra `pr.id` (lo pide el helper) en vez de `pr.commission_rate`. Agrupar
  -- por el id en lugar del nombre+tarifa no junta empresas distintas por error.
  GROUP BY ope.id, ope.full_name, ope.commission_rate, pr.id, pr.name
  ORDER BY 8 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_settlement_detail(p_from date, p_to date)
RETURNS TABLE(folio text, completado timestamp with time zone, servicio text, destinatario text, operador text, comision_pct numeric, bruto numeric, comision numeric, a_pagar numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    effective_commission_rate(pr.id, ope.commission_rate),
    COALESCE(sr.total_price, 0),
    ROUND(COALESCE(sr.total_price, 0) * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2),
    COALESCE(sr.total_price, 0)
      - ROUND(COALESCE(sr.total_price, 0) * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)
  FROM service_requests sr
  LEFT JOIN cases c      ON c.request_id = sr.id
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  ORDER BY sr.completed_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_operator_earnings(p_from date, p_to date)
RETURNS TABLE(servicios bigint, bruto numeric, comision_pct numeric, comision numeric, a_pagar numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    -- El porcentaje se informa para poder explicarle al operador de donde sale
    -- la retencion. MAX sobre un valor constante por operador.
    COALESCE(MAX(effective_commission_rate(pr.id, ope.commission_rate)), default_commission_rate()),
    COALESCE(SUM(ROUND(sr.total_price * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)), 0)
  FROM service_requests sr
  LEFT JOIN profiles  ope ON ope.id = sr.operator_id
  LEFT JOIN providers pr  ON pr.id  = sr.provider_id
  WHERE sr.operator_id = v_op
    AND sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1);
END;
$function$;

-- ---------------------------------------------------------------
-- 5. Como lee y escribe el admin
-- ---------------------------------------------------------------
-- La pantalla de proveedores sigue haciendo `select('*')` sobre `providers`;
-- la comision la trae y la guarda por estas dos.
CREATE OR REPLACE FUNCTION public.admin_list_provider_commissions()
RETURNS TABLE(provider_id uuid, commission_rate numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las comisiones';
  END IF;

  -- Se devuelven TODOS los proveedores, con la tarifa efectiva. El que no tiene
  -- fila propia sale con el default, que es lo que se le va a cobrar de verdad:
  -- la pantalla no tiene por que distinguir "sin fila" de "negociado en 20".
  RETURN QUERY
  SELECT p.id, effective_commission_rate(p.id, NULL)
    FROM providers p;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_provider_commission(
  p_provider_id UUID,
  p_rate        NUMERIC
)
RETURNS JSONB
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

  -- Volver al default borra la fila en vez de guardarla: la tabla sigue
  -- diciendo solo lo que se aparto de la tarifa estandar.
  IF p_rate = default_commission_rate() THEN
    DELETE FROM provider_commissions WHERE provider_id = p_provider_id;
  ELSE
    INSERT INTO provider_commissions (provider_id, commission_rate)
    VALUES (p_provider_id, p_rate)
    ON CONFLICT (provider_id) DO UPDATE SET commission_rate = EXCLUDED.commission_rate;
  END IF;

  RETURN jsonb_build_object('success', true, 'provider_id', p_provider_id, 'commission_rate', p_rate);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_provider_commissions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_provider_commission(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_provider_commissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_commission(UUID, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------
-- 6. Y recien ahora, soltar la columna
-- ---------------------------------------------------------------
ALTER TABLE public.providers DROP COLUMN IF EXISTS commission_rate;
