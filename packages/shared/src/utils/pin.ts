// PIN generation lives server-side (Postgres pgcrypto via the
// create_service_request RPC). Never generate PINs on the client —
// Math.random() is not cryptographically secure.
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
