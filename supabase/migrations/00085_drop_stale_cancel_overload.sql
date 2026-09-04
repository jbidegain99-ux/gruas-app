-- =====================================================
-- 00085 — Borrar el overload viejo de admin_cancel_request
--
-- EL BUG
-- 00075 le agrego `p_reason` a `admin_cancel_request` con CREATE OR REPLACE.
-- Pero CREATE OR REPLACE solo reemplaza cuando la firma es identica: al cambiar
-- la lista de argumentos creo una funcion NUEVA y dejo viva la de 00006. La
-- base quedo con dos:
--
--   admin_cancel_request(p_request_id uuid)
--   admin_cancel_request(p_request_id uuid, p_reason text DEFAULT NULL)
--
-- Como la segunda tiene default, una llamada de UN argumento matchea las dos y
-- Postgres la rechaza:
--   42725: function admin_cancel_request(uuid) is not unique
--
-- Hoy el panel manda las dos claves, asi que PostgREST resuelve bien y no se
-- nota. Pero la vieja sigue siendo alcanzable y es la de ANTES de 00075: cancela
-- sin registrar `cancellation_reason` ni `cancelled_by`, que es justo lo que
-- 00075 vino a arreglar. Cualquiera que la llame con un solo argumento se come
-- el error, o peor, la version que no deja rastro.
--
-- Se borra solo la de un argumento; la de dos queda intacta.
-- =====================================================
DROP FUNCTION IF EXISTS public.admin_cancel_request(p_request_id UUID);

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'admin_cancel_request') <> 1 THEN
    RAISE EXCEPTION 'admin_cancel_request deberia quedar con una sola firma';
  END IF;
END $$;
