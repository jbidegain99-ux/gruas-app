import type { LocationWithAddress } from './geo';
import type { ServiceDetails } from './domain';
import type { ServiceType, TowType } from './enums';

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  success: boolean;
}

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
