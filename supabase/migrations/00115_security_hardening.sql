-- 00115: endurecimiento de seguridad (backlog LAN-02, revisión previa al lanzamiento)
--
-- Hallazgos de `supabase db lint` y de una revisión tipo "advisor" sobre la base:
--
-- 1. `anon` (cualquiera con la publishable key, sin sesión) conservaba los
--    privilegios por defecto de Supabase sobre TODAS las tablas públicas:
--    SELECT/INSERT/UPDATE/DELETE/TRUNCATE. Hoy RLS es lo único que lo frena;
--    una política nueva escrita sin `TO authenticated` (hay 60+ con rol
--    `public`) bastaría para abrir una tabla. Ninguna pantalla pública lee
--    tablas: la landing, /socios y el login solo usan Auth y
--    `submit_partner_lead`. Se quitan todos, también los de secuencias, y los
--    privilegios por defecto para que las tablas nuevas nazcan cerradas a anon.
--
-- 2. 50 funciones seguían ejecutables por anon vía el EXECUTE implícito a
--    PUBLIC: RPCs que exigen sesión (aceptar/cancelar/crear/completar
--    servicio, calificar, chat...), helpers de PIN (`hash_pin`, `verify_pin`,
--    `generate_secure_pin`) y `next_case_folio`, que además consume la
--    secuencia de folios. Se revoca a PUBLIC y anon, conservando
--    explícitamente a cada rol que hoy la ejecuta. Única excepción pública:
--    `submit_partner_lead` (el pre-registro de socios, 00114).
--    Los helpers de PIN y el folio tampoco los necesita `authenticated`: solo
--    los usan funciones SECURITY DEFINER.
--
-- 3. 13 funciones SECURITY INVOKER sin `search_path` fijo (resolución de
--    nombres manipulable por quien controle el search_path de la sesión).
--
-- 4. `preview_mopt_program`/`preview_mopt_services` estaban marcadas STABLE
--    pero llaman funciones VOLATILE (lint 0005).

-- ─── 1. Tablas, vistas y secuencias: nada para anon ─────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel, c.relkind
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'v', 'm', 'p', 'f', 'S')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    IF r.relkind = 'S' THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', r.rel);
    ELSE
      -- Revocar a nivel de tabla quita también los GRANT por columna (00056, 00098).
      EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', r.rel);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- ─── 2. Funciones: sin EXECUTE para PUBLIC ni anon ──────────────────────────
DO $$
DECLARE
  r RECORD;
  v_role TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS fn, p.proname
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
       AND p.proname <> 'submit_partner_lead'
  LOOP
    -- Quien hoy la ejecuta (explícito o vía PUBLIC) la sigue ejecutando.
    FOREACH v_role IN ARRAY ARRAY['authenticated', 'service_role', 'supabase_auth_admin',
                                   'supabase_storage_admin', 'supabase_realtime_admin']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role)
         AND has_function_privilege(v_role, r.oid, 'EXECUTE')
         AND NOT (v_role = 'authenticated'
                  AND r.proname IN ('hash_pin', 'verify_pin', 'generate_secure_pin', 'next_case_folio'))
      THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', r.fn, v_role);
      END IF;
    END LOOP;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.fn);
    IF r.proname IN ('hash_pin', 'verify_pin', 'generate_secure_pin', 'next_case_folio') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.fn);
    END IF;
  END LOOP;
END $$;

-- Las funciones nuevas nacen sin EXECUTE para PUBLIC ni anon; `authenticated`
-- y `service_role` lo siguen recibiendo por los privilegios por defecto de
-- Supabase. Una RPC que deba ser pública necesita su GRANT ... TO anon.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ─── 3. search_path fijo en las funciones INVOKER que no lo tenían ──────────
-- `extensions` va incluido: hash_pin/verify_pin usan crypt()/gen_salt() de pgcrypto.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proconfig IS NULL
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', r.fn);
  END LOOP;
END $$;

-- ─── 4. Volatilidad correcta ────────────────────────────────────────────────
ALTER FUNCTION public.preview_mopt_program(DOUBLE PRECISION, DOUBLE PRECISION, TEXT) VOLATILE;
ALTER FUNCTION public.preview_mopt_services(DOUBLE PRECISION, DOUBLE PRECISION) VOLATILE;
