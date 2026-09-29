-- 00098: programa MOPT — el MOPT presta asistencia con su propia flota y paga.
--
-- Modelo (propuesta "Tres modulos", 2026-09-25):
-- * El MOPT es un `provider` con `is_mopt = true`: sus operadores se vinculan
--   igual que a cualquier empresa (`profiles.provider_id`), y la cuenta MOPT que
--   administra el programa tambien apunta ahi.
-- * QUIEN PAGA se decide solo, al crear la solicitud: si el usuario tiene
--   seguro vigente, paga la aseguradora (como hoy); si no, y el punto de
--   recogida cae en una zona MOPT que cubre ese servicio, paga el MOPT y el
--   usuario paga $0; si no, paga el usuario. Nadie elige.
-- * Flota cerrada: un servicio del MOPT solo lo ve y lo toma un operador de ESE
--   programa, y un operador del MOPT solo ve servicios de su programa.
-- * Budi no liquida los servicios del MOPT (el MOPT le paga directo a sus
--   operadores). Lo que Budi cobra al MOPT es una tarifa de plataforma: la
--   `provider_commissions` del programa, 0% si no se configuro.
--
-- Decisiones de producto tomadas por defecto hasta que se definan (todas
-- configurables sin migracion nueva salvo la prioridad):
--   1. Que casos: zonas (poligonos) + tipos de servicio, por programa.
--   2. Flota cerrada: si.
--   3. Ingreso de Budi: tarifa % por servicio, default 0.
--   4. Tarifa MOPT->operador: la de Budi (calculate_price / services).
--   Prioridad: seguro > MOPT > particular.
--
-- Las funciones que ya existian se reescriben sobre su cuerpo VIVO (el de la
-- ultima migracion que las toco), cambiando solo lo marcado con "00098".

-- ---------------------------------------------------------------
-- 1. Programa MOPT y su vinculo con las solicitudes
-- ---------------------------------------------------------------
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS is_mopt BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.providers.is_mopt IS
  '00098: el proveedor es un programa MOPT (paga el servicio y tiene flota propia).';

-- SIN llave foranea, a proposito. Una FK a `providers` seria la SEGUNDA relacion
-- entre service_requests y providers (ya esta provider_id), y PostgREST deja de
-- resolver los embeds `providers(name)` que usan la app y la web: "Could not
-- embed because more than one relationship was found". Corregir esas consultas
-- no alcanza, porque las apps ya instaladas mandan la vieja. La integridad la
-- cuidan los dos triggers de abajo.
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS mopt_provider_id UUID;
ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_mopt_provider_id_fkey;

COMMENT ON COLUMN public.service_requests.mopt_provider_id IS
  '00098: programa MOPT que paga este servicio (el usuario no paga). NULL = paga '
  'el usuario o su aseguradora. Lo fija create_service_request; el cliente no '
  'puede escribirlo (sin GRANT de columna).';

-- Desde la 00056 la lectura de esta tabla se concede COLUMNA POR COLUMNA (para
-- esconder pin_hash), asi que una columna nueva nace ilegible: un select('*') de
-- la app fallaria con "permission denied". No es un dato sensible y la RLS ya
-- decide que filas ve cada quien.
GRANT SELECT (mopt_provider_id) ON public.service_requests TO authenticated, anon;

-- Lo que haria la FK: solo un programa MOPT real, y no se borra un programa
-- con servicios (se desactiva).
CREATE OR REPLACE FUNCTION public.check_mopt_provider_ref()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.mopt_provider_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM providers WHERE id = NEW.mopt_provider_id AND is_mopt) THEN
    RAISE EXCEPTION 'mopt_provider_id no es un programa MOPT'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_mopt_provider_ref ON public.service_requests;
CREATE TRIGGER trg_check_mopt_provider_ref
  BEFORE INSERT OR UPDATE OF mopt_provider_id ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.check_mopt_provider_ref();

CREATE OR REPLACE FUNCTION public.protect_mopt_program_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM service_requests WHERE mopt_provider_id = OLD.id) THEN
    RAISE EXCEPTION 'El programa tiene servicios: desactivalo en vez de borrarlo'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_mopt_program_delete ON public.providers;
CREATE TRIGGER trg_protect_mopt_program_delete
  BEFORE DELETE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.protect_mopt_program_delete();

CREATE INDEX IF NOT EXISTS idx_service_requests_mopt
  ON public.service_requests (mopt_provider_id, completed_at)
  WHERE mopt_provider_id IS NOT NULL;

