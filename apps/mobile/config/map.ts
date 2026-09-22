// Configuración de mapas de la app móvil.
//
// TILE_SOURCE elige qué dibuja el mapa:
//   'google' -> mapa base de Google. OJO: en Expo Go de este equipo NO renderiza
//               ("access blocked", problema de key/billing de Google Maps).
//   'osm'    -> tiles raster propios vía UrlTile (abajo). Es lo que SÍ funciona
//               en Expo Go. Default.
//
// El servidor PÚBLICO de OpenStreetMap (tile.openstreetmap.org) bloquea el uso
// desde apps (muestra "blocked"). Por eso usamos CARTO, que es gratis, no exige
// API key y permite apps. Para producción con volumen: MapTiler/Stadia con key
// gratis, o self-host.
export const MAP_CONFIG = {
  // En Expo Go, 'google' usa la key de Google que trae Expo Go (gratis) y suele
  // renderizar bien. OSM/Carto públicos bloquean apps (403), por eso no sirven.
  TILE_SOURCE: 'google' as 'google' | 'osm',

  // Carto Voyager: raster, gratis, sin key, no bloquea. Orden estándar {z}/{x}/{y}.
  OSM_TILE_URL: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  OSM_MAX_ZOOM: 20,
} as const;
