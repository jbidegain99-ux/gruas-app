-- =====================================================
-- 00084 — La aseguradora ve cuanto le toca pagar, no solo el precio
--
-- El portal mostraba "Precio del servicio $222.50" cuando a esa aseguradora le
-- correspondian $150.00 — los otros $72.50 son copago del afiliado. Es el mismo
-- error que el historial del cliente tenia esta manana: poner el bruto donde va
-- lo que a quien mira le toca. Y aca pesa mas, porque esa es la pantalla con la
-- que una aseguradora audita su mes: puede leer $222.50 y esperar esa factura.
--
-- El reparto vive en `coverage_usage`, que la aseguradora no podia leer: sus
-- politicas eran solo admin y afiliado. Se le abre lo suyo con el mismo criterio
-- del resto del portal (`request_belongs_to_my_insurer`, migr. 00068), que es
-- menos de lo que ya ve: el caso, el servicio y el precio bruto ya los tenia.
-- =====================================================

DROP POLICY IF EXISTS "Aseguradora ve el consumo de sus casos" ON public.coverage_usage;
CREATE POLICY "Aseguradora ve el consumo de sus casos" ON public.coverage_usage
  FOR SELECT USING (request_belongs_to_my_insurer(coverage_usage.request_id));

-- Y el listado tambien lo trae, para que el total del mes se vea sin entrar caso
-- por caso.
-- Cambia el tipo de retorno, asi que hay que soltarla antes de recrearla.
DROP FUNCTION IF EXISTS public.list_insurer_cases();

CREATE OR REPLACE FUNCTION public.list_insurer_cases()
RETURNS TABLE (
  folio           TEXT,
  service_type    TEXT,
  status          TEXT,
  created_at      TIMESTAMPTZ,
  total_price     NUMERIC,
  coverage_status TEXT,
  -- Lo que asume la poliza y lo que paga el afiliado. Sin esto el portal solo
  -- mostraba el bruto y la aseguradora no sabia cuanto le tocaba de cada caso.
  cubierto        NUMERIC,
  copago          NUMERIC,
  assignment_met  BOOLEAN,
  arrival_met     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_insurer UUID := auth_insurer_id();
  v_asig INT;
  v_lleg INT;
BEGIN
  IF v_insurer IS NULL THEN
    RAISE EXCEPTION 'Solo una cuenta de aseguradora puede ver sus casos';
  END IF;

  SELECT sla_assignment_minutes, sla_arrival_minutes INTO v_asig, v_lleg
    FROM insurers WHERE id = v_insurer;

  RETURN QUERY
  SELECT
    c.folio,
    sr.service_type,
    sr.status::text,
    sr.created_at,
    sr.total_price,
    sr.coverage_status,
    cu.amount_covered,
    cu.amount_copay,
    CASE WHEN sr.assigned_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (sr.assigned_at - sr.created_at)) <= v_asig * 60 END,
    CASE WHEN sr.activated_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (sr.activated_at - sr.assigned_at)) <= v_lleg * 60 END
  FROM cases c
  JOIN service_requests sr ON sr.id = c.request_id
  -- El consumo es 1:1 con la solicitud (`coverage_usage.request_id` es UNIQUE),
  -- asi que este JOIN no multiplica filas. Va como LEFT por si algun caso
  -- llegara sin fila de consumo.
  LEFT JOIN coverage_usage cu ON cu.request_id = sr.id
  WHERE EXISTS (
    SELECT 1 FROM coverage_usage cu2
    JOIN members m  ON m.id = cu2.member_id
    JOIN policies po ON po.id = m.policy_id
    WHERE cu2.request_id = sr.id AND po.insurer_id = v_insurer
  )
  ORDER BY sr.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_insurer_cases() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_insurer_cases() TO authenticated;
