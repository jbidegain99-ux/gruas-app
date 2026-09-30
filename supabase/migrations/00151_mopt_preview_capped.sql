-- =====================================================
-- Vista previa MOPT: avisar cuando el programa llegó a su tope
--
-- Con el tope del contrato agotado (on_cap = 'charge_user'), el Usuario en una
-- zona MOPT veía "Servicio particular · pagas el servicio" sin saber por qué
-- esta vez no era cortesía. preview_mopt_program devuelve ahora `capped` y el
-- programa, y la app lo explica.
--
-- insurer_pays_for(): la regla "¿paga el seguro?" en un solo lugar (la usan
-- mopt_payer_for y la vista previa).
-- =====================================================

CREATE OR REPLACE FUNCTION public.insurer_pays_for(p_coverage jsonb, p_service_type text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN p_coverage->>'status' = 'covered'
     AND plan_cubre_servicio((p_coverage->>'plan_id')::UUID, COALESCE(p_service_type, 'tow'))
     -- 00141: con los servicios del año agotados el seguro no paga nada.
     AND COALESCE((evaluate_coverage((p_coverage->>'member_id')::UUID,
                                     COALESCE(p_service_type, 'tow'), 0)->>'covered')::BOOLEAN, true);
END;
$$;
REVOKE ALL ON FUNCTION public.insurer_pays_for(jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mopt_payer_for(p_coverage jsonb, p_lat double precision, p_lng double precision, p_service_type text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mopt UUID;
BEGIN
  IF insurer_pays_for(p_coverage, p_service_type) THEN
    RETURN NULL;
  END IF;

  v_mopt := mopt_program_for(p_lat, p_lng, p_service_type);
  IF v_mopt IS NULL THEN
    RETURN NULL;
  END IF;
  -- 00142: dos solicitudes a la vez cerca del tope no entran las dos.
  PERFORM pg_advisory_xact_lock(hashtext('budi:mopt_budget:' || v_mopt::text));
  RETURN mopt_program_for(p_lat, p_lng, p_service_type);
END;
$$;

-- Solo "llegó al tope": contrato vigente, programa activo y el consumo del mes
-- (más lo que está en curso) alcanzó el tope que corta la cortesía. Un
-- contrato vencido o un programa suspendido no es "tope".
CREATE OR REPLACE FUNCTION public.mopt_program_capped(p_mopt_provider uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT o.status = 'active'
       AND sv_today() >= c.valid_from AND (c.valid_to IS NULL OR sv_today() <= c.valid_to)
       AND c.monthly_cap IS NOT NULL AND c.on_cap = 'charge_user'
       AND mopt_month_consumption(p_mopt_provider) + mopt_open_reservation(p_mopt_provider) >= c.monthly_cap
      FROM organizations o
      JOIN organization_contracts c ON c.organization_id = o.id
     WHERE o.type = 'MOPT' AND o.provider_id = p_mopt_provider), false);
$$;
REVOKE ALL ON FUNCTION public.mopt_program_capped(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preview_mopt_program(p_lat double precision, p_lng double precision, p_service_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cov  JSONB;
  v_mopt UUID;
  v_capped UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('applies', false);
  END IF;
  v_cov := check_member_coverage();
  v_mopt := mopt_payer_for(v_cov, p_lat, p_lng, p_service_type);
  IF v_mopt IS NOT NULL THEN
    RETURN jsonb_build_object(
      'applies', true,
      'program_name', (SELECT name FROM providers WHERE id = v_mopt)
    );
  END IF;

  -- 00151: ¿lo cubriría un programa que ya llegó a su tope? (mismas reglas que
  -- mopt_program_for, salvo el presupuesto). Solo si el seguro no paga.
  IF NOT insurer_pays_for(v_cov, p_service_type) THEN
    SELECT z.provider_id INTO v_capped
      FROM mopt_zones z
      JOIN providers pr ON pr.id = z.provider_id AND pr.is_mopt AND pr.is_active
     WHERE z.is_active
       AND (z.service_types IS NULL OR COALESCE(p_service_type, 'tow') = ANY (z.service_types))
       AND point_in_polygon(p_lat, p_lng, z.polygon)
       AND mopt_zone_open_now(z.hours_from, z.hours_to, z.active_days)
       AND mopt_program_capped(z.provider_id)
     ORDER BY z.created_at, z.id
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'applies', false,
    'capped', v_capped IS NOT NULL,
    'program_name', (SELECT name FROM providers WHERE id = v_capped)
  );
END;
$$;
