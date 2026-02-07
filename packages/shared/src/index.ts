// Gruas App Shared Types and Utilities

// User Roles
export type UserRole = 'USER' | 'OPERATOR' | 'ADMIN' | 'MOP';

// Tow Truck Types
export type TowType = 'light' | 'heavy';

// Service Types
export type ServiceType = 'tow' | 'battery' | 'tire' | 'fuel' | 'locksmith' | 'mechanic' | 'winch';

// Fuel Types
export type FuelType = 'regular' | 'premium' | 'diesel';

// Service-specific detail interfaces
export interface TireServiceDetails {
  has_spare: boolean;
}

export interface FuelServiceDetails {
  fuel_type: FuelType;
  gallons: number;
}

export type ServiceDetails = TireServiceDetails | FuelServiceDetails | Record<string, unknown>;

// Service Type Pricing (from DB)
export interface ServiceTypePricing {
  id: string;
  service_type: ServiceType;
  display_name: string;
  description: string;
  icon: string;
  base_price: number;
  extra_fee: number;
  extra_fee_label: string | null;
  requires_destination: boolean;
  sort_order: number;
  is_active: boolean;
  currency: string;
}

// UI config for service types
export interface ServiceTypeConfig {
  type: ServiceType;
  emoji: string;
  name: string;
  color: string;
}

export const SERVICE_TYPE_CONFIGS: Record<ServiceType, ServiceTypeConfig> = {
  tow:       { type: 'tow',       emoji: '🚛', name: 'Grua',        color: '#E67E22' },
  battery:   { type: 'battery',   emoji: '🔋', name: 'Bateria',     color: '#2ECC71' },
  tire:      { type: 'tire',      emoji: '🛞', name: 'Llanta',      color: '#3498DB' },
  fuel:      { type: 'fuel',      emoji: '⛽', name: 'Combustible', color: '#E74C3C' },
  locksmith: { type: 'locksmith', emoji: '🔑', name: 'Cerrajeria',  color: '#9B59B6' },
  mechanic:  { type: 'mechanic',  emoji: '🔧', name: 'Mecanico',    color: '#F39C12' },
  winch:     { type: 'winch',     emoji: '🏗️', name: 'Winche',      color: '#1ABC9C' },
};

// Service (dynamic catalog) Interface
export interface Service {
  id: string;
  slug: string;
  name_es: string;
  name_en: string;
  description_es: string;
  description_en: string;
  icon: string;
  base_price: number;
  extra_fee: number;
  extra_fee_label: string | null;
  requires_destination: boolean;
  sort_order: number;
  is_active: boolean;
  currency: string;
  created_at: string;
  updated_at: string;
}

// Provider-Service Junction Interface
export interface ProviderService {
  id: string;
  provider_id: string;
  service_id: string;
  is_available: boolean;
  custom_price: number | null;
  created_at: string;
  updated_at: string;
}

// Service Request Status
export type ServiceRequestStatus =
  | 'initiated'    // Request created, waiting for operator
  | 'assigned'     // Operator accepted, en route to pickup
  | 'en_route'     // Operator on the way to pickup
  | 'active'       // PIN verified, service in progress
  | 'completed'    // Service completed
  | 'cancelled';   // Service cancelled

// Event Types for Audit
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
  | 'MOP_NOTIFIED'
  | 'MESSAGE_SENT'
  | 'RATING_SUBMITTED';

// Profile Interface
export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  phone: string;
  dui_number: string | null;
  id_doc_path: string | null;
  created_at: string;
  updated_at: string;
}

// Provider Interface
export interface Provider {
  id: string;
  name: string;
  tow_type_supported: 'light' | 'heavy' | 'both';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Operator Location Interface
export interface OperatorLocation {
  id: string;
  operator_id: string;
  lat: number;
  lng: number;
  updated_at: string;
}

// Pricing Rules Interface
export interface PricingRule {
  id: string;
  base_exit_fee: number;
  included_km: number;
  price_per_km_light: number;
  price_per_km_heavy: number;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Price Breakdown Interface
export interface PriceBreakdown {
  base_exit_fee: number;
  included_km: number;
  extra_km: number;
  price_per_km: number;
  extra_km_charge: number;
  total: number;
  currency: string;
  tow_type: TowType;
  distance_operator_to_pickup_km: number;
  distance_pickup_to_dropoff_km: number;
  total_distance_km: number;
}

// Service Request Interface
export interface ServiceRequest {
  id: string;
  user_id: string;
  operator_id: string | null;
  provider_id: string | null;
  tow_type: TowType;
  status: ServiceRequestStatus;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string;
  incident_type: string;
  vehicle_plate: string | null;
  vehicle_doc_path: string | null;
  vehicle_photo_url: string | null;
  service_type: ServiceType;
  service_details: ServiceDetails;
  pin_hash: string;
  distance_operator_to_pickup_km: number | null;
  distance_pickup_to_dropoff_km: number | null;
  price_breakdown: PriceBreakdown | null;
  total_price: number | null;
  created_at: string;
  updated_at: string;
}

// Request Event Interface (Audit)
export interface RequestEvent {
  id: string;
  request_id: string;
  actor_id: string;
  actor_role: UserRole;
  event_type: RequestEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

// Request Message Interface (Chat)
export interface RequestMessage {
  id: string;
  request_id: string;
  sender_id: string;
  message: string;
  created_at: string;
}

// Rating Interface
export interface Rating {
  id: string;
  request_id: string;
  rater_user_id: string;
  rated_operator_id: string;
  stars: number; // 1-5
  comment: string | null;
  created_at: string;
}

// API Response Types
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  success: boolean;
}

// Location Types
export interface Coordinates {
  lat: number;
  lng: number;
}

export interface LocationWithAddress extends Coordinates {
  address: string;
}

// Form Types
export interface CreateServiceRequestInput {
  pickup: LocationWithAddress;
  dropoff: LocationWithAddress;
  tow_type: TowType;
  incident_type: string;
  vehicle_plate?: string;
  vehicle_doc_path: string;
  service_type: ServiceType;
  service_details: ServiceDetails;
}

export interface VerifyPinInput {
  request_id: string;
  pin: string;
}

// Utility function to validate PIN format
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

// Generate random 4-digit PIN
export function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
