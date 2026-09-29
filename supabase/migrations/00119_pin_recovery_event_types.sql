-- 00119: tipos de evento para la recuperación del PIN (runbook de operación, LAN-04)
--
-- Van solos en este archivo: un valor nuevo de enum no se puede usar en la
-- misma transacción en la que se agrega (ver 00120).

ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'PIN_REGENERATED';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'PIN_LOCKOUT_RESET';
