-- =====================================================
-- 00052 — El DUI del padron se compara NORMALIZADO
--
-- EL PROBLEMA
-- `_import_members` (00046) buscaba al afiliado con `document_number = v_doc`,
-- comparacion de texto exacta, y el indice unico era sobre la columna en crudo.
-- Pero `check_member_coverage` (00047) ya buscaba con `normalize_document()`.
-- Una parte del sistema normalizaba y la otra no.
--
-- Consecuencia verificada: `09876543-2` y `098765432` crean DOS filas para la
-- misma persona. El dano no es el conteo de eventos —la seleccion es estable,
-- `ORDER BY ... m.created_at ASC LIMIT 1` gana siempre la mas vieja— sino que
-- **una baja enviada con el otro formato de DUI cae en la fila fantasma** y la
-- fila activa sigue cubierta: se le sigue facturando a la aseguradora alguien
-- que ya fue dado de baja. Las aseguradoras mandan formatos mixtos; esto pasa.
--
-- POR QUE UNA CLAVE NUEVA Y NO `normalize_document` A SECAS
-- `normalize_document()` deja solo digitos y devuelve NULL si no hay ninguno.
-- Usarla tal cual como clave romperia los documentos sin digitos: NULL = NULL
-- es falso, asi que cada importacion insertaria una fila nueva para el mismo
-- documento —el bug de duplicados, pero peor—. `member_document_key()` cae al
-- texto crudo en minusculas cuando no hay digitos, que es el comportamiento de
-- hoy para esos casos.
--
-- Llama a `normalize_document()` en vez de repetir el regexp a proposito: dos
-- copias de la misma regla divergiendo es exactamente el bug que se arregla.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. La clave de identidad de un afiliado dentro de su poliza
-- ---------------------------------------------------------------
-- IMMUTABLE porque va dentro de un indice.
CREATE OR REPLACE FUNCTION public.member_document_key(p_doc TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    normalize_document(p_doc),
    NULLIF(lower(btrim(COALESCE(p_doc, ''))), '')
  );
$$;

COMMENT ON FUNCTION public.member_document_key(TEXT) IS
  'Identidad de un afiliado dentro de su poliza: solo digitos si los hay, si no '
  'el texto crudo en minusculas. Usarla SIEMPRE para comparar documentos de '
  'padron — no comparar `document_number` en crudo.';

-- ---------------------------------------------------------------
-- 2. Soltar la unicidad vieja ANTES de reparar
-- ---------------------------------------------------------------
-- Tiene que ir antes de la fusion del punto 3, no despues: al superviviente se
-- le copia el `document_number` de la fila mas reciente, y mientras el indice
-- viejo siga en pie esa copia choca contra la fila fantasma —que todavia
-- existe— con un 23505. No se puede reparar el dato con la restriccion
-- equivocada todavia puesta.
ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_policy_id_document_number_key;
DROP INDEX IF EXISTS public.members_policy_id_document_number_key;

-- ---------------------------------------------------------------
-- 3. Reparar el padron existente antes de imponer la unicidad nueva
-- ---------------------------------------------------------------
-- Sin esto, el CREATE UNIQUE INDEX de mas abajo falla en cualquier base que ya
-- tenga el duplicado. Y aunque no fallara, dejar los duplicados seria dejar el
-- dano hecho: la baja perdida seguiria perdida.
--
-- Criterios de la fusion:
--  · SOBREVIVE LA MAS VIEJA (`created_at`, desempate por `id`). Es la que
--    `check_member_coverage` ya venia eligiendo, asi que a nadie le cambia la
--    afiliacion bajo los pies.
--  · GANAN LOS DATOS DE LA MAS RECIENTE (`updated_at`). Es la ultima palabra de
--    la aseguradora, justo la instruccion que el bug estaba tirando a la basura.
--    Esto puede dar de baja a alguien que figuraba activo —es el punto: esa baja
--    se envio de verdad y nunca se aplico— y tambien puede reactivar a alguien,
--    por el mismo criterio.
--  · `profile_id` SOLO SE RELLENA, nunca se borra. Misma regla que el resto del
--    sistema: no se le quita a nadie una cuenta ya vinculada.
DO $$
DECLARE
  v_grupos INT := 0;
  v_borradas INT := 0;
