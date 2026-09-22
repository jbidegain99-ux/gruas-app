-- 00027_restrict_pin_hash_access.sql
--
-- Defense-in-depth for the arrival PIN.
--
-- pin_hash lives on service_requests, and the RLS SELECT policies expose whole
-- rows to the requester, the assigned operator, MOP, and — for
-- status = 'initiated' — ANY operator (see 00024 "Operators can view available
-- requests"). RLS is ROW-level, so every one of those policies also hands out
-- pin_hash. pin_hash is a bcrypt of a 4-digit PIN: an operator can
-- `select pin_hash from service_requests where status = 'initiated'`, pull the
-- hash for every open request, and crack all 10 000 candidates offline in well
-- under a second — learning the arrival PIN before ever being assigned and
-- defeating the verify_request_pin attempt-lockout added in 00025/00026.
--
-- Fix: hide pin_hash at the COLUMN-privilege level. verify_request_pin is
-- SECURITY DEFINER, so it keeps reading pin_hash with the owner's rights
-- regardless of the caller's grants; only DIRECT SELECTs of the column by the
-- authenticated/anon roles are denied.
--
-- A table-level SELECT grant implicitly covers every column, so we drop it and
-- re-grant SELECT on every column EXCEPT pin_hash. The column list is built
-- dynamically so we don't hand-maintain it; any column added by a later
-- migration is denied by default (fail closed) until that migration re-grants
-- it. anon gets no re-grant (it never legitimately reads this table; RLS
-- already blocks it).

DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'service_requests'
    AND column_name <> 'pin_hash';

  REVOKE SELECT ON public.service_requests FROM authenticated, anon;
  EXECUTE format(
    'GRANT SELECT (%s) ON public.service_requests TO authenticated',
    v_cols
  );
END $$;
