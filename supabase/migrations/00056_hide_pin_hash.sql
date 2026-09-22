-- =====================================================
-- 00056 — El hash del PIN deja de ser legible por el cliente
--
-- EL BUG
-- `service_requests.pin_hash` era SELECT-able por `authenticated`, y el PIN es
-- de 4 digitos hasheado con bcrypt COSTE 6. Un operador podia leer el hash y
-- romperlo por fuerza bruta OFFLINE: las 10.000 combinaciones tardan **~1.9 s**
-- medidos en la base local. Esto no esquiva el rate-limit de `verify_request_pin`
-- (00025/00026) — lo hace irrelevante: el atacante nunca le pregunta el PIN a la
-- funcion, lo saca del hash.
--
-- El PIN es la PRUEBA DE PRESENCIA: acredita que el operador llego y que el
-- cliente, en persona, se lo dicto. Si el operador lo obtiene del hash, puede
-- activar el servicio sin haber llegado y cerrar un cobro por algo no prestado.
--
-- Y NO ERA SOLO SU PROPIA SOLICITUD: la politica `Operators can view available
-- requests` (status='initiated' AND is_operator()) deja a CUALQUIER operador
-- leer el pin_hash de TODO el pool. Podia romper los PIN de solicitudes que
-- todavia no eran suyas, aceptarlas y activarlas sin presencia del cliente.
--
-- EL ARREGLO
-- El hash no tiene por que salir nunca de la base: `verify_request_pin` y
-- `complete_service_request` lo comparan del lado del servidor. Son SECURITY
-- DEFINER y corren como `postgres`, asi que este REVOKE no las toca. Se le quita
-- la columna a `authenticated` (y `anon`) via GRANT por columna.
--
-- Por que revocar la tabla y re-otorgar por columna, y no un `REVOKE (pin_hash)`
-- a secas: un privilegio de tabla otorga SELECT sobre TODAS las columnas, y un
-- revoke de columna sobre quien tiene el de tabla no hace nada. Hay que bajar el
-- de tabla y subir el de columna sobre todas menos una.
--
-- Dinamico a proposito: si mañana se agrega una columna, sigue quedando visible
-- sin tocar esta migracion. La unica que se excluye es `pin_hash`.
-- =====================================================

DO $$
DECLARE
  v_cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'service_requests'
     AND column_name <> 'pin_hash';

  -- authenticated: mantiene todo menos pin_hash.
  EXECUTE 'REVOKE SELECT ON public.service_requests FROM authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.service_requests TO authenticated', v_cols);

  -- anon: no casa con ninguna politica de esta tabla (no ve ninguna fila), pero
  -- se deja consistente por si alguna vez se agrega una politica para anon.
  EXECUTE 'REVOKE SELECT ON public.service_requests FROM anon';
  EXECUTE format('GRANT SELECT (%s) ON public.service_requests TO anon', v_cols);
END;
$$;

-- Las apps no leen `pin_hash` (verificado por grep): el operador verifica por
-- `verify_request_pin`, el usuario ya recibio su PIN en claro al crear la
-- solicitud. Los dos unicos `select('*')` sobre la tabla son `head:true` con
-- count, que no proyectan columnas.
COMMENT ON COLUMN public.service_requests.pin_hash IS
  'bcrypt del PIN. NO legible por authenticated (00056): un PIN de 4 digitos se '
  'rompe del hash en ~2s. Solo lo leen verify_request_pin y complete_service_request '
  '(SECURITY DEFINER). No agregar pin_hash a ningun GRANT ni SELECT de cliente.';
