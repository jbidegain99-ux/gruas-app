-- =====================================================
-- 00043 — Recortar el acceso del MOP a lo que de verdad usa
--
-- Continuacion del checklist RLS de B-07 (docs/PROTECCION_DATOS.md §7).
-- El MOP es un tercero EXTERNO. El principio de minimizacion del Decreto 144
-- pide darle lo necesario para su funcion y nada mas; tenia SELECT amplio sobre
-- seis tablas.
--
-- Auditoria de lo que su UI consulta de verdad
-- (apps/web/src/features/mop/MopDashboardPage.tsx y MopRequestsPage.tsx):
--   · service_requests            -> SI, es su pantalla principal
--   · profiles  (embed)           -> SI, pero solo full_name / email del usuario
--                                    y del operador de cada solicitud
--   · providers (embed)           -> SI, el nombre del proveedor
--   · operator_locations          -> NO lo consulta nunca
--   · pricing_rules               -> NO lo consulta nunca
--   · request_events              -> NO lo consulta nunca
--
-- Se retiran las tres que no usa y se acota `profiles` a las personas que
-- efectivamente participan en alguna solicitud: hoy el MOP puede leer el nombre,
-- telefono y correo de CUALQUIER cuenta registrada, incluida gente que nunca
-- pidio un servicio.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Tablas que el MOP no consulta
-- ---------------------------------------------------------------

-- La 00040 concedio la flota en vivo a `is_admin() OR is_mop()`. Fue de mas:
-- rastrear operadores en tiempo real no hace falta para su reporte y es el dato
-- mas invasivo del sistema. Queda solo el admin.
DROP POLICY IF EXISTS "Staff can view all operator locations" ON operator_locations;
CREATE POLICY "Admins can view all operator locations"
  ON operator_locations FOR SELECT
  USING (is_admin());

DROP POLICY IF EXISTS "MOP can view all pricing rules" ON pricing_rules;
DROP POLICY IF EXISTS "MOP can view all events" ON request_events;

-- ---------------------------------------------------------------
-- 2. `profiles`: solo quienes participan en un servicio
-- ---------------------------------------------------------------
-- SECURITY DEFINER a proposito: una politica de `profiles` que consultara
-- `service_requests` en linea dispararia la RLS de esa tabla, cuyas politicas
-- vuelven a mirar `profiles`. Es la misma recursion que arreglo la 00024 con
-- is_admin() / is_mop(), y se evita igual.
CREATE OR REPLACE FUNCTION public.participa_en_algun_servicio(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM service_requests sr
     WHERE sr.user_id = p_profile_id
        OR sr.operator_id = p_profile_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.participa_en_algun_servicio(UUID) TO authenticated;

DROP POLICY IF EXISTS "MOP can view profiles" ON profiles;
CREATE POLICY "MOP can view profiles involved in requests"
  ON profiles FOR SELECT
  USING (is_mop() AND participa_en_algun_servicio(profiles.id));
