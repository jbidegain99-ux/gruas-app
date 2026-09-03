-- =====================================================
-- 00058 — Solo un operador VERIFICADO puede tomar servicios
--
-- EL BUG
-- La verificacion de operadores (00038/00039: DUI, licencia, tarjeta de
-- circulacion, revisadas por un admin) vivia SOLO en la app: la pantalla del
-- operador oculta el boton de aceptar con `!verified`. El backend nunca lo
-- comprobaba. `accept_service_request` solo exigia `role = 'OPERATOR'`, y
-- `get_available_requests_for_operator` igual.
--
-- VERIFICADO: un operador con `verification_status = 'rejected'` llamo a las dos
-- RPC directo (saltandose la UI) y vio el pool y ACEPTO un servicio.
--
-- POR QUE IMPORTA MAS QUE UN CONTROL COSMETICO CUALQUIERA
-- Es asistencia vial: al aceptar, el operador recibe la ubicacion en vivo de un
-- cliente muchas veces varado y solo, y se presenta fisicamente ahi. La
-- identidad del operador tiene que estar validada del lado del servidor antes de
-- darle un servicio; que baste con registrarse como OPERATOR (rol elegible en el
-- alta) para recibir asignaciones es justo lo que la verificacion venia a evitar.
--
-- EL ARREGLO
-- Las dos RPC exigen `verification_status = 'approved'`. `IS DISTINCT FROM` para
-- que un NULL (operador que nunca envio) tambien quede fuera. Reconstruidas por
-- SUSTITUCION EXACTA sobre `pg_get_functiondef`: el unico cambio es el chequeo.
--
-- ⚠ IMPACTO OPERATIVO (decision de Walter): esto FRENA a cualquier operador que
-- hoy trabaje sin estar 'approved', porque la puerta era cosmetica y pudo haber
-- operadores nunca verificados en produccion. Si los hay, hay que aprobarlos
-- (revision de documentos) antes de que puedan seguir. En local, operador1 ya
-- esta approved, asi que el flujo normal no cambia.
-- =====================================================

CREATE OR REPLACE FUNCTION public.accept_service_request(p_request_id uuid)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_request service_requests;
  v_operator_role user_role;
  v_verif TEXT;
BEGIN
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
$function$

;

CREATE OR REPLACE FUNCTION public.get_available_requests_for_operator()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    AND NOT EXISTS (
      SELECT 1 FROM request_events re
      WHERE re.request_id = sr.id
        AND re.actor_id = auth.uid()
        AND re.event_type = 'OPERATOR_CANCELLED'
    );

  RETURN COALESCE(v_requests, '[]'::jsonb);
END;
$function$

;
