-- =====================================================
-- 00103 — Rol SUPPORT (soporte / operaciones)
--
-- Archivo aparte, solo con el ALTER TYPE: un valor nuevo de enum no se puede
-- usar en la misma transaccion en que se agrega (ver 00097). Los permisos van
-- en la 00104.
-- =====================================================
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'SUPPORT';
