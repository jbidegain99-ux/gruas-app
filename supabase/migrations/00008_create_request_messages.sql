-- Create request_messages table for chat

CREATE TABLE request_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id),
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_request_messages_request ON request_messages(request_id);
CREATE INDEX idx_request_messages_sender ON request_messages(sender_id);
CREATE INDEX idx_request_messages_created ON request_messages(created_at DESC);

-- Enable Row Level Security
ALTER TABLE request_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can view messages for their own requests
CREATE POLICY "Users can view own request messages"
  ON request_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_messages.request_id
        AND sr.user_id = auth.uid()
    )
  );

-- Users can send messages to their own requests
CREATE POLICY "Users can send messages to own requests"
  ON request_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_messages.request_id
        AND sr.user_id = auth.uid()
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  );

-- Operators can view messages for their assigned requests
CREATE POLICY "Operators can view assigned request messages"
  ON request_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_messages.request_id
        AND sr.operator_id = auth.uid()
    )
  );

-- Operators can send messages to their assigned requests
CREATE POLICY "Operators can send messages to assigned requests"
  ON request_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_messages.request_id
        AND sr.operator_id = auth.uid()
        AND sr.status IN ('assigned', 'en_route', 'active')
    )
  );

-- Users and operators can mark messages as read
CREATE POLICY "Participants can mark messages as read"
  ON request_messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_messages.request_id
        AND (sr.user_id = auth.uid() OR sr.operator_id = auth.uid())
    )
  )
  WITH CHECK (
    -- Only allow updating is_read field
    is_read IS NOT NULL
  );

-- Admins can view all messages
CREATE POLICY "Admins can view all messages"
  ON request_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- Function to send a message and create audit event
CREATE OR REPLACE FUNCTION send_message(
  p_request_id UUID,
  p_message TEXT
)
RETURNS request_messages AS $$
DECLARE
  v_message request_messages;
BEGIN
  INSERT INTO request_messages (request_id, sender_id, message)
  VALUES (p_request_id, auth.uid(), p_message)
  RETURNING * INTO v_message;

  -- Create audit event
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  SELECT
    p_request_id,
    auth.uid(),
    p.role,
    'MESSAGE_SENT'::event_type,
    jsonb_build_object('message_id', v_message.id)
  FROM profiles p
  WHERE p.id = auth.uid();

  RETURN v_message;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE request_messages;
