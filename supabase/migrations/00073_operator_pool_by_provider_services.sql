-- =====================================================
-- 00073 — Al operador solo le llegan los servicios que su empresa presta
--
-- La 00022 creo `provider_services` —que servicios presta cada empresa— y la
-- 00048 le agrego a `providers` el `business_type`. El admin las edita en
-- /admin/proveedores desde entonces. Pero NADIE las leia: `provider_services`
-- se usaba unicamente para pintar esa misma pantalla. Configuracion guardada
-- que no manda sobre nada.
--
-- El efecto se nota apenas el catalogo deja de ser solo grúas: el pool
-- (`get_available_requests_for_operator`) devolvia TODAS las solicitudes en
-- 'initiated' a TODOS los operadores aprobados. Un operario de un taller
-- mecanico veia —y podia aceptar— un remolque o una cerrajeria.
--
-- FALLA ABIERTA, A PROPOSITO
-- Hoy ninguna empresa tiene servicios configurados, asi que un filtro estricto
-- dejaria a todos los operadores sin ver nada y las solicitudes sin atender.
-- Por eso el filtro solo aplica cuando hay algo que aplicar: sin empresa, o con
-- una empresa que no declaro ningun servicio, se ve todo como hasta ahora. En
-- cuanto el admin tilda el primer servicio, la empresa pasa a filtrarse. El
-- criterio es el mismo de la cobertura (00047): ante la duda el servicio sigue,
-- porque dejar a alguien varado es peor que ofrecerle un trabajo de mas a un
-- operador.
--
-- Se arregla ademas un bug que salio al mirar esto: el pool no devolvia
-- `service_type`, pero la pantalla del operador lo lee
-- (`apps/mobile/app/(operator)/index.tsx`), asi que caia siempre en su valor por
-- defecto y TODA solicitud disponible se mostraba como "Grúa".
-- =====================================================

-- ---------------------------------------------------------------
-- 1. La regla, en un solo lugar
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_can_serve(
  p_operator     UUID,
  p_service_type TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH empresa AS (
    SELECT provider_id FROM profiles WHERE id = p_operator
  ),
  declarados AS (
    SELECT s.slug
      FROM provider_services ps
      JOIN services s ON s.id = ps.service_id
     WHERE ps.provider_id = (SELECT provider_id FROM empresa)
       AND ps.is_available
       AND s.is_active
  )
  SELECT
    -- Operador sin empresa: no hay catalogo contra que contrastar.
    (SELECT provider_id FROM empresa) IS NULL
    -- Empresa que todavia no declaro nada: se comporta como antes.
    OR NOT EXISTS (SELECT 1 FROM declarados)
    -- `service_type` es NULL en solicitudes anteriores a la columna; esas eran
    -- todas grúas, la misma convencion que usa `requiresDropoff` en el front.
    OR COALESCE(p_service_type, 'tow') IN (SELECT slug FROM declarados);
$$;

COMMENT ON FUNCTION public.operator_can_serve(UUID, TEXT) IS
  '¿La empresa de este operador presta este tipo de servicio? Falla abierta: '
  'sin empresa o sin servicios declarados devuelve true. Ver migr. 00073.';

REVOKE ALL ON FUNCTION public.operator_can_serve(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_can_serve(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------
-- 2. El pool filtra, y ademas dice de que servicio se trata
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_available_requests_for_operator()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_requests JSONB;
BEGIN
  -- Verify caller is operator
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'OPERATOR'
      AND verification_status = 'approved'   -- 00058: mismo gate que accept
  ) THEN
    RAISE EXCEPTION 'Only operators can view available requests';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', sr.id,
      'pickup_lat', sr.pickup_lat,
      'pickup_lng', sr.pickup_lng,
      'pickup_address', sr.pickup_address,
      'dropoff_lat', sr.dropoff_lat,
      'dropoff_lng', sr.dropoff_lng,
      'dropoff_address', sr.dropoff_address,
      'service_type', COALESCE(sr.service_type, 'tow'),
      'tow_type', sr.tow_type,
      'incident_type', sr.incident_type,
      'created_at', sr.created_at,
      'user_name', p.full_name,
      'user_phone', p.phone
    ) ORDER BY sr.created_at ASC
  ) INTO v_requests
  FROM service_requests sr
  JOIN profiles p ON p.id = sr.user_id
  WHERE sr.status = 'initiated'
    -- 00073: solo lo que la empresa del operador declara prestar.
    AND operator_can_serve(auth.uid(), sr.service_type)
    AND NOT EXISTS (
      SELECT 1 FROM request_events re
      WHERE re.request_id = sr.id
        AND re.actor_id = auth.uid()
        AND re.event_type = 'OPERATOR_CANCELLED'
    );

  RETURN COALESCE(v_requests, '[]'::jsonb);
END;
$function$;

-- ---------------------------------------------------------------
-- 3. Y aceptar tambien lo exige
-- ---------------------------------------------------------------
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
