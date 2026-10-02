-- =====================================================
-- Test de contencion del rol SUPPORT (migr. 00103/00104)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transaccion que se revierte: no deja datos.
--
-- Tres partes:
--   A. Lista blanca. Lo que soporte alcanza es exactamente lo que mencionan
--      is_support()/is_staff(). Si alguien agrega una funcion o politica nueva
--      con esos helpers, este test falla hasta que se la agregue abajo: abrirle
--      algo a soporte tiene que ser una decision, no un efecto secundario.
--   B. Lo que soporte ve y hace, probado como soporte de verdad.
--   C. Los tres agujeros cerrados en la 00104, reproducidos.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- 00153: el interruptor de aseguradoras viene apagado; estas pruebas las ejercitan.
UPDATE platform_features SET insurers_enabled = true;

-- ---------------------------------------------------------------
-- A. Lista blanca
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_funcs_ok TEXT[] := ARRAY[
    'is_staff',                        -- el helper mismo
    'admin_assign_request',            -- despacho
    'admin_cancel_request',            -- cancelar
    'suggest_nearest_operators',       -- despacho
    'admin_set_operator_verification', -- verificaciones
    'get_case_sla',                    -- ver el caso
    'get_case_timeline',               -- ver el caso
    'service_payer_info',              -- 00108: quien paga un servicio (sin montos)
    -- 00114 (AGT): captación y revisión de socios. Soporte opera el embudo y
    -- revisa documentos; la cuenta bancaria la ve enmascarada.
    'admin_list_partner_leads',
    'admin_update_partner_lead',
    'admin_mark_message_sent',
    'admin_review_document',
    'admin_partner_application',
    'staff_ops_alerts',                -- 00117: aviso fijo del panel (sin dinero)
    -- 00120 (runbook): PIN bloqueado y notas internas de la operación.
    'staff_pin_status',
    'staff_reset_pin_lockout',
    'staff_add_request_note',
    'staff_request_notes',
    'admin_partner_terms',             -- 00126: qué contrato aceptó el socio (revisión)
    -- 00137 (AGT-05): insignia de verificado y avance de capacitación (sin dinero).
    'request_operator_badge',
    'admin_partner_training',
    'admin_search_request_ids'         -- 00166: buscar en Solicitudes (solo ids, sin dinero)
  ];
  v_policies_ok TEXT[] := ARRAY[
    'service_requests/support: lee solicitudes',
    'profiles/support: lee perfiles',
    'cases/support: lee casos',
    'operator_locations/support: lee ubicaciones',
    'ratings/support: lee calificaciones',
    'providers/support: lee proveedores',
    'provider_services/support: lee servicios de proveedor',
    'services/support: lee catalogo',
    'operator_documents/support: lee documentos de operador',
    'objects/support: lee archivos de verificacion',
    -- 00120: disputas e incidentes ("el socio no llega").
    'request_messages/support: lee mensajes',
    'service_location_trail/support: lee recorrido'
  ];
  v_extra TEXT;
  v_missing TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_extra
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) ~ 'is_(staff|support)\(\)'
     AND p.proname NOT IN ('is_support')
     AND NOT (p.proname = ANY (v_funcs_ok));
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'A1 FALLA: funciones que abren algo a soporte sin estar en la lista blanca: %', v_extra;
  END IF;

  SELECT string_agg(f, ', ') INTO v_missing
    FROM unnest(v_funcs_ok) f
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = f
        AND pg_get_functiondef(p.oid) ~ 'is_(staff|support)\(\)');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'A2 FALLA: la lista blanca nombra funciones que ya no abren nada a soporte: %', v_missing;
  END IF;

  SELECT string_agg(c.relname || '/' || pol.polname, ', ') INTO v_extra
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
   WHERE (COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') ~ 'is_(staff|support)\(\)'
       OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~ 'is_(staff|support)\(\)')
     AND NOT ((c.relname || '/' || pol.polname) = ANY (v_policies_ok));
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'A3 FALLA: politicas que abren algo a soporte sin estar en la lista blanca: %', v_extra;
  END IF;

  -- Soporte solo LEE por RLS: ninguna politica suya puede ser de escritura.
  SELECT string_agg(c.relname || '/' || pol.polname, ', ') INTO v_extra
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
   WHERE COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') ~ 'is_(staff|support)\(\)'
     AND pol.polcmd <> 'r';
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'A4 FALLA: politicas de soporte que no son de solo lectura: %', v_extra;
  END IF;

  RAISE NOTICE 'A. lista blanca: OK';

  -- 00092/00122: ninguna RPC que devuelva la fila entera de service_requests
  -- puede entregar el hash del PIN. Una función nueva así, sin blanquearlo,
  -- hace fallar este test.
  SELECT string_agg(p.proname, ', ') INTO v_extra
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND pg_get_function_result(p.oid) IN ('service_requests', 'SETOF service_requests')
     AND position('pin_hash := NULL' IN pg_get_functiondef(p.oid)) = 0;
  ASSERT v_extra IS NULL, 'A2: devuelven pin_hash: ' || COALESCE(v_extra, '');
  RAISE NOTICE 'A2. ninguna RPC devuelve el hash del PIN: OK';
