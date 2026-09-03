-- Migration: B-11 — verificacion de afiliado activo al solicitar servicio.
--
-- Criterio del backlog: "Al solicitar se valida cobertura; si la verificacion
-- falla NO permite/bloquea en silencio — comportamiento definido y logueado".
--
-- QUE HACE Y QUE NO
-- Esto responde UNA pregunta: "¿quien solicita es un afiliado con cobertura
-- vigente?". NO evalua las reglas del plan (eventos/año, km incluidos, monto
-- maximo) ni calcula copago — eso es B-12/B-13. Por eso la fila de
-- `coverage_usage` nace con montos en 0: aqui solo se registra el VINCULO
-- servicio↔afiliado; los montos los llena el motor de B-12.
--
-- LA DECISION DE DISEÑO: FALLA ABIERTA, NUNCA EN SILENCIO
-- Si la verificacion revienta (timeout, deadlock, bug), la solicitud se crea
-- igual con `coverage_status = 'error'`. Es asistencia vial: bloquear a alguien
-- varado de noche porque una consulta fallo es peor que cobrarle de mas y
-- corregirlo despues. Pero "falla abierta" NO es "falla en silencio":
--   1. se persiste el estado en `service_requests.coverage_status`,
--   2. se emite un evento `COVERAGE_CHECKED` con el SQLERRM,
--   3. el RPC devuelve el resultado al cliente, que lo muestra explicitamente.
-- El admin ve las que fallaron y las resuelve a mano.
-- Para invertirlo a "falla cerrada" basta cambiar el bloque EXCEPTION de
-- `create_service_request` por un RAISE.

-- ===============================================================
-- 1. Estado de cobertura en la solicitud
-- ===============================================================
-- Se guarda en `service_requests` y no en `coverage_usage` porque tambien hay
-- que registrar los casos en que NO hubo cobertura ('none', 'inactive',
-- 'error'), que por definicion no generan fila de consumo. El vinculo con el
-- afiliado sigue viviendo en `coverage_usage` (decision de 00044).
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS coverage_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_coverage_status_check'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_coverage_status_check
      CHECK (coverage_status IS NULL OR coverage_status IN ('covered', 'none', 'inactive', 'error'));
  END IF;
END $$;

COMMENT ON COLUMN public.service_requests.coverage_status IS
  'B-11: resultado de verificar afiliacion al crear. covered=afiliado vigente; '
  'none=no es afiliado (paga particular); inactive=afiliado o poliza no vigente; '
  'error=la verificacion fallo, la solicitud se creo igual y requiere revision '
  'manual. NULL = solicitud anterior a B-11.';

-- Las que fallaron son las que hay que revisar a mano: indice parcial.
CREATE INDEX IF NOT EXISTS service_requests_coverage_error_idx
  ON public.service_requests (created_at DESC)
  WHERE coverage_status = 'error';

-- ===============================================================
-- 2. Evento de auditoria
-- ===============================================================
-- ADD VALUE es seguro dentro de la transaccion de la migracion mientras no se
-- INSERTE ese valor en la misma transaccion; aqui solo se referencia desde el
-- cuerpo de una funcion, que es texto hasta que corre.
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'COVERAGE_CHECKED';

-- ===============================================================
-- 3. Normalizacion de DUI
-- ===============================================================
-- El padron de la aseguradora y el DUI que carga el usuario casi nunca vienen
-- con el mismo formato ('01234567-8' vs '012345678'). Comparar sin normalizar
-- haria que un afiliado real apareciera como no afiliado — un fallo silencioso
-- de los que este ticket viene a eliminar.
CREATE OR REPLACE FUNCTION public.normalize_document(p_doc TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(p_doc, ''), '[^0-9]', '', 'g'), '');
$$;

COMMENT ON FUNCTION public.normalize_document(TEXT) IS
  'Deja solo digitos para comparar documentos entre el padron y el perfil.';