-- ---------------------------------------------------------------
-- 2. Zonas donde atiende cada programa
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mopt_zones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- [[lat, lng], ...] en orden, sin repetir el primero al final. Sin PostGIS:
  -- el punto-en-poligono se resuelve en point_in_polygon().
  polygon       JSONB NOT NULL
                CHECK (jsonb_typeof(polygon) = 'array' AND jsonb_array_length(polygon) >= 3),
  -- NULL = todos los servicios.
  service_types TEXT[],
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mopt_zones_provider ON public.mopt_zones (provider_id) WHERE is_active;

ALTER TABLE public.mopt_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mopt_zones: admin gestiona" ON public.mopt_zones;
CREATE POLICY "mopt_zones: admin gestiona" ON public.mopt_zones
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP TRIGGER IF EXISTS trg_audit ON public.mopt_zones;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.mopt_zones
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS update_mopt_zones_updated_at ON public.mopt_zones;
CREATE TRIGGER update_mopt_zones_updated_at
  BEFORE UPDATE ON public.mopt_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Ray casting. Un punto exactamente sobre el borde puede caer de cualquier lado;
-- para una zona vial eso es irrelevante.
CREATE OR REPLACE FUNCTION public.point_in_polygon(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_polygon JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  n INT := jsonb_array_length(p_polygon);
  i INT;
  j INT := n - 1;
  yi DOUBLE PRECISION; xi DOUBLE PRECISION;
  yj DOUBLE PRECISION; xj DOUBLE PRECISION;
  dentro BOOLEAN := false;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL OR n < 3 THEN
    RETURN false;
  END IF;
  FOR i IN 0 .. n - 1 LOOP
    yi := (p_polygon -> i ->> 0)::DOUBLE PRECISION;
    xi := (p_polygon -> i ->> 1)::DOUBLE PRECISION;
    yj := (p_polygon -> j ->> 0)::DOUBLE PRECISION;
    xj := (p_polygon -> j ->> 1)::DOUBLE PRECISION;
    IF ((yi > p_lat) <> (yj > p_lat))
       AND (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) THEN
      dentro := NOT dentro;
    END IF;
    j := i;
  END LOOP;
  RETURN dentro;
END;
$$;

-- El programa MOPT que atiende este punto y este servicio, o NULL. Si dos
-- programas se solapan gana la zona mas antigua (determinista).
CREATE OR REPLACE FUNCTION public.mopt_program_for(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_service_type TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT z.provider_id
    FROM mopt_zones z
    JOIN providers pr ON pr.id = z.provider_id AND pr.is_mopt AND pr.is_active
   WHERE z.is_active
     AND (z.service_types IS NULL OR COALESCE(p_service_type, 'tow') = ANY (z.service_types))
     AND point_in_polygon(p_lat, p_lng, z.polygon)
   ORDER BY z.created_at, z.id
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.mopt_program_for(DOUBLE PRECISION, DOUBLE PRECISION, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- 3. Quien es quien
-- ---------------------------------------------------------------
-- El programa de la cuenta MOPT que llama, o NULL. Mismo patron que
-- auth_insurer_id(): exige el rol Y un programa MOPT real. `role::text`: el valor
-- MOPT es nuevo (00097) y comparar por texto no depende del enum.
CREATE OR REPLACE FUNCTION public.auth_mopt_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.provider_id
    FROM profiles p
    JOIN providers pr ON pr.id = p.provider_id AND pr.is_mopt
   WHERE p.id = auth.uid()
     AND p.role::text = 'MOPT';
$$;

REVOKE ALL ON FUNCTION public.auth_mopt_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_mopt_id() TO authenticated;

-- Flota cerrada, en los dos sentidos. Un servicio del MOPT solo para operadores
-- de ESE programa; un operador del MOPT solo para servicios de su programa.
CREATE OR REPLACE FUNCTION public.operator_fits_program(p_operator UUID, p_mopt_provider UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN p_mopt_provider IS NOT NULL THEN p.provider_id IS NOT DISTINCT FROM p_mopt_provider
           ELSE NOT COALESCE(pr.is_mopt, false)
         END
    FROM profiles p
    LEFT JOIN providers pr ON pr.id = p.provider_id
   WHERE p.id = p_operator;
$$;

REVOKE ALL ON FUNCTION public.operator_fits_program(UUID, UUID) FROM PUBLIC, anon;
-- `authenticated` la NECESITA: la politica "Operators can view available
-- requests" (abajo) la llama, y una politica corre con los permisos de quien
-- consulta. Sin el GRANT, todo SELECT sobre service_requests de cualquier
-- usuario fallaria con "permission denied". Solo responde si/no sobre el
-- programa de un operador.
GRANT EXECUTE ON FUNCTION public.operator_fits_program(UUID, UUID) TO authenticated;

-- Lo que Budi le cobra al MOPT por servicio. Sin fila = 0%, NO el 20% de las
-- empresas privadas: un default de cobro que nadie decidio no puede aplicarse
-- en silencio a un organismo publico.
CREATE OR REPLACE FUNCTION public.mopt_fee_rate(p_provider UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT commission_rate FROM provider_commissions WHERE provider_id = p_provider), 0);
$$;

REVOKE ALL ON FUNCTION public.mopt_fee_rate(UUID) FROM PUBLIC, anon, authenticated;

-- La politica de la 00024 deja a CUALQUIER operador leer las solicitudes del
-- pool con un select directo. Las RPC ya filtran la flota; la politica tiene
-- que decir lo mismo, o un operador privado lee los pedidos del MOPT (y al
-- reves) sin pasar por ellas.
DROP POLICY IF EXISTS "Operators can view available requests" ON public.service_requests;
CREATE POLICY "Operators can view available requests" ON public.service_requests
  FOR SELECT TO authenticated
  USING (status = 'initiated' AND is_operator()
         AND operator_fits_program(auth.uid(), mopt_provider_id));

-- ---------------------------------------------------------------
-- 4. Vincular una cuenta al portal de un programa
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_link_mopt_user(p_user_id UUID, p_provider_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede vincular una cuenta del MOPT';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio rol';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM providers WHERE id = p_provider_id AND is_mopt) THEN
    RAISE EXCEPTION 'El programa MOPT no existe';
  END IF;

  -- Lo que es solo de operador o de aseguradora se limpia (CHECKs 00076/00080/00093).
  UPDATE profiles
     SET role = 'MOPT',
         provider_id = p_provider_id,
         insurer_id = NULL,
         verification_status = NULL,
         commission_rate = NULL,
         updated_at = now()
   WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_link_mopt_user(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_mopt_user(UUID, UUID) TO authenticated;

-- La regla de "¿paga el MOPT?", en UN solo lugar: la usan create_service_request
-- y la vista previa de la app. Si divergieran, la app prometeria $0 y se
-- cobraria el total (o al reves).
--
-- Prioridad seguro > MOPT > particular, pero "seguro" es que la poliza CUBRA
-- este servicio, no solo que este vigente: un afiliado cuyo plan excluye el
-- servicio pagaria el total, y un no afiliado en el mismo punto $0. Ahi paga
-- el MOPT.
CREATE OR REPLACE FUNCTION public.mopt_payer_for(
  p_coverage     JSONB,
  p_lat          DOUBLE PRECISION,
  p_lng          DOUBLE PRECISION,
  p_service_type TEXT
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_coverage->>'status' = 'covered'
     AND plan_cubre_servicio((p_coverage->>'plan_id')::UUID, COALESCE(p_service_type, 'tow')) THEN
    RETURN NULL;
  END IF;
  RETURN mopt_program_for(p_lat, p_lng, p_service_type);
END;
$$;

REVOKE ALL ON FUNCTION public.mopt_payer_for(JSONB, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- 5. Vista previa para la app: ¿este pedido lo paga el MOPT?
-- ---------------------------------------------------------------
-- Misma regla que create_service_request (mopt_payer_for).
CREATE OR REPLACE FUNCTION public.preview_mopt_program(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_service_type TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('applies', false);
  END IF;
  v_mopt := mopt_payer_for(check_member_coverage(), p_lat, p_lng, p_service_type);
  IF v_mopt IS NULL THEN
    RETURN jsonb_build_object('applies', false);
  END IF;
  RETURN jsonb_build_object(
    'applies', true,
    'program_name', (SELECT name FROM providers WHERE id = v_mopt)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_mopt_program(DOUBLE PRECISION, DOUBLE PRECISION, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_mopt_program(DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO authenticated;

-- ---------------------------------------------------------------
-- 6. Funciones existentes, reescritas sobre su cuerpo vivo
-- ---------------------------------------------------------------

-- create_service_request: 00098 decide si paga el MOPT
CREATE OR REPLACE FUNCTION public.create_service_request(p_dropoff_address text, p_dropoff_lat double precision, p_dropoff_lng double precision, p_incident_type text, p_notes text DEFAULT NULL::text, p_pickup_address text DEFAULT NULL::text, p_pickup_lat double precision DEFAULT NULL::double precision, p_pickup_lng double precision DEFAULT NULL::double precision, p_service_details jsonb DEFAULT '{}'::jsonb, p_service_type text DEFAULT 'tow'::text, p_tow_type tow_type DEFAULT 'light'::tow_type, p_vehicle_doc_path text DEFAULT NULL::text, p_vehicle_photo_url text DEFAULT NULL::text, p_vehicle_plate text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
  v_role user_role;
  v_mopt UUID;  -- 00098: programa MOPT que paga, si aplica
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- 00069: solo un CLIENTE pide servicios. create_service_request no validaba el
  -- rol, asi que cualquier cuenta autenticada (operador, y desde B-17 tambien una
  -- aseguradora) podia crear solicitudes. Un portal de aseguradora no pide gruas.
  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role IS DISTINCT FROM 'USER' THEN
    RAISE EXCEPTION 'Solo un cliente puede solicitar un servicio';
  END IF;

  -- 00063: un usuario tiene UNA sola solicitud en curso a la vez. La app ya lo
  -- asume (activeRequest en singular); sin este freno, un doble-tap o un
  -- reintento de red creaba solicitudes duplicadas, cada una con su PIN, su push
  -- a los operadores y su entrada al pool. El indice unico parcial (creado en la
  -- misma migracion) es la garantia dura a prueba de concurrencia; este chequeo
  -- da el mensaje claro en el caso normal.
  IF EXISTS (
    SELECT 1 FROM service_requests
     WHERE user_id = v_user_id
       AND status IN ('initiated','assigned','en_route','active')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ya tenes un servicio en curso. Espera a que termine o cancelalo antes de pedir otro.'
    );
  END IF;

  -- 00064: sanidad geografica de las coordenadas. El destino es obligatorio;
  -- la recogida puede venir NULL (cae a San Salvador por el COALESCE del
  -- INSERT), pero si viene, tiene que ser real. Fuera de los limites de El
  -- Salvador —o un valor absurdo tipo 999— el operador no podria ubicar al
  -- cliente y los calculos de distancia se rompen. Mismos limites que usa la
  -- Edge Function calculate-distance.
  IF p_dropoff_lat NOT BETWEEN 13.0 AND 14.5 OR p_dropoff_lng NOT BETWEEN -90.2 AND -87.5 THEN
    RETURN jsonb_build_object('success', false,
      'error', 'La ubicacion de destino esta fuera del area de cobertura.');
  END IF;
  IF (p_pickup_lat IS NOT NULL AND p_pickup_lat NOT BETWEEN 13.0 AND 14.5)
     OR (p_pickup_lng IS NOT NULL AND p_pickup_lng NOT BETWEEN -90.2 AND -87.5) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'La ubicacion de recogida esta fuera del area de cobertura.');
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

  -- 00098: ¿lo paga un programa MOPT? Regla unica en mopt_payer_for: si la
  -- poliza cubre ESTE servicio sigue por la aseguradora; si no (sin seguro, o
  -- servicio excluido del plan) y el punto cae en una zona MOPT, paga el MOPT.
  v_mopt := mopt_payer_for(v_coverage,
                           COALESCE(p_pickup_lat, 13.6929), COALESCE(p_pickup_lng, -89.2182),
                           p_service_type);

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
    coverage_status,
    mopt_provider_id
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
    v_coverage_status,
    v_mopt
  ) RETURNING * INTO v_request;

  v_request_id := v_request.id;

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
      'reason',          COALESCE(v_coverage_error, v_coverage->>'reason'),
      'mopt_provider_id', v_mopt
    )
  );

  -- Vinculo servicio↔afiliado. Los montos quedan en 0: los calcula B-12/B-13.
  -- Si esto fallara, la solicitud NO se pierde — se degrada a 'error' igual que
  -- arriba, por la misma razon.
  -- 00098: si paga el MOPT no hay consumo de poliza (el plan excluia el
  -- servicio): sin esto la finanza lo contaria como copago total del afiliado.
  IF v_coverage_status = 'covered' AND v_mopt IS NULL THEN
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
    -- 00098: si paga el MOPT, el usuario no paga nada y la app lo tiene que decir.
    'mopt', CASE WHEN v_mopt IS NULL THEN NULL ELSE jsonb_build_object(
             'program_name', (SELECT name FROM providers WHERE id = v_mopt)) END,
    'message', 'Guarda este PIN. Lo necesitaras cuando llegue el operador.'
  );
END;
$function$;

-- get_available_requests_for_operator: 00098 flota cerrada
CREATE OR REPLACE FUNCTION public.get_available_requests_for_operator()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_requests JSONB;
BEGIN
  -- Verify caller is operator
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'OPERATOR'
      AND verification_status = 'approved'   -- 00058: mismo gate que accept
  ) THEN
    RAISE EXCEPTION 'Only operators can view available requests';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', sr.id,
      'pickup_lat', sr.pickup_lat,
      'pickup_lng', sr.pickup_lng,
      'pickup_address', sr.pickup_address,
      'dropoff_lat', sr.dropoff_lat,
      'dropoff_lng', sr.dropoff_lng,
      'dropoff_address', sr.dropoff_address,
      'service_type', COALESCE(sr.service_type, 'tow'),
      'tow_type', sr.tow_type,
      'incident_type', sr.incident_type,
      'created_at', sr.created_at,
      'user_name', p.full_name,
      'user_phone', p.phone
    ) ORDER BY sr.created_at ASC
  ) INTO v_requests
  FROM service_requests sr
  JOIN profiles p ON p.id = sr.user_id
  WHERE sr.status = 'initiated'
    -- 00073: solo lo que la empresa del operador declara prestar.
    AND operator_can_serve(auth.uid(), sr.service_type)
    -- 00098: flota cerrada del MOPT, en los dos sentidos.
    AND operator_fits_program(auth.uid(), sr.mopt_provider_id)
    AND NOT EXISTS (
      SELECT 1 FROM request_events re
      WHERE re.request_id = sr.id
        AND re.actor_id = auth.uid()
        AND re.event_type = 'OPERATOR_CANCELLED'
    );

  RETURN COALESCE(v_requests, '[]'::jsonb);
END;
$function$;

-- accept_service_request: 00098 flota cerrada
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

  -- 00098: flota cerrada del MOPT. Mismo criterio: no alcanza con filtrar el pool.
  IF NOT operator_fits_program(
       auth.uid(),
       (SELECT mopt_provider_id FROM service_requests WHERE id = p_request_id)) THEN
    RAISE EXCEPTION 'Este servicio corresponde a otro programa';
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
$function$;

-- admin_assign_request: 00098 flota cerrada
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
$function$;

-- suggest_nearest_operators: 00098 flota cerrada
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
  IF NOT is_admin() THEN
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
$function$;

-- assign_nearest_operator: 00098 flota cerrada
CREATE OR REPLACE FUNCTION public.assign_nearest_operator(p_request_id uuid)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_service_type TEXT;
  v_request service_requests;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_operator uuid;
  v_provider uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can auto-assign requests';
  END IF;

  SELECT pickup_lat, pickup_lng, service_type
    INTO v_pickup_lat, v_pickup_lng, v_service_type
  FROM service_requests
  WHERE id = p_request_id AND status = 'initiated';

  IF v_pickup_lat IS NULL THEN
    RAISE EXCEPTION 'Request not found or not available';
  END IF;

  SELECT ol.operator_id, p.provider_id
    INTO v_operator, v_provider
  FROM operator_locations ol
  JOIN profiles p ON p.id = ol.operator_id
    AND p.role = 'OPERATOR'
    AND p.verification_status = 'approved'
  WHERE ol.is_online = true
    AND ol.updated_at > NOW() - INTERVAL '5 minutes'
    -- 00074: asigna sola, sin criterio humano detras; con mas razon tiene que
    -- respetar lo que la empresa declara prestar.
    AND operator_can_serve(ol.operator_id, v_service_type)
    -- 00098: flota cerrada del MOPT.
    AND operator_fits_program(ol.operator_id, (SELECT mopt_provider_id FROM service_requests WHERE id = p_request_id))
    AND NOT EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.operator_id = ol.operator_id
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  ORDER BY (
    6371 * acos(
      least(1, greatest(-1,
        cos(radians(v_pickup_lat)) * cos(radians(ol.lat)) *
          cos(radians(ol.lng) - radians(v_pickup_lng)) +
        sin(radians(v_pickup_lat)) * sin(radians(ol.lat))
      ))
    )
  ) ASC
  LIMIT 1;

  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'No hay operadores en línea disponibles';
  END IF;

  UPDATE service_requests
  SET operator_id = v_operator,
      provider_id = v_provider,
      status = 'assigned',
      assigned_at = NOW(),
      updated_at = NOW()
  WHERE id = p_request_id AND status = 'initiated'
  RETURNING * INTO v_request;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request no longer available';
  END IF;

  RETURN v_request;
END;
$function$;

-- notify_operators_pool_request: 00098 flota cerrada
CREATE OR REPLACE FUNCTION public.notify_operators_pool_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Solo cuando la solicitud esta (o acaba de quedar) en el pool.
  IF NEW.status <> 'initiated' OR NEW.operator_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- En UPDATE, solo al ENTRAR a 'initiated' (evita re-notificar en cada
  -- UPDATE mientras sigue initiated, p.ej. el sello de pool_alerted_at de 00036).
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'initiated' THEN
    RETURN NEW;
  END IF;

  INSERT INTO notification_queue (user_id, title, body, data, created_at)
  SELECT
    ol.operator_id,
    'Nueva solicitud disponible',
    'Hay una nueva solicitud de servicio cerca. Abre la app para aceptarla.',
    jsonb_build_object(
      'type', 'new_pool_request',
      'service_request_id', NEW.id,
      'role', 'operator'
    ),
    NOW()
  FROM operator_locations ol
  JOIN profiles p
    ON p.id = ol.operator_id
   AND p.role = 'OPERATOR'
   AND p.verification_status = 'approved'
  WHERE ol.is_online = true
    -- 00098: la push va solo a quien puede tomarla (flota cerrada del MOPT).
    AND operator_fits_program(ol.operator_id, NEW.mopt_provider_id)
    AND ol.updated_at > NOW() - INTERVAL '5 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.operator_id = ol.operator_id
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
    AND NOT EXISTS (
      SELECT 1 FROM request_events re
      WHERE re.request_id = NEW.id
        AND re.actor_id = ol.operator_id
        AND re.event_type = 'OPERATOR_CANCELLED'
    );

  RETURN NEW;
END;
$function$;

-- admin_settlement_by_provider: 00098 sin servicios del MOPT
CREATE OR REPLACE FUNCTION public.admin_settlement_by_provider(p_from date, p_to date)
 RETURNS TABLE(provider_id uuid, destinatario text, es_independiente boolean, comision_pct numeric, servicios bigint, sin_precio bigint, bruto numeric, comision numeric, a_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    pr.id,
    -- Sin empresa, el destinatario es el operador: es su propia liquidacion.
    -- MAX() y no la columna pelada porque `ope` ya no esta en el GROUP BY; en un
    -- grupo sin empresa todas las filas son del mismo operador, asi que el MAX
    -- es su nombre, y en uno con empresa este COALESCE ni lo mira.
    COALESCE(pr.name, MAX(ope.full_name), 'Sin asignar'),
    pr.id IS NULL,
    effective_commission_rate(pr.id, MAX(ope.commission_rate)),
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE sr.total_price IS NULL)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- 00081: se suman las lineas ya redondeadas, no se redondea el total. El
    -- detalle que se exporta redondea servicio a servicio, y redondear aparte el
    -- agregado los separaba: con tres servicios de $33.33 al 20%, la pantalla
    -- decia $20.00 y el CSV sumaba $20.01. Un export que no cuadra con lo que se
    -- vio antes de transferir no sirve para justificar el pago.
    COALESCE(SUM(ROUND(sr.total_price * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)), 0),
    -- `a pagar` se deriva restando, nunca sumando lineas por su cuenta: asi
    -- comision + a_pagar = bruto siempre, exacto.
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)), 0)
  FROM service_requests sr
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  WHERE sr.status = 'completed'
    -- 00098: Budi no liquida los servicios del MOPT; los paga el MOPT.
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  -- Una fila por DESTINATARIO: la empresa si la hay, el operador si no.
  GROUP BY COALESCE(pr.id, ope.id), pr.id, pr.name
  ORDER BY 9 DESC;
