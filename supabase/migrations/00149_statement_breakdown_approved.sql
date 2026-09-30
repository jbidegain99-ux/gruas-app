-- =====================================================
-- Estado de cuenta: el desglose suma lo aprobado
--
-- Con un caso ajustado, las tarjetas decían "Servicios $294.00 + Tarifa
-- $14.70" (= $308.70) junto a "Total aprobado $297.15", y "Por proveedor"
-- le daba al socio el original. Ahora statement_totals trae lo aprobable
-- partido (servicios y tarifa) y by_provider lo aprobado de cada socio.
-- =====================================================

CREATE OR REPLACE FUNCTION public.statement_totals(p_statement uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'services', count(*),
    'amount',   COALESCE(sum(l.amount), 0),
    'fee',      COALESCE(sum(l.fee), 0),
    'copay',    COALESCE(sum(l.copay), 0),
    'total',    COALESCE(sum(l.amount + l.fee), 0),
    'observed_open', count(*) FILTER (WHERE ob.status = 'open'),
    'observed_open_amount', COALESCE(sum(l.amount + l.fee) FILTER (WHERE ob.status = 'open'), 0),
    -- Lo que se puede aprobar: sin lo observado abierto; lo ajustado, ajustado
    -- (el ajuste reemplaza al monto del servicio; la tarifa se recalcula en
    -- proporción).
    -- 00149: lo aprobable partido en servicios y tarifa, para que el desglose
    -- sume el total (antes mostraba el original: $294 + $14.70 contra $297.15).
    'approvable_amount', COALESCE(sum(
        CASE WHEN ob.status = 'open' THEN 0
             WHEN ob.status = 'adjusted' THEN ob.adjusted_amount
             ELSE l.amount END), 0),
    'approvable_fee', COALESCE(sum(
        CASE WHEN ob.status = 'open' THEN 0
             WHEN ob.status = 'adjusted' THEN
                  CASE WHEN l.amount > 0 THEN ROUND(l.fee * ob.adjusted_amount / l.amount, 2) ELSE 0 END
             ELSE l.fee END), 0),
    'approvable', COALESCE(sum(
        CASE WHEN ob.status = 'open' THEN 0
             WHEN ob.status = 'adjusted' THEN ob.adjusted_amount
                  + CASE WHEN l.amount > 0 THEN ROUND(l.fee * ob.adjusted_amount / l.amount, 2) ELSE 0 END
             ELSE l.amount + l.fee END), 0)
  )
  FROM account_statement_lines l
  LEFT JOIN statement_observations ob ON ob.statement_id = l.statement_id AND ob.request_id = l.request_id
  WHERE l.statement_id = p_statement;
$$;

CREATE OR REPLACE FUNCTION public.statement_detail(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_side TEXT := statement_access(p_id);
  v JSONB;
BEGIN
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'Estado de cuenta no encontrado';
  END IF;

  SELECT jsonb_build_object(
    'id', s.id, 'number', s.number, 'status', s.status,
    'period_from', s.period_from, 'period_to', s.period_to,
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type),
    'issued_at', s.issued_at, 'approved_at', s.approved_at, 'approved_amount', s.approved_amount,
    'approved_by', (SELECT COALESCE(NULLIF(btrim(full_name), ''), email) FROM profiles WHERE id = s.approved_by),
    'paid_at', s.paid_at, 'paid_reference', s.paid_reference, 'void_reason', s.void_reason,
    'viewer', v_side,
    'can_approve', v_side = 'client' AND s.status = 'issued'
                   AND (SELECT member_role FROM auth_org()) IN ('owner', 'admin'),
    'can_observe', v_side = 'client' AND s.status = 'issued'
                   AND (SELECT member_role FROM auth_org()) IN ('owner', 'admin', 'analyst'),
    'totals', statement_totals(s.id),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'request_id', l.request_id, 'folio', l.folio, 'completed_at', l.completed_at,
               'service_type', l.service_type, 'provider_name', l.provider_name,
               'tow_km', l.tow_km, 'total_km', l.total_km,
               'amount', l.amount, 'fee', l.fee, 'copay', l.copay,
               'observation', CASE WHEN ob.id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', ob.id, 'status', ob.status, 'adjusted_amount', ob.adjusted_amount,
                 'events', (SELECT jsonb_agg(jsonb_build_object(
                              'side', e.side, 'kind', e.kind, 'body', e.body, 'amount', e.amount,
                              'author', COALESCE(NULLIF(btrim(p.full_name), ''), p.email, 'Cuenta eliminada'),
                              'at', e.created_at) ORDER BY e.created_at)
                              FROM statement_observation_events e
                              LEFT JOIN profiles p ON p.id = e.author_id
                             WHERE e.observation_id = ob.id)) END
             ) ORDER BY l.completed_at)
        FROM account_statement_lines l
        LEFT JOIN statement_observations ob ON ob.statement_id = l.statement_id AND ob.request_id = l.request_id
       WHERE l.statement_id = s.id), '[]'::jsonb),
    'by_provider', COALESCE((
      -- 00141: por socio o empresa (id), no por nombre: dos homónimos eran una fila.
      SELECT jsonb_agg(x ORDER BY x->>'provider_name', x->>'provider_id')
        FROM (SELECT jsonb_build_object('provider_id', l.provider_id, 'provider_kind', l.provider_kind,
                       'provider_name', COALESCE(l.provider_name, '—'),
                       'services', count(*), 'amount', sum(l.amount), 'tow_km', sum(l.tow_km),
                       -- 00149: lo que cuenta para ese socio (ajustes; lo observado abierto, 0).
                       'approved_amount', sum(CASE WHEN ob.status = 'open' THEN 0
                                                   WHEN ob.status = 'adjusted' THEN ob.adjusted_amount
                                                   ELSE l.amount END)) AS x
                FROM account_statement_lines l
                LEFT JOIN statement_observations ob ON ob.statement_id = l.statement_id AND ob.request_id = l.request_id
               WHERE l.statement_id = s.id
               GROUP BY l.provider_kind, l.provider_id, l.provider_name) g), '[]'::jsonb)
  ) INTO v
  FROM account_statements s JOIN organizations o ON o.id = s.organization_id
  WHERE s.id = p_id;
  RETURN v;
END;
$$;
