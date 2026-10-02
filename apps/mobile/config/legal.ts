// URLs de los documentos legales publicados en la web (Decreto 144).
//
// ⚠️ PLACEHOLDER: `WEB_BASE_URL` apunta al dominio de produccion de Budi, que
// todavia no esta definido. Ajustar antes de publicar, junto con los valores de
// `config/support.ts`. La pagina ya existe en la web
// (apps/web/src/app/privacidad) — lo unico que falta es el dominio.
// EXPO_PUBLIC_WEB_URL lo pisa (p. ej. la web local en desarrollo).
export const WEB_BASE_URL = (process.env.EXPO_PUBLIC_WEB_URL || 'https://budi.sv').replace(/\/$/, '');

export const LEGAL_CONFIG = {
  PRIVACY_URL: `${WEB_BASE_URL}/privacidad`,

  // Donde se elige la contraseña nueva tras "¿Olvidaste tu contraseña?". Sin
  // esto el enlace del correo caía en la página de inicio, sin formulario.
  RESET_PASSWORD_URL: `${WEB_BASE_URL}/recuperar`,

  // Correo del Delegado de Proteccion de Datos, para solicitudes ARCO-POL.
  // ⚠️ PLACEHOLDER — ver docs/PROTECCION_DATOS.md §2.
  PRIVACY_EMAIL: 'privacidad@budi.sv',
} as const;
