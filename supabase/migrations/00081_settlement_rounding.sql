-- =====================================================
-- 00081 — La liquidacion de la pantalla y la del CSV, al centavo
--
-- La 00079 redondeaba el AGREGADO (`ROUND(SUM(bruto) * tasa)`) mientras que el
-- detalle que se exporta redondea servicio a servicio. Casi siempre coinciden,
-- pero no siempre: con tres servicios de $33.33 al 20% la pantalla decia
-- comision $20.00 y el CSV sumaba $20.01.
--
-- Un centavo no rompe nada por si solo. Lo que rompe es que el papel con el que
-- se justifica un pago no cuadre con la pantalla donde se decidio pagarlo: quien
-- recibe la liquidacion suma las lineas y le da otro numero.
--
-- Se invierte el criterio —y el comentario que la 00079 dejaba escrito—: manda
-- la LINEA. El agregado suma lineas ya redondeadas, que es como se arma
-- cualquier factura. Lo que motivaba aquella decision (que no cuadrara contra
-- finanzas) no pasa, porque `a pagar` se deriva restando la comision del bruto
-- en vez de sumar lineas por su cuenta: `comision + a_pagar = bruto` sigue
-- siendo exacto, y `bruto` no cambia.
-- =====================================================

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
    -- 00081: se suman las lineas ya redondeadas, no se redondea el total. El
    -- detalle que se exporta redondea servicio a servicio, y redondear aparte el
    -- agregado los separaba: con tres servicios de $33.33 al 20%, la pantalla
    -- decia $20.00 y el CSV sumaba $20.01. Un export que no cuadra con lo que se
    -- vio antes de transferir no sirve para justificar el pago.
    COALESCE(SUM(ROUND(sr.total_price * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2)), 0),
    -- `a pagar` se deriva restando, nunca sumando lineas por su cuenta: asi
    -- comision + a_pagar = bruto siempre, exacto.
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2)), 0)
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
    -- 00081: se suman las lineas ya redondeadas, no se redondea el total. El
    -- detalle que se exporta redondea servicio a servicio, y redondear aparte el
    -- agregado los separaba: con tres servicios de $33.33 al 20%, la pantalla
    -- decia $20.00 y el CSV sumaba $20.01. Un export que no cuadra con lo que se
    -- vio antes de transferir no sirve para justificar el pago.
    COALESCE(SUM(ROUND(sr.total_price * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2)), 0),
    -- `a pagar` se deriva restando, nunca sumando lineas por su cuenta: asi
    -- comision + a_pagar = bruto siempre, exacto.
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * COALESCE(pr.commission_rate, ope.commission_rate, default_commission_rate()) / 100, 2)), 0)
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
