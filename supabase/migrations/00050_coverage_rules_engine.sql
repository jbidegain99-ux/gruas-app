-- Migration: B-12 — motor de reglas de cobertura + consumo en coverage_usage.
--
-- Criterio del backlog: "Las reglas se aplican y coverage_usage se decrementa
-- correctamente por afiliado".
--
-- QUE HACE Y QUE NO
-- Toma las reglas que B-08 dejo como FILAS en `coverage_rules` y las convierte
-- en dos numeros: cuanto asume la aseguradora y cuanto paga el afiliado. Se
-- evalua al COMPLETAR el servicio, que es cuando existe el precio final y los km
-- reales. Mostrarle el copago al usuario ANTES de confirmar es B-13; aca queda
-- `preview_my_coverage()`, que es la funcion que esa pantalla va a llamar.
--
-- DECISIONES QUE NO SON OBVIAS
--
-- 1. Sin regla `covered`, NO hay cobertura. Un plan que no declara nada no
--    cubre nada. Al reves —cubrir por defecto— haria que un plan mal cargado le
--    facturara a la aseguradora servicios que nunca acepto.
--
-- 2. La regla especifica gana sobre la general. `service_type = NULL` es "todos
--    los servicios"; una fila con el tipo concreto la sobrescribe. Asi se dice
--    "todo incluido, salvo cerrajeria".
--
-- 3. El año es el AÑO DE POLIZA, no el calendario. Una poliza que arranca el 31
--    de diciembre tiene su año hasta el 30 del diciembre siguiente. Contar por
--    año calendario le regalaria al afiliado un juego entero de eventos cada 1
--    de enero.
--
-- 4. Solo cuentan los servicios COMPLETADOS. B-11 crea la fila de
--    `coverage_usage` al momento de solicitar, asi que contar filas a secas
--    haria que una solicitud cancelada gastara un evento del plan.
--
-- 5. El tope de eventos se cuenta con el MISMO alcance que la regla que lo fija.
--    Si dice "Grua: 4 al año", se cuentan solo las gruas; si dice "Todos: 2 al
--    año", se cuenta todo. Contar siempre todo convertiria un tope por servicio
--    en un tope global.
--
-- 6. NO se revalida la vigencia de la poliza al completar. B-11 ya la verifico
--    al solicitar y esa autorizacion vale: si la poliza vencio mientras la grua
--    estaba en camino, el servicio sigue cubierto. Lo contrario le cobraria el
--    total a alguien que pidio el servicio estando cubierto.

-- ===============================================================
-- 1. Resolver una regla con la precedencia especifica > general
-- ===============================================================
-- Devuelve dos cosas distintas que no hay que confundir: si la regla EXISTE y
-- cual es su valor. `rule_value` puede ser NULL con la regla presente (p. ej.
-- "sin tope"), y la ausencia de `covered` significa lo contrario que
-- `covered = 0`... no para el motor, pero si para el mensaje que se le muestra
-- a la persona.
CREATE OR REPLACE FUNCTION public.coverage_rule_lookup(
  p_plan_id      UUID,
  p_service_type TEXT,
  p_rule_key     TEXT
)
RETURNS TABLE (existe BOOLEAN, valor NUMERIC, alcance TEXT)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT TRUE,
         cr.rule_value,
         COALESCE(cr.service_type, '*')
    FROM coverage_rules cr
   WHERE cr.plan_id = p_plan_id
     AND cr.rule_key = p_rule_key
     AND (cr.service_type = p_service_type OR cr.service_type IS NULL)
   -- La especifica primero: NULLS LAST sobre service_type.
   ORDER BY (cr.service_type IS NOT NULL) DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.coverage_rule_lookup(UUID, TEXT, TEXT) IS
  'B-12: resuelve una regla de cobertura aplicando especifica > general. '
  'Devuelve 0 filas si el plan no tiene esa regla.';

