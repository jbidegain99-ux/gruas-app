-- =====================================================
-- 00079 — Liquidacion: cuanto le toca a cada proveedor y a cada operador
--
-- Parte de B-23 (Fase 3). Se construye la mitad que NO depende del procesador de
-- pagos: el modelo de comision y el calculo de lo que se debe. El registro de
-- pagos efectuados (payouts pagados, referencias, disputas) queda para cuando
-- B-20 defina el procesador; sin esa decision, cualquier tabla de pagos que se
-- invente ahora hay que rehacerla.
--
-- A QUIEN SE LE PAGA
-- Al PROVEEDOR cuando el operador pertenece a una empresa, que es el caso
-- normal: Budi contrata con la empresa y la empresa le paga a su gente. Cuando
-- el operador no tiene empresa (`profiles.provider_id IS NULL`) el destinatario
-- es el operador mismo. Por eso hay dos vistas y no una: la de proveedor es la
-- cuenta por pagar, la de operador es el desglose de quien hizo cada servicio
-- —util para que la empresa reparta, y unica cuenta cuando es independiente.
--
-- SOBRE QUE SE CALCULA
-- Sobre el BRUTO del servicio, no sobre lo cobrado. El proveedor hizo el trabajo
-- completo; que una parte la pague la aseguradora y otra el cliente es un asunto
-- de Budi con cada pagador, no del proveedor. Por eso la liquidacion no depende
-- de si el servicio tenia cobertura.
--
-- Mismo corte que los reportes de finanzas (00078): por `completed_at`, `p_to`
-- inclusive. Asi la liquidacion de un mes cuadra contra lo facturado de ese mes.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. La comision, configurable por empresa
-- ---------------------------------------------------------------
-- Es un numero de negocio y se negocia empresa por empresa, asi que vive en la
-- tabla y no en el codigo. El 20% es solo el valor con el que nace un proveedor
-- nuevo; el admin lo cambia desde /admin/proveedores.
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) NOT NULL DEFAULT 20.00;

ALTER TABLE public.providers DROP CONSTRAINT IF EXISTS providers_commission_rate_check;
ALTER TABLE public.providers
  ADD CONSTRAINT providers_commission_rate_check
  CHECK (commission_rate >= 0 AND commission_rate <= 100);

COMMENT ON COLUMN public.providers.commission_rate IS
  'Porcentaje del bruto que retiene Budi por cada servicio de esta empresa. '
  'El resto se le liquida. Ver migr. 00079.';

-- ---------------------------------------------------------------
-- 2. Lo que se le debe a cada proveedor
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_settlement_by_provider(p_from DATE, p_to DATE)
RETURNS TABLE (
  provider_id     UUID,
  destinatario    TEXT,
  es_independiente BOOLEAN,
  comision_pct    NUMERIC,
  servicios       BIGINT,
  sin_precio      BIGINT,
  bruto           NUMERIC,
  comision        NUMERIC,
  a_pagar         NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    COALESCE(pr.commission_rate, 20.00),
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE sr.total_price IS NULL)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- Se redondea el total, no cada linea: sumar centavos redondeados servicio a
    -- servicio se separa del bruto y despues no cuadra contra finanzas.
    ROUND(COALESCE(SUM(sr.total_price), 0) * COALESCE(pr.commission_rate, 20.00) / 100, 2),
    COALESCE(SUM(sr.total_price), 0)
      - ROUND(COALESCE(SUM(sr.total_price), 0) * COALESCE(pr.commission_rate, 20.00) / 100, 2)
  FROM service_requests sr
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= p_from
    AND sr.completed_at < (p_to + 1)
  GROUP BY pr.id, pr.name, pr.commission_rate, ope.full_name
  ORDER BY 9 DESC;
END;
$$;

