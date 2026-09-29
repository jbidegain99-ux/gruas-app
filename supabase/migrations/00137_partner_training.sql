-- =====================================================
-- AGT-05 · Onboarding y capacitación del socio operador
--
--   * Guía en la app (aceptar, PIN de confirmación, completar y cobrar):
--     queda registrado cuándo la vio.
--   * Servicio de práctica: simulado en la app, no crea ni toca servicios
--     reales ni cuenta en ganancias; queda registrado cuándo lo terminó.
--   * Insignia "Socio verificado" que ve el Usuario en su servicio: sale de la
--     verificación de documentos (AGT-03), no de la práctica.
-- El admin ve el avance de capacitación en la ficha del socio.
-- =====================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS partner_guide_seen_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS partner_practice_done_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public._require_operator()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role::text = 'OPERATOR') THEN
    RAISE EXCEPTION 'Solo para socios operadores';
  END IF;
  RETURN auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public._require_operator() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_partner_training()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('guide_seen_at', p.partner_guide_seen_at, 'practice_done_at', p.partner_practice_done_at,
                            'verified', p.verification_status = 'approved')
    FROM profiles p WHERE p.id = _require_operator();
$$;

CREATE OR REPLACE FUNCTION public.mark_partner_guide_seen()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE profiles SET partner_guide_seen_at = COALESCE(partner_guide_seen_at, now()) WHERE id = _require_operator();
$$;

CREATE OR REPLACE FUNCTION public.complete_partner_practice()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE profiles
     SET partner_practice_done_at = COALESCE(partner_practice_done_at, now()),
         partner_guide_seen_at = COALESCE(partner_guide_seen_at, now())
   WHERE id = _require_operator();
$$;

-- Insignia para el Usuario de ESE servicio (y su socio o el personal de Budi).
CREATE OR REPLACE FUNCTION public.request_operator_badge(p_request UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  sr RECORD;
BEGIN
  SELECT r.user_id, r.operator_id INTO sr FROM service_requests r WHERE r.id = p_request;
  IF NOT FOUND OR sr.operator_id IS NULL
     OR NOT (auth.uid() = sr.user_id OR auth.uid() = sr.operator_id OR is_admin() OR is_support()) THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT jsonb_build_object(
            'verified', p.verification_status = 'approved',
            'completed_services', (SELECT count(*) FROM service_requests x
                                    WHERE x.operator_id = p.id AND x.status = 'completed'))
            FROM profiles p WHERE p.id = sr.operator_id);
END;
$$;

-- Admin: capacitación de un socio (para Verificaciones / ficha).
CREATE OR REPLACE FUNCTION public.admin_partner_training(p_operator UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (is_admin() OR is_support()) THEN
    RAISE EXCEPTION 'Solo personal de Budi';
  END IF;
  RETURN (SELECT jsonb_build_object('guide_seen_at', partner_guide_seen_at, 'practice_done_at', partner_practice_done_at)
            FROM profiles WHERE id = p_operator);
END;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['my_partner_training()', 'mark_partner_guide_seen()', 'complete_partner_practice()',
                           'request_operator_badge(uuid)', 'admin_partner_training(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
