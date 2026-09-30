// SecureStore guarda como máximo ~2 KB por valor y la sesión de Supabase pesa
// más (~2.1 KB con los datos del usuario): no se guardaba y, al cerrar la app,
// había que volver a iniciar sesión. Se parte en trozos cifrados bajo el
// límite. Lo guardado entero antes (valores chicos) se sigue leyendo.

export type KeyValueStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export const CHUNK = 1800;

export function chunkedStore(store: KeyValueStore) {
  const remove = async (key: string): Promise<void> => {
    const count = Number((await store.getItemAsync(`${key}.n`)) ?? 0);
    for (let i = 0; i < count; i++) await store.deleteItemAsync(`${key}.${i}`);
    await store.deleteItemAsync(`${key}.n`);
    await store.deleteItemAsync(key);
  };

  const get = async (key: string): Promise<string | null> => {
    const count = await store.getItemAsync(`${key}.n`);
    if (!count) return store.getItemAsync(key);
    const parts: string[] = [];
    for (let i = 0; i < Number(count); i++) {
      const part = await store.getItemAsync(`${key}.${i}`);
      if (part == null) return null; // incompleto: como si no hubiera sesión
      parts.push(part);
    }
    return parts.join('');
  };

  const set = async (key: string, value: string): Promise<void> => {
    await remove(key);
    const count = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < count; i++) {
      await store.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    await store.setItemAsync(`${key}.n`, String(count));
  };

  return { get, set, remove };
}
