export type UserRole = 'USER' | 'OPERATOR' | 'ADMIN' | 'INSURER' | 'MOPT' | 'SUPPORT';

export type TowType = 'light' | 'heavy';

export type ServiceType = 'tow' | 'battery' | 'tire' | 'fuel' | 'locksmith' | 'mechanic' | 'winch' | 'water_truck';

export type FuelType = 'regular' | 'premium' | 'diesel';

export type ServiceRequestStatus =
  | 'initiated'    // Request created, waiting for operator
  | 'assigned'     // Operator accepted, en route to pickup
  | 'en_route'     // Operator on the way to pickup
  | 'active'       // PIN verified, service in progress
  | 'completed'    // Service completed
  | 'cancelled';   // Service cancelled

export type RequestEventType =
  | 'REQUEST_CREATED'
  | 'OPERATOR_ACCEPTED'
  | 'OPERATOR_EN_ROUTE'
  | 'PIN_VERIFIED'
  | 'STATUS_CHANGED'
  | 'OPERATOR_CANCELLED'
  | 'ADMIN_CANCELLED'
  | 'USER_CANCELLED'
  | 'PRICE_COMPUTED'
  // B-11: rastro de la verificacion de cobertura al crear la solicitud.
  | 'COVERAGE_CHECKED'
  | 'MESSAGE_SENT'
  | 'RATING_SUBMITTED';