END;
$function$;

-- admin_settlement_by_operator: 00098 sin servicios del MOPT
CREATE OR REPLACE FUNCTION public.admin_settlement_by_operator(p_from date, p_to date)
 RETURNS TABLE(operator_id uuid, operador text, empresa text, comision_pct numeric, servicios bigint, bruto numeric, comision numeric, a_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    ope.id,
    COALESCE(ope.full_name, 'Sin operador'),
    COALESCE(pr.name, 'Independiente'),
    effective_commission_rate(pr.id, ope.commission_rate),
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- 00081: se suman las lineas ya redondeadas, no se redondea el total.
    COALESCE(SUM(ROUND(sr.total_price * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)), 0)
  FROM service_requests sr
  LEFT JOIN profiles ope  ON ope.id = sr.operator_id
  LEFT JOIN providers pr  ON pr.id = sr.provider_id
  WHERE sr.status = 'completed'
    -- 00098: Budi no liquida los servicios del MOPT; los paga el MOPT.
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  -- Entra `pr.id` (lo pide el helper) en vez de `pr.commission_rate`. Agrupar
  -- por el id en lugar del nombre+tarifa no junta empresas distintas por error.
  GROUP BY ope.id, ope.full_name, ope.commission_rate, pr.id, pr.name
  ORDER BY 8 DESC;
END;
$function$;

-- admin_settlement_detail: 00098 sin servicios del MOPT
CREATE OR REPLACE FUNCTION public.admin_settlement_detail(p_from date, p_to date)
 RETURNS TABLE(folio text, completado timestamp with time zone, servicio text, destinatario text, operador text, comision_pct numeric, bruto numeric, comision numeric, a_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la liquidacion';
  END IF;

  RETURN QUERY
  SELECT
    c.folio,
    sr.completed_at,
    sr.service_type,
    COALESCE(pr.name, ope.full_name, 'Sin asignar'),
    COALESCE(ope.full_name, 'Sin operador'),
    effective_commission_rate(pr.id, ope.commission_rate),
    COALESCE(sr.total_price, 0),
    ROUND(COALESCE(sr.total_price, 0) * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2),
    COALESCE(sr.total_price, 0)
      - ROUND(COALESCE(sr.total_price, 0) * effective_commission_rate(pr.id, ope.commission_rate) / 100, 2)
  FROM service_requests sr
  LEFT JOIN cases c      ON c.request_id = sr.id
  LEFT JOIN providers pr ON pr.id = sr.provider_id
  LEFT JOIN profiles ope ON ope.id = sr.operator_id
  WHERE sr.status = 'completed'
    -- 00098: Budi no liquida los servicios del MOPT; los paga el MOPT.
    AND sr.mopt_provider_id IS NULL
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1)
  ORDER BY sr.completed_at DESC;
END;
$function$;

-- admin_finance_summary: 00098 separa lo del MOPT
CREATE OR REPLACE FUNCTION public.admin_finance_summary(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las finanzas';
  END IF;

  SELECT jsonb_build_object(
    'servicios',       COUNT(*),
    'bruto',           COALESCE(SUM(sr.total_price), 0),
    -- Servicios completados que nunca quedaron cobrados. No es una curiosidad:
    -- son trabajos prestados que no facturaron, y sin esto la pantalla contaba
    -- los 9 servicios pero promediaba sobre los 7 con precio, dando un ticket
    -- que no se podia reconciliar con el total. Se muestra en vez de esconderse.
    'sin_precio',      COUNT(*) FILTER (WHERE sr.total_price IS NULL),
    -- Lo que hay que facturarle a las aseguradoras.
    'aseguradoras',    COALESCE(SUM(cu.amount_covered), 0),
    -- Lo que pone de su bolsillo un afiliado, sobre lo que el plan no cubre.
    'copagos',         COALESCE(SUM(cu.amount_copay), 0),
    -- Servicios sin cobertura de por medio: los paga enteros el cliente.
    'particulares',    COALESCE(SUM(CASE WHEN cu.id IS NULL AND sr.mopt_provider_id IS NULL THEN sr.total_price END), 0),
    -- 00098: lo que pagan los programas MOPT (el usuario no paga).
    'mopt',             COALESCE(SUM(CASE WHEN sr.mopt_provider_id IS NOT NULL THEN sr.total_price END), 0),
    -- AVG ignora los NULL, asi que el promedio es sobre los que SI tienen
    -- precio. Es lo correcto, y por eso la pantalla lo rotula asi.
    'ticket_promedio', COALESCE(ROUND(AVG(sr.total_price), 2), 0)
  ) INTO v
  FROM service_requests sr
  LEFT JOIN coverage_usage cu ON cu.request_id = sr.id
  WHERE sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1);

  RETURN v;
END;
$function$;

-- admin_finance_detail: 00098 el MOPT como pagador
CREATE OR REPLACE FUNCTION public.admin_finance_detail(p_from date, p_to date)
 RETURNS TABLE(folio text, completado timestamp with time zone, servicio text, cliente text, operador text, proveedor text, aseguradora text, bruto numeric, cubierto numeric, copago numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las finanzas';
  END IF;

  RETURN QUERY
  SELECT c.folio,
         sr.completed_at,
         sr.service_type,
         cli.full_name,
         ope.full_name,
         pr.name,
         COALESCE(i.name, mp.name),  -- 00098: o el programa MOPT que paga
         sr.total_price,
         -- Sin cobertura, lo cubierto es 0 y el cliente paga el bruto: asi la
         -- fila cierra igual que las que si tienen consumo.
         COALESCE(cu.amount_covered, CASE WHEN sr.mopt_provider_id IS NOT NULL THEN sr.total_price ELSE 0 END),
         COALESCE(cu.amount_copay, CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 0 ELSE sr.total_price END)
    FROM service_requests sr
    LEFT JOIN cases c            ON c.request_id = sr.id
    LEFT JOIN profiles cli       ON cli.id = sr.user_id
    LEFT JOIN profiles ope       ON ope.id = sr.operator_id
    LEFT JOIN providers pr       ON pr.id = sr.provider_id
    LEFT JOIN coverage_usage cu  ON cu.request_id = sr.id
    LEFT JOIN members m          ON m.id  = cu.member_id
    LEFT JOIN policies po        ON po.id = m.policy_id
    LEFT JOIN insurers i         ON i.id  = po.insurer_id
    LEFT JOIN providers mp       ON mp.id = sr.mopt_provider_id
   WHERE sr.status = 'completed'
     AND sr.completed_at >= sv_day_start(p_from)
     AND sr.completed_at <  sv_day_start(p_to + 1)
   ORDER BY sr.completed_at DESC;
END;
$function$;

-- my_operator_earnings: 00098 el operador del MOPT cobra el total (el MOPT no retiene comision)
CREATE OR REPLACE FUNCTION public.my_operator_earnings(p_from date, p_to date)
 RETURNS TABLE(servicios bigint, bruto numeric, comision_pct numeric, comision numeric, a_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_op UUID := auth.uid();
BEGIN
  IF v_op IS NULL THEN
    RAISE EXCEPTION 'Se necesita una sesion';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT,
    COALESCE(SUM(sr.total_price), 0),
    -- El porcentaje se informa para poder explicarle al operador de donde sale
    -- la retencion. MAX sobre un valor constante por operador.
    COALESCE(MAX((CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 0 ELSE effective_commission_rate(pr.id, ope.commission_rate) END)), default_commission_rate()),
    COALESCE(SUM(ROUND(sr.total_price * (CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 0 ELSE effective_commission_rate(pr.id, ope.commission_rate) END) / 100, 2)), 0),
    COALESCE(SUM(sr.total_price), 0)
      - COALESCE(SUM(ROUND(sr.total_price * (CASE WHEN sr.mopt_provider_id IS NOT NULL THEN 0 ELSE effective_commission_rate(pr.id, ope.commission_rate) END) / 100, 2)), 0)
  FROM service_requests sr
  LEFT JOIN profiles  ope ON ope.id = sr.operator_id
  LEFT JOIN providers pr  ON pr.id  = sr.provider_id
  WHERE sr.operator_id = v_op
    AND sr.status = 'completed'
    AND sr.completed_at >= sv_day_start(p_from)
    AND sr.completed_at <  sv_day_start(p_to + 1);
END;
$function$;

-- admin_update_user_role: 00098 MOPT va por admin_link_mopt_user
CREATE OR REPLACE FUNCTION public.admin_update_user_role(p_user_id uuid, p_new_role user_role, p_provider_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_profile profiles;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can update user roles';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;

  -- 00093: una cuenta de aseguradora necesita SU aseguradora; eso lo hace
  -- admin_link_insurer_user.
  -- 00098: una cuenta MOPT necesita SU programa; eso lo hace admin_link_mopt_user.
  IF p_new_role::text = 'MOPT' THEN
    RAISE EXCEPTION 'Para vincular una cuenta al MOPT usa admin_link_mopt_user';
  END IF;

  IF p_new_role = 'INSURER' THEN
    RAISE EXCEPTION 'Para convertir en aseguradora usa admin_link_insurer_user';
  END IF;

  IF p_new_role = 'OPERATOR' AND p_provider_id IS NULL THEN
    RAISE NOTICE 'Warning: Operator without provider assignment';
  END IF;

  IF p_new_role != 'OPERATOR' THEN
    p_provider_id := NULL;
  END IF;

  UPDATE profiles
     SET role = p_new_role,
         provider_id = p_provider_id,
         -- 00076: misma logica que `provider_id` justo arriba — al dejar de ser
         -- operador se limpia, y al pasar a serlo entra como 'pending' salvo que
         -- ya traiga una revision hecha.
         verification_status = CASE
           WHEN p_new_role = 'OPERATOR' THEN COALESCE(verification_status, 'pending')
           ELSE NULL
         END,
         -- 00080: la comision personal existe SOLO mientras el operador liquida
         -- por su cuenta. Al entrar a una empresa manda la de la empresa, asi
         -- que se limpia en vez de quedar como configuracion muerta.
         commission_rate = CASE
           WHEN p_new_role = 'OPERATOR' AND p_provider_id IS NULL THEN commission_rate
           ELSE NULL
         END,
         -- 00093: el destino nunca es INSURER, asi que el vinculo se va.
         insurer_id = NULL,
         updated_at = NOW()
   WHERE id = p_user_id
  RETURNING * INTO v_profile;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'new_role', p_new_role,
    'provider_id', p_provider_id,
    'full_name', v_profile.full_name
  );
END;
$function$;
