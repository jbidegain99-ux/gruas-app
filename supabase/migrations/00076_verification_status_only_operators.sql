-- =====================================================
-- 00076 — La verificacion es de los operadores, y de nadie mas
--
-- `profiles.verification_status` es la puerta de la verificacion de operadores
-- (00038/00039, bajada al servidor en la 00058): un operador va fisicamente
-- donde un cliente varado, asi que su identidad se revisa antes de dejarlo
-- aceptar servicios. Para cualquier otro rol la columna no quiere decir nada.
--
-- Pero era NOT NULL con DEFAULT 'pending', asi que TODAS las cuentas cargaban un
-- valor, y encima incoherente entre si: el cliente y el admin figuraban como
-- 'approved' —nadie los reviso jamas— y la cuenta de aseguradora como 'pending',
-- como si tuviera una verificacion esperando.
--
-- Hoy no rompe nada: los tres lugares que la leen filtran antes por rol —
-- `accept_service_request`, el pool y el despacho lo hacen en SQL; el panel
-- cuenta con `.eq('role','OPERATOR')` y solo pinta el badge si es operador. El
-- problema es la trampa: cualquier consulta futura que mire la columna sin
-- acordarse de filtrar por rol va a tratar a la aseguradora como no verificada.
-- Se arregla el modelo en vez del dato, para que no haya que acordarse.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. La columna deja de obligar a un valor
-- ---------------------------------------------------------------
ALTER TABLE public.profiles ALTER COLUMN verification_status DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN verification_status DROP DEFAULT;

-- 2. Lo ya escrito: solo los operadores conservan su estado.
UPDATE public.profiles SET verification_status = NULL WHERE role <> 'OPERATOR';

-- 3. Y que no vuelva a pasar. NULL sigue permitido para un operador recien
--    creado por una via que no pase por el trigger; el gate no lo deja aceptar
--    servicios igual, porque exige 'approved'.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_verification_solo_operadores;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_verification_solo_operadores
  CHECK (verification_status IS NULL OR role = 'OPERATOR');

COMMENT ON COLUMN public.profiles.verification_status IS
  'Verificacion de identidad del OPERADOR (pending/approved/rejected). NULL en '
  'cualquier otro rol: no aplica. Ver migr. 00076.';

-- ---------------------------------------------------------------
-- 4. El alta: 'pending' solo si nace operador
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (
    id, full_name, phone, role, email, privacy_accepted_at, marketing_opt_in,
    verification_status
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'USER'),
    NEW.email,
    -- Solo se sella la fecha si el cliente informo la aceptacion.
    CASE
      WHEN (NEW.raw_user_meta_data->>'privacy_accepted') = 'true' THEN NOW()
      ELSE NULL
    END,
    COALESCE((NEW.raw_user_meta_data->>'marketing_opt_in')::boolean, false),
    -- 00076: la verificacion es de operadores. Antes lo ponia el DEFAULT de la
    -- columna, que se aplicaba a todos por igual y dejaba a un admin o una
    -- aseguradora con un 'pending' que no significaba nada.
    CASE WHEN COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'USER') = 'OPERATOR'
         THEN 'pending' ELSE NULL END
  );
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------
-- 5. El cambio de rol lo mantiene coherente
-- ---------------------------------------------------------------
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
