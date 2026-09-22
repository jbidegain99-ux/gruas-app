-- 00092: dejar de filtrar el hash del PIN al operador.
--
-- `accept_service_request` y `complete_service_request` son SECURITY DEFINER y
-- devuelven `RETURNS service_requests`, o sea la FILA ENTERA — con `pin_hash`.
-- Al ser SECURITY DEFINER el resultado NO pasa por el grant de columna que la
-- 00057 le puso a `pin_hash` (revocado a authenticated), asi que el operador que
-- acepta una solicitud recibe el hash en la respuesta de la RPC. Medido: el hash
-- es bcrypt cost 6 sobre un PIN de 4 digitos; el espacio completo (10000) se
-- recorre en ~33 s y devuelve el PIN en claro.
--
-- Por que importa: el PIN es la prueba de que el operador llego FISICAMENTE
-- donde el cliente varado. Con el PIN en mano el operador marca "ya llegue" sin
-- haber llegado, que es exactamente lo que el PIN existe para impedir. Es la
-- misma clase de fuga que la 00057 cerro por REST, reaparecida por la puerta de
-- las RPC que retornan la fila completa.
--
-- Arreglo minimo y sin cambiar el shape: blanquear `pin_hash` en la fila de
-- retorno. Ninguna app usa ese campo de la respuesta (solo miran `error`), y el
-- unico consumidor legitimo del hash, `verify_request_pin`, lee la tabla por su
-- cuenta. Se reproduce el cuerpo vivo y se agrega una sola linea antes del RETURN.

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

  v_request.pin_hash := NULL;  -- 00092: no filtrar el hash del PIN
  RETURN v_request;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.complete_service_request(p_request_id uuid, p_distance_pickup_to_dropoff numeric)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_request service_requests;
  v_price_breakdown JSONB;
  v_total_distance NUMERIC;
  v_svc services;
  v_total NUMERIC;
  v_extra NUMERIC;
  v_cu coverage_usage;
  v_cov JSONB;
  v_line_km NUMERIC;   -- distancia en linea recta pickup->dropoff
  v_max_km  NUMERIC;   -- tope de sanidad para la distancia declarada
