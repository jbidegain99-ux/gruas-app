-- =====================================================
-- Buscar en todas las solicitudes y precios no negativos (migr. 00166)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Una solicitud con 310 más nuevas encima se encuentra por folio, nombre
--      y teléfono (el panel antes solo buscaba en las últimas 300).
--   B. Solo el personal busca.
--   C. Tarifas y precios negativos se rechazan.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(p UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.como TO PUBLIC;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
       jsonb_build_object('full_name', nombre, 'phone', tel, 'role', 'USER'), now(), now()
  FROM (VALUES ('c7c7c7c7-0000-4000-8000-000000000001', 'rs.vieja@budi.invalid', 'Clienta Antiquísima', '7123-9876'),
               ('c7c7c7c7-0000-4000-8000-000000000002', 'rs.soporte@budi.invalid', 'Soporte', ''),
               ('c7c7c7c7-0000-4000-8000-000000000003', 'rs.relleno@budi.invalid', 'Relleno', '')) AS x(id, email, nombre, tel);
UPDATE profiles SET role = 'SUPPORT' WHERE id = 'c7c7c7c7-0000-4000-8000-000000000002';

-- La vieja, hace un año.
INSERT INTO service_requests (id, user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                              dropoff_lat, dropoff_lng, dropoff_address, incident_type, created_at)
VALUES ('c7c7c7c7-0000-4000-8000-0000000000aa', 'c7c7c7c7-0000-4000-8000-000000000001', 'cancelled', 'tow', 'light', 'x',
        13.69, -89.24, 'Calle Vieja 1', 13.68, -89.28, 'Destino', 'x', now() - interval '365 days');
-- 310 más nuevas encima (canceladas: un Usuario tiene una sola abierta).
INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash, pickup_lat, pickup_lng, pickup_address,
                              dropoff_lat, dropoff_lng, dropoff_address, incident_type)
SELECT 'c7c7c7c7-0000-4000-8000-000000000003', 'cancelled', 'tow', 'light', 'x', 13.69, -89.24, 'Relleno', 13.68, -89.28, 'Destino', 'x'
  FROM generate_series(1, 310);

SET LOCAL ROLE authenticated;
SELECT pg_temp.como('c7c7c7c7-0000-4000-8000-000000000002');
DO $$
DECLARE v_folio TEXT := (SELECT folio FROM cases WHERE request_id = 'c7c7c7c7-0000-4000-8000-0000000000aa');
        q TEXT;
BEGIN
  ASSERT v_folio IS NOT NULL, 'A0: la solicitud no tiene folio';
  FOREACH q IN ARRAY ARRAY[v_folio, 'antiquísima', '7123-9876', 'Calle Vieja'] LOOP
    ASSERT 'c7c7c7c7-0000-4000-8000-0000000000aa'::uuid IN (SELECT admin_search_request_ids(q)),
      'A: no encontró la solicitud vieja buscando ' || q;
  END LOOP;
  ASSERT (SELECT count(*) FROM admin_search_request_ids('Relleno')) = 100, 'A2: el tope de 100 no se respetó';
  RAISE NOTICE 'A. encuentra una solicitud con 310 más nuevas encima: OK';
END $$;

SELECT pg_temp.como('c7c7c7c7-0000-4000-8000-000000000001');
DO $$ DECLARE ok BOOLEAN := false; BEGIN
  BEGIN PERFORM admin_search_request_ids('Relleno'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'B: un Usuario usó la búsqueda del personal';
  RAISE NOTICE 'B. solo el personal busca: OK';
END $$;
RESET ROLE;

DO $$ DECLARE ok BOOLEAN; BEGIN
  ok := false;
  BEGIN UPDATE pricing_rules SET base_exit_fee = -60 WHERE is_active; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, 'C: aceptó un cargo base negativo';
  ok := false;
  BEGIN UPDATE services SET base_price = -1 WHERE slug = 'battery'; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, 'C: aceptó un precio de servicio negativo';
  RAISE NOTICE 'C. tarifas y precios negativos se rechazan: OK';
END $$;

ROLLBACK;