-- ===============================================================
-- 4. Resolver la afiliacion del usuario que llama
-- ===============================================================
-- SECURITY DEFINER porque cruza `members`, `policies`, `coverage_plans`,
-- `insurers` y `profile_sensitive`, cada una con su RLS. Se acota
-- ESTRICTAMENTE a auth.uid(): nunca recibe un id de usuario por parametro,
-- justamente para que no pueda usarse para espiar la afiliacion de otro.
CREATE OR REPLACE FUNCTION public.check_member_coverage()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id  UUID;
  v_dui      TEXT;
  v_member   RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'reason', 'No autenticado');
  END IF;

  -- (a) Vinculacion diferida: la aseguradora carga su padron (B-10) antes de que
  -- el afiliado se instale la app, asi que `members.profile_id` suele venir NULL
  -- y el match se hace por documento. Se vincula la PRIMERA vez que coincide.
  -- Solo se toman filas con profile_id NULL: nunca se le roba un afiliado ya
  -- vinculado a otra cuenta.
  SELECT normalize_document(dui_number) INTO v_dui
    FROM profile_sensitive
   WHERE profile_id = v_user_id;

  IF v_dui IS NOT NULL THEN
    UPDATE members
       SET profile_id = v_user_id,
           updated_at = NOW()
     WHERE profile_id IS NULL
       AND normalize_document(document_number) = v_dui;
  END IF;

  -- (b) Elegir la afiliacion. Una persona puede figurar en mas de una poliza
  -- (p. ej. titular en una y beneficiario en otra): se prefiere la que este
  -- vigente hoy, y entre esas la que caduca mas tarde. El ORDER BY es
  -- determinista para que dos llamadas seguidas no devuelvan cosas distintas.
  SELECT m.id            AS member_id,
         m.relationship,
         m.is_active     AS member_active,
         m.starts_on     AS member_starts_on,
         m.ends_on       AS member_ends_on,
         p.id            AS policy_id,
         p.policy_number,
         p.status        AS policy_status,
         p.starts_on     AS policy_starts_on,
         p.ends_on       AS policy_ends_on,
         cp.id           AS plan_id,
         cp.code         AS plan_code,
         cp.name         AS plan_name,
         i.name          AS insurer_name,
         (m.is_active
           AND m.starts_on <= CURRENT_DATE
           AND (m.ends_on IS NULL OR m.ends_on >= CURRENT_DATE)
           AND p.status = 'active'
           AND p.starts_on <= CURRENT_DATE
           AND (p.ends_on IS NULL OR p.ends_on >= CURRENT_DATE)) AS vigente
    INTO v_member
    FROM members m
    JOIN policies p        ON p.id  = m.policy_id
    JOIN coverage_plans cp ON cp.id = p.plan_id
    JOIN insurers i        ON i.id  = p.insurer_id
   WHERE m.profile_id = v_user_id
   ORDER BY vigente DESC,
            COALESCE(p.ends_on, DATE '9999-12-31') DESC,
            m.created_at ASC
   LIMIT 1;

  IF v_member.member_id IS NULL THEN
    -- No es afiliado. NO es un error: paga como cliente particular.
    RETURN jsonb_build_object('status', 'none');
  END IF;

  IF v_member.vigente THEN
    RETURN jsonb_build_object(
      'status',        'covered',
      'member_id',     v_member.member_id,
      'policy_id',     v_member.policy_id,
      'plan_id',       v_member.plan_id,
      'policy_number', v_member.policy_number,
      'plan_code',     v_member.plan_code,
      'plan_name',     v_member.plan_name,
      'insurer_name',  v_member.insurer_name,
      'relationship',  v_member.relationship
    );
  END IF;

  -- Vencida/suspendida: se dice POR QUE. Un "no tenes cobertura" a secas frente
  -- a una poliza que el usuario cree vigente es el peor mensaje posible.
  RETURN jsonb_build_object(
    'status',        'inactive',
    'member_id',     v_member.member_id,
    'policy_id',     v_member.policy_id,
    'policy_number', v_member.policy_number,
    'plan_name',     v_member.plan_name,
    'insurer_name',  v_member.insurer_name,
    'reason',        CASE
      WHEN NOT v_member.member_active                    THEN 'Tu afiliacion esta dada de baja'
      WHEN v_member.member_starts_on > CURRENT_DATE      THEN 'Tu afiliacion aun no entra en vigencia'
      WHEN v_member.member_ends_on < CURRENT_DATE        THEN 'Tu afiliacion vencio'
      WHEN v_member.policy_status = 'suspended'          THEN 'La poliza esta suspendida'
      WHEN v_member.policy_status = 'cancelled'          THEN 'La poliza fue cancelada'
      WHEN v_member.policy_status = 'expired'            THEN 'La poliza vencio'
      WHEN v_member.policy_starts_on > CURRENT_DATE      THEN 'La poliza aun no entra en vigencia'
      WHEN v_member.policy_ends_on < CURRENT_DATE        THEN 'La poliza vencio'
      ELSE 'La cobertura no esta vigente'
    END
  );
