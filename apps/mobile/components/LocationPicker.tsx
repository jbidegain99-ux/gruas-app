import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Modal,
  ActivityIndicator,
  Keyboard,
  Platform,
  Alert,
} from 'react-native';
import * as Location from 'expo-location';
import { X, Search, MapPin } from 'lucide-react-native';

// Conditionally import react-native-maps (native only)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapView: React.ComponentType<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Marker: React.ComponentType<any> | null = null;

if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
}

// Google Maps API Key - should be configured in environment
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

interface LocationData {
  latitude: number;
  longitude: number;
  address: string;
}

interface LocationPickerProps {
  visible: boolean;
  title: string;
  initialLocation?: { latitude: number; longitude: number };
  onLocationSelected: (location: LocationData) => void;
  onClose: () => void;
}

interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
}

interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export function LocationPicker({
  visible,
  title,
  initialLocation,
  onLocationSelected,
  onClose,
}: LocationPickerProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(initialLocation || null);
  const [address, setAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Default region: San Salvador, El Salvador
  const defaultRegion: Region = {
    latitude: initialLocation?.latitude || 13.6929,
    longitude: initialLocation?.longitude || -89.2182,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setSearchQuery('');
      setPredictions([]);
      if (initialLocation) {
        setSelectedLocation(initialLocation);
        reverseGeocode(initialLocation.latitude, initialLocation.longitude);
      } else {
        setSelectedLocation(null);
        setAddress('');
      }
    }
  }, [visible, initialLocation]);

  // Debounced place search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 3) {
        searchPlaces(searchQuery);
      } else {
        setPredictions([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Search places with Google Places Autocomplete API
  const searchPlaces = async (query: string) => {
    if (!GOOGLE_MAPS_API_KEY) {
      // Fallback to Expo Location geocoding
      try {
        setIsSearching(true);
        const results = await Location.geocodeAsync(query);
        if (results && results.length > 0) {
          const mockPredictions: PlacePrediction[] = results.slice(0, 5).map((r, i) => ({
            place_id: `local_${i}`,
            description: query,
            structured_formatting: {
              main_text: query,
              secondary_text: 'El Salvador',
            },
          }));
          setPredictions(mockPredictions);
        }
      } catch (error) {
        console.log('Local geocoding error:', error);
      } finally {
        setIsSearching(false);
      }
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
          query
        )}&components=country:sv&language=es&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();

      if (data.status === 'OK' && data.predictions) {
        setPredictions(data.predictions);
      } else {
        setPredictions([]);
      }
    } catch (error) {
      console.error('Error searching places:', error);
      setPredictions([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Select a place from predictions
  const selectPlace = async (placeId: string, description: string) => {
    setIsLoading(true);
    Keyboard.dismiss();
    setPredictions([]);
    setSearchQuery(description);

    // If using local geocoding (no API key)
    if (placeId.startsWith('local_') || !GOOGLE_MAPS_API_KEY) {
      try {
        const results = await Location.geocodeAsync(description);
        if (results && results.length > 0) {
          const newLocation = {
            latitude: results[0].latitude,
            longitude: results[0].longitude,
          };
          setSelectedLocation(newLocation);
          setAddress(description);

          mapRef.current?.animateToRegion({
            ...newLocation,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }, 500);
        }
      } catch (error) {
        console.error('Geocoding error:', error);
        Alert.alert('Error', 'No se pudo encontrar la ubicación');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,formatted_address&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();

      if (data.status === 'OK' && data.result?.geometry?.location) {
        const { lat, lng } = data.result.geometry.location;
        const newLocation = { latitude: lat, longitude: lng };

        setSelectedLocation(newLocation);
        setAddress(data.result.formatted_address || description);

        mapRef.current?.animateToRegion({
          ...newLocation,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 500);
      }
    } catch (error) {
      console.error('Error getting place details:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Reverse geocoding to get address from coordinates
  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    try {
      // Use Expo Location for reverse geocoding (works without API key)
      const results = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });

      if (results && results.length > 0) {
        const r = results[0];
        const addr = [r.street, r.city, r.region].filter(Boolean).join(', ');
        setAddress(addr || `${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        setSearchQuery(addr || '');
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      setAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    }
  }, []);

  // Use current device location
  const useCurrentLocation = async () => {
    setIsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso Denegado', 'Se necesita acceso a la ubicación');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = location.coords;
      const newLocation = { latitude, longitude };

      setSelectedLocation(newLocation);
      await reverseGeocode(latitude, longitude);

      mapRef.current?.animateToRegion({
        ...newLocation,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 500);
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Error', 'No se pudo obtener tu ubicación');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle map press
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMapPress = async (event: any) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setSelectedLocation({ latitude, longitude });
    setIsLoading(true);
    await reverseGeocode(latitude, longitude);
    setIsLoading(false);
  };

  // Handle marker drag end
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMarkerDragEnd = async (event: any) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setSelectedLocation({ latitude, longitude });
    setIsLoading(true);
    await reverseGeocode(latitude, longitude);
    setIsLoading(false);
  };

  // Confirm location selection
  const confirmLocation = () => {
    if (selectedLocation && address) {
      onLocationSelected({
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
        address,
      });
    }
  };

  // Render map or fallback for web
  const renderMap = () => {
    if (Platform.OS === 'web' || !MapView) {
      return (
        <View style={styles.webFallback}>
          <Text style={styles.webFallbackText}>
            Mapa no disponible en web.{'\n'}
            Usa la búsqueda o tu ubicación actual.
          </Text>
          {selectedLocation && (
            <Text style={styles.coordsText}>
              Lat: {selectedLocation.latitude.toFixed(6)}{'\n'}
              Lng: {selectedLocation.longitude.toFixed(6)}
            </Text>
          )}
        </View>
      );
    }

    return (
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={defaultRegion}
        onPress={onMapPress}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {selectedLocation && Marker && (
          <Marker
            coordinate={selectedLocation}
            draggable
            onDragEnd={onMarkerDragEnd}
          />
        )}
      </MapView>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <X size={20} color="#333" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputContainer}>
            <Search size={18} color="#999" strokeWidth={2} />
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar dirección..."
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
            />
            {isSearching && <ActivityIndicator size="small" color="#2563eb" />}
          </View>
          <TouchableOpacity
            style={styles.currentLocationButton}
            onPress={useCurrentLocation}
            disabled={isLoading}
          >
            <MapPin size={20} color="#2563eb" strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* Predictions List */}
        {predictions.length > 0 && (
          <View style={styles.predictionsContainer}>
            <FlatList
              data={predictions}
              keyExtractor={(item) => item.place_id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.predictionItem}
                  onPress={() => selectPlace(item.place_id, item.description)}
                >
                  <Text style={styles.predictionMainText}>
                    {item.structured_formatting?.main_text || item.description}
                  </Text>
                  {item.structured_formatting?.secondary_text && (
                    <Text style={styles.predictionSecondaryText}>
                      {item.structured_formatting.secondary_text}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {/* Map */}
        <View style={styles.mapContainer}>
          {renderMap()}

          {/* Instruction badge */}
          <View style={styles.instructionBadge}>
            <Text style={styles.instructionText}>
              Toca el mapa o busca una dirección
            </Text>
          </View>
        </View>

        {/* Selected Address Display */}
        <View style={styles.addressContainer}>
          {address ? (
            <>
              <Text style={styles.addressLabel}>Ubicación seleccionada:</Text>
              <Text style={styles.addressText} numberOfLines={2}>{address}</Text>
            </>
          ) : (
            <Text style={styles.addressPlaceholder}>
              Selecciona una ubicación
            </Text>
          )}
        </View>

        {/* Confirm Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[
              styles.confirmButton,
              (!selectedLocation || !address || isLoading) && styles.confirmButtonDisabled,
            ]}
            onPress={confirmLocation}
            disabled={!selectedLocation || !address || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.confirmButtonText}>Confirmar Ubicación</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 24,
    color: '#666',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  placeholder: {
    width: 40,
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: '#fff',
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f9fafb',
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  currentLocationButton: {
    width: 48,
    height: 48,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationIcon: {
    fontSize: 20,
  },
  predictionsContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 160 : 126,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: 250,
    zIndex: 1000,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  predictionItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  predictionMainText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
  },
  predictionSecondaryText: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  webFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
  },
  webFallbackText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  coordsText: {
    marginTop: 16,
    fontSize: 14,
    color: '#333',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  instructionBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  instructionText: {
    color: '#fff',
    fontSize: 13,
  },
  addressContainer: {
    padding: 16,
    backgroundColor: '#f9fafb',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    minHeight: 70,
  },
  addressLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  addressText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
  },
  addressPlaceholder: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  buttonContainer: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    backgroundColor: '#fff',
  },
  confirmButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#ccc',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default LocationPicker;
