-- =====================================================
-- 00077 — `rate_service` valida las estrellas antes de insertar
--
-- Salio de probar la RPC directamente con `p_stars = 9`: en vez del
-- {success:false, error:...} que devuelve el resto de la funcion, salia la
-- excepcion cruda de la tabla —
--     ERROR: new row for relation "ratings" violates check constraint
--            "ratings_stars_check"
-- El CHECK hacia su trabajo y el dato malo nunca entro, asi que no habia
-- corrupcion. Lo que rompia era el contrato: esta es una RPC que cualquier
-- autenticado puede llamar directo, y era la unica de las probadas que filtraba
-- un error de base al cliente en vez de un mensaje propio.
--
-- Desde la app no se dispara —el selector es de 1 a 5 estrellas— pero la barrera
-- no puede vivir solo en la UI, que es la leccion que ya dejaron la 00058
-- (verificacion del operador) y la 00073.
-- =====================================================
CREATE OR REPLACE FUNCTION public.rate_service(p_request_id uuid, p_stars integer, p_comment text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_rating ratings;
  v_request service_requests;
BEGIN
  -- La validacion va PRIMERO, antes de tocar la solicitud: es lo unico que se
  -- sabe sin consultar nada, y asi un valor fuera de rango no llega al INSERT.
  -- Sin esto lo frenaba el CHECK de la tabla (stars BETWEEN 1 AND 5), pero como
  -- excepcion cruda de Postgres: el resto de esta funcion devuelve
  -- {success:false,error:...} y ese caso rompia el contrato justo en la RPC que
  -- cualquiera puede llamar directo.
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RETURN json_build_object('success', false, 'error', 'La calificacion debe ser de 1 a 5 estrellas');
  END IF;

  -- Get request and verify ownership
  SELECT * INTO v_request FROM service_requests
  WHERE id = p_request_id AND user_id = auth.uid() AND status = 'completed';

  IF v_request IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Request not found or not eligible for rating');
  END IF;

  IF v_request.operator_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No operator assigned to this request');
  END IF;

  -- Create or update rating
  INSERT INTO ratings (request_id, rater_user_id, rated_operator_id, stars, comment)
  VALUES (p_request_id, auth.uid(), v_request.operator_id, p_stars, p_comment)
  ON CONFLICT (request_id)
  DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment
  RETURNING * INTO v_rating;

  RETURN json_build_object('success', true, 'rating_id', v_rating.id);
END;
$function$;
