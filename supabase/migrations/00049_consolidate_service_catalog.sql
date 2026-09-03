-- Migration: un solo catalogo de servicios.
--
-- EL PROBLEMA
-- Habia dos catalogos con la misma forma y datos distintos:
--
--   services              (00022) — CRUD en /admin/services, FK desde
--                                   provider_services. Tenia el catalogo, pero
--                                   sus precios y recargos estaban en 0.
--   service_type_pricing  (00021) — sin ninguna UI, pero es de donde la app leia
--                                   nombres y precios y de donde
--                                   complete_service_request() COBRA.
--
-- O sea: el admin editaba una tabla y el sistema cobraba desde la otra. El caso
-- concreto que aparecio al revisar: `extra_fee` valia 15.00 (llanta sin repuesto)
-- y 4.50 (galon extra de combustible) en service_type_pricing, y 0.00 en
-- services. Consolidar hacia services sin mirar habria dejado de cobrar los dos
-- recargos, en silencio.
--
-- LA DECISION
-- Sobrevive `services` —es la que tiene la FK y la UI— pero los DATOS que ganan
-- son los de `service_type_pricing`, porque son los que la plataforma viene
-- usando de verdad. Una consolidacion nunca puede cambiar lo que se le cobra a
-- un cliente como efecto secundario.
--
-- CONSECUENCIA A TENER EN CUENTA AL APLICAR EN PRODUCCION
-- Si alguien edito un precio en /admin/services, ese cambio NUNCA tuvo efecto
-- (la app cobraba desde la otra tabla) y esta migracion lo sobrescribe con el
-- valor que realmente se estaba cobrando. Es deliberado: se conserva el
-- comportamiento observable. Los NOTICE de abajo listan cada valor que cambia,
-- para poder revisarlos en el log de `db push`.
-- De aca en adelante, editar en /admin/services SI tiene efecto.

-- ===============================================================
-- 1. Fusionar los datos vivos hacia `services`
-- ===============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT stp.service_type,
           s.id IS NULL AS falta_en_services,
           s.base_price  AS srv_precio, stp.base_price  AS stp_precio,
           s.extra_fee   AS srv_extra,  stp.extra_fee   AS stp_extra
      FROM service_type_pricing stp
      LEFT JOIN services s ON s.slug = stp.service_type
  LOOP
    IF r.falta_en_services THEN
      RAISE NOTICE '[catalogo] % no existia en services: se crea', r.service_type;
    ELSE
      IF r.srv_precio IS DISTINCT FROM r.stp_precio THEN
        RAISE NOTICE '[catalogo] %: base_price % -> % (gana lo que se cobraba)',
          r.service_type, r.srv_precio, r.stp_precio;
      END IF;
      IF r.srv_extra IS DISTINCT FROM r.stp_extra THEN
        RAISE NOTICE '[catalogo] %: extra_fee % -> % (gana lo que se cobraba)',
          r.service_type, r.srv_extra, r.stp_extra;
      END IF;
    END IF;
  END LOOP;
END $$;

-- Lo que ya existe en las dos: se traen los campos que la app usaba de verdad.
-- NO se tocan `name_es`/`name_en` ni `icon`: los nombres coinciden y el `icon` de
-- services usa nombres de lucide coherentes con lo que la UI pinta, mientras el
-- de service_type_pricing quedo a medias entre emojis y nombres de lucide.
UPDATE services s
   SET base_price           = stp.base_price,
       extra_fee            = stp.extra_fee,
       extra_fee_label      = stp.extra_fee_label,
       description_es       = COALESCE(NULLIF(stp.description, ''), s.description_es),
       requires_destination = stp.requires_destination,
       sort_order           = stp.sort_order,
       is_active            = stp.is_active,
       currency             = stp.currency,
       updated_at           = NOW()
  FROM service_type_pricing stp
 WHERE stp.service_type = s.slug;

-- Lo que solo existia en service_type_pricing (p. ej. un tipo dado de alta
-- despues de 00022): se crea. `name_en` cae al nombre en español porque no hay
-- traduccion de donde sacarla; es mejor eso que dejarlo NOT NULL vacio.
INSERT INTO services (
  slug, name_es, name_en, description_es, description_en, icon,
  base_price, extra_fee, extra_fee_label, requires_destination,
  sort_order, is_active, currency
)
SELECT stp.service_type, stp.display_name, stp.display_name,
       stp.description, '', COALESCE(NULLIF(stp.icon, ''), 'wrench'),
       stp.base_price, stp.extra_fee, stp.extra_fee_label, stp.requires_destination,
       stp.sort_order, stp.is_active, stp.currency
  FROM service_type_pricing stp
 WHERE NOT EXISTS (SELECT 1 FROM services s WHERE s.slug = stp.service_type)
ON CONFLICT (slug) DO NOTHING;

