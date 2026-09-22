-- 00028_admin_assign_request.sql
-- Permite que un ADMIN asigne (o reasigne) una solicitud a un operador concreto.
-- Antes solo existia admin_cancel_request; no habia forma de asignar desde el
-- panel admin. Este RPC es SECURITY DEFINER para saltar RLS de forma controlada.

CREATE OR REPLACE FUNCTION public.admin_assign_request(
  p_request_id uuid,
  p_operator_id uuid
)
RETURNS service_requests
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request service_requests;
  v_operator_role user_role;
  v_operator_provider uuid;
BEGIN
  -- Solo un admin puede asignar
  IF NOT public.is_admin() THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.admin_assign_request(uuid, uuid) TO authenticated;
