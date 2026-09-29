-- 00095: la plataforma nunca se queda sin administradores.
--
-- `admin_update_user_role` y `admin_link_insurer_user` ya impiden que un admin
-- se cambie el rol a si mismo (00093). Pero eso no alcanza: con dos admins, A
-- degrada a B y B degrada a A AL MISMO TIEMPO. Cada uno pasa `is_admin()` (el
-- otro todavia no hizo commit) y cada uno toca una fila distinta, asi que no se
-- bloquean entre si: los dos commits entran y la plataforma queda sin nadie que
-- pueda entrar al panel. Arreglarlo exigiria tocar la base a mano.
--
-- Un `SELECT count(*)` dentro de la RPC tampoco alcanza: bajo READ COMMITTED las
-- dos transacciones leen "queda otro admin" antes de que ninguna escriba.
--
-- La solucion (misma que TalentOS): un advisory lock de clave fija que
-- SERIALIZA toda perdida de un admin. No hay una "fila de la plataforma" que
-- bloquear con FOR UPDATE, asi que el advisory lock cumple ese rol. El segundo
-- espera al commit del primero y, como en READ COMMITTED cada sentencia toma un
-- snapshot nuevo, su conteo ya ve el cambio del primero.
--
-- Va en un trigger de `profiles` y no en las RPC: cubre cualquier camino que
-- saque a un admin (las dos RPC de hoy, una futura, o borrar la cuenta en
-- auth.users, que cae en cascada sobre profiles).

CREATE OR REPLACE FUNCTION public.guard_last_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Solo importa cuando un ADMIN deja de serlo (o desaparece).
  IF OLD.role::text <> 'ADMIN' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role::text = 'ADMIN' THEN
    RETURN NEW;
  END IF;

  -- Clave fija: serializa entre si todas las bajas de admin, y nada mas.
  PERFORM pg_advisory_xact_lock(hashtext('budi:guard_last_admin'));

  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE role::text = 'ADMIN' AND id <> OLD.id
  ) THEN
    RAISE EXCEPTION 'No se puede quitar al ultimo administrador: la plataforma se quedaria sin acceso al panel'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.guard_last_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_last_admin ON public.profiles;
CREATE TRIGGER trg_guard_last_admin
  BEFORE UPDATE OF role OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_admin();
