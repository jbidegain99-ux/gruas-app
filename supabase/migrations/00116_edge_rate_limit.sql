-- 00116: límite de frecuencia para las Edge Functions (backlog LAN-02)
--
-- get-eta y calculate-distance pueden llamar a Google Maps (facturado por
-- llamada) y import-members valida claves de API: sin tope, una sesión
-- cualquiera o un script podía disparar miles de llamadas por minuto.
--
-- Ventana fija por (bucket, sujeto). El sujeto lo pone la base: para una
-- sesión es SIEMPRE auth.uid(), así nadie puede agotar el cupo de otro; solo
-- service_role (las funciones que no tienen sesión, como import-members)
-- puede indicar un sujeto propio (la IP, la aseguradora).

CREATE TABLE public.rate_limit_hits (
  bucket       TEXT        NOT NULL,
  subject      TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, subject, window_start)
);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo se toca a través de rate_limit_hit().
REVOKE ALL ON public.rate_limit_hits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_bucket         TEXT,
  p_limit          INTEGER,
  p_window_seconds INTEGER,
  p_subject        TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subject TEXT;
  v_window  TIMESTAMPTZ;
  v_hits    INTEGER;
BEGIN
  IF p_bucket IS NULL OR p_limit IS NULL OR p_limit < 1
     OR p_window_seconds IS NULL OR p_window_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'Parámetros de límite inválidos';
  END IF;

  IF auth.role() = 'service_role' THEN
    v_subject := p_subject;
  ELSE
    v_subject := auth.uid()::text;
  END IF;
  IF v_subject IS NULL OR v_subject = '' THEN
    RAISE EXCEPTION 'Sin sujeto para el límite de frecuencia';
  END IF;

  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO rate_limit_hits (bucket, subject, window_start)
  VALUES (left(p_bucket, 64), left(v_subject, 128), v_window)
  ON CONFLICT (bucket, subject, window_start)
  DO UPDATE SET hits = rate_limit_hits.hits + 1
  RETURNING hits INTO v_hits;

  RETURN v_hits <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER, TEXT) IS
  'Cuenta una llamada y devuelve si sigue dentro del cupo. El sujeto es auth.uid() '
  'salvo para service_role. Lo usan las Edge Functions (get-eta, calculate-distance, '
  'import-members).';

-- Las ventanas viejas no sirven para nada: se barren cada hora.
SELECT cron.schedule(
  'purge-rate-limit-hits',
  '7 * * * *',
  $$DELETE FROM public.rate_limit_hits WHERE window_start < now() - interval '1 day'$$
);
