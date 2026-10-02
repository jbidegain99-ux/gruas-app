/**
 * Mensaje para el socio cuando verify_request_pin (00054) rechaza sin decir
 * cuántos intentos quedan ni que hay bloqueo (esos dos casos se arman aparte).
 * El servidor responde códigos en inglés; acá se dicen en español y con qué
 * hacer. Uno desconocido cae al genérico en vez de mostrarse tal cual.
 */
const MENSAJES: Record<string, string> = {
  'Not the assigned operator': 'Este servicio ya no está asignado a ti. Vuelve a tus solicitudes.',
  'Invalid request': 'Este servicio ya no está disponible.',
  'Not authenticated': 'Tu sesión venció. Vuelve a iniciar sesión.',
  'Request has no PIN': 'Este servicio no tiene PIN de confirmación. Llama a soporte.',
};

export const PIN_GENERIC_ERROR = 'El PIN no coincide. Verifica con el Usuario.';

export function pinErrorMessage(serverError: string | null | undefined): string {
  return (serverError && MENSAJES[serverError]) || PIN_GENERIC_ERROR;
}
