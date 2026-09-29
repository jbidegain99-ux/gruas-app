// Contactos de soporte (backlog APP-07). Salen de variables de entorno (.env o
// secretos de EAS), nunca de números de relleno en el código: si una no está
// configurada, esa opción simplemente no se ofrece.
const clean = (v: string | undefined) => (v ?? '').replace(/[^\d+]/g, '');

export const SUPPORT_CONFIG = {
  // Número nacional de emergencias (El Salvador). Es real y público.
  EMERGENCY_NUMBER: '911',

  // Línea de soporte de Budi (voz), p. ej. +50322223333.
  SUPPORT_PHONE: clean(process.env.EXPO_PUBLIC_SUPPORT_PHONE),

  // WhatsApp de soporte, formato internacional sin '+' (para wa.me), p. ej. 50370001234.
  SUPPORT_WHATSAPP: clean(process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP).replace(/^\+/, ''),
} as const;
