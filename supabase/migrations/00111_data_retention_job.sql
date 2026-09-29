-- =====================================================
-- 00111 — Retencion de datos personales (backlog LAN-01, Decreto 144)
--
-- El aviso de privacidad publicado (PrivacyPage / docs/PROTECCION_DATOS.md)
-- PROMETE plazos que nadie cumplia:
--   * Recorrido detallado de cada servicio: 90 dias.
--   * Mensajes del chat: 12 meses.
-- Este job los cumple todos los dias. Un aviso que promete borrar y no borra
-- es peor que no prometer nada.
--
-- Los km de cada caso (00107) se calculan desde el recorrido; antes de borrarlo
-- se asegura que el caso ya los tenga guardados, asi el tablero del MOPT y la
-- ficha 360 no pierden el dato al vencer el recorrido.
--
-- Los documentos de identidad del socio (12 meses despues de dejar de estar
-- activo) quedan pendientes: "dejar de estar activo" todavia no esta definido
-- en el modelo, y borrar documentos mal es irreversible.
-- =====================================================

CREATE OR REPLACE FUNCTION public.purge_expired_personal_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trail_cutoff TIMESTAMPTZ := now() - interval '90 days';
  v_chat_cutoff  TIMESTAMPTZ := now() - interval '12 months';
  v_trail INT;
  v_chat  INT;
  r RECORD;
BEGIN
  -- Servicios cerrados hace mas de 90 dias: primero los km, despues el recorrido.
  FOR r IN
    SELECT sr.id
      FROM service_requests sr
      JOIN cases c ON c.request_id = sr.id
     WHERE sr.status = 'completed'
       AND sr.completed_at < v_trail_cutoff
       AND c.km_computed_at IS NULL
       AND EXISTS (SELECT 1 FROM service_location_trail t WHERE t.request_id = sr.id)
  LOOP
    PERFORM compute_case_km(r.id);
  END LOOP;

  DELETE FROM service_location_trail t
   USING service_requests sr
   WHERE sr.id = t.request_id
     AND sr.status IN ('completed', 'cancelled')
     AND COALESCE(sr.completed_at, sr.cancelled_at, sr.updated_at) < v_trail_cutoff;
  GET DIAGNOSTICS v_trail = ROW_COUNT;

  DELETE FROM request_messages WHERE created_at < v_chat_cutoff;
  GET DIAGNOSTICS v_chat = ROW_COUNT;

  RETURN jsonb_build_object('trail_points', v_trail, 'chat_messages', v_chat, 'ran_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_personal_data() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.purge_expired_personal_data() IS
  '00111 (LAN-01): borra el recorrido GPS a los 90 dias y el chat a los 12 meses, '
  'como promete el aviso de privacidad. La agenda pg_cron una vez al dia.';

-- Todos los dias a las 03:15 de El Salvador (09:15 UTC), fuera de horario pico.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-personal-data') THEN
    PERFORM cron.unschedule('purge-expired-personal-data');
  END IF;

  PERFORM cron.schedule(
    'purge-expired-personal-data',
    '15 9 * * *',
    $cron$SELECT public.purge_expired_personal_data();$cron$
  );
END;
$$;
