-- =====================================================
-- 00082 — El corte de periodo, en hora de El Salvador
--
-- Las funciones de finanzas (00078) y de liquidacion (00079) comparaban
-- `completed_at` —que es TIMESTAMPTZ— contra un DATE. Postgres convierte ese
-- date usando la zona de la sesion, que en esta base es UTC. El Salvador es
-- UTC-6 y no tiene horario de verano, asi que el corte quedaba corrido seis
-- horas.
--
-- Efecto medido: un servicio cerrado el 30 de septiembre a las 20:00 hora de El
-- Salvador se guarda como 2026-10-01 02:00 UTC y se facturaba en OCTUBRE. Un
-- servicio de $500 aparecia en el mes equivocado. Pasa con TODO lo que se cierre
-- despues de las 18:00 del ultimo dia del mes — seis horas de cada cierre, y
-- justo en la franja de mas actividad de una gruera.
--
-- Importa aca mas que en otras pantallas porque estos numeros son los que se le
-- facturan a una aseguradora y los que se le pagan a un proveedor: un servicio
-- en el mes equivocado es una factura mal emitida.
--
-- El corte convierte el borde del dia LOCAL a timestamptz, en vez de convertir
-- cada fila a hora local: asi la comparacion sigue siendo directa contra la
-- columna y puede usar un indice, cosa que con
-- `(completed_at AT TIME ZONE ...)::date` se perderia.
-- =====================================================

-- La zona, en un solo lugar. El Salvador no usa horario de verano, asi que el
-- desfase es -6 todo el anio, pero se nombra la zona y no el offset: si algun
-- dia eso cambiara, lo resuelve la base y no hay literales sueltos que buscar.
CREATE OR REPLACE FUNCTION public.sv_day_start(d DATE)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$ SELECT d::timestamp AT TIME ZONE 'America/El_Salvador' $$;

COMMENT ON FUNCTION public.sv_day_start(DATE) IS
  'Instante en que empieza ese dia en El Salvador. Para cortar periodos de '
  'finanzas y liquidacion en hora local y no en UTC. Ver migr. 00082.';

CREATE OR REPLACE FUNCTION public.admin_finance_summary(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las finanzas';
  END IF;

  SELECT jsonb_build_object(
    'servicios',       COUNT(*),
    'bruto',           COALESCE(SUM(sr.total_price), 0),
    -- Servicios completados que nunca quedaron cobrados. No es una curiosidad:
    -- son trabajos prestados que no facturaron, y sin esto la pantalla contaba
    -- los 9 servicios pero promediaba sobre los 7 con precio, dando un ticket
    -- que no se podia reconciliar con el total. Se muestra en vez de esconderse.
    'sin_precio',      COUNT(*) FILTER (WHERE sr.total_price IS NULL),
    -- Lo que hay que facturarle a las aseguradoras.
    'aseguradoras',    COALESCE(SUM(cu.amount_covered), 0),
    -- Lo que pone de su bolsillo un afiliado, sobre lo que el plan no cubre.
    'copagos',         COALESCE(SUM(cu.amount_copay), 0),
    -- Servicios sin cobertura de por medio: los paga enteros el cliente.
    'particulares',    COALESCE(SUM(CASE WHEN cu.id IS NULL THEN sr.total_price END), 0),
    -- AVG ignora los NULL, asi que el promedio es sobre los que SI tienen
    -- precio. Es lo correcto, y por eso la pantalla lo rotula asi.
    'ticket_promedio', COALESCE(ROUND(AVG(sr.total_price), 2), 0)
  ) INTO v
  FROM service_requests sr
  LEFT JOIN coverage_usage cu ON cu.request_id = sr.id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1);

  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_finance_by_insurer(p_from date, p_to date)
 RETURNS TABLE(insurer_id uuid, aseguradora text, servicios bigint, a_facturar numeric, copagos numeric, bruto numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las finanzas';
  END IF;

  RETURN QUERY
  SELECT i.id, i.name,
         COUNT(*)::BIGINT,
         COALESCE(SUM(cu.amount_covered), 0),
         COALESCE(SUM(cu.amount_copay), 0),
         COALESCE(SUM(sr.total_price), 0)
    FROM service_requests sr
    JOIN coverage_usage cu ON cu.request_id = sr.id
    JOIN members m         ON m.id  = cu.member_id
    JOIN policies po       ON po.id = m.policy_id
    JOIN insurers i        ON i.id  = po.insurer_id
   WHERE sr.status = 'completed'
     AND sr.completed_at >= sv_day_start(p_from)
     AND sr.completed_at <  sv_day_start(p_to + 1)
   GROUP BY i.id, i.name
   ORDER BY 4 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_finance_detail(p_from date, p_to date)
 RETURNS TABLE(folio text, completado timestamp with time zone, servicio text, cliente text, operador text, proveedor text, aseguradora text, bruto numeric, cubierto numeric, copago numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las finanzas';
  END IF;

  RETURN QUERY
  SELECT c.folio,
         sr.completed_at,
         sr.service_type,
         cli.full_name,
         ope.full_name,
         pr.name,
         i.name,
         sr.total_price,
         -- Sin cobertura, lo cubierto es 0 y el cliente paga el bruto: asi la
         -- fila cierra igual que las que si tienen consumo.
         COALESCE(cu.amount_covered, 0),
         COALESCE(cu.amount_copay, sr.total_price)
    FROM service_requests sr
    LEFT JOIN cases c            ON c.request_id = sr.id
    LEFT JOIN profiles cli       ON cli.id = sr.user_id
    LEFT JOIN profiles ope       ON ope.id = sr.operator_id
    LEFT JOIN providers pr       ON pr.id = sr.provider_id
    LEFT JOIN coverage_usage cu  ON cu.request_id = sr.id
    LEFT JOIN members m          ON m.id  = cu.member_id
    LEFT JOIN policies po        ON po.id = m.policy_id
    LEFT JOIN insurers i         ON i.id  = po.insurer_id
   WHERE sr.status = 'completed'
     AND sr.completed_at >= sv_day_start(p_from)
     AND sr.completed_at <  sv_day_start(p_to + 1)
   ORDER BY sr.completed_at DESC;
END;
$function$;

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
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
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
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
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
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  ORDER BY sr.completed_at DESC;
END;
$function$;
