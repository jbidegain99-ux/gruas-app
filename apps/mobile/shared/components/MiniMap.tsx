// Mapa compacto, no interactivo, para mostrar recogida (+ destino) sin que el
// usuario tenga que leer coordenadas. Usa liteMode en Android (bitmap ligero,
// apto para listas/modales). Web y errores de carga caen a un placeholder.
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { colors, typography, spacing, radii } from '@/theme';
import { MAP_CONFIG } from '@/config/map';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapView: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Marker: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let UrlTile: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Polyline: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PROVIDER_GOOGLE: any = null;
let mapsLoadError: string | null = null;
if (Platform.OS !== 'web') {
  try {
    const Maps = require('react-native-maps');
    MapView = Maps.default;
    Marker = Maps.Marker;
    UrlTile = Maps.UrlTile;
    Polyline = Maps.Polyline;
    PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
    if (!MapView) mapsLoadError = 'react-native-maps cargó pero MapView es null';
  } catch (e) {
    mapsLoadError = e instanceof Error ? e.message : 'Fallo al cargar react-native-maps';
    console.error('[MiniMap] require react-native-maps failed:', e);
  }
}

const USE_OSM = MAP_CONFIG.TILE_SOURCE === 'osm';

interface Coords {
  lat: number;
  lng: number;
}

interface MiniMapProps {
  pickup: Coords;
  dropoff?: Coords | null;
  /**
   * Recorrido real del servicio (migas de pan del operador). Si trae >=2 puntos
   * se dibuja como la ruta conducida; si no, se cae a una línea recta
   * recogida→destino.
   */
  route?: Coords[] | null;
  height?: number;
}

export function MiniMap({ pickup, dropoff, route, height = 140 }: MiniMapProps) {
  const hasDropoff = !!dropoff && !!dropoff.lat && !!dropoff.lng;
  const hasRealRoute = !!route && route.length >= 2;

  if (!MapView || !Marker) {
    return (
      <View style={[styles.fallback, { height }]}>
        <MapPin size={20} color={colors.text.tertiary} strokeWidth={2} />
        <Text style={styles.fallbackText}>Mapa no disponible aquí</Text>
        {mapsLoadError && (
          <Text style={styles.fallbackError} numberOfLines={3}>
            {mapsLoadError}
          </Text>
        )}
      </View>
    );
  }

  // Puntos que debe encuadrar el mapa y la línea a dibujar. Con recorrido real
  // usamos todos sus puntos; si no, recogida (+ destino).
  const linePoints: Coords[] = hasRealRoute
    ? route!
    : hasDropoff
      ? [pickup, dropoff!]
      : [pickup];
  const framePoints = hasRealRoute ? [pickup, ...route!, ...(hasDropoff ? [dropoff!] : [])] : linePoints;

  const lats = framePoints.map((p) => p.lat);
  const lngs = framePoints.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const latDelta = Math.max((Math.max(...lats) - Math.min(...lats)) * 1.4, 0.02);
  const lngDelta = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 1.4, 0.02);
  const lineCoords = linePoints.map((p) => ({ latitude: p.lat, longitude: p.lng }));

  return (
    <View style={[styles.wrapper, { height }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        // OSM: usamos el provider Google en Android SOLO para poder poner
        // mapType="none" (base en blanco) y encima los tiles de OSM.
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType={USE_OSM ? 'none' : 'standard'}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        initialRegion={{
          latitude: midLat,
          longitude: midLng,
          latitudeDelta: latDelta,
          longitudeDelta: lngDelta,
        }}
      >
        {USE_OSM && UrlTile && (
          <UrlTile
            urlTemplate={MAP_CONFIG.OSM_TILE_URL}
            maximumZ={MAP_CONFIG.OSM_MAX_ZOOM}
            flipY={false}
          />
        )}
        {/* Recorrido real: línea sólida. Respaldo recto: línea punteada, para
            no dar a entender que la grúa fue en línea recta. */}
        {Polyline && lineCoords.length >= 2 && (
          <Polyline
            coordinates={lineCoords}
            strokeColor={colors.accent[500]}
            strokeWidth={hasRealRoute ? 4 : 3}
            lineDashPattern={hasRealRoute ? undefined : [6, 6]}
          />
        )}
        <Marker
          coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
          title="Recogida"
          pinColor="green"
        />
        {hasDropoff && (
          <Marker
            coordinate={{ latitude: dropoff!.lat, longitude: dropoff!.lng }}
            title="Destino"
            pinColor="red"
          />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: radii.m,
    overflow: 'hidden',
    backgroundColor: colors.border.light,
  },
  fallback: {
    borderRadius: radii.m,
    backgroundColor: colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  fallbackText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
  },
  fallbackError: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.micro,
    color: colors.error.main,
    textAlign: 'center',
    paddingHorizontal: spacing.m,
  },
});
