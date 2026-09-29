-- =====================================================
-- Bug: el Usuario no veía al socio operador asignado
--
-- La app del Usuario leía el nombre y el teléfono del socio con un embed de
-- PostgREST (`operator:profiles!service_requests_operator_id_fkey`), pero
-- ninguna política de `profiles` deja al Usuario leer el perfil de su socio:
-- el embed volvía siempre NULL. Consecuencias: en el servicio activo no salía
-- "Socio operador asignado", el botón de llamar no tenía teléfono, el chat no
-- tenía nombre y el historial decía "Cancelada por el socio operador" sin
-- nombre.
--
-- No se abre la fila de `profiles` (tiene correo, rol, datos de verificación):
-- una RPC devuelve solo nombre y, mientras el servicio está en curso,
-- teléfono; y solo de los servicios del propio Usuario.
-- =====================================================

CREATE OR REPLACE FUNCTION public.my_request_operators(p_request_ids UUID[])
RETURNS TABLE (request_id UUID, operator_name TEXT, operator_phone TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sr.id,
         op.full_name,
         CASE WHEN sr.status::text IN ('assigned', 'en_route', 'active') THEN op.phone END
    FROM service_requests sr
    JOIN profiles op ON op.id = sr.operator_id
   WHERE sr.id = ANY (p_request_ids)
     AND sr.user_id = auth.uid()
   LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.my_request_operators(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_request_operators(UUID[]) TO authenticated;
