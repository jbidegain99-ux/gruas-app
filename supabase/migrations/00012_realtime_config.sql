-- Configure realtime for relevant tables

-- Enable realtime for operator_locations (for tracking)
ALTER PUBLICATION supabase_realtime ADD TABLE operator_locations;

-- Enable realtime for service_requests (for status updates)
ALTER PUBLICATION supabase_realtime ADD TABLE service_requests;

-- request_messages already added in previous migration

-- Note: request_events could be added but may generate too much traffic
-- ALTER PUBLICATION supabase_realtime ADD TABLE request_events;
