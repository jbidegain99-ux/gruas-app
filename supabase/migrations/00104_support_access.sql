-- =====================================================
-- 00104 — Que puede ver y hacer el rol SUPPORT
--
-- Alcance decidido por Walter (2026-09-28):
--   VE    la operacion: solicitudes (folio, linea de tiempo, SLA), flota,
--         usuarios, proveedores (sin comision), verificaciones, calificaciones.
--   NO VE dinero ni configuracion: finanzas, cuentas, tarifas, precios,
--         aseguradoras/polizas/padron, bitacora, DUI de los usuarios.
--   HACE  despacho (asignar/reasignar, sugerir el mas cercano), cancelar
--         solicitudes y revisar verificaciones de operadores.
--
-- Como queda contenido (la leccion del spec de TalentOS, traducida):
-- * Todo lo del admin esta guardado por is_admin(), que para SUPPORT es false.
--   El rol nace SIN acceso a nada y solo alcanza lo que esta migracion le abre
--   de forma explicita, con is_support()/is_staff(). Fallar cerrado.
-- * Una funcion o politica nueva que mencione is_staff()/is_support() tiene
--   que agregarse a la lista blanca de supabase/tests/support_role.sql, o el
--   test falla: nadie le abre algo a soporte sin decidirlo.
--
-- De paso se cierran tres agujeros hallados al revisar las RPCs de despacho:
-- * admin_cancel_request comparaba `rol != 'ADMIN'`: sin sesion el rol es NULL,
--   la comparacion da NULL y el IF no dispara. Cualquiera con la anon key
--   cancelaba cualquier servicio —incluso uno COMPLETADO, que asi desaparecia
--   del libro de movimientos—.
-- * cancel_service_request solo miraba los permisos de USER y OPERATOR:
--   sin sesion, o con rol INSURER/MOPT, cancelaba cualquier servicio activo.
-- * create_request_event dejaba a cualquiera (incluso sin sesion) escribir
--   eventos en la linea de tiempo de un servicio ajeno, que es lo que ve la
--   aseguradora en su portal. Ninguna app la usa: se cierra.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------
-- ::text y no el literal del enum: el valor nuevo no se puede usar desde una
-- funcion de la misma transaccion en que se agrego (ver 00097).
CREATE OR REPLACE FUNCTION public.is_support()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN COALESCE(auth_user_role()::text = 'SUPPORT', false);
END;
$$;

-- Admin o soporte: el "personal de Budi". Solo para lo que se decidio abrir a
-- los dos; toda escritura de configuracion sigue en is_admin().
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN is_admin() OR is_support();
END;
$$;

REVOKE ALL ON FUNCTION public.is_support() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
-- Las politicas corren con los permisos de quien consulta.
GRANT EXECUTE ON FUNCTION public.is_support() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- ---------------------------------------------------------------
-- 2. Lecturas de soporte (solo SELECT)
-- ---------------------------------------------------------------
-- Politicas nuevas en vez de tocar las del admin: las del admin son FOR ALL
-- (leer Y escribir), y cambiarlas a is_staff() le abriria las escrituras.

DROP POLICY IF EXISTS "support: lee solicitudes" ON public.service_requests;
CREATE POLICY "support: lee solicitudes" ON public.service_requests
  FOR SELECT TO authenticated USING (is_support());

DROP POLICY IF EXISTS "support: lee perfiles" ON public.profiles;
CREATE POLICY "support: lee perfiles" ON public.profiles
  FOR SELECT TO authenticated USING (is_support());

DROP POLICY IF EXISTS "support: lee casos" ON public.cases;
CREATE POLICY "support: lee casos" ON public.cases
  FOR SELECT TO authenticated USING (is_support());

DROP POLICY IF EXISTS "support: lee ubicaciones" ON public.operator_locations;
CREATE POLICY "support: lee ubicaciones" ON public.operator_locations
  FOR SELECT TO authenticated USING (is_support());

DROP POLICY IF EXISTS "support: lee calificaciones" ON public.ratings;
CREATE POLICY "support: lee calificaciones" ON public.ratings
  FOR SELECT TO authenticated USING (is_support());

