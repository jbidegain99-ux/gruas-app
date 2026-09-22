-- =====================================================
-- 00041 — Registro del consentimiento de privacidad (Decreto 144)
--
-- La ley exige que el consentimiento sea libre, informado y especifico, y que el
-- responsable pueda ACREDITARLO. Una casilla marcada en la UI que no se persiste
-- no acredita nada, asi que se guarda cuando se acepto y si hubo opt-in de
-- marketing.
--
-- Se separan a proposito en dos columnas:
--   · privacy_accepted_at — aviso de privacidad y terminos. Es requisito para
--     usar la plataforma, por eso se guarda la FECHA (sirve para saber que
--     version del aviso acepto la persona cuando el texto cambie).
--   · marketing_opt_in    — comunicaciones comerciales. Es lo UNICO que se trata
--     con base "consentimiento" (ver docs/PROTECCION_DATOS.md §4); el resto va
--     por ejecucion de contrato u obligacion legal. Debe poder revocarse.
--
-- Las cuentas anteriores a esta migracion quedan con privacy_accepted_at NULL:
-- refleja la verdad (nunca se les mostro el aviso) en vez de fabricar un
-- consentimiento retroactivo. Habra que pedirselo en el proximo inicio de sesion.
-- =====================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.privacy_accepted_at IS
  'Cuando el titular acepto el aviso de privacidad y los terminos. NULL = nunca lo acepto (cuentas previas al Decreto 144).';
COMMENT ON COLUMN profiles.marketing_opt_in IS
  'Consentimiento OPCIONAL y revocable para comunicaciones comerciales. No condiciona el uso del servicio.';

-- =====================================================
-- El trigger de alta copia ambos valores desde raw_user_meta_data, que es lo que
-- manda supabase.auth.signUp({ options: { data } }) desde movil y web.
-- Se mantiene el resto del cuerpo tal cual estaba en 00024.
-- =====================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, full_name, phone, role, email, privacy_accepted_at, marketing_opt_in
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
    COALESCE((NEW.raw_user_meta_data->>'marketing_opt_in')::boolean, false)
  );
  RETURN NEW;
END;
$$;

-- =====================================================
-- Permite al titular revocar (o dar) el opt-in de marketing mas adelante desde
-- su perfil, sin tocar el resto del registro. La politica de UPDATE de profiles
-- ya limita la fila a la suya; esta RPC existe para que la revocacion sea un
-- gesto explicito y no un update generico.
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_marketing_opt_in(p_value BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  UPDATE profiles SET marketing_opt_in = p_value, updated_at = NOW()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_marketing_opt_in(BOOLEAN) TO authenticated;
