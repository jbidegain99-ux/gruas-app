-- Migration: cerrar funciones que quedaron ejecutables por `anon`.
--
-- COMO APARECIO
-- Probando el control de acceso del motor de cobertura (B-12) salio que
-- `evaluate_coverage` era llamable por cualquiera con el id de otro afiliado,
-- pese a tener `REVOKE ALL ... FROM PUBLIC`. Ese REVOKE no alcanza: Supabase
-- concede EXECUTE a los roles `anon` y `authenticated` por privilegios por
-- defecto en el esquema public, y esos grants son propios de cada rol, no del
-- pseudo-rol PUBLIC. Hay que revocarlos por nombre.
--
-- Y ademas de PUBLIC: Postgres concede EXECUTE a PUBLIC por defecto en TODA
-- funcion nueva. Revocar solo de `anon` no cambia nada mientras PUBLIC lo tenga
-- —lo comprobe en el primer intento de esta misma migracion, que no cerro nada—.
-- Por eso cada revocacion nombra a los tres.
--
-- Al auditar el resto aparecieron cosas peores, todas verificadas ejecutando
-- como `anon` (la anon key viaja dentro de la app movil y en cualquier
-- navegador, asi que "anon" es literalmente cualquiera en internet):
--
--   * `_import_members` — ESCRIBE el padron. Un anonimo insertaba afiliados en
--     cualquier poliza. Verificado: inserto "INTRUSO ANONIMO".
--   * `import_members_for_insurer` — misma escritura, saltandose la clave de API
--     por completo: su unica "autorizacion" es el insurer_id que recibe por
--     parametro, y confiaba en que solo la Edge Function la llamara.
--   * `verify_insurer_api_key` — oraculo para validar claves a ciegas.
--   * `get_admin_dashboard_stats` — devolvia ingresos, cantidad de usuarios y
--     calificacion promedio. Verificado con rol anon.
--   * `get_user_device_tokens` — tokens push de cualquier usuario por su id.
--
-- EL PATRON QUE LO CAUSO
-- Varias funciones se escribieron asumiendo que "la autorizacion la hace el
-- envoltorio". Eso solo vale si el envoltorio es el UNICO camino, y en PostgREST
-- toda funcion del esquema public es un endpoint. La leccion: la guarda va
-- DENTRO de la funcion, o se revoca el EXECUTE explicitamente por rol.

-- ===============================================================
-- 1. Escritura del padron — solo por los caminos autorizados
-- ===============================================================
-- `_import_members` es la implementacion compartida; sus dos envoltorios
-- (`import_policy_members`, con is_admin(), y `import_members_for_insurer`) son
-- SECURITY DEFINER, asi que la siguen llamando sin problema aunque nadie mas
-- tenga EXECUTE.
REVOKE ALL ON FUNCTION public._import_members(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- La aseguradora no tiene cuenta: entra por la Edge Function `import-members`,
-- que valida el hash de la clave y usa la service role. Ningun cliente del
-- navegador ni de la app debe poder llamarla.
REVOKE ALL ON FUNCTION public.import_members_for_insurer(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_insurer_api_key(TEXT) FROM PUBLIC, anon, authenticated;

-- Estas ya validan is_admin() adentro, pero no hay motivo para que un anonimo
-- pueda siquiera intentarlo.
REVOKE ALL ON FUNCTION public.import_policy_members(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_insurer_api_key(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_insurer_api_key(UUID) FROM PUBLIC, anon;

-- ===============================================================
-- 2. Cobertura
-- ===============================================================
-- `evaluate_coverage` recibe un member_id: con EXECUTE publico se podia leer el
-- consumo y los topes de cualquier afiliado. El camino publico es
-- `preview_my_coverage`, que resuelve el afiliado por auth.uid().
REVOKE ALL ON FUNCTION public.evaluate_coverage(UUID, TEXT, NUMERIC, NUMERIC, tow_type, UUID)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.preview_my_coverage(TEXT, NUMERIC, NUMERIC, tow_type) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_member_coverage() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coverage_rule_lookup(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_marketing_opt_in(BOOLEAN) FROM PUBLIC, anon;

-- ===============================================================
-- 3. Fugas de datos
-- ===============================================================
-- Ninguna de las dos se llama desde el codigo de las apps (verificado con grep):
-- `get_user_device_tokens` la usa el envio de push con la service role, y el
-- panel arma sus metricas consultando las tablas.
REVOKE ALL ON FUNCTION public.get_user_device_tokens(UUID) FROM PUBLIC, anon, authenticated;

-- A esta se le agrega ademas la guarda que le faltaba. Revocarla a secas de
-- `authenticated` dejaria afuera al propio admin, que es un usuario autenticado;
-- la guarda adentro es lo correcto y no depende de quien tenga el grant.
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_stats JSONB;
BEGIN
  -- La guarda que faltaba: sin esto, cualquiera con la anon key leia los ingresos.
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las metricas del panel';
  END IF;

  SELECT jsonb_build_object(
    'total_requests', (SELECT COUNT(*) FROM service_requests),
    'pending_requests', (SELECT COUNT(*) FROM service_requests WHERE status = 'initiated'),
    'active_requests', (SELECT COUNT(*) FROM service_requests WHERE status IN ('assigned', 'en_route', 'active')),
    'completed_requests', (SELECT COUNT(*) FROM service_requests WHERE status = 'completed'),
    'cancelled_requests', (SELECT COUNT(*) FROM service_requests WHERE status = 'cancelled'),
    'total_users', (SELECT COUNT(*) FROM profiles WHERE role = 'USER'),
    'total_operators', (SELECT COUNT(*) FROM profiles WHERE role = 'OPERATOR'),
    'active_providers', (SELECT COUNT(*) FROM providers WHERE is_active = true),
    'total_revenue', (SELECT COALESCE(SUM(total_price), 0) FROM service_requests WHERE status = 'completed'),
    'avg_rating', (SELECT COALESCE(AVG(stars), 0) FROM ratings),
    'requests_today', (SELECT COUNT(*) FROM service_requests WHERE created_at >= CURRENT_DATE),
    'requests_this_week', (SELECT COUNT(*) FROM service_requests WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'),
    'requests_this_month', (SELECT COUNT(*) FROM service_requests WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')
  ) INTO v_stats;

  RETURN v_stats;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO authenticated;

COMMENT ON FUNCTION public.get_admin_dashboard_stats() IS
  'Metricas del panel. Exige is_admin(): antes cualquiera con la anon key leia '
  'los ingresos.';

-- ===============================================================
-- 4. Devolver el acceso legitimo
-- ===============================================================
-- Quitarle EXECUTE a PUBLIC tambien se lo quita al usuario autenticado, asi que
-- las funciones que SI son para el cliente se conceden de nuevo, ahora de forma
-- explicita en vez de por herencia.
GRANT EXECUTE ON FUNCTION public.import_policy_members(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_insurer_api_key(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_insurer_api_key(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_my_coverage(TEXT, NUMERIC, NUMERIC, tow_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_member_coverage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.coverage_rule_lookup(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_marketing_opt_in(BOOLEAN) TO authenticated;