-- ---------------------------------------------------------------
-- 3. El desglose por operador dentro de cada proveedor
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_settlement_by_operator(p_from DATE, p_to DATE)
RETURNS TABLE (
  operator_id  UUID,
  operador     TEXT,
  empresa      TEXT,
  comision_pct NUMERIC,
  servicios    BIGINT,
  bruto        NUMERIC,
  comision     NUMERIC,
  a_pagar      NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    ope.id,
    COALESCE(ope.full_name, 'Sin operador'),
    COALESCE(pr.name, 'Independiente'),
    COALESCE(pr.commission_rate, 20.00),
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    ROUND(COALESCE(SUM(sr.total_price), 0) * COALESCE(pr.commission_rate, 20.00) / 100, 2),
    COALESCE(SUM(sr.total_price), 0)
      - ROUND(COALESCE(SUM(sr.total_price), 0) * COALESCE(pr.commission_rate, 20.00) / 100, 2)
  FROM service_requests sr
  LEFT JOIN profiles ope  ON ope.id = sr.operator_id
  LEFT JOIN providers pr  ON pr.id = sr.provider_id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= p_from
    AND sr.completed_at < (p_to + 1)
  GROUP BY ope.id, ope.full_name, pr.name, pr.commission_rate
  ORDER BY 8 DESC;
END;
$$;

-- ---------------------------------------------------------------
-- 4. El detalle, para exportar y pagar
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_settlement_detail(p_from DATE, p_to DATE)
RETURNS TABLE (
  folio        TEXT,
  completado   TIMESTAMPTZ,
  servicio     TEXT,
  destinatario TEXT,
  operador     TEXT,
  comision_pct NUMERIC,
  bruto        NUMERIC,
  comision     NUMERIC,
  a_pagar      NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    COALESCE(pr.commission_rate, 20.00),
    COALESCE(sr.total_price, 0),
    ROUND(COALESCE(sr.total_price, 0) * COALESCE(pr.commission_rate, 20.00) / 100, 2),
    COALESCE(sr.total_price, 0)
      - ROUND(COALESCE(sr.total_price, 0) * COALESCE(pr.commission_rate, 20.00) / 100, 2)
  FROM service_requests sr
  LEFT JOIN cases c      ON c.request_id = sr.id
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= p_from
    AND sr.completed_at < (p_to + 1)
  ORDER BY sr.completed_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_settlement_by_provider(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_settlement_by_operator(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_settlement_detail(DATE, DATE)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_settlement_by_provider(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_settlement_by_operator(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_settlement_detail(DATE, DATE)      TO authenticated;

-- ---------------------------------------------------------------
-- 5. El bug que destapo la liquidacion: aceptar no guardaba la empresa
-- ---------------------------------------------------------------
-- `admin_assign_request` graba `service_requests.provider_id`, pero
-- `accept_service_request` no — y tomar del pool es el camino NORMAL. Resultado:
-- de 9 servicios completados, 7 no tenian empresa anotada, y tanto la
-- liquidacion como la tabla "por proveedor" de finanzas los daban como
-- independientes aunque el operador si pertenece a una empresa.
--
-- Se anota al aceptar, y no se resuelve despues leyendo el perfil, porque es una
-- FOTO del momento: si manana el operador cambia de empresa, la liquidacion de
-- un mes ya cerrado no puede moverse.
CREATE OR REPLACE FUNCTION public.accept_service_request(p_request_id uuid)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
  v_operator_role user_role;
  v_verif TEXT;
BEGIN
  -- 00059: testigo para el guardian de la maquina de estados.
  PERFORM set_config('app.sr_rpc', p_request_id::text, true);
  -- Verify operator role AND que este verificado. La puerta de verificacion
  -- (00038/00039) vivia SOLO en la UI (el boton se ocultaba con !verified),
  -- asi que un operador rechazado o sin enviar documentos podia aceptar
  -- servicios llamando esta RPC directo. En asistencia vial el operador va
  -- fisicamente donde un cliente varado: la identidad tiene que estar validada
  -- del lado del servidor, no del cliente.
  SELECT role, verification_status INTO v_operator_role, v_verif
    FROM profiles WHERE id = auth.uid();
  IF v_operator_role != 'OPERATOR' THEN
    RAISE EXCEPTION 'Only operators can accept requests';
  END IF;
  IF v_verif IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Tu cuenta de operador todavia no esta verificada';
  END IF;

  -- 00073: y que su empresa preste este servicio. El pool ya no se lo muestra,
  -- pero filtrar solo la lista seria un guard de fachada: esta RPC se puede
  -- llamar con cualquier id. Mismo criterio que la verificacion de arriba, que
  -- vivia en la UI hasta que la 00058 la bajo al servidor.
  IF NOT operator_can_serve(
       auth.uid(),
       (SELECT service_type FROM service_requests WHERE id = p_request_id)) THEN
    RAISE EXCEPTION 'Tu empresa no presta este tipo de servicio';
  END IF;

  -- Update request
  UPDATE service_requests
  SET
    operator_id = auth.uid(),
    -- 00079: se guarda tambien la empresa del operador. `admin_assign_request`
    -- ya lo hacia; esta no, y como tomar del pool es el camino NORMAL, casi
    -- ningun servicio quedaba atribuido a su proveedor.
    provider_id = (SELECT provider_id FROM profiles WHERE id = auth.uid()),
    status = 'assigned',
    assigned_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id
    AND status = 'initiated'
    AND operator_id IS NULL
  RETURNING * INTO v_request;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not available or already assigned';
  END IF;

  RETURN v_request;
END;
$function$;

-- Relleno de lo ya escrito. Ojo: usa la empresa ACTUAL del operador, que es lo
-- unico que se puede saber hoy — para las filas historicas es una aproximacion,
-- no un dato de archivo. De aca en adelante queda bien de origen.
UPDATE service_requests sr
   SET provider_id = p.provider_id
  FROM profiles p
 WHERE p.id = sr.operator_id
   AND sr.provider_id IS NULL
   AND p.provider_id IS NOT NULL;