-- ===============================================================
-- 2. Cobrar desde el catalogo unico
-- ===============================================================
-- Copia literal de la definicion viva, con UNA sola diferencia: de que tabla
-- lee. Es la funcion que decide cuanto se le cobra al cliente por un servicio
-- que no es grua, asi que el cambio de tabla tenia que ir junto con la fusion de
-- datos de arriba — hacerlo antes habria puesto los recargos en 0.
--
-- Se conserva tal cual, sin `SET search_path`, aunque otras funciones SECURITY
-- DEFINER si lo tienen desde 00026. Endurecerla es un cambio aparte y no
-- corresponde colarlo en una migracion de consolidacion de catalogo.
CREATE OR REPLACE FUNCTION public.complete_service_request(
  p_request_id UUID,
  p_distance_pickup_to_dropoff NUMERIC
)
 RETURNS service_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_request service_requests;
  v_price_breakdown JSONB;
  v_total_distance NUMERIC;
  v_svc services;
  v_total NUMERIC;
  v_extra NUMERIC;
BEGIN
  SELECT * INTO v_request FROM service_requests
  WHERE id = p_request_id AND operator_id = auth.uid();

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found or not assigned to you';
  END IF;

  IF v_request.status != 'active' THEN
    RAISE EXCEPTION 'Request is not in active state';
  END IF;

  IF v_request.service_type = 'tow' THEN
    -- Tow: use existing calculate_price()
    v_total_distance := COALESCE(v_request.distance_operator_to_pickup_km, 0) + p_distance_pickup_to_dropoff;
    v_price_breakdown := calculate_price(v_total_distance, v_request.tow_type);
  ELSE
    -- Non-tow: tarifa plana del catalogo unico + extras
    SELECT * INTO v_svc FROM services
    WHERE slug = v_request.service_type AND is_active = true
    LIMIT 1;

    v_extra := 0;

    -- Tire: +extra_fee if no spare
    IF v_request.service_type = 'tire' AND v_svc.extra_fee > 0 THEN
      IF (v_request.service_details->>'has_spare')::boolean IS DISTINCT FROM true THEN
        v_extra := v_svc.extra_fee;
      END IF;
    END IF;

    -- Fuel: extra_fee per gallon (beyond 1 included)
    IF v_request.service_type = 'fuel' AND v_svc.extra_fee > 0 THEN
      DECLARE
        v_gallons NUMERIC;
      BEGIN
        v_gallons := COALESCE((v_request.service_details->>'gallons')::numeric, 1);
        IF v_gallons > 1 THEN
          v_extra := v_svc.extra_fee * (v_gallons - 1);
        END IF;
      END;
    END IF;

    v_total := v_svc.base_price + v_extra;

    v_price_breakdown := jsonb_build_object(
      'base_price', v_svc.base_price,
      'extra_fee', v_extra,
      'extra_fee_label', v_svc.extra_fee_label,
      'total', v_total,
      'currency', v_svc.currency,
      'service_type', v_request.service_type
    );
  END IF;

  UPDATE service_requests
  SET
    status = 'completed',
    distance_pickup_to_dropoff_km = p_distance_pickup_to_dropoff,
    price_breakdown = v_price_breakdown,
    total_price = (v_price_breakdown->>'total')::NUMERIC,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$function$;

-- ===============================================================
-- 3. service_type_pricing deja de ser una tabla
-- ===============================================================
-- Se reemplaza por una vista de solo lectura con las mismas columnas. Podria
-- borrarse del todo —en este repo ya no la usa nadie— pero produccion es un
-- entorno que no vemos desde aca: una vista deja que cualquier consumidor que se
-- nos haya pasado siga leyendo, y leyendo BIEN, en vez de romperse. Se borra en
-- una migracion posterior, cuando se confirme que nadie la consulta.
--
-- Nada la referencia por FK (verificado) y ninguna pantalla escribe en ella, asi
-- que perder la escritura no rompe nada: los cambios se hacen en /admin/services.
DROP TABLE IF EXISTS public.service_type_pricing CASCADE;

CREATE VIEW public.service_type_pricing
WITH (security_invoker = true) AS
  SELECT s.id,
         s.slug            AS service_type,
         s.name_es         AS display_name,
         s.description_es  AS description,
         s.icon,
         s.base_price,
         s.extra_fee,
         s.extra_fee_label,
         s.requires_destination,
         s.sort_order,
         s.is_active,
         s.currency,
         s.created_at,
         s.updated_at
    FROM public.services s;

-- security_invoker: la vista aplica el RLS de `services` al que consulta, en vez
-- de los permisos del dueño. Sin esto seria un agujero que saltaria las
-- politicas de la tabla.
COMMENT ON VIEW public.service_type_pricing IS
  'OBSOLETA — compatibilidad. El catalogo unico es `services` (migracion 00049). '
  'Solo lectura. No agregar consumidores nuevos; migrar los que queden a services.';

GRANT SELECT ON public.service_type_pricing TO authenticated;

COMMENT ON TABLE public.services IS
  'Catalogo unico de servicios (migracion 00049). Editable en /admin/services. '
  'De aca salen los precios que cobra complete_service_request() y el flag '
  'requires_destination que usa requiresDropoff() en el cliente.';
