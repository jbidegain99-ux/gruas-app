-- 00128: la fecha de alta de un afiliado, en hora de El Salvador
--
-- `members.starts_on` tenía DEFAULT CURRENT_DATE, que es la fecha en UTC. Un
-- afiliado dado de alta después de las 6:00 p. m. (hora de El Salvador, UTC-6)
-- quedaba con fecha de alta de MAÑANA, y check_member_coverage le respondía
-- "Tu afiliación aún no entra en vigencia" hasta el día siguiente. La carga
-- por CSV (_import_members) ya usaba sv_today(); el default no.
-- Hallado corriendo el ciclo de negocio de noche (qa:cycle, sección 4).

ALTER TABLE public.members ALTER COLUMN starts_on SET DEFAULT sv_today();
