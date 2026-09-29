-- =====================================================
-- 00110 — Que servicios son "Sin costo" en este punto (backlog VID-02)
--
-- El video muestra el catalogo con un badge "Sin costo" en los servicios que
-- cubre el MOPT. preview_mopt_program (00098) responde por UN servicio; el
-- catalogo necesita la lista entera sin hacer una llamada por tarjeta.
--
-- Misma regla que al crear la solicitud (mopt_payer_for): sin un seguro que
-- cubra ese servicio, y la ubicacion dentro de una zona MOPT activa, en su
-- horario (00107), que incluya el servicio.
-- =====================================================
CREATE OR REPLACE FUNCTION public.preview_mopt_services(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_coverage JSONB;
BEGIN
  IF auth.uid() IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN
    RETURN ARRAY[]::TEXT[];
  END IF;
  v_coverage := check_member_coverage();
  RETURN ARRAY(
    SELECT s.slug
      FROM services s
     WHERE s.is_active
       AND mopt_payer_for(v_coverage, p_lat, p_lng, s.slug) IS NOT NULL
     ORDER BY s.sort_order
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_mopt_services(DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_mopt_services(DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