END;
$$;

COMMENT ON FUNCTION public.check_member_coverage() IS
  'B-11: devuelve la cobertura vigente del usuario autenticado '
  '(covered/none/inactive). Vincula por DUI el padron cargado antes del registro.';

REVOKE ALL ON FUNCTION public.check_member_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_member_coverage() TO authenticated;

-- ===============================================================
-- 5. create_service_request: verificar al crear
-- ===============================================================
-- Misma firma y mismo cuerpo que 00026, mas el bloque de cobertura. Cualquier
-- cambio futuro debe mantener 00021 / 00025 / 00026 / 00047 en sincronia.
CREATE OR REPLACE FUNCTION create_service_request(
  p_dropoff_address TEXT,
  p_dropoff_lat DOUBLE PRECISION,
  p_dropoff_lng DOUBLE PRECISION,
  p_incident_type TEXT,
  p_notes TEXT DEFAULT NULL,
  p_pickup_address TEXT DEFAULT NULL,
  p_pickup_lat DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng DOUBLE PRECISION DEFAULT NULL,
  p_service_details JSONB DEFAULT '{}',
  p_service_type TEXT DEFAULT 'tow',
  p_tow_type tow_type DEFAULT 'light',
  p_vehicle_doc_path TEXT DEFAULT NULL,
  p_vehicle_photo_url TEXT DEFAULT NULL,
  p_vehicle_plate TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_pin TEXT;
  v_pin_hash TEXT;
  v_request_id UUID;
  v_request service_requests;
  v_actual_tow_type tow_type;
  v_coverage JSONB;
  v_coverage_status TEXT;
  v_coverage_error TEXT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF p_service_type != 'tow' THEN
    v_actual_tow_type := 'light';
  ELSE
    v_actual_tow_type := p_tow_type;
  END IF;

  -- Cryptographically-secure PIN (was RANDOM() — see 00025).
  v_pin := generate_secure_pin();
  v_pin_hash := crypt(v_pin, gen_salt('bf'));

  -- --- B-11: verificacion de cobertura ---------------------------------
  -- Va ANTES del INSERT para que `coverage_status` se escriba de una y no
  -- exista una ventana en que la solicitud vive sin estado de cobertura.
  -- El EXCEPTION es el nucleo del ticket: convierte cualquier fallo en un
  -- estado explicito y auditable en vez de tumbar la solicitud (falla cerrada
  -- en silencio) o dejarla pasar como si no hubiera cobertura (falla abierta
  -- en silencio, que le cobraria de mas a un afiliado legitimo).
  BEGIN
    v_coverage := check_member_coverage();
    v_coverage_status := v_coverage->>'status';
    IF v_coverage_status NOT IN ('covered', 'none', 'inactive') THEN
      v_coverage_error := 'Estado inesperado: ' || COALESCE(v_coverage_status, 'NULL');
      v_coverage_status := 'error';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_coverage_status := 'error';
    v_coverage_error  := SQLSTATE || ': ' || SQLERRM;
    v_coverage        := jsonb_build_object('status', 'error', 'reason', v_coverage_error);
  END;

  INSERT INTO service_requests (
    user_id,
    pickup_lat,
    pickup_lng,
    pickup_address,
    dropoff_lat,
    dropoff_lng,
    dropoff_address,
    tow_type,
    incident_type,
    vehicle_plate,
    vehicle_doc_path,
    vehicle_photo_url,
    notes,
    pin_hash,
    status,
    service_type,
    service_details,
    coverage_status
  ) VALUES (
    v_user_id,
    COALESCE(p_pickup_lat, 13.6929),
    COALESCE(p_pickup_lng, -89.2182),
    COALESCE(p_pickup_address, 'San Salvador'),
    p_dropoff_lat,
    p_dropoff_lng,
    p_dropoff_address,
    v_actual_tow_type,
    p_incident_type,
    p_vehicle_plate,
    p_vehicle_doc_path,
    p_vehicle_photo_url,
    p_notes,
    v_pin_hash,
    'initiated',
    p_service_type,
    COALESCE(p_service_details, '{}'::jsonb),
    v_coverage_status
  ) RETURNING * INTO v_request;

  v_request_id := v_request.id;

  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    v_request_id,
    v_user_id,
    'USER',
    'REQUEST_CREATED',
    jsonb_build_object(
      'pickup_address', p_pickup_address,
      'dropoff_address', p_dropoff_address,
      'tow_type', v_actual_tow_type,
      'incident_type', p_incident_type,
      'service_type', p_service_type,
      'has_photo', p_vehicle_photo_url IS NOT NULL
    )
  );

  -- Rastro de la verificacion: sin esto "fallo la cobertura" no seria
  -- investigable despues. Se guarda el motivo tal cual (SQLSTATE + SQLERRM).
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    v_request_id,
    v_user_id,
    'USER',
    'COVERAGE_CHECKED',
    jsonb_build_object(
      'coverage_status', v_coverage_status,
      'member_id',       v_coverage->>'member_id',
      'policy_number',   v_coverage->>'policy_number',
      'insurer_name',    v_coverage->>'insurer_name',
      'plan_name',       v_coverage->>'plan_name',
      'reason',          COALESCE(v_coverage_error, v_coverage->>'reason')
    )
  );

  -- Vinculo servicio↔afiliado. Los montos quedan en 0: los calcula B-12/B-13.
  -- Si esto fallara, la solicitud NO se pierde — se degrada a 'error' igual que
  -- arriba, por la misma razon.
  IF v_coverage_status = 'covered' THEN
    BEGIN
      INSERT INTO coverage_usage (member_id, request_id, service_type)
      VALUES ((v_coverage->>'member_id')::UUID, v_request_id, p_service_type);
    EXCEPTION WHEN OTHERS THEN
      UPDATE service_requests SET coverage_status = 'error' WHERE id = v_request_id;
      INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
      VALUES (v_request_id, v_user_id, 'USER', 'COVERAGE_CHECKED',
              jsonb_build_object(
                'coverage_status', 'error',
                'reason', 'No se pudo registrar el consumo: ' || SQLSTATE || ': ' || SQLERRM
              ));
      v_coverage_status := 'error';
      v_coverage := jsonb_build_object('status', 'error', 'reason', 'No se pudo registrar el consumo');
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'pin', v_pin,
    'status', 'initiated',
    -- El cliente DEBE mostrar esto. Que la solicitud se cree igual no significa
    -- que el usuario no tenga que enterarse de en que condicion quedo.
    'coverage', v_coverage,
    'message', 'Guarda este PIN. Lo necesitaras cuando llegue el operador.'
  );
END;
$$;

-- ===============================================================
-- 6. Solicitudes viejas
-- ===============================================================
-- Se dejan en NULL a proposito: nunca se les verifico cobertura y marcarlas
-- 'none' afirmaria algo que no se comprobo. NULL = "anterior a B-11".
