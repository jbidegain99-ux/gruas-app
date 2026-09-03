-- =====================================================
-- 00062 — search_path fijo en las funciones SECURITY DEFINER que faltaban
--
-- EL RIESGO
-- Una funcion SECURITY DEFINER corre con los privilegios de su dueño (postgres).
-- Si no fija su `search_path`, resuelve los nombres sin calificar contra el path
-- de QUIEN LA LLAMA. Un rol que pueda crear objetos en un esquema que preceda a
-- `public` (p. ej. su propio esquema, o `pg_temp`) puede plantar ahi una tabla o
-- funcion con el mismo nombre que una de las que la funcion usa sin calificar, y
-- secuestrar la ejecucion con privilegios de postgres (search_path hijacking).
--
-- 00051 blindo los GRANT de ejecucion, no esto. Quedaban 27 funciones
-- SECURITY DEFINER sin `search_path` — entre ellas complete_service_request,
-- accept/cancel, admin_update_user_role, is_admin, calculate_price, rate_service.
--
-- EL ARREGLO
-- `ALTER FUNCTION ... SET search_path = public, extensions, pg_temp` en las 27.
-- Se usa ALTER (no CREATE OR REPLACE) a proposito: NO toca el cuerpo, solo fija
-- el atributo, asi que no hay forma de introducir un cambio de logica.
--   · `public`     — tablas y funciones de la app.
--   · `extensions` — pgcrypto (crypt, gen_salt, digest, gen_random_bytes).
--   · `pg_temp`    — al FINAL: solo se consulta si algo no aparecio en los dos
--     anteriores, y las funciones de la app resuelven todo en public/extensions.
-- Lo que cierra el hijacking es que el path quede FIJO: un esquema plantado por
-- el atacante ya no puede colarse delante. `auth.uid()` y demas referencias a
-- otros esquemas van calificadas en el codigo, asi que no dependen del path.
--
-- Verificado tras aplicar: camino feliz completo + rate, mensaje, device token,
-- ubicacion y cancelaciones siguen funcionando.
-- =====================================================

ALTER FUNCTION public.accept_service_request(p_request_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_assign_request(p_request_id uuid, p_operator_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_cancel_request(p_request_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_update_user_role(p_user_id uuid, p_new_role user_role, p_provider_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.assign_nearest_operator(p_request_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.auth_user_role() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.calculate_price(p_distance_km numeric, p_tow_type tow_type) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.cancel_service_request(p_request_id uuid, p_reason text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.complete_service_request(p_request_id uuid, p_distance_pickup_to_dropoff numeric) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.create_request_event(p_request_id uuid, p_event_type event_type, p_payload jsonb) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_active_pricing_rule() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_available_requests_for_operator() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_request_audit_trail(p_request_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_user_device_tokens(p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.is_operator() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.log_service_request_changes() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.notify_operator_new_assignment() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.notify_service_status_change() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.operator_cancel_request(p_request_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.rate_service(p_request_id uuid, p_stars integer, p_comment text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.register_device_token(p_expo_push_token text, p_device_type text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.send_message(p_request_id uuid, p_message text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.set_active_pricing_rule(p_rule_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.sync_profile_email() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.unregister_device_token(p_expo_push_token text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.upsert_operator_location(p_lat double precision, p_lng double precision, p_is_online boolean) SET search_path = public, extensions, pg_temp;
