-- =====================================================
-- 00054 — El cliente deja de poder escribir lo que decide la plataforma
--
-- TRES AGUJEROS, TODOS DE LA MISMA FAMILIA: las politicas RLS decidian QUE
-- FILAS puede tocar cada quien, pero nunca QUE COLUMNAS. Y `authenticated`
-- tiene UPDATE sobre la tabla entera. Toda la logica cuidadosa que vive en las
-- RPC (precio, PIN, cobertura, rol) era decorativa: un PATCH de PostgREST la
-- sobreescribia. Verificado explotandolo, no leyendo el codigo.
--
-- 1. ESCALADA DE PRIVILEGIOS (lo mas grave). `Users can update own profile`
--    permite escribir CUALQUIER columna de la propia fila, incluida `role`.
--    Cualquier cuenta registrada hacia `UPDATE profiles SET role='ADMIN'` y
--    pasaba a ver todas las solicitudes, todos los usuarios, todo el padron de
--    afiliados y las claves de API de las aseguradoras. Tambien permitia
--    auto-aprobarse la verificacion de operador (`verification_status`) y
--    asignarse a la empresa que quisiera (`provider_id`).
--
-- 2. PRECIO, PIN Y COBERTURA FALSIFICABLES en `service_requests`. El operador
--    asignado podia: activar el servicio SIN PIN, marcarlo completado saltandose
--    el calculo de precio, ponerse `total_price` a dedo, REESCRIBIR el `pin_hash`
--    y declararse `coverage_status='covered'`. El cliente dueño de la solicitud
--    podia ponerse `total_price = 0` y declararse cubierto por la aseguradora.
--
-- 3. EL ENDURECIMIENTO DEL PIN ERA ESQUIVABLE. Quedaron dos funciones vivas:
--    `verify_request_pin` (00025/00026: bloqueo a los 5 intentos, ventana de 15
--    min, registro en `pin_attempts`, advisory lock) — la que llama la app — y
--    la vieja `verify_pin_and_activate`, sin limite, sin registro y que ademas
--    activaba el servicio. Seguia concedida a `authenticated`: llamarla
--    directamente daba intentos infinitos sobre un PIN de 4 digitos.
--
-- EL CRITERIO DEL ARREGLO
-- RLS decide la fila; los GRANT por columna deciden el campo. Al cliente se le
-- deja exactamente lo que las apps escriben de verdad (comprobado en las dos
-- apps), y todo lo demas pasa por las RPC, que son SECURITY DEFINER y corren
-- como `postgres`, asi que los GRANT por columna no las afectan.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. profiles: el cliente solo edita su nombre y su telefono
-- ---------------------------------------------------------------
-- Es todo lo que escriben las dos pantallas de perfil. El rol se cambia con
-- `admin_update_user_role`, la verificacion con `submit_operator_verification` /
-- `admin_set_operator_verification`, el opt-in con `set_marketing_opt_in`, y
-- `privacy_accepted_at` lo sella el trigger `handle_new_user` al registrarse.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------
-- 2. service_requests: el cliente solo mueve el estado y la ruta
-- ---------------------------------------------------------------
-- `status` sigue siendo escribible porque el operador marca "voy en camino" con
-- un UPDATE directo; las transiciones que valen dinero las cierra el guardian
-- del punto 3. `route_polyline` es cache de la ruta dibujada.
REVOKE UPDATE ON public.service_requests FROM authenticated, anon;
GRANT UPDATE (status, route_polyline) ON public.service_requests TO authenticated;

