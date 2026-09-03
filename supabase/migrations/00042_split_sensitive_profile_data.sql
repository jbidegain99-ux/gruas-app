-- =====================================================
-- 00042 — Sacar el DUI de `profiles` a una tabla con RLS propio
--
-- Hallazgo 2 del checklist RLS de B-07 (docs/PROTECCION_DATOS.md §7.3).
--
-- EL PROBLEMA
-- RLS en Postgres filtra FILAS, no COLUMNAS. `profiles` guardaba `dui_number` e
-- `id_doc_path` junto al nombre y el telefono, asi que todo rol autorizado a ver
-- una fila veia tambien esas dos columnas:
--   · el OPERADOR ve el perfil de los clientes que tiene asignados
--     (politica "Operators can view assigned user profiles"),
--   · el MOP —que es un tercero EXTERNO— ve TODOS los perfiles (is_mop()).
-- La interfaz nunca mostro esos campos, pero RLS no protege la interfaz: con el
-- token de sesion se le puede pedir `select=dui_number` directamente a PostgREST.
--
-- POR QUE UNA TABLA APARTE Y NO GRANTS POR COLUMNA
-- La alternativa era revocar el SELECT de tabla a `authenticated` y volver a
-- otorgarlo columna por columna. Funciona, pero deja una trampa permanente: cada
-- columna que se agregue a `profiles` en el futuro queda invisible hasta que
-- alguien recuerde concederla, y cualquier `select('*')` que se escriba despues
-- falla con un error de permisos poco obvio. Separar la tabla resuelve el mismo
-- problema con RLS normal —que es fila a fila, como el resto del esquema— y
-- `profiles` conserva su grant de tabla intacto.
--
-- SOBRE LOS DATOS
-- Al escribir esta migracion las dos columnas estaban VACIAS en local (0 de 3
-- filas): la verificacion de operadores real vive en `operator_documents` +
-- buckets privados desde la 00038, asi que estas columnas quedaron muertas
-- desde la 00002. Aun asi se copian antes de borrarlas, porque no hay forma de
-- saber desde aca si produccion tiene valores.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.profile_sensitive (
  profile_id  UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  dui_number  TEXT,
  id_doc_path TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profile_sensitive IS
  'Documentos de identidad separados de profiles: RLS los limita al titular y al admin. Ver docs/PROTECCION_DATOS.md §7.3.';

-- Preserva lo que hubiera (en local: nada; en produccion: lo que exista).
INSERT INTO public.profile_sensitive (profile_id, dui_number, id_doc_path)
SELECT id, dui_number, id_doc_path
  FROM public.profiles
 WHERE dui_number IS NOT NULL OR id_doc_path IS NOT NULL
ON CONFLICT (profile_id) DO NOTHING;

ALTER TABLE public.profile_sensitive ENABLE ROW LEVEL SECURITY;

-- El titular gestiona lo suyo.
DROP POLICY IF EXISTS "Titular gestiona sus datos sensibles" ON public.profile_sensitive;
CREATE POLICY "Titular gestiona sus datos sensibles"
  ON public.profile_sensitive FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- El admin los lee para verificar identidad. NO se incluye al MOP: es externo y
-- no tiene ninguna razon operativa para ver documentos de identidad.
DROP POLICY IF EXISTS "Admin lee datos sensibles" ON public.profile_sensitive;
CREATE POLICY "Admin lee datos sensibles"
  ON public.profile_sensitive FOR SELECT
  USING (is_admin());

-- Defensa en profundidad: RLS ya bloquea a `anon` (todas las politicas exigen
-- auth.uid()), pero las default privileges de Supabase le conceden grants a toda
-- tabla nueva de `public` y aqui no hacen ninguna falta.
REVOKE ALL ON public.profile_sensitive FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_sensitive TO authenticated;

-- Ya copiadas: se retiran de profiles, que es lo que cierra la fuga.
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS dui_number,
  DROP COLUMN IF EXISTS id_doc_path;