BEGIN
  SELECT * INTO v_request FROM service_requests
  WHERE id = p_request_id AND operator_id = auth.uid();

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found or not assigned to you';
  END IF;

  IF v_request.status != 'active' THEN
    RAISE EXCEPTION 'Request is not in active state';
  END IF;

  IF v_request.service_type = 'tow' THEN
    -- 00060: la distancia la declara el OPERADOR al cerrar, y de ella sale
    -- el precio. Sin control, declarar 99999 km sobre un tramo de 150 m daba
    -- un total de $249,995 (verificado). Dos frenos:
    --  · negativa: se rechaza (no existe un arrastre de km negativos).
    --  · inflada: se capa al maximo geograficamente plausible — 4x la linea
    --    recta pickup->dropoff, con piso de 5 km para tramos cortos donde ese
    --    ratio es ruidoso. No se BLOQUEA el cierre (es asistencia vial: un
    --    operador no debe quedar trabado por una ruta atipica), pero el exceso
    --    no se cobra y queda un evento PRICE_DISTANCE_CAPPED para el admin.
    IF p_distance_pickup_to_dropoff < 0 THEN
      RAISE EXCEPTION 'La distancia no puede ser negativa';
    END IF;

    v_line_km := 6371 * acos(LEAST(1, GREATEST(-1,
      cos(radians(v_request.pickup_lat)) * cos(radians(v_request.dropoff_lat)) *
        cos(radians(v_request.dropoff_lng) - radians(v_request.pickup_lng)) +
      sin(radians(v_request.pickup_lat)) * sin(radians(v_request.dropoff_lat))
    )));
    v_max_km := GREATEST(5, COALESCE(v_line_km, 0) * 4);

    IF p_distance_pickup_to_dropoff > v_max_km THEN
      INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
      VALUES (p_request_id, auth.uid(), 'OPERATOR', 'PRICE_DISTANCE_CAPPED',
              jsonb_build_object(
                'declared_km', p_distance_pickup_to_dropoff,
                'straight_line_km', round(v_line_km, 2),
                'capped_to_km', round(v_max_km, 2)));
      p_distance_pickup_to_dropoff := v_max_km;
    END IF;

    -- Tow: use existing calculate_price()
    v_total_distance := COALESCE(v_request.distance_operator_to_pickup_km, 0) + p_distance_pickup_to_dropoff;
    v_price_breakdown := calculate_price(v_total_distance, v_request.tow_type);
  ELSE
    -- Non-tow: tarifa plana del catalogo unico + extras
    SELECT * INTO v_svc FROM services
    WHERE slug = v_request.service_type AND is_active = true
    LIMIT 1;

    v_extra := 0;

    -- Tire: +extra_fee if no spare
    IF v_request.service_type = 'tire' AND v_svc.extra_fee > 0 THEN
      IF (v_request.service_details->>'has_spare')::boolean IS DISTINCT FROM true THEN
        v_extra := v_svc.extra_fee;
      END IF;
    END IF;

    -- Fuel: extra_fee per gallon (beyond 1 included)
    IF v_request.service_type = 'fuel' AND v_svc.extra_fee > 0 THEN
      DECLARE
        v_gallons NUMERIC;
      BEGIN
        v_gallons := COALESCE((v_request.service_details->>'gallons')::numeric, 1);
        IF v_gallons > 1 THEN
          v_extra := v_svc.extra_fee * (v_gallons - 1);
        END IF;
      END;
    END IF;

    v_total := v_svc.base_price + v_extra;

    v_price_breakdown := jsonb_build_object(
      'base_price', v_svc.base_price,
      'extra_fee', v_extra,
      'extra_fee_label', v_svc.extra_fee_label,
      'total', v_total,
      'currency', v_svc.currency,
      'service_type', v_request.service_type
    );
  END IF;

  -- Testigo para el guardian de 00054: acredita que este cierre viene de aqui,
  -- donde el precio se calcula, y no de un UPDATE suelto del cliente.
  PERFORM set_config('app.service_completed', p_request_id::text, true);

  UPDATE service_requests
  SET
    status = 'completed',
    distance_pickup_to_dropoff_km = p_distance_pickup_to_dropoff,
    price_breakdown = v_price_breakdown,
    total_price = (v_price_breakdown->>'total')::NUMERIC,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  -- --- B-12: repartir el total entre aseguradora y afiliado ------------
  -- Solo hay algo que repartir si B-11 dejo el vinculo con el afiliado. Va
  -- DESPUES del UPDATE para evaluar sobre el precio final ya guardado.
  --
  -- El EXCEPTION sigue el mismo criterio que B-11: que falle el reparto no puede
  -- impedirle al operador cerrar un servicio ya prestado. Se marca la solicitud
  -- como 'error' y se deja el motivo en el historial para que alguien lo
  -- resuelva; los montos quedan en 0, que es "sin decidir", y no en algo que
  -- facturaria de mas a la aseguradora o al afiliado.
  SELECT * INTO v_cu FROM coverage_usage WHERE request_id = p_request_id;

  IF v_cu.id IS NOT NULL THEN
    BEGIN
      v_cov := evaluate_coverage(
        v_cu.member_id,
        v_request.service_type,
        v_request.total_price,
        CASE WHEN v_request.service_type = 'tow' THEN p_distance_pickup_to_dropoff END,
        v_request.tow_type,
        p_request_id
      );

      UPDATE coverage_usage
         SET km_used        = (v_cov->>'km_used')::NUMERIC,
             amount_covered = (v_cov->>'amount_covered')::NUMERIC,
             amount_copay   = (v_cov->>'amount_copay')::NUMERIC
       WHERE request_id = p_request_id;

      -- El desglose viaja con el precio: sin esto, "por que pague $12.50" no
      -- tendria respuesta en ningun lado.
      UPDATE service_requests
         SET price_breakdown = price_breakdown || jsonb_build_object('coverage', v_cov)
       WHERE id = p_request_id
       RETURNING * INTO v_request;

      INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
      VALUES (p_request_id, auth.uid(), 'OPERATOR', 'COVERAGE_CHECKED', v_cov);

    EXCEPTION WHEN OTHERS THEN
      UPDATE service_requests SET coverage_status = 'error' WHERE id = p_request_id
        RETURNING * INTO v_request;
      INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
      VALUES (p_request_id, auth.uid(), 'OPERATOR', 'COVERAGE_CHECKED',
              jsonb_build_object(
                'coverage_status', 'error',
                'reason', 'Fallo el reparto de cobertura al cerrar: ' || SQLSTATE || ': ' || SQLERRM
              ));
    END;
  END IF;

  v_request.pin_hash := NULL;  -- 00092: no filtrar el hash del PIN
  RETURN v_request;
END;
$function$

;
