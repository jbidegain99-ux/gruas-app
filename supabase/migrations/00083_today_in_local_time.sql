-- =====================================================
-- 00083 — "Hoy" es el de El Salvador, tambien en la cobertura
--
-- Continuacion de la 00082, que arreglo el corte de periodo de finanzas. Queda
-- la misma raiz en el motor de cobertura: `CURRENT_DATE` se evalua con la zona
-- de la sesion, que en esta base es UTC, y El Salvador es UTC-6. Entre las 18:00
-- y la medianoche hora local, la base ya cree que es manana.
--
-- No es teorico, y aca cuesta plata en las dos direcciones:
--
--   * `check_member_coverage` valida la poliza con `starts_on <= CURRENT_DATE <=
--     ends_on`. Una poliza que vence HOY se da por vencida a partir de las 18:00,
--     y el afiliado termina pagando como particular un servicio que su seguro
--     cubria. Del otro lado, una que empieza manana se activa seis horas antes.
--   * `coverage_usage.used_on` nacia con `DEFAULT CURRENT_DATE`, asi que un
--     servicio del 31 de diciembre a las 20:00 quedaba anotado el 1 de enero y
--     consumia el cupo del anio siguiente en vez del que correspondia.
--   * `evaluate_coverage` acota el anio de poliza con la misma fecha.
--
-- `get_admin_dashboard_stats` tiene el mismo defecto. Hoy NO la llama nadie —el
-- panel calcula sus propios conteos— pero se corrige igual en vez de dejar una
-- funcion que parece util y contaria mal el dia.
-- =====================================================

-- Complementa a `sv_day_start` de la 00082: aquella da el instante en que
-- empieza un dia; esta dice que dia es hoy, en El Salvador.
CREATE OR REPLACE FUNCTION public.sv_today()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$ SELECT (now() AT TIME ZONE 'America/El_Salvador')::date $$;

COMMENT ON FUNCTION public.sv_today() IS
  'La fecha de hoy en El Salvador. Reemplaza a CURRENT_DATE, que se evalua en '
  'la zona de la sesion (UTC) y adelanta el dia a partir de las 18:00 locales. '
  'Ver migr. 00083.';

-- El consumo se anota con la fecha local del servicio, no con la de UTC.
ALTER TABLE public.coverage_usage ALTER COLUMN used_on SET DEFAULT sv_today();

