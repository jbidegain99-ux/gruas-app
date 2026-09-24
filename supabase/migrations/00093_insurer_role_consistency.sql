-- 00093: el rol INSURER y su `insurer_id` quedan consistentes en las dos RPC
-- que cambian roles.
--
-- Tres huecos, todos en la gestion de roles desde el panel admin:
--
-- 1. `admin_link_insurer_user` (00068) no tenia las guardas de
--    `admin_update_user_role`: un admin podia vincularse A SI MISMO (y perder el
--    panel sin forma de volver), y con un id inexistente no hacia nada y no
--    avisaba. Ademas no limpiaba lo que es solo de operador: al vincular a un
--    operador chocaba con `profiles_verification_solo_operadores` (00076) o con
--    `profiles_commission_solo_independientes` (00080), y el `provider_id`
--    quedaba colgando.
--
-- 2. `admin_update_user_role` aceptaba INSURER como rol destino, pero sin
--    aseguradora: la cuenta quedaba INSURER con `insurer_id` NULL, un portal
--    vacio. Convertir en aseguradora es trabajo de `admin_link_insurer_user`.
--
-- 3. Al sacar a alguien de INSURER, `insurer_id` no se limpiaba. Hoy no abre
--    nada porque `auth_insurer_id()` tambien exige el rol, pero si la cuenta
--    volvia a ser INSURER recuperaba EN SILENCIO el vinculo con la aseguradora
--    vieja. Se cierra igual que 00076/00080: limpieza en la RPC + un CHECK que
--    lo garantiza en la tabla.

-- ---------------------------------------------------------------
-- 1. Datos: limpiar vinculos colgados antes de poner el CHECK
-- ---------------------------------------------------------------
UPDATE public.profiles
   SET insurer_id = NULL, updated_at = now()
 WHERE insurer_id IS NOT NULL AND role::text <> 'INSURER';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_insurer_solo_aseguradoras;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_insurer_solo_aseguradoras
  CHECK (insurer_id IS NULL OR role = 'INSURER');

-- ---------------------------------------------------------------
-- 2. admin_update_user_role: sin INSURER como destino, y limpia insurer_id
-- ---------------------------------------------------------------
-- Cuerpo vivo de la 00080 + el rechazo de INSURER y la limpieza de insurer_id.
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

-- ---------------------------------------------------------------
-- 3. admin_link_insurer_user: mismas guardas que el cambio de rol
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_link_insurer_user(p_user_id UUID, p_insurer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede vincular una cuenta de aseguradora';
  END IF;
  -- 00093: igual que admin_update_user_role — un admin no se cambia el rol a si
  -- mismo (se quedaria fuera del panel).
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio rol';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM insurers WHERE id = p_insurer_id) THEN
    RAISE EXCEPTION 'La aseguradora no existe';
  END IF;

  -- 00093: lo que es solo de operador se limpia (CHECKs de 00076/00080).
  UPDATE profiles
     SET role = 'INSURER',
         insurer_id = p_insurer_id,
         provider_id = NULL,
         verification_status = NULL,
         commission_rate = NULL,
         updated_at = now()
   WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_link_insurer_user(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_insurer_user(UUID, UUID) TO authenticated;
