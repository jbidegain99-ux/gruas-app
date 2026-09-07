-- =====================================================
-- 00088 — Dos hallazgos de la bateria de pruebas del 2026-09-07
--
-- Sin relacion entre si, pero los dos son del mismo tipo que ya veniamos
-- corrigiendo: algo que la RLS deja pasar porque nadie le puso el rol, y una
-- cuenta que sale mal porque el JOIN multiplica filas.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. providers: dejaba leer toda la red (y su comision) sin sesion
-- ---------------------------------------------------------------
-- La politica se llamaba "Everyone can view active providers" y hacia
-- exactamente eso: `USING (is_active = true)` sin clausula TO, o sea que
-- aplicaba a TODOS los roles, `anon` incluido. Sumado a los default privileges
-- de Supabase sobre `public` —que le dan SELECT a `anon`— alcanzaba un
--
--     curl "$SUPABASE_URL/rest/v1/providers?select=*" -H "apikey: $PUBLISHABLE"
--
-- para sacar la lista completa de empresas de la red con su telefono, correo,
-- direccion y, lo peor, `commission_rate`: el porcentaje que Budi le retiene a
-- cada proveedor. Son las condiciones comerciales de cada acuerdo. Y la
-- publishable key no es un secreto: viaja dentro del bundle de la app movil y
-- del JS de la web, asi que cualquiera puede leerla del navegador.
--
-- Es el mismo agujero que la 00070 le tapo a `operator_stats`, con la misma
-- causa (una politica sin rol + el grant heredado a anon) y el mismo arreglo.
--
-- Nadie consulta `providers` sin sesion: en la web solo la leen las paginas de
-- /admin, y en la movil aparece unicamente como embed `providers (name)` colgado
-- de una solicitud que la persona ya tiene derecho a ver. Restringir a
-- `authenticated` no le quita nada a ningun flujo.
DROP POLICY IF EXISTS "Everyone can view active providers" ON public.providers;

CREATE POLICY "Authenticated users can view active providers"
  ON public.providers FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Cinturon y tirantes: aunque la RLS ya no le deje ver filas, `anon` no tiene
-- por que conservar los grants heredados sobre esta tabla.
REVOKE ALL ON public.providers FROM anon;

COMMENT ON TABLE public.providers IS
  'Empresas de la red. NO exponer a anon: `commission_rate` son las condiciones '
  'comerciales del acuerdo con cada proveedor, y la publishable key es publica.';

-- ---------------------------------------------------------------
-- 2. operator_stats: total_ratings venia multiplicado por los servicios
-- ---------------------------------------------------------------
-- La vista colgaba de `profiles` DOS left joins uno-a-muchos independientes
-- entre si —`service_requests` y `ratings`— y agrupaba. Eso es un producto
-- cartesiano: cada calificacion aparece repetida una vez por cada servicio del
-- operador. `total_services` no se notaba porque usa COUNT(DISTINCT sr.id),
-- pero `total_ratings` era un COUNT(r.id) pelado, o sea servicios x
-- calificaciones. Medido en local: 6 servicios y 1 calificacion real daban
-- `total_ratings = 6`.
--
-- `average_rating` sobrevivia de casualidad: como cada calificacion se repite
-- el mismo numero de veces, el promedio no se corre. Pero era correcto por
-- accidente, no por construccion.
--
-- Se reescribe con dos subconsultas laterales, una por rama. Asi ninguna
-- multiplica a la otra y la cuenta no depende de que alguien se acuerde de
-- poner DISTINCT en cada agregado nuevo.
--
-- Se conservan `security_invoker` y los grants de la 00070: el arreglo es de la
-- cuenta, no de los permisos.
CREATE OR REPLACE VIEW public.operator_stats
WITH (security_invoker = true) AS
 SELECT p.id AS operator_id,
    p.full_name,
    COALESCE(s.total, 0::BIGINT)     AS total_services,
    COALESCE(s.completed, 0::BIGINT) AS completed_services,
    COALESCE(s.cancelled, 0::BIGINT) AS cancelled_services,
    COALESCE(r.promedio, 0::NUMERIC)::NUMERIC(3,2) AS average_rating,
    COALESCE(r.cantidad, 0::BIGINT)  AS total_ratings
   FROM profiles p
     LEFT JOIN LATERAL (
       SELECT count(*) AS total,
              count(*) FILTER (WHERE sr.status = 'completed'::request_status) AS completed,
              count(*) FILTER (WHERE sr.status = 'cancelled'::request_status) AS cancelled
         FROM service_requests sr
        WHERE sr.operator_id = p.id
     ) s ON TRUE
     LEFT JOIN LATERAL (
       SELECT avg(ra.stars) AS promedio, count(*) AS cantidad
         FROM ratings ra
        WHERE ra.rated_operator_id = p.id
     ) r ON TRUE
  WHERE p.role = 'OPERATOR'::user_role;

REVOKE ALL ON public.operator_stats FROM PUBLIC, anon;
GRANT SELECT ON public.operator_stats TO authenticated;

COMMENT ON VIEW public.operator_stats IS
  'Resumen por operador. Servicios y calificaciones se agregan en subconsultas '
  'laterales separadas: colgar los dos joins de profiles multiplicaba las filas '
  'y total_ratings salia servicios x calificaciones. security_invoker: consulta '
  'con los permisos de quien llama. No darle SELECT a anon.';
