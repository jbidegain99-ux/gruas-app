// Logger de la app. En producción (`__DEV__ === false`) `log`/`debug` no hacen
// nada, para no ensuciar la consola ni filtrar datos (p. ej. contenido de chat)
// en los flujos calientes (tracking, ETA, mensajes). `warn`/`error` SÍ pasan
// siempre: son diagnóstico legítimo útil incluso en producción.
//
// Uso: import { logger } from '@/lib/logger';  logger.log('...', obj);

export const logger = {
  log: (...args: unknown[]) => {
    if (__DEV__) console.log(...args);
  },
  debug: (...args: unknown[]) => {
    if (__DEV__) console.debug(...args);
  },
  warn: (...args: unknown[]) => {
    console.warn(...args);
  },
  error: (...args: unknown[]) => {
    console.error(...args);
  },
};
