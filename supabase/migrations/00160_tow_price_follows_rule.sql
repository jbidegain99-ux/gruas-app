-- =====================================================================
-- 00160 — El "Desde $" de la grúa sigue a la tarifa activa
--
-- La grúa se cobra con pricing_rules (calculate_price: cargo base + km
-- extra), pero la tarjeta "Grúa · Desde $X" de la app sale del catálogo
-- (services.base_price). Eran dos números sueltos: al activar la tarifa
-- nocturna ($75) la app seguía diciendo "Desde $60", y en Servicios el admin
-- podía cambiar el precio de la grúa sin que cambiara lo cobrado.
--
-- Ahora services.base_price de la grúa es un reflejo del cargo base de la
-- tarifa activa: se actualiza al activar o editar una tarifa y no se puede
-- desalinear editando el catálogo. Los demás servicios no cambian (su precio
-- sí vive en el catálogo).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.active_tow_base_fee()
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT base_exit_fee FROM pricing_rules WHERE is_active LIMIT 1;
$$;

-- Catálogo: la grúa no se edita a mano; toma el cargo base de la tarifa activa.
CREATE OR REPLACE FUNCTION public.services_tow_price_from_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fee NUMERIC := active_tow_base_fee();
BEGIN
  IF NEW.slug = 'tow' AND v_fee IS NOT NULL THEN
    NEW.base_price := v_fee;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS services_tow_price_from_rule ON public.services;
CREATE TRIGGER services_tow_price_from_rule
  BEFORE INSERT OR UPDATE OF base_price, slug ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.services_tow_price_from_rule();

-- Tarifas: al activar una o cambiar el cargo base de la activa, el catálogo
-- se pone al día (el trigger de arriba pone el valor).
CREATE OR REPLACE FUNCTION public.pricing_rules_sync_tow_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE services SET base_price = base_price WHERE slug = 'tow';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pricing_rules_sync_tow_price ON public.pricing_rules;
CREATE TRIGGER pricing_rules_sync_tow_price
  AFTER INSERT OR UPDATE OF is_active, base_exit_fee OR DELETE ON public.pricing_rules
  FOR EACH STATEMENT EXECUTE FUNCTION public.pricing_rules_sync_tow_price();

-- Alinear lo que ya hay.
UPDATE public.services SET base_price = base_price WHERE slug = 'tow';
