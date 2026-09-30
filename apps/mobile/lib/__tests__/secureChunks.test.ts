import { describe, it, expect } from 'vitest';
import { chunkedStore, type KeyValueStore } from '../secureChunks';

// Imita SecureStore: más de 2048 bytes por valor no se guarda (la sesión de
// Supabase pesa ~2.1 KB y la app pedía iniciar sesión cada vez que se abría).
function fakeSecureStore() {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    getItemAsync: async (k) => data.get(k) ?? null,
    setItemAsync: async (k, v) => {
      if (v.length > 2048) throw new Error('Value larger than 2048 bytes');
      data.set(k, v);
    },
    deleteItemAsync: async (k) => {
      data.delete(k);
    },
  };
  return { store, data };
}

const SESION = JSON.stringify({ access_token: 'a'.repeat(866), refresh_token: 'r'.repeat(12), user: { id: 'u', x: 'y'.repeat(1200) } });

describe('chunkedStore', () => {
  it('guarda y lee una sesión más grande que el límite de SecureStore', async () => {
    const { store, data } = fakeSecureStore();
    const s = chunkedStore(store);
    expect(SESION.length).toBeGreaterThan(2048);
    await s.set('sb-auth-token', SESION);
    expect(await s.get('sb-auth-token')).toBe(SESION);
    for (const v of data.values()) expect(v.length).toBeLessThanOrEqual(2048);
  });

  it('lee lo que quedó guardado entero con la versión anterior', async () => {
    const { store } = fakeSecureStore();
    await store.setItemAsync('viejo', 'valor chico');
    expect(await chunkedStore(store).get('viejo')).toBe('valor chico');
  });

  it('borrar no deja trozos, y una sesión más corta no hereda restos', async () => {
    const { store, data } = fakeSecureStore();
    const s = chunkedStore(store);
    await s.set('k', SESION);
    await s.set('k', 'corta');
    expect(await s.get('k')).toBe('corta');
    await s.remove('k');
    expect(data.size).toBe(0);
    expect(await s.get('k')).toBeNull();
  });

  it('si falta un trozo, no devuelve una sesión rota', async () => {
    const { store, data } = fakeSecureStore();
    const s = chunkedStore(store);
    await s.set('k', SESION);
    data.delete('k.1');
    expect(await s.get('k')).toBeNull();
  });
});
