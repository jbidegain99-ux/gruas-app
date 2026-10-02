-- =====================================================================
-- 00161 — Un solo formato de teléfono en los perfiles
--
-- El teléfono se guardaba como lo escribía cada formulario: el registro de
-- Usuario (app y web) lo dejaba tal cual ("7555-1234"), el registro de socio y
-- el de interesados lo normalizaban ("+50371234567"), y las cuentas creadas a
-- mano tenían otro más ("+503 7000-0001"). El panel, los enlaces de llamar y de
-- WhatsApp y las búsquedas veían tres formatos para lo mismo.
--
-- Ahora todo teléfono de El Salvador (8 dígitos que empiezan en 2, 6 o 7, con
-- o sin 503) se guarda como "+503XXXXXXXX", lo escriba quien lo escriba: el
-- alta (handle_new_user), editar el perfil, el registro de socio o el panel.
-- Un número de otro país (o vacío) se deja como vino, sin espacios a los
-- lados. La web y la app lo muestran como "+503 7123-4567" (formatPhone en
-- @gruas-app/shared, la misma regla).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.normalize_sv_phone(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_d TEXT := regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g');
BEGIN
  IF v_d ~ '^503\d{8}$' THEN v_d := substr(v_d, 4); END IF;
  IF v_d ~ '^[267]\d{7}$' THEN RETURN '+503' || v_d; END IF;
  -- profiles.phone es NOT NULL y el alta guarda '' cuando no hay teléfono.
  RETURN CASE WHEN p_raw IS NULL THEN NULL ELSE btrim(p_raw) END;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_normalize_phone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.phone := normalize_sv_phone(NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_normalize_phone ON public.profiles;
CREATE TRIGGER trg_profiles_normalize_phone
  BEFORE INSERT OR UPDATE OF phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_normalize_phone();

-- Alinear los que ya existen sin llenar la bitácora con un "cambio" por
-- persona ni mover updated_at: es un cambio de formato, no de dato.
ALTER TABLE public.profiles DISABLE TRIGGER trg_audit;
ALTER TABLE public.profiles DISABLE TRIGGER update_profiles_updated_at;
UPDATE public.profiles
   SET phone = normalize_sv_phone(phone)
 WHERE phone IS DISTINCT FROM normalize_sv_phone(phone);
ALTER TABLE public.profiles ENABLE TRIGGER update_profiles_updated_at;
ALTER TABLE public.profiles ENABLE TRIGGER trg_audit;
