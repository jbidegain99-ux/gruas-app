import type {
  FuelType,
  RequestEventType,
  ServiceRequestStatus,
  ServiceType,
  TowType,
  UserRole,
} from './enums';

export interface TireServiceDetails {
  has_spare: boolean;
}

export interface FuelServiceDetails {
  fuel_type: FuelType;
  gallons: number;
}

export type ServiceDetails = TireServiceDetails | FuelServiceDetails | Record<string, unknown>;

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

export interface ProviderService {
  id: string;
  provider_id: string;
  service_id: string;
  is_available: boolean;
  custom_price: number | null;
  created_at: string;
  updated_at: string;
}

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

export interface Provider {
  id: string;
  name: string;
  tow_type_supported: 'light' | 'heavy' | 'both';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OperatorLocation {
  id: string;
  operator_id: string;
  lat: number;
  lng: number;
  updated_at: string;
}

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

export interface RequestEvent {
  id: string;
  request_id: string;
  actor_id: string;
  actor_role: UserRole;
  event_type: RequestEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface RequestMessage {
  id: string;
  request_id: string;
  sender_id: string;
  message: string;
  created_at: string;
}

export interface Rating {
  id: string;
  request_id: string;
  rater_user_id: string;
  rated_operator_id: string;
  stars: number; // 1-5
  comment: string | null;
  created_at: string;
}
