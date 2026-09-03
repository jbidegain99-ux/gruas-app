-- =====================================================
-- 00045 — Eliminar el rol MOP
--
-- Decision de producto: el MOP no forma parte del producto que se esta
-- construyendo. Se retira del esquema por completo en vez de dejarlo inerte:
-- un rol muerto con politicas RLS vivas es superficie de ataque gratis y ruido
-- permanente en toda auditoria.
--
-- OJO — la 00043 se quedo corta. Aquella auditoria busco `is_mop()` y por eso
-- solo encontro tres politicas. Estas otras cinco comparan `profiles.role`
-- directamente y se le escaparon, de modo que el MOP tambien podia leer
-- `ratings`, `services`, `provider_services`, `providers` (por una segunda via)
-- y los recorridos de `service_location_trail`:
--     provider_services      -> "MOP read all provider_services"
--     providers              -> "MOP can view providers"
--     ratings                -> "MOP can view all ratings"
--     services               -> "MOP read all services"
--     service_location_trail -> "View service trail" (MOP dentro de un ARRAY)
-- Leccion para la proxima auditoria: buscar el literal del rol, no solo el helper.
--
-- Seguro de aplicar: al escribir esto habia **0 perfiles con rol MOP**, asi que
-- la conversion del enum no toca ninguna fila. Verificar antes de `db push`:
--     SELECT count(*) FROM profiles WHERE role = 'MOP';
--
-- Postgres no deja borrar un valor de un enum, ni cambiar el tipo de una columna
-- de la que dependan politicas, vistas o funciones. Hay que soltar todo eso,
-- recrear los tipos y volver a montarlo. Lo que se conserva se reescribe con los
-- helpers `is_admin()` / `is_operator()` de la 00024: mismo efecto, SECURITY
-- DEFINER, y dejan de depender del tipo, que es lo que provoco esta friccion.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Politicas exclusivas del MOP: se van y no vuelven
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "MOP can view profiles involved in requests" ON profiles;
DROP POLICY IF EXISTS "MOP can view profiles"                      ON profiles;
DROP POLICY IF EXISTS "MOP can view all requests"                  ON service_requests;
DROP POLICY IF EXISTS "MOP can view all providers"                 ON providers;
DROP POLICY IF EXISTS "MOP can view providers"                     ON providers;
DROP POLICY IF EXISTS "MOP read all provider_services"             ON provider_services;
DROP POLICY IF EXISTS "MOP can view all ratings"                   ON ratings;
DROP POLICY IF EXISTS "MOP read all services"                      ON services;
DROP POLICY IF EXISTS "MOP can view all pricing rules"             ON pricing_rules;
DROP POLICY IF EXISTS "MOP can view all events"                    ON request_events;

-- ---------------------------------------------------------------
-- 2. Politicas conservadas que mencionan `role`: soltar para poder cambiar
--    el tipo. Se recrean en el paso 6.
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view all device tokens"      ON device_tokens;
DROP POLICY IF EXISTS "Admins can view all locations"          ON operator_locations;
DROP POLICY IF EXISTS "Admin full access to provider_services" ON provider_services;
DROP POLICY IF EXISTS "Operator read own provider services"    ON provider_services;
DROP POLICY IF EXISTS "Operators can view active providers"    ON providers;
DROP POLICY IF EXISTS "Admins can view all ratings"            ON ratings;
DROP POLICY IF EXISTS "Admins can view all messages"           ON request_messages;
-- `pin_attempts` la crea 00025. Faltaba aca, y como en local 00025/00026 no
-- estaban aplicadas cuando esta migracion corrio, el hueco no se noto: la
-- politica no existia. En cualquier entorno con la cadena completa —produccion,
-- una instalacion nueva— este ALTER TYPE falla con "cannot alter type of a
-- column used in a policy definition".
DROP POLICY IF EXISTS "Admins read all attempts"               ON pin_attempts;
DROP POLICY IF EXISTS "View service trail"                     ON service_location_trail;
DROP POLICY IF EXISTS "Users can create requests"              ON service_requests;
DROP POLICY IF EXISTS "Admins can manage service pricing"      ON service_type_pricing;
DROP POLICY IF EXISTS "Admin full access to services"          ON services;

-- Tambien en `storage`: son las que dejan al admin abrir los documentos de
-- verificacion de operadores (buckets privados de la 00010).
DROP POLICY IF EXISTS "Admins can view all ID documents"      ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all vehicle documents" ON storage.objects;

-- ---------------------------------------------------------------
-- 3. Vista y funciones que dependen de los tipos
-- ---------------------------------------------------------------
DROP VIEW IF EXISTS public.operator_stats;

DROP FUNCTION IF EXISTS public.create_request_event(uuid, event_type, jsonb);
DROP FUNCTION IF EXISTS public.auth_user_role();
DROP FUNCTION IF EXISTS public.admin_update_user_role(uuid, user_role, uuid);
-- Sobrecarga heredada de una version anterior: la de tres argumentos ya tiene
-- DEFAULT en `p_provider_id`, asi que ambas competian por las llamadas de dos
-- argumentos. Se retira y no se recrea.
DROP FUNCTION IF EXISTS public.admin_update_user_role(uuid, user_role);

DROP FUNCTION IF EXISTS public.is_mop();
-- Solo la usaba la politica de `profiles` para el MOP (00043).
DROP FUNCTION IF EXISTS public.participa_en_algun_servicio(UUID);

-- ---------------------------------------------------------------
-- 4. Recrear los enums sin los valores del MOP
-- ---------------------------------------------------------------
-- `MOP_NOTIFIED` quedo declarado en la 00001 pero nunca se emitio (0 filas).
ALTER TABLE public.profiles ALTER COLUMN role DROP DEFAULT;

