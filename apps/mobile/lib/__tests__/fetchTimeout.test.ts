import { describe, expect, it, vi } from 'vitest';
import { API_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, fetchWithTimeout, timeoutFor } from '../fetchTimeout';

// Un fetch que nunca responde hasta que lo cancelan: como una zona sin señal.
const colgado = (() => (_: unknown, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('abortado')));
  })) as unknown as () => typeof fetch;

describe('fetchWithTimeout', () => {
  it('corta una llamada que no responde', async () => {
    vi.useFakeTimers();
    const f = fetchWithTimeout(colgado(), () => 1000);
    const p = f('http://x/rest/v1/rpc/complete_service_request');
    const check = expect(p).rejects.toThrow('abortado');
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    vi.useRealTimers();
  });

  it('deja pasar la respuesta si llega a tiempo', async () => {
    const ok = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const r = await fetchWithTimeout(ok, () => 1000)('http://x/rest/v1/profiles');
    expect(r.status).toBe(200);
  });

  it('respeta la cancelación de quien llama', async () => {
    const outer = new AbortController();
    const p = fetchWithTimeout(colgado(), () => 60_000)('http://x/rest/v1/x', { signal: outer.signal });
    outer.abort();
    await expect(p).rejects.toThrow('abortado');
  });

  it('más margen para subir archivos', () => {
    expect(timeoutFor('http://x/storage/v1/object/id-documents/a.jpg')).toBe(UPLOAD_TIMEOUT_MS);
    expect(timeoutFor('http://x/rest/v1/rpc/x')).toBe(API_TIMEOUT_MS);
  });
});
