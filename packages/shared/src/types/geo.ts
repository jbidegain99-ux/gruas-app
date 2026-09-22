export interface Coordinates {
  lat: number;
  lng: number;
}

export interface LocationWithAddress extends Coordinates {
  address: string;
}