END $$;

-- ---------------------------------------------------------------
-- Preparacion: una cuenta NUEVA de soporte (se revierte al final). Nueva y no
-- una existente: un usuario real puede ser afiliado o tener su DUI cargado, y
-- ver lo PROPIO no es una fuga.
-- ---------------------------------------------------------------
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '5a5a5a5a-0000-4000-8000-00000000500e',
        'authenticated', 'authenticated', 'soporte.test@budi.invalid',
        '{"full_name": "Soporte de prueba"}', now(), now());

-- Datos propios del test: dos solicitudes abiertas y una completada, de un
-- Usuario de prueba. Asi corre igual en una base limpia que en una con datos.
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '5a5a5a5a-0000-4000-8000-00000000c11e',
        'authenticated', 'authenticated', 'usuario.test@budi.invalid',
        '{"full_name": "Usuario de prueba"}', now(), now()),
       -- Otro Usuario: la base permite una sola solicitud abierta por persona (00063).
       ('00000000-0000-0000-0000-000000000000', '5a5a5a5a-0000-4000-8000-00000000c12e',
        'authenticated', 'authenticated', 'usuario2.test@budi.invalid',
        '{"full_name": "Usuario de prueba 2"}', now(), now());

-- 00117: un socio suspendido (documento vencido) no se puede asignar.
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '5a5a5a5a-0000-4000-8000-00000000050e',
        'authenticated', 'authenticated', 'socio.suspendido@budi.invalid',
        '{"full_name": "Socio suspendido"}', now(), now());
UPDATE profiles SET role = 'OPERATOR', verification_status = 'suspended'
 WHERE id = '5a5a5a5a-0000-4000-8000-00000000050e';

CREATE TEMP TABLE t_req ON COMMIT DROP AS
WITH nuevas AS (
  INSERT INTO service_requests (user_id, status, service_type, tow_type, pin_hash,
                                pickup_lat, pickup_lng, pickup_address,
                                dropoff_lat, dropoff_lng, dropoff_address, incident_type,
                                total_price, completed_at, assigned_at, activated_at)
  SELECT CASE WHEN n = 2 THEN '5a5a5a5a-0000-4000-8000-00000000c12e'::uuid
              ELSE '5a5a5a5a-0000-4000-8000-00000000c11e'::uuid END, st::request_status, 'tow', 'light', crypt('1234', gen_salt('bf')),
         13.69, -89.21, 'Punto de prueba', 13.70, -89.22, 'Destino de prueba', 'Vehículo varado',
         CASE WHEN st = 'completed' THEN 60 END,
         CASE WHEN st = 'completed' THEN now() END,
         CASE WHEN st = 'completed' THEN now() - interval '40 minutes' END,
         CASE WHEN st = 'completed' THEN now() - interval '20 minutes' END
    FROM unnest(ARRAY['initiated', 'initiated', 'completed']) WITH ORDINALITY AS x(st, n)
  RETURNING id, status, created_at
)
SELECT id, status::text AS status, row_number() OVER (ORDER BY id) AS n FROM nuevas;
GRANT SELECT ON t_req TO PUBLIC;

