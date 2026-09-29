-- =====================================================
-- 00112 — Soporte no podia asignar (hallado por la bateria pnpm qa:cycle)
--
-- La 00104 le abrio admin_assign_request a SUPPORT, pero el guardian de
-- transiciones de estado (00059) solo deja pasar un cambio de estado si quien
-- lo hace es admin o si la RPC dejo su "testigo" (app.sr_rpc). A
-- admin_cancel_request se le agrego el testigo en la 00104; a esta no. Para
-- el admin funcionaba (pasa por is_admin), para soporte fallaba con
-- "Transicion de estado initiated -> assigned no permitida".
-- =====================================================

CREATE OR REPLACE FUNCTION public.admin_assign_request(p_request_id uuid, p_operator_id uuid)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
  v_operator_role user_role;
  v_operator_provider uuid;
BEGIN
  -- Solo un admin puede asignar
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Only admins can assign requests';
  END IF;

  -- El operador destino debe existir y tener rol OPERATOR
  SELECT role, provider_id INTO v_operator_role, v_operator_provider
  FROM profiles
  WHERE id = p_operator_id;

  IF v_operator_role IS NULL THEN
    RAISE EXCEPTION 'Operator not found';
  END IF;

  IF v_operator_role != 'OPERATOR' THEN
    RAISE EXCEPTION 'Target user is not an operator';
  END IF;

  -- 00098: ni el admin cruza la flota del MOPT con la privada.
  IF NOT operator_fits_program(
       p_operator_id,
       (SELECT mopt_provider_id FROM service_requests WHERE id = p_request_id)) THEN
    RAISE EXCEPTION 'Ese socio operador no pertenece al programa de este servicio';
  END IF;

  -- 00112: testigo del guardian de estados (00059). Soporte no pasa por
  -- is_admin(), y sin esto el guardian rechazaba su asignacion.
  PERFORM set_config('app.sr_rpc', p_request_id::text, true);

  -- Asignar. Se permite reasignar mientras la solicitud no este activada,
  -- completada o cancelada (una vez activa hay un PIN verificado en curso).
  UPDATE service_requests
  SET
    operator_id = p_operator_id,
    provider_id = v_operator_provider,
    status = 'assigned',
    assigned_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id
    AND status IN ('initiated', 'assigned', 'en_route')
  RETURNING * INTO v_request;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found or not in an assignable state';
  END IF;

  RETURN v_request;
END;
$function$;
