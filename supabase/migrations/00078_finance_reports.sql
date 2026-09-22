-- =====================================================
-- 00078 — Reportes de finanzas: quien paga, y cuanto se le factura a cada quien
--
-- EL HUECO
-- /admin/finance sumaba `service_requests.total_price` de los servicios
-- completados y lo presentaba como "ingresos". Eso era cierto cuando Budi le
-- cobraba a una sola persona, pero desde B-12/B-13 el precio de un servicio se
-- reparte entre DOS pagadores: lo que asume la aseguradora
-- (`coverage_usage.amount_covered`) y lo que paga el cliente (`amount_copay`, o
-- el precio entero si no es afiliado).
--
-- Con el piloto de aseguradoras encima, "cuanto le facturo a Seguros Demo este
-- mes" es LA pregunta del area, y no habia forma de responderla desde el panel.
-- Verificado sobre los datos actuales: de $383.03 de "ingresos", $60.00 hay que
-- cobrarselos a la aseguradora y $323.03 a los clientes.
--
-- CRITERIO DE PERIODO
-- Todo se corta por `completed_at`, no por `created_at`: el ingreso se reconoce
-- cuando el servicio se presto. Una solicitud creada el 31 y completada el 1
-- cuenta en el mes nuevo. `p_to` es INCLUSIVE (se compara contra el dia
-- siguiente), que es como lo lee cualquiera que escriba "del 1 al 31".
--
-- Las tres funciones son de admin y comparten el mismo corte, para que los
-- numeros de las tres pantallas cierren entre si.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. El resumen: el reparto por pagador
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_finance_summary(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    AND sr.completed_at >= p_from
    AND sr.completed_at < (p_to + 1);

  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.admin_finance_summary(DATE, DATE) IS
  'Reparto de lo facturado en el periodo: bruto, lo que asumen las aseguradoras '
  'y lo que pagan los clientes. Corta por completed_at; p_to inclusive.';

-- ---------------------------------------------------------------
-- 2. Por aseguradora: la factura de cada una
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_finance_by_insurer(p_from DATE, p_to DATE)
RETURNS TABLE (
  insurer_id  UUID,
  aseguradora TEXT,
  servicios   BIGINT,
  a_facturar  NUMERIC,
  copagos     NUMERIC,
  bruto       NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
     AND sr.completed_at >= p_from
     AND sr.completed_at < (p_to + 1)
   GROUP BY i.id, i.name
   ORDER BY 4 DESC;
END;
$$;

-- ---------------------------------------------------------------
-- 3. El detalle, para exportar y conciliar
-- ---------------------------------------------------------------
-- Un resumen no sirve para cerrar un mes con contabilidad: hace falta la linea
-- por servicio, con su folio, para poder cruzarla contra lo que reporta la
-- aseguradora. Es la misma informacion del resumen, sin agregar.
CREATE OR REPLACE FUNCTION public.admin_finance_detail(p_from DATE, p_to DATE)
RETURNS TABLE (
  folio        TEXT,
  completado   TIMESTAMPTZ,
  servicio     TEXT,
  cliente      TEXT,
  operador     TEXT,
  proveedor    TEXT,
  aseguradora  TEXT,
  bruto        NUMERIC,
  cubierto     NUMERIC,
  copago       NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
     AND sr.completed_at >= p_from
     AND sr.completed_at < (p_to + 1)
   ORDER BY sr.completed_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_finance_summary(DATE, DATE)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_finance_by_insurer(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_finance_detail(DATE, DATE)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_finance_summary(DATE, DATE)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finance_by_insurer(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finance_detail(DATE, DATE)     TO authenticated;
