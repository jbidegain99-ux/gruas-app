-- =====================================================
-- 00091 — La liquidacion por proveedor partia a la empresa en varias filas
--
-- `admin_settlement_by_provider` agrupaba por `pr.id, pr.name, ope.full_name,
-- ope.commission_rate`. Ese `ope.full_name` hace que una empresa con DOS
-- operadores salga como DOS destinatarios, cada uno con una parte del bruto.
-- La pantalla de Finanzas y el CSV de liquidacion terminan diciendo:
--
--     Gruas El Salvador S.A. de C.V.   2 servicios   $357.50   a pagar $286.00
--     Gruas El Salvador S.A. de C.V.   3 servicios   $141.00   a pagar $112.80
--
-- Dos lineas con el mismo nombre y el mismo NIT. A alguien que esta por
-- transferir eso le pasa una de dos: paga dos veces, o llama para preguntar cual
-- es la buena. En una funcion que se llama "por proveedor" tiene que haber una
-- fila por proveedor.
--
-- No se veia porque en la base de pruebas cada empresa tenia exactamente un
-- operador. Aparecio al sembrar el escenario de demo (B-18), que le pone dos.
-- En produccion es al reves: una empresa con un solo chofer es la excepcion.
--
-- El `ope.full_name` estaba ahi por una razon real: cuando la solicitud NO tiene
-- empresa (operador independiente), el destinatario ES el operador y hay que
-- agrupar por el. La regla correcta es agrupar por el DESTINATARIO, que es la
-- empresa si la hay y el operador si no: COALESCE(pr.id, ope.id). Los datos del
-- operador pasan a leerse con MAX(), que dentro de un grupo sin empresa es el
-- unico valor posible y con empresa no se usa.
-- =====================================================

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
    -- MAX() y no la columna pelada porque `ope` ya no esta en el GROUP BY; en un
    -- grupo sin empresa todas las filas son del mismo operador, asi que el MAX
    -- es su nombre, y en uno con empresa este COALESCE ni lo mira.
    COALESCE(pr.name, MAX(ope.full_name), 'Sin asignar'),
    pr.id IS NULL,
    effective_commission_rate(pr.id, MAX(ope.commission_rate)),
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
  -- Una fila por DESTINATARIO: la empresa si la hay, el operador si no.
  GROUP BY COALESCE(pr.id, ope.id), pr.id, pr.name
  ORDER BY 9 DESC;
END;
$function$;

COMMENT ON FUNCTION public.admin_settlement_by_provider(date, date) IS
  'Liquidacion agrupada por destinatario del pago: una fila por empresa, o por '
  'operador independiente cuando la solicitud no tuvo empresa. No agrupar por '
  'operador cuando hay empresa: parte a la empresa en una fila por chofer.';