-- ===============================================================
-- 2. El motor
-- ===============================================================
-- Pura: no escribe nada. Recibe el total ya calculado y lo parte en dos.
-- SECURITY DEFINER porque cruza members/policies/coverage_rules/coverage_usage,
-- todas con RLS. NO se expone a `authenticated` — recibe un member_id por
-- parametro y serviria para espiar el consumo de otro. El acceso publico va por
-- `preview_my_coverage()`, que resuelve el afiliado del que llama.
CREATE OR REPLACE FUNCTION public.evaluate_coverage(
  p_member_id       UUID,
  p_service_type    TEXT,
  p_total           NUMERIC,
  p_km              NUMERIC DEFAULT NULL,   -- km de arrastre (solo grua)
  p_tow_type        tow_type DEFAULT 'light',
  p_exclude_request UUID DEFAULT NULL       -- el servicio en curso no se cuenta a si mismo
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan_id       UUID;
  v_poliza_inicio DATE;
  v_anios         INT;
  v_ini           DATE;
  v_fin           DATE;

  v_cubierto_existe BOOLEAN; v_cubierto NUMERIC; v_cubierto_alcance TEXT;
  v_tope_existe     BOOLEAN; v_tope     NUMERIC; v_tope_alcance     TEXT;
  v_km_existe       BOOLEAN; v_km_incl  NUMERIC; v_km_alcance       TEXT;
  v_max_existe      BOOLEAN; v_max      NUMERIC; v_max_alcance      TEXT;

  v_usados        INT := 0;
  v_precio_km     NUMERIC := 0;
  v_km_exceso     NUMERIC := 0;
  v_cargo_exceso  NUMERIC := 0;
  v_candidato     NUMERIC;
  v_asume         NUMERIC;
  v_copago        NUMERIC;
  v_topeado       BOOLEAN := FALSE;
BEGIN
  SELECT p.plan_id, p.starts_on INTO v_plan_id, v_poliza_inicio
    FROM members m JOIN policies p ON p.id = m.policy_id
   WHERE m.id = p_member_id;

  IF v_plan_id IS NULL THEN
    RETURN jsonb_build_object(
      'covered', false,
      'reason', 'El afiliado no existe o no tiene poliza',
      'amount_total', p_total, 'amount_covered', 0, 'amount_copay', p_total
    );
  END IF;

  -- Año de poliza vigente (ver decision 3).
  v_anios := EXTRACT(YEAR FROM age(CURRENT_DATE, v_poliza_inicio))::INT;
  v_ini   := (v_poliza_inicio + (v_anios || ' years')::INTERVAL)::DATE;
  v_fin   := (v_ini + INTERVAL '1 year' - INTERVAL '1 day')::DATE;

  SELECT existe, valor, alcance INTO v_cubierto_existe, v_cubierto, v_cubierto_alcance
    FROM coverage_rule_lookup(v_plan_id, p_service_type, 'covered');
  SELECT existe, valor, alcance INTO v_tope_existe, v_tope, v_tope_alcance
    FROM coverage_rule_lookup(v_plan_id, p_service_type, 'services_per_year');
  SELECT existe, valor, alcance INTO v_km_existe, v_km_incl, v_km_alcance
    FROM coverage_rule_lookup(v_plan_id, p_service_type, 'included_km');
  SELECT existe, valor, alcance INTO v_max_existe, v_max, v_max_alcance
    FROM coverage_rule_lookup(v_plan_id, p_service_type, 'max_covered_amount');

  -- --- (a) ¿esta cubierto el tipo de servicio? -------------------
  IF NOT COALESCE(v_cubierto_existe, FALSE) THEN
    RETURN jsonb_build_object(
      'covered', false,
      'reason', 'El plan no declara cobertura para este servicio',
      'amount_total', p_total, 'amount_covered', 0, 'amount_copay', p_total,
      'policy_year_start', v_ini, 'policy_year_end', v_fin
    );
  END IF;

  IF COALESCE(v_cubierto, 0) = 0 THEN
    RETURN jsonb_build_object(
      'covered', false,
      'reason', 'Este servicio esta excluido del plan',
      'amount_total', p_total, 'amount_covered', 0, 'amount_copay', p_total,
      'policy_year_start', v_ini, 'policy_year_end', v_fin
    );
  END IF;

  -- --- (b) ¿le quedan eventos en el año? -------------------------
  IF COALESCE(v_tope_existe, FALSE) AND v_tope IS NOT NULL THEN
    SELECT COUNT(*) INTO v_usados
      FROM coverage_usage cu
      JOIN service_requests sr ON sr.id = cu.request_id
     WHERE cu.member_id = p_member_id
       AND cu.used_on BETWEEN v_ini AND v_fin
       AND sr.status = 'completed'                          -- decision 4
       AND (p_exclude_request IS NULL OR cu.request_id <> p_exclude_request)
       -- decision 5: el conteo tiene el mismo alcance que la regla
       AND (v_tope_alcance = '*' OR cu.service_type = v_tope_alcance);

    IF v_usados >= v_tope THEN
      RETURN jsonb_build_object(
        'covered', false,
        'reason', format('Se agotaron los %s servicios cubiertos del año', v_tope::INT),
        'amount_total', p_total, 'amount_covered', 0, 'amount_copay', p_total,
        'services_per_year', v_tope, 'events_used', v_usados,
        'policy_year_start', v_ini, 'policy_year_end', v_fin
      );
    END IF;
  END IF;

  -- --- (c) km de arrastre por encima de lo incluido --------------
  -- Se cobra al afiliado el excedente al mismo precio por km que la tarifa
  -- vigente; asi el copago coincide con lo que ese tramo costo de verdad.
  -- OJO: `coverage_rules.included_km` (lo que cubre la aseguradora) no es
  -- `pricing_rules.included_km` (lo que ya trae la tarifa base).
  IF COALESCE(v_km_existe, FALSE) AND v_km_incl IS NOT NULL AND p_km IS NOT NULL THEN
    v_km_exceso := GREATEST(0, p_km - v_km_incl);
    IF v_km_exceso > 0 THEN
      SELECT CASE WHEN p_tow_type = 'light' THEN pr.price_per_km_light
                  ELSE pr.price_per_km_heavy END
        INTO v_precio_km
        FROM pricing_rules pr WHERE pr.is_active = true LIMIT 1;
      v_cargo_exceso := ROUND(v_km_exceso * COALESCE(v_precio_km, 0), 2);
    END IF;
  END IF;

  -- --- (d) repartir ---------------------------------------------
  v_candidato := GREATEST(0, p_total - v_cargo_exceso);

  IF COALESCE(v_max_existe, FALSE) AND v_max IS NOT NULL AND v_candidato > v_max THEN
    v_asume   := v_max;
    v_topeado := TRUE;
  ELSE
    v_asume := v_candidato;
  END IF;

  v_copago := ROUND(GREATEST(0, p_total - v_asume), 2);
  v_asume  := ROUND(v_asume, 2);

  RETURN jsonb_build_object(
    'covered', true,
    'amount_total', p_total,
    'amount_covered', v_asume,
    'amount_copay', v_copago,
    'km_used', p_km,
    'included_km', v_km_incl,
    'excess_km', v_km_exceso,
    'excess_km_charge', v_cargo_exceso,
    'price_per_km', v_precio_km,
    'max_covered_amount', v_max,
    'capped', v_topeado,
    'services_per_year', v_tope,
    'events_used', v_usados,
    'events_left', CASE WHEN v_tope IS NULL THEN NULL ELSE GREATEST(0, v_tope::INT - v_usados - 1) END,
    'policy_year_start', v_ini,
    'policy_year_end', v_fin
  );
END;
$$;

COMMENT ON FUNCTION public.evaluate_coverage(UUID, TEXT, NUMERIC, NUMERIC, tow_type, UUID) IS
  'B-12: aplica las reglas del plan y parte el total en amount_covered / amount_copay. '
  'No escribe. Interna: recibe member_id, usar preview_my_coverage() desde el cliente.';

REVOKE ALL ON FUNCTION public.evaluate_coverage(UUID, TEXT, NUMERIC, NUMERIC, tow_type, UUID) FROM PUBLIC;

-- ===============================================================
-- 3. Consulta para el propio afiliado (la usara B-13)
-- ===============================================================
-- Misma evaluacion pero acotada a quien llama: nunca recibe un member_id, lo
-- resuelve de su propia afiliacion. Sin esto, exponer el motor seria dejar que
-- cualquiera consultara el consumo de otro pasando su id.
CREATE OR REPLACE FUNCTION public.preview_my_coverage(
  p_service_type TEXT,
  p_total        NUMERIC,
  p_km           NUMERIC DEFAULT NULL,
  p_tow_type     tow_type DEFAULT 'light'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cobertura JSONB;
  v_member_id UUID;
BEGIN
  v_cobertura := check_member_coverage();

  IF v_cobertura->>'status' <> 'covered' THEN
    -- Se devuelve el estado tal cual (none / inactive / error) para que la UI
    -- diga lo mismo que ya dice el banner de B-11, en vez de inventar otro texto.
    RETURN jsonb_build_object(
      'covered', false,
      'coverage_status', v_cobertura->>'status',
      'reason', COALESCE(v_cobertura->>'reason', 'No tenes una cobertura vigente'),
      'amount_total', p_total, 'amount_covered', 0, 'amount_copay', p_total
    );
  END IF;

  v_member_id := (v_cobertura->>'member_id')::UUID;
  RETURN evaluate_coverage(v_member_id, p_service_type, p_total, p_km, p_tow_type, NULL)
         || jsonb_build_object('coverage_status', 'covered');
END;
$$;

COMMENT ON FUNCTION public.preview_my_coverage(TEXT, NUMERIC, NUMERIC, tow_type) IS
  'B-12/B-13: cuanto cubriria el plan del usuario autenticado para un servicio, '
  'antes de solicitarlo. Resuelve el afiliado por auth.uid().';

REVOKE ALL ON FUNCTION public.preview_my_coverage(TEXT, NUMERIC, NUMERIC, tow_type) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_my_coverage(TEXT, NUMERIC, NUMERIC, tow_type) TO authenticated;

-- ===============================================================
-- 4. Enganche: al cerrar el servicio se reparte y se consume
-- ===============================================================
-- Copia de la definicion viva (00049) mas el bloque marcado "B-12". El resto no
-- se toca: sigue sin `SET search_path`, igual que antes.
CREATE OR REPLACE FUNCTION public.complete_service_request(
  p_request_id UUID,
  p_distance_pickup_to_dropoff NUMERIC
)
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
$function$;