BEGIN
  CREATE TEMP TABLE _dedupe ON COMMIT DROP AS
  WITH ordenadas AS (
    SELECT m.*,
           first_value(m.id) OVER w_viejas AS survivor_id,
           first_value(m.id) OVER w_nuevas AS fuente_id,
           count(*)          OVER (PARTITION BY m.policy_id, member_document_key(m.document_number)) AS n
      FROM members m
    WINDOW
      w_viejas AS (PARTITION BY m.policy_id, member_document_key(m.document_number)
                   ORDER BY m.created_at ASC, m.id ASC),
      w_nuevas AS (PARTITION BY m.policy_id, member_document_key(m.document_number)
                   ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC, m.id DESC)
  )
  SELECT id, survivor_id, fuente_id FROM ordenadas WHERE n > 1;

  SELECT count(DISTINCT survivor_id) INTO v_grupos FROM _dedupe;
  IF v_grupos = 0 THEN
    RAISE NOTICE '00052: no habia afiliados duplicados por DUI.';
    RETURN;
  END IF;

  -- (a) Los datos de la fila mas reciente pasan al superviviente.
  UPDATE members m
     SET full_name       = f.full_name,
         phone           = f.phone,
         relationship    = f.relationship,
         starts_on       = f.starts_on,
         ends_on         = f.ends_on,
         is_active       = f.is_active,
         document_number = f.document_number,
         updated_at      = NOW()
    FROM (SELECT DISTINCT survivor_id, fuente_id FROM _dedupe) d
    JOIN members f ON f.id = d.fuente_id
   WHERE m.id = d.survivor_id
     AND d.fuente_id <> d.survivor_id;

  -- (b) Rellenar `profile_id` si el superviviente no tenia y alguna copia si.
  UPDATE members m
     SET profile_id = sub.profile_id, updated_at = NOW()
    FROM (
      SELECT d.survivor_id, min(c.profile_id::text)::uuid AS profile_id
        FROM _dedupe d JOIN members c ON c.id = d.id
       WHERE c.profile_id IS NOT NULL
       GROUP BY d.survivor_id
    ) sub
   WHERE m.id = sub.survivor_id AND m.profile_id IS NULL;

  -- (c) El consumo registrado contra una copia pasa al superviviente, ANTES de
  --     borrarla: `coverage_usage.member_id` es ON DELETE CASCADE y si no, el
  --     historial de servicios cubiertos se perderia en silencio.
  UPDATE coverage_usage cu
     SET member_id = d.survivor_id
    FROM _dedupe d
   WHERE cu.member_id = d.id AND d.id <> d.survivor_id;

  DELETE FROM members m USING _dedupe d
   WHERE m.id = d.id AND d.id <> d.survivor_id;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;

  RAISE NOTICE '00052: % afiliados duplicados fusionados en % personas.', v_borradas, v_grupos;
END;
$$;

-- ---------------------------------------------------------------
-- 4. La unicidad pasa a ser sobre el DUI normalizado
-- ---------------------------------------------------------------
-- Este indice es la red que atrapa TODOS los caminos de escritura, no solo la
-- importacion: el panel de administracion inserta y edita afiliados directo
-- contra la tabla (AdminPolicyDetailPage), sin pasar por `_import_members`.
-- Esa pantalla ya traduce el 23505 a "Ya hay un afiliado con ese DUI en esta
-- poliza", asi que el mensaje sigue siendo el correcto.
CREATE UNIQUE INDEX IF NOT EXISTS members_policy_document_key_uidx
  ON public.members (policy_id, member_document_key(document_number));

-- Sirve a la vinculacion diferida de `check_member_coverage`, que en el punto 6
-- pasa a comparar con esta misma expresion. (El `members_document_idx` viejo era
-- sobre la columna en crudo, asi que nunca sirvio para esa consulta.)
DROP INDEX IF EXISTS public.members_document_idx;
CREATE INDEX IF NOT EXISTS members_document_key_idx
  ON public.members (member_document_key(document_number));

-- ---------------------------------------------------------------
-- 5. La importacion compara normalizado (las DOS busquedas)
-- ---------------------------------------------------------------
-- Identica a 00046 salvo los dos WHERE marcados. Se reescribe entera en vez de
-- parchearla porque una funcion plpgsql no se puede editar por partes.
CREATE OR REPLACE FUNCTION public._import_members(
  p_policy_id UUID,
  p_members   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

      v_starts := coalesce(nullif(btrim(v_row->>'starts_on'), '')::date, CURRENT_DATE);
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
$$;

REVOKE ALL ON FUNCTION public._import_members(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.member_document_key(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_document_key(TEXT) TO authenticated;

-- ---------------------------------------------------------------
-- 6. La vinculacion diferida usa la MISMA clave que todo lo demas
-- ---------------------------------------------------------------
-- `check_member_coverage` (00047) comparaba con `normalize_document()`. Dejarlo
-- asi habria vuelto a partir el sistema en dos nociones de identidad —la de la
-- importacion y la de la vinculacion— que es justo el bug que corrige esta
-- migracion; ademas `members_document_key_idx` no serviria para esa consulta.
-- Con el cambio, un documento sin digitos tambien vincula (antes
-- `normalize_document` daba NULL y no casaba nunca).
--
-- La funcion se reconstruye por SUSTITUCION EXACTA sobre `pg_get_functiondef`,
-- no reescrita a mano: solo cambian las dos lineas de abajo, el resto es
-- byte a byte lo que ya estaba en produccion.
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
           AND m.starts_on <= CURRENT_DATE
           AND (m.ends_on IS NULL OR m.ends_on >= CURRENT_DATE)
           AND p.status = 'active'
           AND p.starts_on <= CURRENT_DATE
           AND (p.ends_on IS NULL OR p.ends_on >= CURRENT_DATE)) AS vigente
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
      WHEN v_member.member_starts_on > CURRENT_DATE      THEN 'Tu afiliacion aun no entra en vigencia'
      WHEN v_member.member_ends_on < CURRENT_DATE        THEN 'Tu afiliacion vencio'
      WHEN v_member.policy_status = 'suspended'          THEN 'La poliza esta suspendida'
      WHEN v_member.policy_status = 'cancelled'          THEN 'La poliza fue cancelada'
      WHEN v_member.policy_status = 'expired'            THEN 'La poliza vencio'
      WHEN v_member.policy_starts_on > CURRENT_DATE      THEN 'La poliza aun no entra en vigencia'
      WHEN v_member.policy_ends_on < CURRENT_DATE        THEN 'La poliza vencio'
      ELSE 'La cobertura no esta vigente'
    END
  );
END;
$function$

;