ALTER TYPE public.user_role RENAME TO user_role_old;
CREATE TYPE public.user_role AS ENUM ('USER', 'OPERATOR', 'ADMIN');

ALTER TABLE public.profiles
  ALTER COLUMN role TYPE public.user_role USING role::text::public.user_role;
ALTER TABLE public.request_events
  ALTER COLUMN actor_role TYPE public.user_role USING actor_role::text::public.user_role;

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'USER';
DROP TYPE public.user_role_old;

ALTER TYPE public.event_type RENAME TO event_type_old;
CREATE TYPE public.event_type AS ENUM (
  'REQUEST_CREATED',
  'OPERATOR_ACCEPTED',
  'OPERATOR_EN_ROUTE',
  'PIN_VERIFIED',
  'STATUS_CHANGED',
  'OPERATOR_CANCELLED',
  'ADMIN_CANCELLED',
  'USER_CANCELLED',
  'PRICE_COMPUTED',
  'MESSAGE_SENT',
  'RATING_SUBMITTED'
);

ALTER TABLE public.request_events
  ALTER COLUMN event_type TYPE public.event_type USING event_type::text::public.event_type;

DROP TYPE public.event_type_old;

-- ---------------------------------------------------------------
-- 5. Recrear vista y funciones, identicas salvo el tipo
-- ---------------------------------------------------------------
CREATE VIEW public.operator_stats AS
 SELECT p.id AS operator_id,
    p.full_name,
    count(DISTINCT sr.id) AS total_services,
    count(DISTINCT sr.id) FILTER (WHERE sr.status = 'completed'::request_status) AS completed_services,
    count(DISTINCT sr.id) FILTER (WHERE sr.status = 'cancelled'::request_status) AS cancelled_services,
    COALESCE(avg(r.stars), 0::numeric)::numeric(3,2) AS average_rating,
    count(r.id) AS total_ratings
   FROM profiles p
     LEFT JOIN service_requests sr ON sr.operator_id = p.id
     LEFT JOIN ratings r ON r.rated_operator_id = p.id
  WHERE p.role = 'OPERATOR'::user_role
  GROUP BY p.id, p.full_name;

CREATE FUNCTION public.create_request_event(
  p_request_id uuid, p_event_type event_type, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS request_events
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_event request_events;
  v_actor_role user_role;
BEGIN
  SELECT role INTO v_actor_role FROM profiles WHERE id = auth.uid();

  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (p_request_id, auth.uid(), v_actor_role, p_event_type, p_payload)
  RETURNING * INTO v_event;

  RETURN v_event;
END;
$function$;

CREATE FUNCTION public.auth_user_role() RETURNS user_role
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_role user_role;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  RETURN v_role;
END;
$function$;

CREATE FUNCTION public.admin_update_user_role(
  p_user_id uuid, p_new_role user_role, p_provider_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
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

  IF p_new_role = 'OPERATOR' AND p_provider_id IS NULL THEN
    RAISE NOTICE 'Warning: Operator without provider assignment';
  END IF;

  IF p_new_role != 'OPERATOR' THEN
    p_provider_id := NULL;
  END IF;

  UPDATE profiles
     SET role = p_new_role,
         provider_id = p_provider_id,
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

GRANT EXECUTE ON FUNCTION public.create_request_event(uuid, event_type, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(uuid, user_role, uuid) TO authenticated;
GRANT SELECT ON public.operator_stats TO authenticated;

-- ---------------------------------------------------------------
-- 6. Recrear las politicas conservadas, ya sin MOP
-- ---------------------------------------------------------------
CREATE POLICY "Admins can view all device tokens"
  ON device_tokens FOR SELECT USING (is_admin());

CREATE POLICY "Admins can view all locations"
  ON operator_locations FOR SELECT USING (is_admin());

-- Solo si 00025 ya paso: la tabla puede no existir en una base a medio migrar.
DO $$
BEGIN
  IF to_regclass('public.pin_attempts') IS NOT NULL THEN
    CREATE POLICY "Admins read all attempts"
      ON pin_attempts FOR SELECT USING (is_admin());
  END IF;
END $$;

CREATE POLICY "Admin full access to provider_services"
  ON provider_services FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Operator read own provider services"
  ON provider_services FOR SELECT
  USING (
    is_operator() AND EXISTS (
      SELECT 1 FROM profiles
       WHERE profiles.id = auth.uid()
         AND profiles.provider_id = provider_services.provider_id
    )
  );

CREATE POLICY "Operators can view active providers"
  ON providers FOR SELECT
  USING (is_active = true AND is_operator());

CREATE POLICY "Admins can view all ratings"
  ON ratings FOR SELECT USING (is_admin());

CREATE POLICY "Admins can view all messages"
  ON request_messages FOR SELECT USING (is_admin());

-- Antes ADMIN y MOP veian todos los recorridos; ahora solo el admin.
CREATE POLICY "View service trail"
  ON service_location_trail FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
       WHERE sr.id = service_location_trail.request_id
         AND (sr.user_id = auth.uid() OR sr.operator_id = auth.uid())
    )
    OR is_admin()
  );

CREATE POLICY "Users can create requests"
  ON service_requests FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
       WHERE profiles.id = auth.uid() AND profiles.role = 'USER'
    )
  );

CREATE POLICY "Admins can manage service pricing"
  ON service_type_pricing FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admin full access to services"
  ON services FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admins can view all ID documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'id-documents' AND is_admin());

CREATE POLICY "Admins can view all vehicle documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'vehicle-documents' AND is_admin());
