-- 00122: las RPC del personal tampoco devuelven el hash del PIN
--
-- Mismo bug que la 00092, en otras tres funciones: `admin_cancel_request`,
-- `admin_assign_request` y `assign_nearest_operator` devuelven
-- `service_requests` (la FILA ENTERA), y con ella `pin_hash`. Las llama el
-- personal —soporte incluido desde la 00104— y un bcrypt de un PIN de 4
-- dígitos se rompe en segundos. El runbook promete que nadie de Budi conoce el
-- PIN; con esto era falso. Hallado probando el portal (POR-03): cancelar desde
-- SQL como admin devolvía `$2a$06$…`.
--
-- Mismo arreglo mínimo que la 00092: blanquear `pin_hash` en la fila de
-- retorno, sin cambiar la firma (el panel y los tests usan el resto).
DO $$
DECLARE
  f   TEXT;
  def TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_cancel_request(uuid,text)',
                           'admin_assign_request(uuid,uuid)',
                           'assign_nearest_operator(uuid)']
  LOOP
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    IF position('pin_hash := NULL' IN def) > 0 THEN
      CONTINUE;
    END IF;
    IF (length(def) - length(replace(def, 'RETURN v_request;', ''))) / length('RETURN v_request;') <> 1 THEN
      RAISE EXCEPTION '%: se esperaba un solo "RETURN v_request;"', f;
    END IF;
    EXECUTE replace(def, 'RETURN v_request;',
      'v_request.pin_hash := NULL;  -- 00122: no filtrar el hash del PIN' || chr(10) || '  RETURN v_request;');
  END LOOP;
END $$;
