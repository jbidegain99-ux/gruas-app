-- =====================================================================
-- 00166 — Buscar en todas las solicitudes, y precios no negativos
--
-- 1. Solicitudes del panel trae las últimas 300 y la búsqueda (folio, nombre,
--    teléfono, dirección) filtraba solo esas en el navegador: un servicio más
--    viejo —el que el Usuario reclama por teléfono dictando su folio— no
--    aparecía. admin_search_request_ids busca en todas, en la base, y devuelve
--    los ids (hasta 100, los más nuevos primero). Solo el personal.
-- 2. pricing_rules y services no tenían CHECK: un error de tipeo del admin
--    (o una llamada directa) dejaba tarifas o precios negativos, que se
--    cobraban en cada servicio siguiente. El formulario ya pide min=0; esto es
--    la red de la base.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_search_request_ids(p_q TEXT, p_limit INTEGER DEFAULT 100)
RETURNS SETOF UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q      TEXT := btrim(COALESCE(p_q, ''));
  v_digits TEXT := regexp_replace(COALESCE(p_q, ''), '\D', '', 'g');
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de Budi';
  END IF;
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT r.id
    FROM service_requests r
    LEFT JOIN cases c ON c.request_id = r.id
    LEFT JOIN profiles u ON u.id = r.user_id
   WHERE c.folio ILIKE '%' || v_q || '%'
      OR u.full_name ILIKE '%' || v_q || '%'
      OR r.pickup_address ILIKE '%' || v_q || '%'
      OR r.dropoff_address ILIKE '%' || v_q || '%'
      OR r.id::text LIKE lower(v_q) || '%'
      -- Teléfono por dígitos (≥4): "7000-0001" encuentra "+50370000001".
      OR (length(v_digits) >= 4 AND regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
   ORDER BY r.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_request_ids(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_request_ids(TEXT, INTEGER) TO authenticated;

ALTER TABLE public.pricing_rules
  ADD CONSTRAINT pricing_rules_non_negative CHECK (
    base_exit_fee >= 0 AND included_km >= 0 AND price_per_km_light >= 0 AND price_per_km_heavy >= 0
  );
ALTER TABLE public.services
  ADD CONSTRAINT services_prices_non_negative CHECK (base_price >= 0 AND COALESCE(extra_fee, 0) >= 0);
