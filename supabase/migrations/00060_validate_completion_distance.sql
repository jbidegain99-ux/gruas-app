-- =====================================================
-- 00060 — La distancia de cierre no la infla el operador
--
-- EL BUG (sobrefacturacion)
-- `complete_service_request(p_request_id, p_distance_pickup_to_dropoff)`: para un
-- remolque, el precio sale de esa distancia, que la DECLARA el operador al
-- cerrar. No se validaba. Verificado: sobre un tramo con recogida y destino a
-- ~150 m, el operador declaro 99999 km y el total salio **$249,995**. El operador
-- gana con el excedente de km, asi que tiene incentivo directo para inflar; y en
-- servicios con cobertura, el sobrecosto lo paga la aseguradora o el afiliado.
--
-- (Ojo: `distance_operator_to_pickup_km` tambien suma al total y hoy nadie la
-- setea — queda 0. El vector real es `p_distance_pickup_to_dropoff`, el unico
-- que el cliente controla. Si algun dia se puebla la otra, habra que validarla
-- con la posicion del operador, que hoy no se guarda de forma confiable.)
--
-- EL ARREGLO — tope geografico, sin bloquear el cierre
--  · Negativa: se rechaza (no hay km de arrastre negativos).
--  · Inflada: se capa a 4x la linea recta recogida->destino (haversine), con
--    piso de 5 km para tramos cortos donde ese ratio es ruidoso. En El Salvador
--    —pais de ~300 km— 4x la linea recta cubre de sobra cualquier ruta real.
--  · NO se bloquea el cierre (asistencia vial: un operador no puede quedar
--    trabado por una ruta atipica), pero el exceso no se cobra y se deja un
--    evento PRICE_DISTANCE_CAPPED con lo declarado vs. lo capado, para el admin.
--
-- complete_service_request reconstruida por SUSTITUCION EXACTA: solo se agregan
-- las dos variables y el bloque de validacion en la rama 'tow'.
-- =====================================================

-- El evento nuevo. ADD VALUE va en autocommit (no dentro de un BEGIN) y no se
-- usa hasta runtime, asi que queda disponible para la funcion de abajo.
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'PRICE_DISTANCE_CAPPED';

CREATE OR REPLACE FUNCTION public.complete_service_request(p_request_id uuid, p_distance_pickup_to_dropoff numeric)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
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

  RETURN v_request;
END;
$function$

;
