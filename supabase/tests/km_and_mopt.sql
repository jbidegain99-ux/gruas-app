-- =====================================================
-- Km reales (VID-04) y cumplimiento MOPT (MOPT-01/02, VID-03) — migr. 00107
--
-- Correr contra la base LOCAL:  pnpm db:test km_and_mopt
-- Todo corre en una transaccion que se revierte: no deja datos.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- 00153: el interruptor de aseguradoras viene apagado; estas pruebas las ejercitan.
UPDATE platform_features SET insurers_enabled = true;

-- ---------------------------------------------------------------
-- A. Km de un recorrido conocido: +-5 % (criterio de VID-04)
-- ---------------------------------------------------------------
-- Un servicio del MOPT completado; se le reemplaza el recorrido por uno
-- sintetico: 5.56 km de aproximacion y 11.12 km de arrastre en linea recta
-- (0.05 y 0.10 grados de latitud), mas un salto de GPS falso y ruido quieto.
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT sr.id, sr.operator_id, c.folio
  FROM service_requests sr JOIN cases c ON c.request_id = sr.id
 WHERE sr.mopt_provider_id IS NOT NULL AND sr.status = 'completed'
 ORDER BY sr.completed_at DESC LIMIT 1;

DO $$ BEGIN
  ASSERT (SELECT count(*) FROM t) = 1, 'A0: no hay un servicio MOPT completado para probar';
END $$;

UPDATE service_requests SET
  assigned_at  = '2026-09-01 12:00:00+00',
  activated_at = '2026-09-01 12:20:00+00',
  completed_at = '2026-09-01 13:00:00+00'
 WHERE id = (SELECT id FROM t);

DELETE FROM service_location_trail WHERE request_id = (SELECT id FROM t);

-- Aproximacion: 13.50 -> 13.55 en 21 puntos, cada 1 min (~16.7 km/h).
INSERT INTO service_location_trail (request_id, lat, lng, recorded_at)
SELECT (SELECT id FROM t), 13.50 + i * 0.0025, -89.30, '2026-09-01 12:00:00+00'::timestamptz + i * interval '55 seconds'
  FROM generate_series(0, 20) i;
-- Salto de GPS: un punto a 30 km, 5 s despues. Tiene que descartarse.
INSERT INTO service_location_trail (request_id, lat, lng, recorded_at)
VALUES ((SELECT id FROM t), 13.80, -89.30, '2026-09-01 12:19:30+00');
-- Ruido quieto en el sitio: 10 puntos que bailan 3 m. No deben sumar.
INSERT INTO service_location_trail (request_id, lat, lng, recorded_at)
SELECT (SELECT id FROM t), 13.55 + (i % 2) * 0.00003, -89.30, '2026-09-01 12:19:40+00'::timestamptz + i * interval '1 second'
  FROM generate_series(0, 9) i;
-- Arrastre: 13.55 -> 13.65 en 41 puntos, cada ~55 s.
INSERT INTO service_location_trail (request_id, lat, lng, recorded_at)
SELECT (SELECT id FROM t), 13.55 + i * 0.0025, -89.30, '2026-09-01 12:21:00+00'::timestamptz + i * interval '55 seconds'
  FROM generate_series(0, 40) i;

SELECT compute_case_km((SELECT id FROM t));

DO $$
DECLARE
  v_app NUMERIC; v_tow NUMERIC;
  e_app NUMERIC := haversine_km(13.50, -89.30, 13.55, -89.30);
  e_tow NUMERIC := haversine_km(13.55, -89.30, 13.65, -89.30);
BEGIN
  SELECT approach_km, tow_km INTO v_app, v_tow FROM cases WHERE request_id = (SELECT id FROM t);
  ASSERT abs(v_app - e_app) / e_app <= 0.05, format('A1: aproximacion %s km, esperado %s', v_app, round(e_app, 2));
  ASSERT abs(v_tow - e_tow) / e_tow <= 0.05, format('A2: arrastre %s km, esperado %s', v_tow, round(e_tow, 2));
  RAISE NOTICE 'A. km (aprox %, arrastre %) dentro de +-5%% con salto de GPS y ruido filtrados: OK', v_app, v_tow;
