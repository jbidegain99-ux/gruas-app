// 00153: aseguradoras y reaseguradoras en pausa hasta que Walter avise. Se lee
// el mismo interruptor que el panel y la app, con la llave pública y un caché
// de un minuto (las páginas públicas no tienen sesión y siguen siendo rápidas).
export async function insurersOn(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/platform_features`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      next: { revalidate: 60 },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { insurers?: unknown } | null;
    return data?.insurers === true;
  } catch {
    return false;
  }
}
