-- Create request_events table for audit trail

CREATE TABLE request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES profiles(id),
  actor_role user_role NOT NULL,
  event_type event_type NOT NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_request_events_request ON request_events(request_id);
CREATE INDEX idx_request_events_actor ON request_events(actor_id);
CREATE INDEX idx_request_events_type ON request_events(event_type);
CREATE INDEX idx_request_events_created ON request_events(created_at DESC);

-- Enable Row Level Security
ALTER TABLE request_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can view events for their own requests
CREATE POLICY "Users can view own request events"
  ON request_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_events.request_id
        AND sr.user_id = auth.uid()
    )
  );

-- Operators can view events for their assigned requests
CREATE POLICY "Operators can view assigned request events"
  ON request_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = request_events.request_id
        AND sr.operator_id = auth.uid()
    )
  );

-- Admins can view all events
CREATE POLICY "Admins can view all events"
  ON request_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- MOP can view all events
CREATE POLICY "MOP can view all events"
  ON request_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'MOP'
    )
  );

-- Function to create an audit event
CREATE OR REPLACE FUNCTION create_request_event(
  p_request_id UUID,
  p_event_type event_type,
  p_payload JSONB DEFAULT '{}'
)
RETURNS request_events AS $$
DECLARE
  v_event request_events;
  v_actor_role user_role;
BEGIN
  -- Get actor role
  SELECT role INTO v_actor_role FROM profiles WHERE id = auth.uid();

  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (p_request_id, auth.uid(), v_actor_role, p_event_type, p_payload)
  RETURNING * INTO v_event;

  RETURN v_event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger function to auto-create events on status changes
CREATE OR REPLACE FUNCTION log_service_request_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Log status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
    SELECT
      NEW.id,
      COALESCE(auth.uid(), NEW.user_id),
      COALESCE(
        (SELECT role FROM profiles WHERE id = auth.uid()),
        'USER'
      ),
      CASE
        WHEN NEW.status = 'assigned' THEN 'OPERATOR_ACCEPTED'::event_type
        WHEN NEW.status = 'en_route' THEN 'OPERATOR_EN_ROUTE'::event_type
        WHEN NEW.status = 'active' THEN 'PIN_VERIFIED'::event_type
        WHEN NEW.status = 'completed' THEN 'STATUS_CHANGED'::event_type
        WHEN NEW.status = 'cancelled' AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'ADMIN' THEN 'ADMIN_CANCELLED'::event_type
        WHEN NEW.status = 'cancelled' AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'OPERATOR' THEN 'OPERATOR_CANCELLED'::event_type
        WHEN NEW.status = 'cancelled' THEN 'USER_CANCELLED'::event_type
        ELSE 'STATUS_CHANGED'::event_type
      END,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      );
  END IF;

  -- Log price computation
  IF OLD.total_price IS NULL AND NEW.total_price IS NOT NULL THEN
    INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
    SELECT
      NEW.id,
      COALESCE(auth.uid(), NEW.operator_id),
      COALESCE(
        (SELECT role FROM profiles WHERE id = auth.uid()),
        'OPERATOR'
      ),
      'PRICE_COMPUTED'::event_type,
      NEW.price_breakdown;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for auto-logging
CREATE TRIGGER log_service_request_changes_trigger
  AFTER UPDATE ON service_requests
  FOR EACH ROW EXECUTE FUNCTION log_service_request_changes();

-- Trigger for new request creation
CREATE OR REPLACE FUNCTION log_new_service_request()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    NEW.id,
    NEW.user_id,
    'USER',
    'REQUEST_CREATED',
    jsonb_build_object(
      'pickup_address', NEW.pickup_address,
      'dropoff_address', NEW.dropoff_address,
      'tow_type', NEW.tow_type,
      'incident_type', NEW.incident_type
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER log_new_service_request_trigger
  AFTER INSERT ON service_requests
  FOR EACH ROW EXECUTE FUNCTION log_new_service_request();