CREATE TEMP TABLE t_ctx ON COMMIT DROP AS
SELECT
  '5a5a5a5a-0000-4000-8000-00000000500e'::uuid AS support_id,
  -- 00106: la aseguradora entra por membresia, no por rol.
  (SELECT m.profile_id FROM organization_members m JOIN organizations o ON o.id = m.organization_id
    WHERE o.type = 'INSURER' AND m.status = 'active' LIMIT 1)                 AS insurer_id,
  (SELECT id FROM t_req WHERE status = 'initiated' ORDER BY n LIMIT 1)        AS open_req,
  (SELECT id FROM t_req WHERE status = 'completed')                            AS done_req,
  (SELECT c.folio FROM cases c JOIN t_req r ON r.id = c.request_id ORDER BY r.n LIMIT 1) AS folio;
GRANT SELECT ON t_ctx TO PUBLIC;

UPDATE profiles SET role = 'SUPPORT' WHERE id = (SELECT support_id FROM t_ctx);

-- La otra solicitud abierta, para la prueba de cancelar desde el cliente.
CREATE TEMP TABLE t_open2 ON COMMIT DROP AS
SELECT id FROM t_req WHERE status = 'initiated' AND id <> (SELECT open_req FROM t_ctx);
GRANT SELECT ON t_open2 TO PUBLIC;

-- Un socio aprobado, de flota privada y que remolca, si la base tiene alguno.
CREATE TEMP TABLE t_op ON COMMIT DROP AS
SELECT id FROM profiles WHERE role = 'OPERATOR' AND verification_status = 'approved'
   AND operator_fits_program(id, NULL) AND operator_can_serve(id, 'tow') LIMIT 1;
GRANT SELECT ON t_op TO PUBLIC;

-- ---------------------------------------------------------------
-- B. Como soporte
-- ---------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT support_id FROM t_ctx), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  n INT;
  ok BOOLEAN;
  v_folio TEXT := (SELECT folio FROM t_ctx);
  fn TEXT;
