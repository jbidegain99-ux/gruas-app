-- =====================================================
-- 00090 — El padron acepta las mismas palabras por CSV que por API
--
-- El feature tiene dos puertas: el admin sube un CSV desde /admin/aseguradoras,
-- y la aseguradora integra por `import-members` con su API key. Las dos caen en
-- `_import_members`, pero solo una traduce el vocabulario.
--
-- `apps/web/src/features/admin/csv.ts` normaliza con `traduceRelacion()`: acepta
-- titular, beneficiario, beneficiaria, dependiente. La funcion SQL no: exige
-- literalmente 'holder' o 'beneficiary'. Resultado: el MISMO padron entra por CSV
-- y se rechaza fila por fila por API, con un error que ademas le pide palabras en
-- ingles a una aseguradora salvadorena, cuyo padron dice "Titular" en la columna
-- de relacion.
--
-- Se sube la traduccion a la capa de abajo, que es la que comparten las dos
-- puertas. La UI ya normaliza antes de llamar, asi que para ella no cambia nada:
-- 'holder' sigue mapeando a 'holder'.
-- =====================================================

-- Espeja `traduceRelacion()` de apps/web/src/features/admin/csv.ts. Lo que no
-- reconoce se devuelve tal cual, a proposito: asi el validador de mas abajo lo
-- rechaza nombrando el valor que mando la persona, no un 'beneficiary' inventado.
CREATE OR REPLACE FUNCTION public.member_relationship(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(coalesce(p_texto, '')))
    WHEN ''             THEN 'beneficiary'
    WHEN 'titular'      THEN 'holder'
    WHEN 'holder'       THEN 'holder'
    WHEN 'beneficiario' THEN 'beneficiary'
    WHEN 'beneficiaria' THEN 'beneficiary'
    WHEN 'beneficiary'  THEN 'beneficiary'
    WHEN 'dependiente'  THEN 'beneficiary'
    ELSE lower(btrim(coalesce(p_texto, '')))
  END
$$;

COMMENT ON FUNCTION public.member_relationship(TEXT) IS
  'Normaliza la relacion de un afiliado (titular/beneficiario/... -> holder/beneficiary). '
  'Vacio = beneficiary. Lo desconocido pasa sin tocar para que el validador lo nombre.';

-- Y `_import_members` la usa, en vez de exigir el ingles.
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
      v_rel  := member_relationship(v_row->>'relationship');

      IF v_doc IS NULL THEN
        RAISE EXCEPTION 'Falta el numero de documento';
      END IF;
      IF v_name IS NULL THEN
        RAISE EXCEPTION 'Falta el nombre completo';
      END IF;
      IF v_rel NOT IN ('holder', 'beneficiary') THEN
        RAISE EXCEPTION 'Relacion invalida: "%". Use titular/holder o beneficiario/beneficiary', v_rel;
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
