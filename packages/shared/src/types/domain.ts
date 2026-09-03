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

/**
 * Forma que usa el asistente de solicitud para un servicio del catalogo.
 *
 * Conserva los nombres de la vieja tabla `service_type_pricing`, que desde la
 * migracion 00049 ya no existe: el catalogo unico es `services` y la pantalla
 * mapea sus columnas (`slug`, `name_es`, `description_es`) a estos nombres.
 */
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
  created_at: string;
  updated_at: string;
}

/**
 * Documentos de identidad, deliberadamente FUERA de `Profile`.
 *
 * RLS filtra filas, no columnas: mientras el DUI vivio en `profiles`, todo rol
 * que pudiera ver una fila lo veia tambien —el operador, el de sus clientes—.
 * La migracion 00042 los movio a `profile_sensitive`, cuyo RLS los limita al
 * titular y al admin. Ver docs/PROTECCION_DATOS.md §7.3.
 *
 * La misma razon vale para cualquier rol que se agregue despues: separar la
 * tabla es lo que hace que ampliar el acceso a `profiles` no filtre el DUI.
 */
export interface ProfileSensitive {
  profile_id: string;
  dui_number: string | null;
  id_doc_path: string | null;
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

/**
 * B-11 — resultado de verificar si quien solicita es un afiliado con cobertura
 * vigente. Lo devuelve el RPC `check_member_coverage()` y viene tambien dentro
 * de la respuesta de `create_service_request`.
 *
 * `error` NO significa "sin cobertura": significa que no se pudo comprobar. La
 * solicitud se crea igual (es asistencia vial: no se deja varado a nadie porque
 * fallo una consulta), pero hay que decirselo al usuario y revisarla a mano.
 * Ver supabase/migrations/00047_coverage_check_on_request.sql.
 */
export type CoverageStatus = 'covered' | 'none' | 'inactive' | 'error';

export interface CoverageResult {
  status: CoverageStatus;
  member_id?: string;
  policy_id?: string;
  plan_id?: string;
  policy_number?: string;
  plan_code?: string;
  plan_name?: string;
  insurer_name?: string;
  relationship?: 'holder' | 'beneficiary';
  /** Por que no esta vigente, o que fallo. Presente en `inactive` y `error`. */
  reason?: string;
}
