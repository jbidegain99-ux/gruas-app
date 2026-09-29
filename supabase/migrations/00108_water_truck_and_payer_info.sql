-- =====================================================
-- 00108 — Pipas de agua (SRV-01) y "quien paga" para el socio (LAN-06)
--
-- * SRV-01: 8.o servicio, `water_truck` ("Pipa de agua"). Propuesta D6 de
--   Jose: se cobra por viaje + km, y la capacidad (m3) es un dato del vehiculo
--   (operator_vehicles.capacity_m3, 00107), no de la solicitud.
-- * LAN-06: el socio tiene que saber ANTES de aceptar que no debe cobrarle al
--   Usuario (cortesia MOPT o cubierto por una aseguradora). No ve montos.
-- * De paso, los nombres del catalogo llevan tilde (Grua -> Grúa, etc.): se
--   ven asi en las apps.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Pipa de agua
-- ---------------------------------------------------------------
ALTER TABLE public.service_requests DROP CONSTRAINT IF EXISTS chk_service_type;
ALTER TABLE public.service_requests ADD CONSTRAINT chk_service_type
  CHECK (service_type = ANY (ARRAY['tow', 'battery', 'tire', 'fuel', 'locksmith', 'mechanic', 'winch', 'water_truck']));

INSERT INTO public.services
  (slug, name_es, name_en, description_es, description_en, icon, base_price, extra_fee, extra_fee_label,
   requires_destination, sort_order, is_active, currency)
VALUES
  ('water_truck', 'Pipa de agua', 'Water truck',
   'Entrega de agua potable en pipa hasta tu ubicación', 'Drinking water delivered by tank truck',
   'droplets', 40.00, 1.50, 'por km de viaje', false, 8, true, 'USD')
ON CONFLICT (slug) DO NOTHING;

UPDATE public.services SET name_es = 'Grúa'      WHERE slug = 'tow'       AND name_es = 'Grua';
UPDATE public.services SET name_es = 'Batería'   WHERE slug = 'battery'   AND name_es = 'Bateria';
UPDATE public.services SET name_es = 'Cerrajería' WHERE slug = 'locksmith' AND name_es = 'Cerrajeria';
UPDATE public.services SET name_es = 'Mecánico'  WHERE slug = 'mechanic'  AND name_es = 'Mecanico';

-- complete_service_request: la pipa suma los km del viaje.
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

    -- 00108 (SRV-01, propuesta D6): la pipa cobra por viaje + km. Los km son
    -- los del viaje del socio hasta el Usuario (la pipa no arrastra nada).
    IF v_request.service_type = 'water_truck' AND v_svc.extra_fee > 0 THEN
      v_extra := ROUND(v_svc.extra_fee * COALESCE(v_request.distance_operator_to_pickup_km, 0), 2);
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


-- ---------------------------------------------------------------
-- 2. Quien paga, para el socio (sin montos)
-- ---------------------------------------------------------------
-- Devuelve, por solicitud: 'mopt' (cortesia, el Usuario no paga), 'insurer'
-- (cubierto por la aseguradora, con o sin copago) o 'user' (lo paga el
-- Usuario). Solo para quien ya puede ver esa solicitud: el socio asignado, un
-- socio que la tiene disponible en su pool, el Usuario dueno o el personal.
CREATE OR REPLACE FUNCTION public.service_payer_info(p_request_ids UUID[])
RETURNS TABLE (request_id UUID, payer TEXT, label TEXT, has_copay BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sr.id,
         CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 'mopt'
              WHEN i.id IS NOT NULL THEN 'insurer'
              ELSE 'user' END,
         CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 'Cortesía MOPT'
              WHEN i.id IS NOT NULL THEN 'Cubierto por ' || i.name
              ELSE NULL END,
         COALESCE(cu.amount_copay > 0, false)
    FROM service_requests sr
    LEFT JOIN coverage_usage cu ON cu.request_id = sr.id AND sr.mopt_provider_id IS NULL
    LEFT JOIN members m         ON m.id = cu.member_id
    LEFT JOIN policies po       ON po.id = m.policy_id
    LEFT JOIN insurers i        ON i.id = po.insurer_id
   WHERE sr.id = ANY (p_request_ids)
     AND (   sr.operator_id = auth.uid()
          OR sr.user_id = auth.uid()
          OR is_staff()
          OR (sr.status = 'initiated' AND is_operator()
              AND operator_fits_program(auth.uid(), sr.mopt_provider_id)))
$$;

REVOKE ALL ON FUNCTION public.service_payer_info(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_payer_info(UUID[]) TO authenticated;

-- Descripciones del catalogo con tilde (se ven en la app del Usuario).
UPDATE public.services SET description_es = 'Remolque de vehículo'          WHERE slug = 'tow'       AND description_es = 'Remolque de vehiculo';
UPDATE public.services SET description_es = 'Carga o cambio de batería'     WHERE slug = 'battery'   AND description_es = 'Carga o cambio de bateria';
UPDATE public.services SET description_es = 'Apertura de vehículo cerrado'  WHERE slug = 'locksmith' AND description_es = 'Apertura de vehiculo cerrado';
UPDATE public.services SET description_es = 'Servicio de mecánica en sitio' WHERE slug = 'mechanic'  AND description_es = 'Servicio de mecanica en sitio';
UPDATE public.services SET extra_fee_label = 'Por galón extra'              WHERE slug = 'fuel'      AND extra_fee_label = 'Por galon extra';
