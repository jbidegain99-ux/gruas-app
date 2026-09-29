import { describe, expect, it } from 'vitest';
import { normalizeVersion, parseVersionCheck } from '../appVersion';

describe('appVersion', () => {
  it('interpreta la respuesta de la base', () => {
    expect(
      parseVersionCheck({ status: 'update_required', store_url: 'https://play.google.com/x', latest_version: '1.2.0' })
    ).toEqual({ status: 'update_required', storeUrl: 'https://play.google.com/x', latestVersion: '1.2.0' });
    expect(parseVersionCheck({ status: 'update_available', store_url: null }).status).toBe('update_available');
  });

  it('falla abierta: sin respuesta o con algo raro, la app sigue', () => {
    expect(parseVersionCheck(null).status).toBe('ok');
    expect(parseVersionCheck('update_required').status).toBe('ok');
    expect(parseVersionCheck({ status: 'bloquear' }).status).toBe('ok');
  });

  it('solo abre enlaces https a la tienda', () => {
    expect(parseVersionCheck({ status: 'update_required', store_url: 'javascript:alert(1)' }).storeUrl).toBeNull();
  });

  it('normaliza la versión del binario', () => {
    expect(normalizeVersion('1.0.0')).toBe('1.0.0');
    expect(normalizeVersion('1.2.3-beta.1')).toBe('1.2.3');
    expect(normalizeVersion('1.2')).toBeNull();
    expect(normalizeVersion(undefined)).toBeNull();
  });
});
