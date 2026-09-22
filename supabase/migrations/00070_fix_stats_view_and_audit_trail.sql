-- =====================================================
-- 00070 — Dos objetos que quedaron rotos por arrastre de migraciones viejas
--
-- Los dos salieron de la misma auditoria y comparten origen: la 00045, que
-- elimino el rol MOP, tuvo que soltar y recrear todo lo que dependia del enum
-- `user_role`. En esa reconstruccion se perdieron dos cosas.
--
--   1. `operator_stats` se recreo SIN `security_invoker`, asi que la vista
--      volvio a consultar con los permisos de su dueno (`postgres`) y dejo de
--      pasar por la RLS de `profiles`, `service_requests` y `ratings`.
--   2. `get_request_audit_trail` no se toco, y sigue comparando contra 'MOP',
--      un valor que ya no existe en el enum.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. operator_stats: que la vista respete la RLS, y que anon no la vea
-- ---------------------------------------------------------------
-- Una vista sin `security_invoker` corre con los permisos de su dueno. Siendo
-- `postgres` el dueno, la vista leia `profiles`, `service_requests` y `ratings`
-- sin RLS y devolvia TODOS los operadores a quien pudiera hacerle SELECT.
--
-- Y podia hacerle SELECT cualquiera: la 00045 le dio el grant a `authenticated`,
-- pero los default privileges de Supabase sobre el esquema `public` ya se lo
-- habian dado tambien a `anon`. Con eso, un `GET /rest/v1/operator_stats` con
-- la publishable key —que es publica, va dentro del bundle de la app— listaba
-- id, nombre completo, servicios totales/completados/cancelados y calificacion
-- promedio de cada operador. Sin sesion.
--
-- Se arreglan las dos mitades: `security_invoker` para que la vista consulte
-- como quien la llama (el admin sigue viendo todo por sus politicas; un
-- operador ve lo suyo), y REVOKE para sacar a `anon` de encima.
CREATE OR REPLACE VIEW public.operator_stats
WITH (security_invoker = true) AS
 SELECT p.id AS operator_id,
    p.full_name,
    count(DISTINCT sr.id) AS total_services,
    count(DISTINCT sr.id) FILTER (WHERE sr.status = 'completed'::request_status) AS completed_services,
    count(DISTINCT sr.id) FILTER (WHERE sr.status = 'cancelled'::request_status) AS cancelled_services,
    COALESCE(avg(r.stars), 0::numeric)::numeric(3,2) AS average_rating,
    count(r.id) AS total_ratings
   FROM profiles p
     LEFT JOIN service_requests sr ON sr.operator_id = p.id
     LEFT JOIN ratings r ON r.rated_operator_id = p.id
  WHERE p.role = 'OPERATOR'::user_role
  GROUP BY p.id, p.full_name;

REVOKE ALL ON public.operator_stats FROM PUBLIC, anon;
GRANT SELECT ON public.operator_stats TO authenticated;

COMMENT ON VIEW public.operator_stats IS
  'Resumen por operador. security_invoker: consulta con los permisos de quien '
  'llama, para que la RLS de profiles/service_requests/ratings aplique. No '
  'darle SELECT a anon: la publishable key es publica.';

-- ---------------------------------------------------------------
-- 2. get_request_audit_trail: sacar el MOP que la dejo inservible
-- ---------------------------------------------------------------
-- Unico objeto vivo que quedo referenciando el rol borrado. No fallaba solo
-- para el MOP: el literal se castea a `user_role` al evaluar el IN, asi que
-- reventaba para TODOS los que la llamaran, incluido un admin —
--     ERROR: invalid input value for enum user_role: "MOP"
-- Reconstruida por sustitucion exacta: solo cambia el chequeo de acceso, que
-- pasa a `is_admin()` (SECURITY DEFINER, ya no depende del tipo — el mismo
-- criterio con el que la 00045 reescribio las politicas que si conservo).
CREATE OR REPLACE FUNCTION public.get_request_audit_trail(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_events JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver el rastro de auditoria';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', re.id,
      'event_type', re.event_type,
      'actor_id', re.actor_id,
      'actor_role', re.actor_role,
      'actor_name', p.full_name,
      'payload', re.payload,
      'created_at', re.created_at
    ) ORDER BY re.created_at ASC
  ) INTO v_events
  FROM request_events re
  LEFT JOIN profiles p ON p.id = re.actor_id
  WHERE re.request_id = p_request_id;

  RETURN COALESCE(v_events, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_request_audit_trail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_request_audit_trail(uuid) TO authenticated;