-- ---------------------------------------------------------------
-- 3. Guardian: a 'active' y a 'completed' solo se llega por la RPC
-- ---------------------------------------------------------------
-- Con el GRANT del punto 2 ya no se puede falsificar el precio ni el PIN, pero
-- `status` a secas todavia dejaba activar sin PIN (el PIN es la prueba de que el
-- operador llego y el cliente lo recibio) y cerrar sin precio.
--
-- El testigo es transaccion-local (`set_config(..., true)`) y lleva el id de la
-- solicitud: una autorizacion no sirve para otra fila, y no sobrevive a la
-- peticion. PostgREST abre una transaccion por llamada, asi que no se filtra.
CREATE OR REPLACE FUNCTION public.guard_privileged_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- El admin conserva la valvula manual: es el rol que ya puede todo.
  IF is_admin() THEN
    RETURN NEW;
  END IF;

  -- Sin usuario autenticado no hay peticion de cliente: es una sesion directa a
  -- la base (psql, un job, el service_role de una Edge Function). No se les pone
  -- el freno porque no son la superficie que este guardian protege, y si no,
  -- reparar datos a mano seria imposible. No abre nada: una peticion de
  -- PostgREST sin JWT llega como `anon`, y `anon` no casa con ninguna politica
  -- de esta tabla, asi que no alcanza ninguna fila que actualizar.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'active'
     AND COALESCE(current_setting('app.pin_verified', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'El servicio se activa verificando el PIN (verify_request_pin), no con un UPDATE';
  END IF;

  IF NEW.status = 'completed'
     AND COALESCE(current_setting('app.service_completed', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'El servicio se cierra con complete_service_request(), no con un UPDATE';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_privileged_status_change() IS
  'Impide llegar a active/completed con un UPDATE suelto (00054). Las RPC que si '
  'pueden dejan un testigo transaccion-local con el id de la solicitud.';

DROP TRIGGER IF EXISTS guard_privileged_status_change_trigger ON public.service_requests;
CREATE TRIGGER guard_privileged_status_change_trigger
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_privileged_status_change();

-- ---------------------------------------------------------------
-- 4. Muere la funcion de PIN sin endurecer
-- ---------------------------------------------------------------
-- No la llama nadie: la app usa `verify_request_pin` (active.tsx). Solo aparecia
-- en `database.types.ts`, que se regenera. Dejarla viva era dejar abierta la
-- puerta que 00025/00026 vinieron a cerrar.
DROP FUNCTION IF EXISTS public.verify_pin_and_activate(UUID, TEXT);

-- ---------------------------------------------------------------
-- 5. `verify_request_pin` activa el servicio ella misma
-- ---------------------------------------------------------------
-- Antes la app verificaba el PIN y DESPUES mandaba un UPDATE de status aparte:
-- dos pasos, con lo que la base no tenia forma de saber si el primero habia
-- ocurrido. Ahora verificacion y activacion son la misma transaccion.
--
-- La app no necesita cambios: sigue llamando a `verify_request_pin` y luego a
-- su `updateStatus('active')`, que queda como un no-op (el estado ya es
-- 'active', y el guardian solo mira los cambios de estado).
--
-- Reconstruida por SUSTITUCION EXACTA sobre `pg_get_functiondef`: el unico
-- cambio es el bloque del PIN valido. El bloqueo por intentos, el advisory lock
-- y el registro en `pin_attempts` quedan byte a byte igual.
CREATE OR REPLACE FUNCTION public.verify_request_pin(p_request_id uuid, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_caller_id        UUID;
  v_request          service_requests;
  v_pin_hash         TEXT;
  v_recent_failures  INTEGER;
  v_last_failure_at  TIMESTAMPTZ;
  v_retry_after_s    INTEGER;
  v_is_valid         BOOLEAN;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Not authenticated');
  END IF;

  -- Serialize all verification attempts for this request. xact-scoped, so
  -- it releases when the RPC transaction ends. This closes the TOCTOU
  -- where parallel calls each read "< 5 failures" before any INSERT lands.
  PERFORM pg_advisory_xact_lock(hashtext(p_request_id::text));

  -- 1. Resolve and authorize.
  SELECT * INTO v_request FROM service_requests WHERE id = p_request_id;
  IF v_request.id IS NULL THEN
    -- Generic message — don't leak which IDs exist.
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid request');
  END IF;

  -- Only the assigned operator can verify. ADMIN passes for ops debugging.
  IF v_request.operator_id IS DISTINCT FROM v_caller_id
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_caller_id AND role = 'ADMIN') THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Not the assigned operator');
  END IF;

  -- Opportunistic retention: drop attempts for this request older than the
  -- lockout window by a wide margin. Bounded by request_id, uses the
  -- (request_id, attempted_at DESC) index.
  DELETE FROM pin_attempts
   WHERE request_id = p_request_id
     AND attempted_at < NOW() - INTERVAL '1 hour';

  -- 2. Lockout check. Count failed attempts in the last 15 minutes.
  SELECT COUNT(*), MAX(attempted_at)
    INTO v_recent_failures, v_last_failure_at
    FROM pin_attempts
   WHERE request_id = p_request_id
     AND success = false
     AND attempted_at > NOW() - INTERVAL '15 minutes';

  IF v_recent_failures >= 5 THEN
    v_retry_after_s := GREATEST(
      1,
      EXTRACT(EPOCH FROM (v_last_failure_at + INTERVAL '15 minutes' - NOW()))::INTEGER
    );
    -- Record this as a failed attempt too so the lockout extends if the
    -- operator keeps hammering.
    INSERT INTO pin_attempts (request_id, operator_id, success)
    VALUES (p_request_id, v_caller_id, false);
    RETURN jsonb_build_object(
      'valid', false,
      'locked', true,
      'retry_after_seconds', v_retry_after_s,
      'error', 'Too many failed attempts; try again later'
    );
  END IF;

  -- 3. Verify the PIN.
  v_pin_hash := v_request.pin_hash;
  IF v_pin_hash IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Request has no PIN');
  END IF;

  v_is_valid := (v_pin_hash = crypt(p_pin, v_pin_hash));

  -- 4. Record the attempt.
  INSERT INTO pin_attempts (request_id, operator_id, success)
  VALUES (p_request_id, v_caller_id, v_is_valid);

  IF v_is_valid THEN
    -- Activar AQUI, en la misma transaccion que la verificacion. Antes la app
    -- verificaba el PIN y despues mandaba un UPDATE de status por separado, asi
    -- que la base no tenia como saber si el PIN se habia comprobado: bastaba
    -- omitir el primer paso. El testigo lleva el id de la solicitud para que la
    -- autorizacion de una no sirva para otra en la misma transaccion.
    IF v_request.status IN ('assigned', 'en_route') THEN
      PERFORM set_config('app.pin_verified', p_request_id::text, true);
      UPDATE service_requests
         SET status = 'active', activated_at = NOW(), updated_at = NOW()
       WHERE id = p_request_id;
    END IF;
    RETURN jsonb_build_object('valid', true, 'status', 'active');
  END IF;

  RETURN jsonb_build_object(
    'valid', false,
    'attempts_remaining', GREATEST(0, 5 - (v_recent_failures + 1)),
    'error', 'Incorrect PIN'
  );
END;
$function$

;

-- ---------------------------------------------------------------
-- 6. `complete_service_request` acredita su propio cierre
-- ---------------------------------------------------------------
-- Misma tecnica: sustitucion exacta, solo se le antepone el testigo al UPDATE
-- que pone 'completed'.
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
