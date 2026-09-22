-- =====================================================
-- 00080 — El operador independiente tambien tiene su comision
--
-- La 00079 puso la comision en `providers`, asi que quien no pertenece a una
-- empresa caia siempre al 20% y no habia donde cambiarselo. Peor: el panel
-- EXIGIA proveedor al editar un operador, asi que el independiente ni siquiera
-- se podia crear desde la UI, aunque la base lo permite y la liquidacion ya lo
-- contemplaba (lo mostraba con su distintivo).
--
-- Se cierra el caso: la comision vive junto a quien COBRA. Si el operador
-- pertenece a una empresa, cobra la empresa y manda la comision de la empresa.
-- Si no, cobra el operador y manda la suya.
--
-- Y se aplica la leccion del `max_covered_amount` de hoy: nada de configuracion
-- que se guarda y no hace nada. Por eso `admin_set_operator_commission` rechaza
-- ponerle comision propia a alguien que pertenece a una empresa, y
-- `admin_update_user_role` la limpia cuando lo mete a una.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. El default de plataforma, en un solo lugar
-- ---------------------------------------------------------------
-- Estaba repetido como literal en el DEFAULT de la columna y en cada COALESCE de
-- las tres funciones de liquidacion: cuatro sitios donde cambiar el mismo numero
-- y tres oportunidades de que se desincronice.
CREATE OR REPLACE FUNCTION public.default_commission_rate()
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 20.00::NUMERIC $$;

COMMENT ON FUNCTION public.default_commission_rate() IS
  'Comision de plataforma por defecto (%). La usan el DEFAULT de '
  'providers.commission_rate y la liquidacion cuando no hay una configurada.';

ALTER TABLE public.providers
  ALTER COLUMN commission_rate SET DEFAULT default_commission_rate();

-- ---------------------------------------------------------------
-- 2. Comision propia del operador
-- ---------------------------------------------------------------
-- NULL = usa el default de plataforma. Solo tiene sentido cuando el operador no
-- tiene empresa; el CHECK y las dos RPC de abajo se encargan de que no quede
-- puesta en alguien de una empresa.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_commission_rate_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_commission_rate_check
  CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_commission_solo_independientes;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_commission_solo_independientes
  CHECK (commission_rate IS NULL OR (role = 'OPERATOR' AND provider_id IS NULL));

COMMENT ON COLUMN public.profiles.commission_rate IS
  'Comision (%) de un operador INDEPENDIENTE, el que liquida por su cuenta. '
  'NULL = default de plataforma. Si pertenece a una empresa manda la de la '
  'empresa y esta columna debe estar en NULL. Ver migr. 00080.';

-- ---------------------------------------------------------------
-- 3. El admin la configura
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_operator_commission(
  p_operator_id UUID,
  -- DEFAULT NULL a proposito: omitir el argumento es como se dice "sin comision
  -- propia, usa el default de plataforma". Ademas hace que el tipo generado sea
  -- opcional, y el cliente pueda expresar ese caso sin castear.
  p_rate        NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role     user_role;
  v_provider UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede configurar comisiones';
  END IF;

  SELECT role, provider_id INTO v_role, v_provider FROM profiles WHERE id = p_operator_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;
  IF v_role <> 'OPERATOR' THEN
    RAISE EXCEPTION 'La comision propia es de los operadores';
  END IF;
  -- Nada de guardar un numero que despues no manda.
  IF v_provider IS NOT NULL AND p_rate IS NOT NULL THEN
    RAISE EXCEPTION 'Este operador pertenece a una empresa: la comision se configura en la empresa';
  END IF;
  IF p_rate IS NOT NULL AND (p_rate < 0 OR p_rate > 100) THEN
    RAISE EXCEPTION 'La comision debe estar entre 0 y 100';
  END IF;

  UPDATE profiles SET commission_rate = p_rate, updated_at = NOW() WHERE id = p_operator_id;

  RETURN jsonb_build_object('success', true, 'operator_id', p_operator_id, 'commission_rate', p_rate);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_operator_commission(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_operator_commission(UUID, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------
-- 4. La liquidacion la usa, y el cambio de rol la mantiene coherente
-- ---------------------------------------------------------------
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
    -- Sin empresa, el destinatario es el operador: es su propia liquidacion.
    COALESCE(pr.name, ope.full_name, 'Sin asignar'),
    pr.id IS NULL,
    COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()),
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE sr.total_price IS NULL)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- Se redondea el total, no cada linea: sumar centavos redondeados servicio a
    -- servicio se separa del bruto y despues no cuadra contra finanzas.
    ROUND(COALESCE(SUM(sr.total_price), 0) * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2),
    COALESCE(SUM(sr.total_price), 0)
      - ROUND(COALESCE(SUM(sr.total_price), 0) * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2)
  FROM service_requests sr
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= p_from
    AND sr.completed_at < (p_to + 1)
  -- `ope.commission_rate` entra al GROUP BY porque el COALESCE de arriba ahora
  -- la lee: sin esto la funcion no compila.
  GROUP BY pr.id, pr.name, pr.commission_rate, ope.full_name, ope.commission_rate
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
    COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()),
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    ROUND(COALESCE(SUM(sr.total_price), 0) * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2),
    COALESCE(SUM(sr.total_price), 0)
      - ROUND(COALESCE(SUM(sr.total_price), 0) * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2)
  FROM service_requests sr
  LEFT JOIN profiles ope  ON ope.id = sr.operator_id
  LEFT JOIN providers pr  ON pr.id = sr.provider_id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= p_from
    AND sr.completed_at < (p_to + 1)
  GROUP BY ope.id, ope.full_name, pr.name, pr.commission_rate
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
    COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()),
    COALESCE(sr.total_price, 0),
    ROUND(COALESCE(sr.total_price, 0) * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2),
    COALESCE(sr.total_price, 0)
      - ROUND(COALESCE(sr.total_price, 0) * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2)
  FROM service_requests sr
  LEFT JOIN cases c      ON c.request_id = sr.id
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= p_from
    AND sr.completed_at < (p_to + 1)
  ORDER BY sr.completed_at DESC;
END;
$function$;

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
         -- 00080: la comision personal existe SOLO mientras el operador liquida
         -- por su cuenta. Al entrar a una empresa manda la de la empresa, asi
         -- que se limpia en vez de quedar como configuracion muerta.
         commission_rate = CASE
           WHEN p_new_role = 'OPERATOR' AND p_provider_id IS NULL THEN commission_rate
           ELSE NULL
         END,
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
$function$;
