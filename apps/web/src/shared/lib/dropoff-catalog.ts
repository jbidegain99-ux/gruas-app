import { setDropoffCatalog } from '@gruas-app/shared';
import type { createClient } from '@/shared/lib/supabase/client';

/**
 * Que tipos de servicio trasladan el vehiculo — y por lo tanto tienen un destino
 * real — lo decide `services`, la tabla que el admin edita en /admin/services
 * (columna "Requiere destino"), no una constante del codigo.
 *
 * Vive en `shared/lib` porque lo necesita cualquier pantalla que pinte un
 * "Destino": el panel de admin y el portal de aseguradoras. Las columnas
 * `dropoff_*` de `service_requests` son NOT NULL, asi que al crear una solicitud
 * sin destino se copia el origen; una UI que se fie de `dropoff_address` a secas
 * termina mostrando la direccion de recogida repetida como si fuera el destino.
 *
 * Se carga una sola vez por carga de pagina. Si falla, `requiresDropoff()` cae a
 * su respaldo — nunca lanza.
 */
let catalogoEnVuelo: Promise<void> | null = null;

// El reset va en su propia funcion y no dentro del cuerpo async: ahi TypeScript
// estrecha la variable a Promise<void> por la asignacion de afuera y rechaza null.
function olvidarCatalogo(): void {
  catalogoEnVuelo = null;
}

export function cargarCatalogoDestinos(
  supabase: ReturnType<typeof createClient>
): Promise<void> {
  if (catalogoEnVuelo) return catalogoEnVuelo;
  // Envuelto en un async: el builder de Supabase devuelve un PromiseLike, no una
  // Promise real (no trae catch/finally).
  const promesa = (async () => {
    const { data, error } = await supabase
      .from('services')
      .select('slug, requires_destination')
      .eq('is_active', true);
    if (error) {
      console.error('[catalogo] no se pudo cargar, se usa el respaldo:', error.message);
      olvidarCatalogo(); // que el proximo refresco reintente
      return;
    }
    // `slug` de `services` es el mismo valor que `service_requests.service_type`.
    setDropoffCatalog(
      (data ?? []).map((s) => ({
        service_type: s.slug,
        requires_destination: !!s.requires_destination,
      }))
    );
  })();
  catalogoEnVuelo = promesa;
  return promesa;
}
