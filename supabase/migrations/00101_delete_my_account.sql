-- 00101: eliminar la cuenta desde la app.
--
-- Apple (guia 5.1.1(v)) rechaza apps que dejan crear una cuenta pero no
-- borrarla desde la propia app, y Google Play exige lo mismo mas una URL web
-- para pedirlo. El Decreto 144 da ademas el derecho de supresion.
--
-- Por que ANONIMIZAR y no borrar la fila de auth.users: el borrado cae en
-- cascada sobre profiles y de ahi sobre service_requests (user_id ON DELETE
-- CASCADE), y con ellos se irian liquidaciones, finanzas, casos de aseguradoras
-- y el libro de movimientos. Esos registros de servicios prestados y cobrados se
-- conservan por obligacion contable; lo que se suprime es todo lo que identifica
-- a la persona:
--
--   * perfil: nombre, telefono y email → reemplazados; DUI y su foto → borrados
--   * vehiculos guardados, tokens de push, notificaciones pendientes → borrados
--   * operador: documentos de verificacion y ultima ubicacion → borrados; sale
--     de su empresa o programa
--   * en SUS servicios: placa, marca, modelo, color, fotos y notas → borrados
--   * mensajes de chat que escribio → reemplazados; comentarios de calificacion → borrados
--   * afiliacion al padron: se desvincula (el padron es de la aseguradora)
--   * login: email y contrasena inservibles, sesiones cerradas, cuenta bloqueada
--
-- Los ARCHIVOS (fotos del DUI, documentos, fotos del vehiculo) no se pueden
-- borrar desde SQL —borrar la fila de storage.objects deja el archivo—, asi que
-- los borra la Edge Function `delete-account` con la API de Storage. Esta
-- funcion solo la llama esa Edge Function (service_role).

-- ---------------------------------------------------------------
-- 1. Constancia de la supresion (sin datos personales)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_deletions (
  user_id          UUID PRIMARY KEY,
  role             TEXT NOT NULL,
  deleted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lo completa la Edge Function al terminar de borrar los archivos. NULL =
  -- quedaron archivos por borrar (reintentar).
  files_removed_at TIMESTAMPTZ
);

COMMENT ON TABLE public.account_deletions IS
  '00101: constancia de cada cuenta eliminada por su titular. Solo el id (ya '
  'anonimo), el rol y cuando. files_removed_at NULL = archivos pendientes.';

ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_deletions: admin lee" ON public.account_deletions;
CREATE POLICY "account_deletions: admin lee" ON public.account_deletions
  FOR SELECT TO authenticated USING (is_admin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.account_deletions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- 2. La supresion
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role::text INTO v_role FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'La cuenta no existe';
  END IF;

  -- Las cuentas de gestion (admin, aseguradora, MOPT) las da de alta y de baja
  -- Budi: no son cuentas de consumidor, y borrar una se lleva el acceso de una
  -- organizacion entera.
  IF v_role NOT IN ('USER', 'OPERATOR') THEN
    RAISE EXCEPTION 'Esta cuenta la administra Budi. Pedi la baja a soporte.';
  END IF;

  -- Con un servicio en curso, borrar la cuenta dejaria a alguien varado (o a un
  -- operador sin poder cerrar el servicio).
  IF EXISTS (
    SELECT 1 FROM service_requests
     WHERE (user_id = p_user_id OR operator_id = p_user_id)
       AND status IN ('initiated', 'assigned', 'en_route', 'active')
  ) THEN
    RAISE EXCEPTION 'Tenes un servicio en curso. Terminalo o cancelalo antes de eliminar tu cuenta.';
  END IF;

  -- Login: primero auth.users, porque el trigger on_auth_user_email_updated
  -- copia el email al perfil y lo pisaria si fuera al reves.
  UPDATE auth.users
     SET email = 'eliminada+' || p_user_id || '@cuentas.budi.invalid',
         phone = NULL,
         encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
         raw_user_meta_data = '{}'::jsonb,
         -- 100 anos y no 'infinity': GoTrue (Go) no sabe leer una fecha infinita
         -- y responde 500 a toda operacion sobre el usuario, incluido el logout.
         -- Es la misma duracion que usa la API admin de Supabase para banear.
         banned_until = now() + interval '100 years',
         updated_at = now()
   WHERE id = p_user_id;
  DELETE FROM auth.sessions        WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens  WHERE user_id = p_user_id::text;
  DELETE FROM auth.identities      WHERE user_id = p_user_id;
  DELETE FROM auth.mfa_factors     WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;

  -- Perfil. El rol se conserva: los registros historicos dicen "un cliente" o
  -- "un operador", no quien.
  UPDATE profiles
     SET full_name = 'Cuenta eliminada',
         phone = '',
         email = NULL,
         marketing_opt_in = false,
         provider_id = NULL,
         insurer_id = NULL,
         commission_rate = NULL,
         verification_status = CASE WHEN role = 'OPERATOR' THEN 'rejected' END,
         verification_rejection_reason = CASE WHEN role = 'OPERATOR' THEN 'Cuenta eliminada por su titular' END,
         updated_at = now()
   WHERE id = p_user_id;

  DELETE FROM profile_sensitive  WHERE profile_id = p_user_id;
  DELETE FROM vehicles           WHERE user_id = p_user_id;
  DELETE FROM device_tokens      WHERE user_id = p_user_id;
  DELETE FROM notification_queue WHERE user_id = p_user_id;
  DELETE FROM operator_documents WHERE operator_id = p_user_id;
  DELETE FROM operator_locations WHERE operator_id = p_user_id;
  DELETE FROM pin_attempts       WHERE operator_id = p_user_id;

  UPDATE members SET profile_id = NULL, updated_at = now() WHERE profile_id = p_user_id;

  -- En sus servicios queda el hecho (que, donde, cuanto), no el vehiculo.
  UPDATE service_requests
     SET vehicle_plate = NULL, vehicle_make = NULL, vehicle_model = NULL, vehicle_color = NULL,
         vehicle_photo_url = NULL, vehicle_doc_path = NULL, notes = NULL
   WHERE user_id = p_user_id;

  UPDATE request_messages SET message = '[mensaje eliminado]' WHERE sender_id = p_user_id;
  UPDATE ratings SET comment = NULL WHERE rater_user_id = p_user_id;

  INSERT INTO account_deletions (user_id, role) VALUES (p_user_id, v_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'role', v_role);
END;
$$;

-- Solo la Edge Function (service_role). Un cliente no la llama directo: los
-- archivos quedarian sin borrar.
REVOKE ALL ON FUNCTION public.anonymize_account(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_account(UUID) TO service_role;
