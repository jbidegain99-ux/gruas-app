import { setDropoffCatalog } from '@gruas-app/shared';
import { supabase } from '@/lib/supabase';

/**
 * Carga que tipos de servicio trasladan el vehiculo (y por lo tanto tienen
 * destino) desde `services`, que es la tabla que el admin edita en
 * /admin/services — ahi ya existe la columna "Requiere destino".
 *
 * `services` es el catalogo unico desde la migracion 00049. Antes convivia con
 * `service_type_pricing`, que tenia los mismos campos con datos distintos; hoy
 * esa quedo como vista de compatibilidad y no debe usarse.
 *
 * `slug` de `services` es el mismo valor que `service_requests.service_type`.
 *
 * Nunca lanza: si falla, `requiresDropoff()` cae a su respaldo.
 */
export async function loadDropoffCatalog(): Promise<void> {
  const { data, error } = await supabase
    .from('services')
    .select('slug, requires_destination')
    .eq('is_active', true);

  if (error) {
    console.error('[catalogo] no se pudo cargar, se usa el respaldo:', error.message);
    return;
  }

  setDropoffCatalog(
    (data ?? []).map((s) => ({
      service_type: s.slug,
      requires_destination: !!s.requires_destination,
    }))
  );
}
