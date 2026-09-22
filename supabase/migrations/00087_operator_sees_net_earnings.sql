-- =====================================================
-- 00087 — El operador ve lo que va a COBRAR, no el bruto
--
-- EL BUG
-- La pantalla de ganancias de la movil suma `service_requests.total_price` de
-- los servicios completados y lo presenta como lo que gano el operador. Eso era
-- cierto mientras no hubo comision. Desde 00079/00080 Budi retiene un
-- porcentaje, asi que el numero que ve el operador NO es el que va a cobrar.
--
-- Medido sobre los datos actuales, Operador Uno:
--   la app le muestra            $357.50
--   el admin le va a transferir  $286.00   (bruto 357.50 - comision 71.50)
--
-- $71.50 de diferencia en dos servicios. Es exactamente el numero por el que un
-- operador reclama a fin de mes, y la app le estaba dando la razon equivocada.
--
-- EL CRITERIO
-- La comision no se recalcula en el cliente: se expone la MISMA formula que usa
-- `admin_settlement_by_operator`, para que la pantalla del operador y la
-- liquidacion del admin no puedan dar numeros distintos. Eso incluye:
--   · la precedencia empresa -> independiente -> default (00080);
--   · redondear servicio por servicio y derivar `a_pagar` restando (00081);
--   · cortar el periodo en hora de El Salvador (00082).
-- =====================================================
CREATE OR REPLACE FUNCTION public.my_operator_earnings(p_from DATE, p_to DATE)
RETURNS TABLE (
  servicios    BIGINT,
  bruto        NUMERIC,
  comision_pct NUMERIC,
  comision     NUMERIC,
  a_pagar      NUMERIC
)
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
  SELECT
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- El porcentaje se informa para poder explicarle al operador de donde sale
    -- la retencion. MAX sobre un valor constante por operador.
    COALESCE(MAX(COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate())), default_commission_rate()),
    COALESCE(SUM(ROUND(sr.total_price * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2)), 0)
  FROM service_requests sr
  LEFT JOIN profiles  ope ON ope.id = sr.operator_id
  LEFT JOIN providers pr  ON pr.id  = sr.provider_id
  WHERE sr.operator_id = v_op
    AND sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1);
END;
$$;

COMMENT ON FUNCTION public.my_operator_earnings(DATE, DATE) IS
  'Lo que el operador que llama facturo y lo que va a cobrar en el periodo. '
  'Misma formula que admin_settlement_by_operator, para que no puedan discrepar.';

REVOKE ALL ON FUNCTION public.my_operator_earnings(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_operator_earnings(DATE, DATE) TO authenticated;
