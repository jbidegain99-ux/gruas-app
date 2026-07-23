// PIN storage on top of expo-secure-store (Keychain on iOS,
// EncryptedSharedPreferences on Android). Replaces the previous
// AsyncStorage 'request_pins' blob, which was plaintext and readable
// by anything that touched the app sandbox.
//
// Keys live under the prefix `pin_<request_id>` so we can scope reads
// per request without loading the whole set. A small index entry
// (`pin_index`) keeps the list of known request_ids so the history
// screen can bulk-load without enumerating SecureStore (which has no
// listKeys API).
//
// NOTE: SecureStore keys must match /^[\w.-]+$/ (alphanumeric, '.', '-',
// '_'). The prefix must not contain ':' or any other character — it
// throws "Invalid key provided to SecureStore" on device otherwise.
//
// A one-shot migration moves any legacy blob in AsyncStorage into
// SecureStore the first time any helper here is called.

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PIN_KEY_PREFIX = 'pin_';
const PIN_INDEX_KEY = 'pin_index';
const LEGACY_ASYNC_KEY = 'request_pins';

type PinMap = Record<string, string>;

let migrationPromise: Promise<void> | null = null;

// Serializes read-modify-write on the index. Without this, two concurrent
// savePin/removePin calls can both read the index, each append/drop their
// own id, and the second write clobbers the first — losing an id (the PIN
// itself is safe under its own key, but getAllPins would skip it).
let indexQueue: Promise<unknown> = Promise.resolve();

function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexQueue.then(fn, fn);
  // Keep the chain alive regardless of success/failure of this task.
  indexQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readIndex(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(PIN_INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]): Promise<void> {
  await SecureStore.setItemAsync(PIN_INDEX_KEY, JSON.stringify(ids));
}

async function addToIndex(requestId: string): Promise<void> {
  await withIndexLock(async () => {
    const ids = await readIndex();
    if (ids.includes(requestId)) return;
    ids.push(requestId);
    await writeIndex(ids);
  });
}

async function removeFromIndex(requestId: string): Promise<void> {
  await withIndexLock(async () => {
    const ids = await readIndex();
    const next = ids.filter((id) => id !== requestId);
    if (next.length !== ids.length) await writeIndex(next);
  });
}

async function migrateLegacyPinsOnce(): Promise<void> {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    try {
      let blob: string | null;
      try {
        blob = await AsyncStorage.getItem(LEGACY_ASYNC_KEY);
      } catch (err) {
        console.warn('[pinStorage] Failed to read legacy AsyncStorage blob:', err);
        return;
      }
      if (!blob) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(blob);
      } catch (err) {
        console.warn('[pinStorage] Legacy blob was not JSON; discarding:', err);
        await AsyncStorage.removeItem(LEGACY_ASYNC_KEY).catch(() => {});
        return;
      }
      if (!parsed || typeof parsed !== 'object') {
        await AsyncStorage.removeItem(LEGACY_ASYNC_KEY).catch(() => {});
        return;
      }

      const ids: string[] = [];
      let failures = 0;
      for (const [requestId, pin] of Object.entries(parsed as PinMap)) {
        if (typeof pin !== 'string') continue;
        try {
          await SecureStore.setItemAsync(`${PIN_KEY_PREFIX}${requestId}`, pin);
          ids.push(requestId);
        } catch (err) {
          failures++;
          console.warn(`[pinStorage] Failed to migrate PIN for ${requestId}:`, err);
        }
      }

      // Merge with whatever index already exists (defensive — should be
      // empty on first migration).
      const existing = await readIndex();
      const merged = Array.from(new Set([...existing, ...ids]));
      await writeIndex(merged);

      // Drop the plaintext blob only if every PIN made it into SecureStore.
      // If any write failed we keep the legacy blob so the data isn't lost
      // and the migration retries on the next app launch (migrationPromise
      // resets per session).
      if (failures === 0) {
        await AsyncStorage.removeItem(LEGACY_ASYNC_KEY).catch(() => {});
      } else {
        console.warn(
          `[pinStorage] Keeping legacy blob: ${failures} PIN(s) failed to migrate; will retry next launch`,
        );
      }
      console.log(`[pinStorage] Migrated ${ids.length} PIN(s) from AsyncStorage to SecureStore`);
    } catch (err) {
      // readIndex()/writeIndex() (SecureStore I/O) can throw transiently —
      // e.g. Keychain locked right after boot. Don't let that poison the
      // cached promise: reset it so the next call retries, and DON'T rethrow,
      // so a failed legacy migration never blocks savePin/getPin of new PINs.
      console.warn('[pinStorage] Legacy migration failed; will retry on next call:', err);
      migrationPromise = null;
    }
  })();
  return migrationPromise;
}

export async function savePin(requestId: string, pin: string): Promise<void> {
  await migrateLegacyPinsOnce();
  await SecureStore.setItemAsync(`${PIN_KEY_PREFIX}${requestId}`, pin);
  await addToIndex(requestId);
}

export async function getPin(requestId: string): Promise<string | null> {
  await migrateLegacyPinsOnce();
  return SecureStore.getItemAsync(`${PIN_KEY_PREFIX}${requestId}`);
}

export async function getAllPins(): Promise<PinMap> {
  await migrateLegacyPinsOnce();
  const ids = await readIndex();
  const result: PinMap = {};
  for (const id of ids) {
    const pin = await SecureStore.getItemAsync(`${PIN_KEY_PREFIX}${id}`);
    if (pin) result[id] = pin;
  }
  return result;
}

export async function removePin(requestId: string): Promise<void> {
  await migrateLegacyPinsOnce();
  await SecureStore.deleteItemAsync(`${PIN_KEY_PREFIX}${requestId}`);
  await removeFromIndex(requestId);
}
