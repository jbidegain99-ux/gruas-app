-- =====================================================
-- 00040 — Restringir quien ve la ubicacion en vivo de los operadores
--
-- Hallazgo del checklist RLS de B-07 (Decreto 144, proteccion de datos).
--
-- La politica de 00024 era:
--     EXISTS (profiles WHERE id = auth.uid() AND role IN ('USER','ADMIN','MOP'))
--     OR EXISTS (service_requests sr WHERE sr.operator_id = ... AND sr.user_id = auth.uid() ...)
--
-- El primer EXISTS concede la lectura a CUALQUIER cuenta con rol USER, sin
-- exigir que tenga un servicio en curso con ese operador. Como esta en un OR,
-- absorbe al segundo y lo vuelve decorativo: en la practica cualquier persona
-- que se registre en la app podia leer `operator_locations` completa y seguir
-- en tiempo real a todos los operadores. Geolocalizacion continua de personas
-- identificables, expuesta sin base legitima.
--
-- Aqui se separa por rol:
--   · ADMIN / MOP  -> siguen viendo toda la flota (despacho y supervision).
--   · USER         -> solo el operador asignado a SU servicio en curso.
--   · operador     -> su propia fila, via la politica "Operators can update own
--                     location" (FOR ALL, operator_id = auth.uid()), sin cambios.
--
-- Compatibilidad verificada antes de aplicar: la app movil consulta esta tabla
-- siempre con `.eq('operator_id', <operador del servicio>)`
-- (features/tracking/hooks/useOperatorRealtimeTracking.ts y
-- useOperatorLocationTracking.ts); el unico consumidor que lista toda la flota
-- es el panel admin (features/admin/fleet-data.ts), cubierto por is_admin().
-- Es decir: el caso de uso real del USER ya estaba contemplado por el segundo
-- EXISTS, asi que quitar el primero no rompe ninguna pantalla.
-- =====================================================

DROP POLICY IF EXISTS "Users can view operator locations" ON operator_locations;

-- Despacho y supervision: flota completa.
CREATE POLICY "Staff can view all operator locations"
  ON operator_locations FOR SELECT
  USING (is_admin() OR is_mop());

-- Cliente: unicamente el operador que lo esta atendiendo ahora mismo.
CREATE POLICY "Users can view their assigned operator location"
  ON operator_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.operator_id = operator_locations.operator_id
        AND sr.user_id = auth.uid()
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  );