CREATE OR REPLACE FUNCTION public.check_member_coverage()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id  UUID;
  v_dui      TEXT;
  v_member   RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'reason', 'No autenticado');
  END IF;

  -- (a) Vinculacion diferida: la aseguradora carga su padron (B-10) antes de que
  -- el afiliado se instale la app, asi que `members.profile_id` suele venir NULL
  -- y el match se hace por documento. Se vincula la PRIMERA vez que coincide.
  -- Solo se toman filas con profile_id NULL: nunca se le roba un afiliado ya
  -- vinculado a otra cuenta.
  SELECT member_document_key(dui_number) INTO v_dui
    FROM profile_sensitive
   WHERE profile_id = v_user_id;

  IF v_dui IS NOT NULL THEN
    UPDATE members
       SET profile_id = v_user_id,
           updated_at = NOW()
     WHERE profile_id IS NULL
       AND member_document_key(document_number) = v_dui;
  END IF;

  -- (b) Elegir la afiliacion. Una persona puede figurar en mas de una poliza
  -- (p. ej. titular en una y beneficiario en otra): se prefiere la que este
  -- vigente hoy, y entre esas la que caduca mas tarde. El ORDER BY es
  -- determinista para que dos llamadas seguidas no devuelvan cosas distintas.
  SELECT m.id            AS member_id,
         m.relationship,
         m.is_active     AS member_active,
         m.starts_on     AS member_starts_on,
         m.ends_on       AS member_ends_on,
         p.id            AS policy_id,
         p.policy_number,
         p.status        AS policy_status,
         p.starts_on     AS policy_starts_on,
         p.ends_on       AS policy_ends_on,
         cp.id           AS plan_id,
         cp.code         AS plan_code,
         cp.name         AS plan_name,
         i.name          AS insurer_name,
         (m.is_active
           AND m.starts_on <= sv_today()
           AND (m.ends_on IS NULL OR m.ends_on >= sv_today())
           AND p.status = 'active'
           AND p.starts_on <= sv_today()
           AND (p.ends_on IS NULL OR p.ends_on >= sv_today())) AS vigente
    INTO v_member
    FROM members m
    JOIN policies p        ON p.id  = m.policy_id
    JOIN coverage_plans cp ON cp.id = p.plan_id
    JOIN insurers i        ON i.id  = p.insurer_id
   WHERE m.profile_id = v_user_id
   ORDER BY vigente DESC,
            COALESCE(p.ends_on, DATE '9999-12-31') DESC,
            m.created_at ASC
   LIMIT 1;

  IF v_member.member_id IS NULL THEN
    -- No es afiliado. NO es un error: paga como cliente particular.
    RETURN jsonb_build_object('status', 'none');
  END IF;

  IF v_member.vigente THEN
    RETURN jsonb_build_object(
      'status',        'covered',
      'member_id',     v_member.member_id,
      'policy_id',     v_member.policy_id,
      'plan_id',       v_member.plan_id,
      'policy_number', v_member.policy_number,
      'plan_code',     v_member.plan_code,
      'plan_name',     v_member.plan_name,
      'insurer_name',  v_member.insurer_name,
      'relationship',  v_member.relationship
    );
  END IF;

  -- Vencida/suspendida: se dice POR QUE. Un "no tenes cobertura" a secas frente
  -- a una poliza que el usuario cree vigente es el peor mensaje posible.
  RETURN jsonb_build_object(
    'status',        'inactive',
    'member_id',     v_member.member_id,
    'policy_id',     v_member.policy_id,
    'policy_number', v_member.policy_number,
    'plan_name',     v_member.plan_name,
    'insurer_name',  v_member.insurer_name,
    'reason',        CASE
      WHEN NOT v_member.member_active                    THEN 'Tu afiliacion esta dada de baja'
      WHEN v_member.member_starts_on > sv_today()      THEN 'Tu afiliacion aun no entra en vigencia'
      WHEN v_member.member_ends_on < sv_today()        THEN 'Tu afiliacion vencio'
      WHEN v_member.policy_status = 'suspended'          THEN 'La poliza esta suspendida'
      WHEN v_member.policy_status = 'cancelled'          THEN 'La poliza fue cancelada'
      WHEN v_member.policy_status = 'expired'            THEN 'La poliza vencio'
      WHEN v_member.policy_starts_on > sv_today()      THEN 'La poliza aun no entra en vigencia'
      WHEN v_member.policy_ends_on < sv_today()        THEN 'La poliza vencio'
      ELSE 'La cobertura no esta vigente'
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.evaluate_coverage(p_member_id uuid, p_service_type text, p_total numeric, p_km numeric DEFAULT NULL::numeric, p_tow_type tow_type DEFAULT 'light'::tow_type, p_exclude_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan_id       UUID;
  v_poliza_inicio DATE;
  v_anios         INT;
  v_ini           DATE;
  v_fin           DATE;

  v_cubierto_existe BOOLEAN; v_cubierto NUMERIC; v_cubierto_alcance TEXT;
  v_tope_existe     BOOLEAN; v_tope     NUMERIC; v_tope_alcance     TEXT;
  v_km_existe       BOOLEAN; v_km_incl  NUMERIC; v_km_alcance       TEXT;
  v_max_existe      BOOLEAN; v_max      NUMERIC; v_max_alcance      TEXT;

  v_usados        INT := 0;
  v_precio_km     NUMERIC := 0;
  v_km_exceso     NUMERIC := 0;
  v_cargo_exceso  NUMERIC := 0;
  v_candidato     NUMERIC;
  v_asume         NUMERIC;
  v_copago        NUMERIC;
  v_topeado       BOOLEAN := FALSE;
BEGIN
  SELECT p.plan_id, p.starts_on INTO v_plan_id, v_poliza_inicio
    FROM members m JOIN policies p ON p.id = m.policy_id
   WHERE m.id = p_member_id;

  IF v_plan_id IS NULL THEN
    RETURN jsonb_build_object(
      'covered', false,
      'reason', 'El afiliado no existe o no tiene poliza',
      'amount_total', p_total, 'amount_covered', 0, 'amount_copay', p_total
    );
  END IF;

  -- Año de poliza vigente (ver decision 3).
  v_anios := EXTRACT(YEAR FROM age(sv_today(), v_poliza_inicio))::INT;
  v_ini   := (v_poliza_inicio + (v_anios || ' years')::INTERVAL)::DATE;
  v_fin   := (v_ini + INTERVAL '1 year' - INTERVAL '1 day')::DATE;

  SELECT existe, valor, alcance INTO v_cubierto_existe, v_cubierto, v_cubierto_alcance
    FROM coverage_rule_lookup(v_plan_id, p_service_type, 'covered');
  SELECT existe, valor, alcance INTO v_tope_existe, v_tope, v_tope_alcance
    FROM coverage_rule_lookup(v_plan_id, p_service_type, 'services_per_year');
  SELECT existe, valor, alcance INTO v_km_existe, v_km_incl, v_km_alcance
    FROM coverage_rule_lookup(v_plan_id, p_service_type, 'included_km');
  SELECT existe, valor, alcance INTO v_max_existe, v_max, v_max_alcance
    FROM coverage_rule_lookup(v_plan_id, p_service_type, 'max_covered_amount');

  -- --- (a) ¿esta cubierto el tipo de servicio? -------------------
  IF NOT COALESCE(v_cubierto_existe, FALSE) THEN
    RETURN jsonb_build_object(
      'covered', false,
      'reason', 'El plan no declara cobertura para este servicio',
      'amount_total', p_total, 'amount_covered', 0, 'amount_copay', p_total,
      'policy_year_start', v_ini, 'policy_year_end', v_fin
    );
  END IF;

  IF COALESCE(v_cubierto, 0) = 0 THEN
    RETURN jsonb_build_object(
      'covered', false,
      'reason', 'Este servicio esta excluido del plan',
      'amount_total', p_total, 'amount_covered', 0, 'amount_copay', p_total,
      'policy_year_start', v_ini, 'policy_year_end', v_fin
    );
  END IF;

  -- --- (b) ¿le quedan eventos en el año? -------------------------
  IF COALESCE(v_tope_existe, FALSE) AND v_tope IS NOT NULL THEN
    SELECT COUNT(*) INTO v_usados
      FROM coverage_usage cu
      JOIN service_requests sr ON sr.id = cu.request_id
     WHERE cu.member_id = p_member_id
       AND cu.used_on BETWEEN v_ini AND v_fin
       AND sr.status = 'completed'                          -- decision 4
       AND (p_exclude_request IS NULL OR cu.request_id <> p_exclude_request)
       -- decision 5: el conteo tiene el mismo alcance que la regla
       AND (v_tope_alcance = '*' OR cu.service_type = v_tope_alcance);

    IF v_usados >= v_tope THEN
      RETURN jsonb_build_object(
        'covered', false,
        'reason', format('Se agotaron los %s servicios cubiertos del año', v_tope::INT),
        'amount_total', p_total, 'amount_covered', 0, 'amount_copay', p_total,
        'services_per_year', v_tope, 'events_used', v_usados,
        'policy_year_start', v_ini, 'policy_year_end', v_fin
      );
    END IF;
  END IF;

  -- --- (c) km de arrastre por encima de lo incluido --------------
  -- Se cobra al afiliado el excedente al mismo precio por km que la tarifa
  -- vigente; asi el copago coincide con lo que ese tramo costo de verdad.
  -- OJO: `coverage_rules.included_km` (lo que cubre la aseguradora) no es
  -- `pricing_rules.included_km` (lo que ya trae la tarifa base).
  IF COALESCE(v_km_existe, FALSE) AND v_km_incl IS NOT NULL AND p_km IS NOT NULL THEN
    v_km_exceso := GREATEST(0, p_km - v_km_incl);
    IF v_km_exceso > 0 THEN
      SELECT CASE WHEN p_tow_type = 'light' THEN pr.price_per_km_light
                  ELSE pr.price_per_km_heavy END
        INTO v_precio_km
        FROM pricing_rules pr WHERE pr.is_active = true LIMIT 1;
      v_cargo_exceso := ROUND(v_km_exceso * COALESCE(v_precio_km, 0), 2);
    END IF;
  END IF;

  -- --- (d) repartir ---------------------------------------------
  v_candidato := GREATEST(0, p_total - v_cargo_exceso);

  IF COALESCE(v_max_existe, FALSE) AND v_max IS NOT NULL AND v_candidato > v_max THEN
    v_asume   := v_max;
    v_topeado := TRUE;
  ELSE
    v_asume := v_candidato;
  END IF;

  v_copago := ROUND(GREATEST(0, p_total - v_asume), 2);
  v_asume  := ROUND(v_asume, 2);

  RETURN jsonb_build_object(
    'covered', true,
    'amount_total', p_total,
    'amount_covered', v_asume,
    'amount_copay', v_copago,
    'km_used', p_km,
    'included_km', v_km_incl,
    'excess_km', v_km_exceso,
    'excess_km_charge', v_cargo_exceso,
    'price_per_km', v_precio_km,
    'max_covered_amount', v_max,
    'capped', v_topeado,
    'services_per_year', v_tope,
    'events_used', v_usados,
    'events_left', CASE WHEN v_tope IS NULL THEN NULL ELSE GREATEST(0, v_tope::INT - v_usados - 1) END,
    'policy_year_start', v_ini,
    'policy_year_end', v_fin
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._import_members(p_policy_id uuid, p_members jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row        JSONB;
  v_idx        INT := 0;
  v_inserted   INT := 0;
  v_updated    INT := 0;
  v_errors     JSONB := '[]'::jsonb;
  v_doc        TEXT;
  v_key        TEXT;
  v_name       TEXT;
  v_rel        TEXT;
  v_starts     DATE;
  v_ends       DATE;
  v_profile    UUID;
  v_existing   UUID;
BEGIN
  IF jsonb_typeof(p_members) <> 'array' THEN
    RAISE EXCEPTION 'Se esperaba un arreglo de afiliados';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_members) LOOP
    v_idx := v_idx + 1;

    BEGIN
      v_doc  := nullif(btrim(v_row->>'document_number'), '');
      v_name := nullif(btrim(v_row->>'full_name'), '');
      v_rel  := lower(coalesce(nullif(btrim(v_row->>'relationship'), ''), 'beneficiary'));

      IF v_doc IS NULL THEN
        RAISE EXCEPTION 'Falta el numero de documento';
      END IF;
      IF v_name IS NULL THEN
        RAISE EXCEPTION 'Falta el nombre completo';
      END IF;
      IF v_rel NOT IN ('holder', 'beneficiary') THEN
        RAISE EXCEPTION 'Relacion invalida: "%". Use holder o beneficiary', v_rel;
      END IF;

      v_key := member_document_key(v_doc);

      v_starts := coalesce(nullif(btrim(v_row->>'starts_on'), '')::date, sv_today());
      v_ends   := nullif(btrim(v_row->>'ends_on'), '')::date;

      IF v_ends IS NOT NULL AND v_ends < v_starts THEN
        RAISE EXCEPTION 'La fecha de baja es anterior a la de alta';
      END IF;

      -- Vinculacion con una cuenta existente por documento. Casi siempre da
      -- NULL: el padron se carga antes de que la gente descargue la app.
      -- ARREGLADO en 00052: comparaba `ps.dui_number = v_doc` en crudo, asi que
      -- un DUI guardado con guion no casaba con uno enviado sin el.
      SELECT ps.profile_id INTO v_profile
        FROM profile_sensitive ps
       WHERE member_document_key(ps.dui_number) = v_key
       LIMIT 1;

      -- ARREGLADO en 00052: comparaba `m.document_number = v_doc` en crudo.
      SELECT m.id INTO v_existing
        FROM members m
       WHERE m.policy_id = p_policy_id
         AND member_document_key(m.document_number) = v_key;

      IF v_existing IS NOT NULL THEN
        UPDATE members
           SET full_name  = v_name,
               phone      = nullif(btrim(v_row->>'phone'), ''),
               relationship = v_rel,
               starts_on  = v_starts,
               ends_on    = v_ends,
               -- Solo se rellena; nunca se desvincula una cuenta ya asociada.
               profile_id = coalesce(members.profile_id, v_profile),
               updated_at = NOW()
         WHERE id = v_existing;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO members (policy_id, profile_id, document_number, full_name,
                             phone, relationship, starts_on, ends_on)
        VALUES (p_policy_id, v_profile, v_doc, v_name,
                nullif(btrim(v_row->>'phone'), ''), v_rel, v_starts, v_ends);
        v_inserted := v_inserted + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Una fila mala no debe tumbar el lote entero: se anota y se sigue.
      v_errors := v_errors || jsonb_build_object(
        'row', v_idx,
        'document_number', coalesce(v_doc, ''),
        'message', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated',  v_updated,
    'failed',   jsonb_array_length(v_errors),
    'errors',   v_errors
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stats JSONB;
BEGIN
  -- La guarda que faltaba: sin esto, cualquiera con la anon key leia los ingresos.
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las metricas del panel';
  END IF;

  SELECT jsonb_build_object(
    'total_requests', (SELECT COUNT(*) FROM service_requests),
    'pending_requests', (SELECT COUNT(*) FROM service_requests WHERE status = 'initiated'),
    'active_requests', (SELECT COUNT(*) FROM service_requests WHERE status IN ('assigned', 'en_route', 'active')),
    'completed_requests', (SELECT COUNT(*) FROM service_requests WHERE status = 'completed'),
    'cancelled_requests', (SELECT COUNT(*) FROM service_requests WHERE status = 'cancelled'),
    'total_users', (SELECT COUNT(*) FROM profiles WHERE role = 'USER'),
    'total_operators', (SELECT COUNT(*) FROM profiles WHERE role = 'OPERATOR'),
    'active_providers', (SELECT COUNT(*) FROM providers WHERE is_active = true),
    'total_revenue', (SELECT COALESCE(SUM(total_price), 0) FROM service_requests WHERE status = 'completed'),
    'avg_rating', (SELECT COALESCE(AVG(stars), 0) FROM ratings),
    'requests_today', (SELECT COUNT(*) FROM service_requests WHERE created_at >= sv_today()),
    'requests_this_week', (SELECT COUNT(*) FROM service_requests WHERE created_at >= sv_today() - INTERVAL '7 days'),
    'requests_this_month', (SELECT COUNT(*) FROM service_requests WHERE created_at >= sv_today() - INTERVAL '30 days')
  ) INTO v_stats;

  RETURN v_stats;
END;
$function$;
