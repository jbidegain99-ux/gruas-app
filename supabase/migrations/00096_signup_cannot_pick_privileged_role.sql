-- 00096: registrarse ya no permite elegir un rol privilegiado.
--
-- `handle_new_user` copiaba el rol de `raw_user_meta_data`, que es lo que manda
-- el propio cliente en `supabase.auth.signUp({ options: { data } })`. Con solo
-- la anon key, cualquiera podia registrarse con `role: 'ADMIN'` y entrar al
-- panel, o con `role: 'INSURER'` y abrir el portal de aseguradoras. Probado en
-- local el 2026-09-25: las dos altas quedaban con ese rol.
--
-- La 00054 cerro la escalada por UPDATE (el cliente ya no puede escribir
-- `role`), pero el alta es un INSERT hecho por el trigger, y ahi nadie miraba.
--
-- Arreglo:
-- * Por el registro publico solo se nace USER u OPERATOR, que es lo que
--   ofrecen las pantallas de registro. Cualquier otra cosa (ADMIN, INSURER, un
--   texto invalido) cae a USER en vez de fallar el alta.
-- * Nadie NACE admin ni aseguradora, tampoco por la API admin: se crea la
--   cuenta (queda USER) y un admin la promueve desde el panel —
--   `admin_update_user_role` para ADMIN, `admin_link_insurer_user` (00093) para
--   INSURER, que ademas necesita su aseguradora—. Asi el paso queda en la
--   bitacora (00094). (Se probo leer el rol de `raw_app_meta_data`, que el
--   cliente no puede escribir, pero GoTrue lo completa DESPUES del INSERT y el
--   trigger no lo ve.)

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role public.user_role;
BEGIN
  -- Lo unico que el propio usuario puede elegir al registrarse.
  v_role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'OPERATOR' THEN 'OPERATOR'
    ELSE 'USER'
  END::public.user_role;

  INSERT INTO public.profiles (
    id, full_name, phone, role, email, privacy_accepted_at, marketing_opt_in,
    verification_status
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    v_role,
    NEW.email,
    -- Solo se sella la fecha si el cliente informo la aceptacion.
    CASE
      WHEN (NEW.raw_user_meta_data->>'privacy_accepted') = 'true' THEN NOW()
      ELSE NULL
    END,
    COALESCE((NEW.raw_user_meta_data->>'marketing_opt_in')::boolean, false),
    -- 00076: la verificacion es de operadores.
    CASE WHEN v_role = 'OPERATOR' THEN 'pending' ELSE NULL END
  );
  RETURN NEW;
END;
$function$;