BEGIN
  -- B1. Ve la operacion
  SELECT count(*) INTO n FROM service_requests;      ASSERT n > 0, 'B1: no ve solicitudes';
  SELECT count(*) INTO n FROM profiles;              ASSERT n > 1, 'B1: no ve perfiles';
  SELECT count(*) INTO n FROM providers;             ASSERT n > 0, 'B1: no ve proveedores';
  SELECT count(*) INTO n FROM cases;                 ASSERT n > 0, 'B1: no ve casos';
  PERFORM * FROM get_case_timeline(v_folio);
  PERFORM * FROM get_case_sla(v_folio);

  -- B2. No ve dinero, configuracion ni datos sensibles
  SELECT count(*) INTO n FROM profile_sensitive;     ASSERT n = 0, 'B2: ve profile_sensitive (DUI)';
  SELECT count(*) INTO n FROM rate_versions;         ASSERT n = 0, 'B2: ve tarifas';
  SELECT count(*) INTO n FROM audit_log;             ASSERT n = 0, 'B2: ve la bitacora';
  SELECT count(*) INTO n FROM ledger_payments;       ASSERT n = 0, 'B2: ve pagos';
  SELECT count(*) INTO n FROM members;               ASSERT n = 0, 'B2: ve el padron';
  SELECT count(*) INTO n FROM policies;              ASSERT n = 0, 'B2: ve polizas';
  SELECT count(*) INTO n FROM insurer_api_keys;      ASSERT n = 0, 'B2: ve llaves de API';

  FOREACH fn IN ARRAY ARRAY[
    'SELECT * FROM admin_finance_summary(''2020-01-01'', ''2030-01-01'')',
    'SELECT * FROM admin_settlement_by_provider(''2020-01-01'', ''2030-01-01'')',
    'SELECT * FROM admin_rate_overview()',
    'SELECT admin_business_dashboard()',
    'SELECT admin_account_360(''provider'', (SELECT id FROM providers LIMIT 1), ''2020-01-01'', ''2030-01-01'')',
    'SELECT * FROM admin_list_provider_commissions()',
    'SELECT * FROM admin_audit_log(NULL, NULL, NULL, NULL, NULL, NULL, 10, 0)',
    'SELECT admin_schedule_rate(''platform_default'', NULL, 1, NULL, NULL)',
    'SELECT admin_update_user_role((SELECT insurer_id FROM t_ctx), ''USER'')'
  ] LOOP
    ok := false;
    BEGIN
      EXECUTE fn;
    EXCEPTION WHEN OTHERS THEN ok := true;
    END;
    ASSERT ok, 'B2: soporte pudo ejecutar ' || fn;
  END LOOP;

  -- B3. No escribe configuracion. Bloqueado = error de permiso o 0 filas (RLS).
  FOREACH fn IN ARRAY ARRAY[
    'UPDATE providers SET name = name || '' X''',
    'UPDATE services SET is_active = NOT is_active',
    'UPDATE profiles SET role = ''ADMIN'' WHERE id <> auth.uid()',
    'UPDATE profiles SET verification_status = ''approved'' WHERE role = ''OPERATOR''',
    'UPDATE service_requests SET total_price = 1',
    'UPDATE insurers SET name = name',
    'DELETE FROM ratings',
    'INSERT INTO services (slug, name_es) VALUES (''x-soporte'', ''x'')'
  ] LOOP
    BEGIN
      EXECUTE fn;
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN n := 0;
    END;
    ASSERT n = 0, 'B3: soporte pudo escribir: ' || fn;
  END LOOP;

  -- B4. Lo que si hace
  PERFORM * FROM suggest_nearest_operators((SELECT open_req FROM t_ctx), 3);
  -- 00112: asignar tambien (el guardian de estados la rechazaba para soporte).
  -- Con un socio aprobado de empresa privada, si la base tiene alguno.
  IF EXISTS (SELECT 1 FROM t_op) THEN
    ASSERT (admin_assign_request((SELECT open_req FROM t_ctx), (SELECT id FROM t_op))).pin_hash IS NULL,
      'B4: asignar le devolvio a soporte el hash del PIN';
  ELSE
    RAISE NOTICE 'B4. sin socios aprobados en esta base: no se prueba la asignacion';
  END IF;
  -- 00117: ni soporte ni admin asignan a un socio suspendido.
  ok := false;
  BEGIN
    PERFORM admin_assign_request((SELECT open_req FROM t_ctx), '5a5a5a5a-0000-4000-8000-00000000050e');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%no está aprobado%';
  END;
  ASSERT ok, 'B4: se asigno un servicio a un socio suspendido';

  -- 00117: el aviso del panel, sin el dato tecnico de jobs (solo ADMIN).
  ASSERT (staff_ops_alerts() ? 'stale_pool'), 'B4: staff_ops_alerts sin stale_pool';
  ASSERT staff_ops_alerts()->'failed_jobs' = 'null'::jsonb, 'B4: soporte ve jobs fallidos';
  ASSERT (admin_cancel_request((SELECT open_req FROM t_ctx), 'Prueba de soporte')).pin_hash IS NULL,
    'B4: cancelar le devolvio a soporte el hash del PIN';

  ok := false;
  BEGIN
    PERFORM admin_cancel_request((SELECT done_req FROM t_ctx), 'no deberia');
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'B4: soporte cancelo un servicio COMPLETADO';

  RAISE NOTICE 'B. soporte ve la operacion, no ve dinero, no escribe configuracion, despacha y cancela: OK';
END $$;

RESET ROLE;