-- Incluye los inactivos: la pantalla de proveedores los lista. La comision no
-- esta en esta tabla (00089/00102), asi que no se filtra nada de dinero.
DROP POLICY IF EXISTS "support: lee proveedores" ON public.providers;
CREATE POLICY "support: lee proveedores" ON public.providers
  FOR SELECT TO authenticated USING (is_support());

DROP POLICY IF EXISTS "support: lee servicios de proveedor" ON public.provider_services;
CREATE POLICY "support: lee servicios de proveedor" ON public.provider_services
  FOR SELECT TO authenticated USING (is_support());

DROP POLICY IF EXISTS "support: lee catalogo" ON public.services;
CREATE POLICY "support: lee catalogo" ON public.services
  FOR SELECT TO authenticated USING (is_support());

-- Verificaciones: los documentos de los OPERADORES, no los de cualquier usuario.
DROP POLICY IF EXISTS "support: lee documentos de operador" ON public.operator_documents;
CREATE POLICY "support: lee documentos de operador" ON public.operator_documents
  FOR SELECT TO authenticated USING (is_support());

-- En Storage, solo los archivos que un operador presento para su verificacion.
-- El bucket id-documents tambien guarda el DUI de los clientes, y eso soporte
-- no lo ve (el admin si, por su propia politica).
DROP POLICY IF EXISTS "support: lee archivos de verificacion" ON storage.objects;
CREATE POLICY "support: lee archivos de verificacion" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('id-documents', 'vehicle-documents')
    AND is_support()
    AND EXISTS (
      SELECT 1 FROM public.operator_documents od
       WHERE od.bucket = storage.objects.bucket_id
         AND od.path = storage.objects.name
    )
  );

