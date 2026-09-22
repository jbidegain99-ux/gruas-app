-- =====================================================
-- 00057 — Un mensaje de chat no se puede reescribir
--
-- EL BUG (mismo patron que 00054: RLS filtra filas, no columnas)
-- La politica `Participants can mark messages as read` sobre `request_messages`
-- es `UPDATE USING (soy participante) WITH CHECK (is_read IS NOT NULL)`. La
-- intencion era "cualquiera de los dos puede marcar leido", pero el WITH CHECK
-- solo mira `is_read`, asi que un participante podia reescribir CUALQUIER
-- columna del mensaje del OTRO — incluido el texto — mientras `is_read` siguiera
-- no-nulo (y su default es `false`, nunca es nulo).
--
-- VERIFICADO: el operador manda "Voy en camino, 10 minutos"; el usuario hace
-- `UPDATE ... SET message='Acepto pagar $500 extra en efectivo'` sobre esa fila
-- y queda con el `sender_id` del OPERADOR. Evidencia fabricada: en una disputa
-- de cobro, poner palabras en boca del otro es material.
--
-- EL ARREGLO
-- El unico cambio legitimo sobre un mensaje ya escrito es marcarlo leido. Se le
-- deja al cliente exactamente esa columna por GRANT, y nada mas. El texto y el
-- remitente quedan inmutables: los fija `send_message` (SECURITY DEFINER, pone
-- `sender_id = auth.uid()`), unico camino de escritura de la app.
--
-- Hoy la app ni siquiera marca leido (no hace ese UPDATE), asi que esto no
-- quita nada en uso; deja la puerta justa por si se implementa.
-- =====================================================

REVOKE UPDATE ON public.request_messages FROM authenticated, anon;
GRANT UPDATE (is_read) ON public.request_messages TO authenticated;

-- La politica sigue existiendo y sigue diciendo "solo un participante"; ahora la
-- unica columna que ese UPDATE puede tocar es `is_read`. Se endurece igual el
-- WITH CHECK para que quede explicito que solo se permite MARCAR leido (pasar a
-- true), no "desmarcar" el mensaje del otro.
DROP POLICY IF EXISTS "Participants can mark messages as read" ON public.request_messages;
CREATE POLICY "Participants can mark messages as read"
  ON public.request_messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
       WHERE sr.id = request_messages.request_id
         AND (sr.user_id = auth.uid() OR sr.operator_id = auth.uid())
    )
  )
  WITH CHECK (is_read = true);

COMMENT ON TABLE public.request_messages IS
  'Chat del servicio. El texto y el remitente son inmutables (00057): se escriben '
  'solo por send_message(). El cliente solo puede marcar is_read=true.';
