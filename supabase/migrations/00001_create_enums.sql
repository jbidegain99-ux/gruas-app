-- Create custom enums for Gruas App

-- User roles
CREATE TYPE user_role AS ENUM ('USER', 'OPERATOR', 'ADMIN', 'MOP');

-- Tow truck types
CREATE TYPE tow_type AS ENUM ('light', 'heavy');

-- Service request status
CREATE TYPE request_status AS ENUM (
  'initiated',   -- Request created, waiting for operator
  'assigned',    -- Operator accepted
  'en_route',    -- Operator on the way to pickup
  'active',      -- PIN verified, service in progress
  'completed',   -- Service completed
  'cancelled'    -- Service cancelled
);

-- Event types for audit
CREATE TYPE event_type AS ENUM (
  'REQUEST_CREATED',
  'OPERATOR_ACCEPTED',
  'OPERATOR_EN_ROUTE',
  'PIN_VERIFIED',
  'STATUS_CHANGED',
  'OPERATOR_CANCELLED',
  'ADMIN_CANCELLED',
  'USER_CANCELLED',
  'PRICE_COMPUTED',
  'MOP_NOTIFIED',
  'MESSAGE_SENT',
  'RATING_SUBMITTED'
);