-- ---------------------------------------------------------------
-- 3. Cancelar: los dos agujeros, y soporte adentro
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cancel_request(p_request_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
BEGIN
  -- is_staff() y no `rol != 'ADMIN'`: con el rol en NULL (sin sesion) aquella
  -- comparacion daba NULL y dejaba pasar a cualquiera.
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el personal de Budi puede forzar una cancelacion';
  END IF;

  SELECT * INTO v_request FROM service_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  -- Un servicio completado ya genero deudas y pagos en el libro (00099):
  -- cancelarlo lo borraria de ahi en silencio.
  IF v_request.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Esta solicitud ya esta cerrada y no se puede cancelar';
  END IF;

  -- Testigo del guardian de estados (00059): soporte no pasa por is_admin().
  PERFORM set_config('app.sr_rpc', p_request_id::text, true);

  UPDATE service_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = auth.uid(),
    cancellation_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_cancel_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_request(uuid, text) TO authenticated;

-- ---------------------------------------------------------------
-- 4. create_request_event: fuera del alcance del cliente
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_request_event(uuid, event_type, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- 5. Defensa en profundidad: ninguna RPC de admin para `anon`
-- ---------------------------------------------------------------
-- Todas tienen su guard, pero el de admin_cancel_request demostro que un guard
-- mal escrito con NULL deja pasar. Sin sesion no hay nada que hacer aca.
REVOKE ALL ON FUNCTION public.admin_assign_request(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_operator_verification(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_user_role(uuid, user_role, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_nearest_operator(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_active_pricing_rule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_request(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_operator_verification(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(uuid, user_role, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_nearest_operator(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_pricing_rule(uuid) TO authenticated;
-- La 00102 la hizo SECURITY DEFINER y conservaba el EXECUTE de PUBLIC: la
-- comision de plataforma quedaba legible sin sesion. Solo la usan otras
-- funciones del servidor.
REVOKE ALL ON FUNCTION public.default_commission_rate() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- 6. cancel_service_request: solo quien corresponde
-- ---------------------------------------------------------------
-- Solo miraba USER y OPERATOR: sin sesion (rol NULL) o con cualquier otro rol
-- (INSURER, MOPT) pasaba de largo y cancelaba el servicio de otro. Ahora un
-- rol que no es parte del servicio ni personal de Budi no llega al UPDATE.

CREATE OR REPLACE FUNCTION public.cancel_service_request(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
  v_user_id UUID;
  v_user_role user_role;
  v_event_type event_type;
BEGIN
  -- 00059: testigo para el guardian de la maquina de estados.
  PERFORM set_config('app.sr_rpc', p_request_id::text, true);
  v_user_id := auth.uid();

  -- Get user role
  SELECT role INTO v_user_role FROM profiles WHERE id = v_user_id;

  IF v_user_id IS NULL OR v_user_role IS NULL
     OR v_user_role::text NOT IN ('USER', 'OPERATOR', 'ADMIN', 'SUPPORT') THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

  -- Get the request
  SELECT * INTO v_request FROM service_requests WHERE id = p_request_id;

  IF v_request IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitud no encontrada');
  END IF;

  -- Check if request can be cancelled
  IF v_request.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta solicitud ya no puede ser cancelada');
  END IF;

  -- Verify user has permission to cancel
  IF v_user_role = 'USER' AND v_request.user_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

  IF v_user_role = 'OPERATOR' AND v_request.operator_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

  -- ==========================================================
  -- OPERADOR cancela -> liberar la solicitud de vuelta al pool
  -- ==========================================================
  IF v_user_role = 'OPERATOR' THEN
    -- Auditoria PRIMERO: queda constancia de quien la solto y por que.
    -- Debe ir ANTES del UPDATE porque el trigger de 00037
    -- (notify_operators_pool_request) dispara en ese UPDATE y consulta este
    -- evento para NO re-ofrecerle la solicitud al operador que la acaba de
    -- soltar. Tambien la usa get_available_requests_for_operator.
    INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
    VALUES (
      p_request_id,
      v_user_id,
      v_user_role,
      'OPERATOR_CANCELLED'::event_type,
      jsonb_build_object('reason', p_reason, 'released_to_pool', true)
    );

    UPDATE service_requests
    SET
      status = 'initiated',
      operator_id = NULL,
      assigned_at = NULL,
      activated_at = NULL,
      route_polyline = NULL,      -- la ruta era del operador saliente
      updated_at = NOW()
    WHERE id = p_request_id;

    -- El trigger de notificaciones (00018) no cubre 'cancelled'->'initiated',
    -- asi que encolamos la push al usuario directamente aqui.
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      v_request.user_id,
      'Buscando otro operador',
      'El operador no pudo atender tu servicio. Tu solicitud sigue activa y estamos buscando otro operador.',
      jsonb_build_object(
        'type', 'service_reassigning',
        'service_request_id', p_request_id,
        'role', 'user'
      ),
      NOW()
    );

    RETURN jsonb_build_object(
      'success', true,
      'released', true,
      'message', 'Servicio liberado. La solicitud volvera a ofrecerse a otros operadores.'
    );
  END IF;

  -- ==========================================================
  -- USER / ADMIN cancelan -> cancelacion terminal (como antes)
  -- ==========================================================
  v_event_type := CASE
    WHEN v_user_role::text IN ('ADMIN', 'SUPPORT') THEN 'ADMIN_CANCELLED'::event_type
    ELSE 'USER_CANCELLED'::event_type
  END;

  UPDATE service_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = v_user_id,
    cancellation_reason = p_reason
  WHERE id = p_request_id;

  -- Sin INSERT de auditoria: lo emite el trigger log_service_request_changes al
  -- ver el cambio a 'cancelled', ya con el motivo. El INSERT que habia aca
  -- duplicaba ese evento. `v_event_type` se conserva porque el trigger resuelve
  -- el mismo tipo (USER_/ADMIN_CANCELLED) desde el rol de quien llama.

  RETURN jsonb_build_object('success', true, 'message', 'Solicitud cancelada exitosamente');
END;
$function$
;


-- ---------------------------------------------------------------
-- 7. Registro de cancelaciones: soporte no es "el cliente"
-- ---------------------------------------------------------------
-- Una cancelacion de soporte caia en la rama por defecto y quedaba como
-- USER_CANCELLED ("Cancelado por el cliente") en la linea de tiempo que ve la
-- aseguradora.

CREATE OR REPLACE FUNCTION public.log_service_request_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Log status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
    SELECT
      NEW.id,
      COALESCE(auth.uid(), NEW.user_id),
      COALESCE(
        (SELECT role FROM profiles WHERE id = auth.uid()),
        'USER'
      ),
      CASE
        WHEN NEW.status = 'assigned' THEN 'OPERATOR_ACCEPTED'::event_type
        WHEN NEW.status = 'en_route' THEN 'OPERATOR_EN_ROUTE'::event_type
        WHEN NEW.status = 'active' THEN 'PIN_VERIFIED'::event_type
        WHEN NEW.status = 'completed' THEN 'STATUS_CHANGED'::event_type
        WHEN NEW.status = 'cancelled' AND (SELECT role::text FROM profiles WHERE id = auth.uid()) IN ('ADMIN', 'SUPPORT') THEN 'ADMIN_CANCELLED'::event_type
        WHEN NEW.status = 'cancelled' AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'OPERATOR' THEN 'OPERATOR_CANCELLED'::event_type
        WHEN NEW.status = 'cancelled' THEN 'USER_CANCELLED'::event_type
        ELSE 'STATUS_CHANGED'::event_type
      END,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      )
      -- Al cancelar, el trigger absorbe lo que antes ponia el INSERT explicito
      -- de cancel_service_request: el motivo y quien cancelo. Sin esto, quitar
      -- aquel INSERT dejaria la linea de tiempo sin el "por que".
      || CASE WHEN NEW.status = 'cancelled' THEN jsonb_build_object(
              'reason', NEW.cancellation_reason,
              'cancelled_by_role', COALESCE(
                (SELECT role FROM profiles WHERE id = auth.uid())::text, 'USER')
           ) ELSE '{}'::jsonb END;
  END IF;

  -- Log price computation
  IF OLD.total_price IS NULL AND NEW.total_price IS NOT NULL THEN
    INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
    SELECT
      NEW.id,
      COALESCE(auth.uid(), NEW.operator_id),
      COALESCE(
        (SELECT role FROM profiles WHERE id = auth.uid()),
        'OPERATOR'
      ),
      'PRICE_COMPUTED'::event_type,
      NEW.price_breakdown;
  END IF;

  RETURN NEW;
END;
$function$
;


-- ---------------------------------------------------------------
-- 8. RPCs de despacho, verificacion y caso: abiertas a soporte
-- ---------------------------------------------------------------

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
    RAISE EXCEPTION 'Ese operador no pertenece al programa de este servicio';
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
$function$
;


CREATE OR REPLACE FUNCTION public.suggest_nearest_operators(p_request_id uuid, p_limit integer DEFAULT 3)
 RETURNS TABLE(operator_id uuid, full_name text, provider_name text, distance_km numeric, last_seen timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_service_type TEXT;
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver sugerencias de despacho';
  END IF;

  SELECT pickup_lat, pickup_lng, service_type INTO v_lat, v_lng, v_service_type
    FROM service_requests WHERE id = p_request_id;

  IF v_lat IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada o sin ubicación';
  END IF;

  RETURN QUERY
  SELECT
    ol.operator_id,
    p.full_name,
    prov.name AS provider_name,
    ROUND((6371 * acos(LEAST(1, GREATEST(-1,
      cos(radians(v_lat)) * cos(radians(ol.lat)) *
        cos(radians(ol.lng) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(ol.lat))
    ))))::numeric, 2) AS distance_km,
    ol.updated_at AS last_seen
  FROM operator_locations ol
  JOIN profiles p ON p.id = ol.operator_id
    AND p.role = 'OPERATOR'
    AND p.verification_status = 'approved'
  LEFT JOIN providers prov ON prov.id = p.provider_id
  WHERE ol.is_online = true
    AND ol.updated_at > NOW() - INTERVAL '5 minutes'
    -- 00074: no proponer a quien no presta este servicio.
    AND operator_can_serve(ol.operator_id, v_service_type)
    -- 00098: flota cerrada del MOPT.
    AND operator_fits_program(ol.operator_id, (SELECT mopt_provider_id FROM service_requests WHERE id = p_request_id))
    AND NOT EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.operator_id = ol.operator_id
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  ORDER BY distance_km ASC
  LIMIT GREATEST(1, p_limit);
END;
$function$
;


CREATE OR REPLACE FUNCTION public.admin_set_operator_verification(p_operator_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Only admins can verify operators';
  END IF;
  IF p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid verification status';
  END IF;

  UPDATE public.profiles
  SET verification_status = p_status,
      verification_reviewed_at = now(),
      verification_reviewed_by = auth.uid(),
      verification_rejection_reason =
        CASE WHEN p_status = 'rejected' THEN p_reason ELSE NULL END
  WHERE id = p_operator_id AND role = 'OPERATOR';

  -- Aviso al operador cuando se resuelve su verificación.
  IF p_status IN ('approved', 'rejected') THEN
    INSERT INTO notification_queue (user_id, title, body, data, created_at)
    VALUES (
      p_operator_id,
      CASE WHEN p_status = 'approved' THEN 'Cuenta verificada' ELSE 'Verificación rechazada' END,
      CASE WHEN p_status = 'approved'
        THEN 'Tu cuenta fue aprobada. Ya puedes ponerte en línea y recibir solicitudes.'
        ELSE 'Tu verificación fue rechazada. Revisa el motivo y vuelve a enviar tus documentos.'
      END,
      jsonb_build_object('type', 'verification_result', 'status', p_status, 'role', 'operator'),
      now()
    );
  END IF;
END;
$function$
;


CREATE OR REPLACE FUNCTION public.get_case_sla(p_folio text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sr           service_requests;
  v_insurer_name TEXT;
  v_asig_target  INT := 10;
  v_lleg_target  INT := 45;
  v_asig_secs    NUMERIC;
  v_lleg_secs    NUMERIC;
  v_serv_secs    NUMERIC;
BEGIN
  SELECT sr.* INTO v_sr
    FROM cases c JOIN service_requests sr ON sr.id = c.request_id
   WHERE c.folio = p_folio;

  IF v_sr.id IS NULL THEN
    RAISE EXCEPTION 'Caso no encontrado';
  END IF;

  IF NOT is_staff()
     AND auth.uid() IS DISTINCT FROM v_sr.user_id
     AND auth.uid() IS DISTINCT FROM v_sr.operator_id
     AND NOT request_belongs_to_my_insurer(v_sr.id)
     AND NOT request_belongs_to_my_mopt(v_sr.id) THEN  -- 00100
    RAISE EXCEPTION 'No tenes acceso a este caso';
  END IF;

  SELECT i.name, i.sla_assignment_minutes, i.sla_arrival_minutes
    INTO v_insurer_name, v_asig_target, v_lleg_target
    FROM coverage_usage cu
    JOIN members m   ON m.id = cu.member_id
    JOIN policies p  ON p.id = m.policy_id
    JOIN insurers i  ON i.id = p.insurer_id
   WHERE cu.request_id = v_sr.id
   LIMIT 1;

  v_asig_target := COALESCE(v_asig_target, 10);
  v_lleg_target := COALESCE(v_lleg_target, 45);

  v_asig_secs := EXTRACT(EPOCH FROM (v_sr.assigned_at  - v_sr.created_at));
  v_lleg_secs := EXTRACT(EPOCH FROM (v_sr.activated_at - v_sr.assigned_at));
  v_serv_secs := EXTRACT(EPOCH FROM (v_sr.completed_at - v_sr.activated_at));

  RETURN jsonb_build_object(
    'folio', p_folio,
    'insurer_name', v_insurer_name,
    'assignment_seconds', v_asig_secs,
    'arrival_seconds',    v_lleg_secs,
    'service_seconds',    v_serv_secs,
    'assignment_target_minutes', v_asig_target,
    'arrival_target_minutes',    v_lleg_target,
    'assignment_met', CASE WHEN v_asig_secs IS NULL THEN NULL
                           ELSE v_asig_secs <= v_asig_target * 60 END,
    'arrival_met',    CASE WHEN v_lleg_secs IS NULL THEN NULL
                           ELSE v_lleg_secs <= v_lleg_target * 60 END
  );
END;
$function$
;


CREATE OR REPLACE FUNCTION public.get_case_timeline(p_folio text)
 RETURNS TABLE(at timestamp with time zone, event_type text, label text, actor_role text, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id UUID;
  v_user_id    UUID;
  v_operator   UUID;
BEGIN
  SELECT c.request_id, sr.user_id, sr.operator_id
    INTO v_request_id, v_user_id, v_operator
    FROM cases c JOIN service_requests sr ON sr.id = c.request_id
   WHERE c.folio = p_folio;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'Caso no encontrado';
  END IF;

  IF NOT is_staff()
     AND auth.uid() IS DISTINCT FROM v_user_id
     AND auth.uid() IS DISTINCT FROM v_operator
     AND NOT request_belongs_to_my_insurer(v_request_id)
     AND NOT request_belongs_to_my_mopt(v_request_id) THEN  -- 00100
    RAISE EXCEPTION 'No tenes acceso a este caso';
  END IF;

  RETURN QUERY
  SELECT
    re.created_at,
    re.event_type::text,
    CASE re.event_type
      WHEN 'REQUEST_CREATED'      THEN 'Solicitud creada'
      WHEN 'COVERAGE_CHECKED'     THEN 'Cobertura verificada'
      WHEN 'OPERATOR_ACCEPTED'    THEN 'Operador asignado'
      WHEN 'OPERATOR_EN_ROUTE'    THEN 'Operador en camino'
      WHEN 'PIN_VERIFIED'         THEN 'PIN verificado (el operador llegó)'
      WHEN 'PRICE_COMPUTED'       THEN 'Precio calculado'
      WHEN 'PRICE_DISTANCE_CAPPED' THEN 'Distancia ajustada al máximo razonable'
      WHEN 'STATUS_CHANGED'       THEN 'Cambio de estado'
      WHEN 'MESSAGE_SENT'         THEN 'Mensaje en el chat'
      WHEN 'RATING_SUBMITTED'     THEN 'Calificación enviada'
      WHEN 'USER_CANCELLED'       THEN 'Cancelado por el cliente'
      WHEN 'OPERATOR_CANCELLED'   THEN 'El operador liberó el servicio'
      WHEN 'ADMIN_CANCELLED'      THEN 'Cancelado por Budi (soporte o administración)'
      ELSE re.event_type::text
    END AS label,
    re.actor_role::text,
    COALESCE(
      re.payload->>'reason',
      re.payload->>'new_status',
      CASE WHEN re.event_type = 'PRICE_COMPUTED' THEN
             CASE
               -- Se formatea solo si de verdad es un numero. El cast a secas
               -- lanzaba, y como esto es una funcion que devuelve la linea de
               -- tiempo entera, un payload malformado no se comia una fila: se
               -- comia el caso completo en el portal.
               WHEN re.payload->>'total' ~ '^-?[0-9]+(\.[0-9]+)?$'
                 THEN '$' || to_char((re.payload->>'total')::NUMERIC, 'FM999999990.00')
               -- Si no lo es, se muestra crudo antes que perderlo.
               ELSE COALESCE('$' || (re.payload->>'total'), '?')
             END
           END,
      CASE WHEN re.event_type = 'COVERAGE_CHECKED'
           THEN COALESCE(re.payload->>'coverage_status', re.payload->>'status') END
    ) AS detail
  FROM request_events re
  WHERE re.request_id = v_request_id
  ORDER BY re.created_at ASC,
    CASE re.event_type
      WHEN 'REQUEST_CREATED'       THEN 1
      WHEN 'COVERAGE_CHECKED'      THEN 2
      WHEN 'OPERATOR_ACCEPTED'     THEN 3
      WHEN 'OPERATOR_EN_ROUTE'     THEN 4
      WHEN 'PIN_VERIFIED'          THEN 5
      WHEN 'PRICE_DISTANCE_CAPPED' THEN 6
      WHEN 'PRICE_COMPUTED'        THEN 7
      WHEN 'STATUS_CHANGED'        THEN 8
      WHEN 'USER_CANCELLED'        THEN 9
      WHEN 'OPERATOR_CANCELLED'    THEN 9
      WHEN 'ADMIN_CANCELLED'       THEN 9
      WHEN 'RATING_SUBMITTED'      THEN 10
      ELSE 50
    END ASC,
    re.id ASC;
END;
$function$
;