-- La cancelacion de soporte queda como "cancelado por Budi", no "por el cliente".
DO $$
DECLARE v_types TEXT;
BEGIN
  -- Todo pasa en la misma transaccion (misma hora): se miran los tipos, no "el ultimo".
  SELECT string_agg(event_type::text, ',') INTO v_types FROM request_events
   WHERE request_id = (SELECT open_req FROM t_ctx) AND event_type::text LIKE '%CANCELLED';
  ASSERT v_types = 'ADMIN_CANCELLED', 'B5: la cancelacion de soporte quedo como ' || COALESCE(v_types, 'nada');
  RAISE NOTICE 'B5. evento de cancelacion: OK';
END $$;

-- 00159: si cancela Budi con un socio asignado, se enteran los dos.
DO $$
DECLARE v_req UUID := (SELECT open_req FROM t_ctx); v_op UUID := (SELECT id FROM t_op);
BEGIN
  ASSERT EXISTS (SELECT 1 FROM notification_queue
                  WHERE data->>'service_request_id' = v_req::text AND data->>'type' = 'service_cancelled'
                    AND user_id = (SELECT user_id FROM service_requests WHERE id = v_req)),
    'B6: el Usuario no recibio el aviso de la cancelacion';
  IF v_op IS NOT NULL THEN
    ASSERT EXISTS (SELECT 1 FROM notification_queue
                    WHERE data->>'service_request_id' = v_req::text AND data->>'type' = 'service_cancelled'
                      AND user_id = v_op AND body LIKE '%Prueba de soporte%'),
      'B6: el socio asignado no se entero de que soporte cancelo';
    RAISE NOTICE 'B6. la cancelacion de soporte avisa al Usuario y al socio: OK';
  ELSE
    RAISE NOTICE 'B6. sin socio aprobado en la base: solo se probo el aviso al Usuario';
  END IF;
END $$;

-- ---------------------------------------------------------------
-- C. Los agujeros de la 00104
-- ---------------------------------------------------------------
-- C1. Sin sesion no se ejecuta ninguna RPC de admin ni create_request_event.
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
DECLARE ok BOOLEAN; fn TEXT; r JSONB;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'SELECT admin_cancel_request((SELECT done_req FROM t_ctx), ''anon'')',
    'SELECT create_request_event((SELECT done_req FROM t_ctx), ''ADMIN_CANCELLED'', ''{}'')',
    'SELECT admin_assign_request((SELECT done_req FROM t_ctx), (SELECT support_id FROM t_ctx))',
    'SELECT default_commission_rate()',
    -- 00115: sin sesion no hay RPCs de servicio, ni helpers de PIN, ni tablas.
    'SELECT cancel_service_request((SELECT id FROM t_open2), ''anon'')',
    'SELECT hash_pin(''1234'')',
    'SELECT next_case_folio()',
    'SELECT count(*) FROM pricing_rules',
    'SELECT count(*) FROM profiles',
    'SELECT staff_ops_alerts()',
    'SELECT notify_ops(''x'')'
  ] LOOP
    ok := false;
    BEGIN
      EXECUTE fn;
    EXCEPTION WHEN insufficient_privilege THEN ok := true;
    END;
    ASSERT ok, 'C1: anon pudo ejecutar ' || fn;
  END LOOP;

  -- C2. cancel_service_request sin sesion: ni siquiera se puede llamar (00115).
  RAISE NOTICE 'C1/C2. sin sesion: OK';
END $$;
RESET ROLE;

-- C3. Una aseguradora tampoco cancela servicios con cancel_service_request.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT insurer_id FROM t_ctx), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r JSONB;
BEGIN
  IF (SELECT insurer_id FROM t_ctx) IS NULL THEN
    RAISE NOTICE 'C3. sin cuenta de aseguradora local: se omite';
    RETURN;
  END IF;
  r := cancel_service_request((SELECT id FROM t_open2), 'aseguradora');
  ASSERT (r->>'success')::boolean IS NOT TRUE, 'C3: una aseguradora cancelo un servicio';
  RAISE NOTICE 'C3. aseguradora: OK';
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'TODO VERDE'; END $$;
ROLLBACK;