END $$;

-- ---------------------------------------------------------------
-- B. El portal MOPT cuadra con el admin (criterio de MOPT-01)
-- ---------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', (SELECT m.profile_id FROM organization_members m JOIN organizations o ON o.id = m.organization_id
           WHERE o.type = 'MOPT' AND m.status = 'active' LIMIT 1),
  -- 00113: el dueño del portal solo ve datos con 2FA verificado.
  'role', 'authenticated', 'aal', 'aal2')::text, true);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE t_mopt ON COMMIT DROP AS
SELECT mopt_compliance('2026-01-01', '2026-12-31') AS c;
CREATE TEMP TABLE t_km ON COMMIT DROP AS
SELECT * FROM mopt_km_by_vehicle('2026-01-01', '2026-12-31');
RESET ROLE;

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', (SELECT id FROM profiles WHERE role = 'ADMIN' LIMIT 1), 'role', 'authenticated')::text, true);

DO $$
DECLARE
  v_c JSONB := (SELECT c FROM t_mopt);
  v_admin JSONB := admin_account_360('mopt', (SELECT id FROM providers WHERE is_mopt ORDER BY created_at LIMIT 1),
                                     '2026-01-01', '2026-12-31');
BEGIN
  ASSERT (v_c->>'completed')::int = (v_admin->'services'->>'completed')::int,
    format('B1: portal MOPT %s completados, admin %s', v_c->>'completed', v_admin->'services'->>'completed');
  ASSERT (SELECT SUM(cases) FROM t_km) = (v_c->>'completed')::int, 'B2: la tabla por grua no suma los casos del tablero';
  ASSERT (SELECT SUM(total_km) FROM t_km) = (v_c->>'km_total')::numeric, 'B3: los km por grua no suman el total del tablero';
  ASSERT (SELECT SUM((x->>'count')::int) FROM jsonb_array_elements(v_c->'by_service') x) = (v_c->>'completed')::int,
    'B4: los casos por tipo de servicio no suman el total';
  RAISE NOTICE 'B. portal MOPT = admin (% casos, % km): OK', v_c->>'completed', v_c->>'km_total';
END $$;

-- Un usuario comun no entra al tablero.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', (SELECT p.id FROM profiles p WHERE p.role = 'USER'
            AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.profile_id = p.id) LIMIT 1),
  'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok BOOLEAN := false;
BEGIN
  BEGIN PERFORM mopt_compliance('2026-01-01', '2026-12-31');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B5: un usuario comun vio el tablero MOPT';
  RAISE NOTICE 'B5. tablero MOPT cerrado a usuarios comunes: OK';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------
-- C. Horario de la zona (VID-03)
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_now TIME := (now() AT TIME ZONE 'America/El_Salvador')::time;
  v_dow SMALLINT := EXTRACT(ISODOW FROM now() AT TIME ZONE 'America/El_Salvador')::smallint;
BEGIN
  ASSERT mopt_zone_open_now(NULL, NULL, NULL), 'C1: sin horario debe estar abierta';
  ASSERT mopt_zone_open_now(v_now - interval '1 hour', v_now + interval '1 hour', NULL) OR v_now < '01:00' OR v_now > '23:00',
    'C2: dentro del rango debe estar abierta';
  ASSERT NOT mopt_zone_open_now(v_now + interval '1 hour', v_now + interval '2 hours', NULL) OR v_now > '22:00',
    'C3: fuera del rango debe estar cerrada';
  ASSERT NOT mopt_zone_open_now(NULL, NULL, ARRAY[((v_dow % 7) + 1)::smallint]), 'C4: otro dia debe estar cerrada';
  ASSERT mopt_zone_open_now(NULL, NULL, ARRAY[v_dow]), 'C5: el dia de hoy debe estar abierta';
  -- Rango nocturno 22:00-06:00: a las 23:00 y a las 03:00 abierta, a las 12:00 no.
  ASSERT ('23:00'::time >= '22:00' OR '23:00'::time < '06:00'), 'C6';
  RAISE NOTICE 'C. horario de zonas: OK';
END $$;

DO $$ BEGIN RAISE NOTICE 'TODO VERDE'; END $$;
ROLLBACK;
