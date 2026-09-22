-- 00034_service_location_trail.sql
--
-- Graba el RECORRIDO REAL de cada servicio (las migas de pan del operador),
-- para poder dibujarlo después en el historial y como prueba de trayecto para
-- aseguradoras (Fase 2 del plan).
--
-- Hasta ahora `operator_locations` guardaba UNA sola fila por operador (upsert):
-- cada actualización de GPS pisaba la anterior, así que el trayecto se perdía.
-- Acá agregamos una tabla append-only y hacemos que `upsert_operator_location`
-- —que ya lo llaman tanto el tracking de primer plano como el de segundo—
-- inserte también un punto cuando el operador está trabajando una solicitud.

-- =====================================================
-- Tabla de rastro (append-only)
-- =====================================================
CREATE TABLE IF NOT EXISTS service_location_trail (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lectura típica: todos los puntos de una solicitud, en orden.
CREATE INDEX IF NOT EXISTS idx_service_location_trail_request
  ON service_location_trail(request_id, recorded_at);

ALTER TABLE service_location_trail ENABLE ROW LEVEL SECURITY;

-- El cliente de la solicitud, el operador asignado y admin/MOP pueden verlo.
-- No hay política de INSERT: sólo escribe la RPC SECURITY DEFINER de abajo.
DROP POLICY IF EXISTS "View service trail" ON service_location_trail;
CREATE POLICY "View service trail"
  ON service_location_trail FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = service_location_trail.request_id
        AND (sr.user_id = auth.uid() OR sr.operator_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('ADMIN', 'MOP')
    )
  );

GRANT SELECT ON service_location_trail TO authenticated;

-- =====================================================
-- upsert_operator_location: además de la última posición, graba el rastro
-- del servicio en curso.
--
-- La versión vigente es la de 3 args (lat, lng, is_online) que definió 00019
-- y es la que llama la app; se le AÑADE el INSERT condicional al rastro. La
-- vieja de 5 args ya la había eliminado 00019, así que la dejamos fuera para
-- no reintroducir la ambigüedad de sobrecarga.
-- =====================================================
DROP FUNCTION IF EXISTS upsert_operator_location(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
) CASCADE;

CREATE OR REPLACE FUNCTION upsert_operator_location(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_is_online BOOLEAN DEFAULT TRUE
)
RETURNS JSON AS $$
DECLARE
  v_location operator_locations;
  v_request_id UUID;
BEGIN
  INSERT INTO operator_locations (operator_id, lat, lng, is_online, updated_at)
  VALUES (auth.uid(), p_lat, p_lng, p_is_online, NOW())
  ON CONFLICT (operator_id)
  DO UPDATE SET
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    is_online = EXCLUDED.is_online,
    updated_at = NOW()
  RETURNING * INTO v_location;

  -- ¿Está el operador atendiendo una solicitud? Se graba desde que va en camino
  -- (en_route) hasta que el servicio está activo, para tener el trayecto
  -- completo operador→recogida→destino.
  SELECT sr.id INTO v_request_id
  FROM service_requests sr
  WHERE sr.operator_id = auth.uid()
    AND sr.status IN ('en_route', 'active')
  ORDER BY sr.assigned_at DESC NULLS LAST
  LIMIT 1;

  IF v_request_id IS NOT NULL THEN
    INSERT INTO service_location_trail (request_id, lat, lng)
    VALUES (v_request_id, p_lat, p_lng);
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
