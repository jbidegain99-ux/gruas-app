-- =====================================================================
-- 00163 — Un socio, un servicio a la vez (también en el servidor)
--
-- La app le dice al socio "Tienes un servicio en curso. Complétalo antes de
-- aceptar uno nuevo" y le oculta el pool, pero accept_service_request nunca lo
-- revisaba: llamando la RPC (o con dos aceptaciones al mismo tiempo) un socio
-- se quedaba con varios servicios a la vez y los Usuarios esperaban a alguien
-- que no iba a llegar. En la prueba de simultaneidad pasó en 8 de 8 rondas.
--
-- Ahora la aceptación se serializa por socio (advisory lock) y se rechaza si
-- ya tiene un servicio asignado, en camino o activo. La asignación manual del
-- despacho (admin_assign_request) no cambia: forzarla es a propósito (00074).
-- El resto de la función, igual que antes.
-- =====================================================================

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
    RAISE EXCEPTION 'Tu cuenta de socio operador todavía no está verificada';
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

  -- 00098: flota cerrada del MOPT. Mismo criterio: no alcanza con filtrar el pool.
  IF NOT operator_fits_program(
       auth.uid(),
       (SELECT mopt_provider_id FROM service_requests WHERE id = p_request_id)) THEN
    RAISE EXCEPTION 'Este servicio corresponde a otro programa';
  END IF;

  -- 00163: un servicio a la vez. El lock por socio hace que dos aceptaciones
  -- simultáneas se esperen en vez de pasar las dos el chequeo.
  PERFORM pg_advisory_xact_lock(hashtext('accept_service_request:' || auth.uid()::text));
  IF EXISTS (SELECT 1 FROM service_requests
              WHERE operator_id = auth.uid() AND status IN ('assigned', 'en_route', 'active')) THEN
    RAISE EXCEPTION 'Ya tienes un servicio en curso. Complétalo antes de aceptar uno nuevo.';
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

  v_request.pin_hash := NULL;  -- 00092: no filtrar el hash del PIN
  RETURN v_request;
END;
$function$;
