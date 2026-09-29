// Política de versión mínima (backlog APP-09, migr. 00118). La base decide;
// esto interpreta su respuesta y falla abierta: si no se puede consultar, la
// app sigue funcionando (un Usuario varado no puede quedar bloqueado por un
// error de red).

export type VersionStatus = 'ok' | 'update_available' | 'update_required';

export type VersionCheck = {
  status: VersionStatus;
  storeUrl: string | null;
  latestVersion: string | null;
};

const OK: VersionCheck = { status: 'ok', storeUrl: null, latestVersion: null };

/** Respuesta de `app_version_check` -> estado para la UI. Cualquier rareza es "ok". */
export function parseVersionCheck(data: unknown): VersionCheck {
  if (!data || typeof data !== 'object') return OK;
  const d = data as Record<string, unknown>;
  const status = d.status;
  if (status !== 'update_required' && status !== 'update_available') return OK;
  return {
    status,
    storeUrl: typeof d.store_url === 'string' && d.store_url.startsWith('https://') ? d.store_url : null,
    latestVersion: typeof d.latest_version === 'string' ? d.latest_version : null,
  };
}

/** Versión del binario en formato 1.2.3, o null si no se puede leer. */
export function normalizeVersion(v: string | null | undefined): string | null {
  const m = v?.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}
