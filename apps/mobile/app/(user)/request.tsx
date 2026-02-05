import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useDistanceCalculation } from '@/hooks/useDistanceCalculation';
import { LocationPicker } from '@/components/LocationPicker';

type TowType = 'light' | 'heavy';

const INCIDENT_TYPES = [
  'Avería mecánica',
  'Accidente de tránsito',
  'Vehículo varado',
  'Llantas ponchadas',
  'Sin combustible',
  'Batería descargada',
  'Llaves dentro del vehículo',
  'Otro',
];

type PricingRule = {
  base_exit_fee: number;
  included_km: number;
  price_per_km_light: number;
  price_per_km_heavy: number;
};

export default function RequestService() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Location state
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [gettingLocation, setGettingLocation] = useState(false);

  // LocationPicker visibility
  const [showPickupPicker, setShowPickupPicker] = useState(false);
  const [showDestinationPicker, setShowDestinationPicker] = useState(false);

  // Service details
  const [towType, setTowType] = useState<TowType>('light');
  const [incidentType, setIncidentType] = useState('');
  const [vehicleDescription, setVehicleDescription] = useState('');
  const [notes, setNotes] = useState('');

  // Photo
  const [photo, setPhoto] = useState<string | null>(null);

  // Pricing
  const [pricing, setPricing] = useState<PricingRule | null>(null);
  const [estimatedPrice, setEstimatedPrice] = useState<number | null>(null);

  // Distance calculation using Google Distance Matrix API
  const {
    distance: calculatedDistance,
    distanceText,
    duration: calculatedDuration,
    durationText,
    loading: distanceLoading,
    error: distanceError,
    isFallback: isDistanceFallback,
    refetch: refetchDistance,
  } = useDistanceCalculation(pickupCoords, dropoffCoords);

  // Fetch active pricing rule
  useEffect(() => {
    const fetchPricing = async () => {
      const { data, error } = await supabase
        .from('pricing_rules')
        .select('base_exit_fee, included_km, price_per_km_light, price_per_km_heavy')
        .eq('is_active', true)
        .single();

      if (error) {
        console.error('Error fetching pricing rules:', error);
        return;
      }

      if (data) {
        console.log('=== PRICING RULES LOADED ===');
        console.log('base_exit_fee:', data.base_exit_fee);
        console.log('included_km:', data.included_km);
        console.log('price_per_km_light:', data.price_per_km_light);
        console.log('price_per_km_heavy:', data.price_per_km_heavy);

        // Warn if price_per_km values are 0 (this would cause constant pricing)
        if (data.price_per_km_light === 0 && data.price_per_km_heavy === 0) {
          console.warn('WARNING: price_per_km values are 0! Price will always equal base_exit_fee.');
          console.warn('Update pricing_rules in Supabase: price_per_km_light=2.50, price_per_km_heavy=3.50');
        }

        setPricing(data);
      }
    };
    fetchPricing();
  }, []);

  const getCurrentLocation = async () => {
    setGettingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permisos', 'Se requiere acceso a la ubicación para continuar');
        setGettingLocation(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const coords = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      };
      setPickupCoords(coords);

      // Reverse geocode to get address
      const [addressResult] = await Location.reverseGeocodeAsync({
        latitude: coords.lat,
        longitude: coords.lng,
      });

      if (addressResult) {
        const address = [
          addressResult.street,
          addressResult.city,
          addressResult.region,
        ]
          .filter(Boolean)
          .join(', ');
        setPickupAddress(address || `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`);
      }
    } catch (error) {
      Alert.alert('Error', 'No se pudo obtener la ubicación');
    }
    setGettingLocation(false);
  };

  // Geocode address to coordinates
  const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
    if (!address || address.length < 5) return null;

    try {
      const results = await Location.geocodeAsync(address);
      if (results && results.length > 0) {
        return {
          lat: results[0].latitude,
          lng: results[0].longitude,
        };
      }
    } catch (error) {
      console.log('Geocoding error:', error);
    }
    return null;
  };

  // Geocode pickup address when it changes (if not already set via GPS)
  useEffect(() => {
    const geocodePickup = async () => {
      if (pickupAddress && !pickupCoords) {
        const coords = await geocodeAddress(pickupAddress);
        if (coords) {
          setPickupCoords(coords);
        }
      }
    };

    const timeoutId = setTimeout(geocodePickup, 1000); // Debounce 1s
    return () => clearTimeout(timeoutId);
  }, [pickupAddress, pickupCoords]);

  // Geocode dropoff address when it changes
  useEffect(() => {
    const geocodeDropoff = async () => {
      if (dropoffAddress && dropoffAddress.length >= 5) {
        const coords = await geocodeAddress(dropoffAddress);
        if (coords) {
          setDropoffCoords(coords);
        }
      }
    };

    const timeoutId = setTimeout(geocodeDropoff, 1000); // Debounce 1s
    return () => clearTimeout(timeoutId);
  }, [dropoffAddress]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisos', 'Se requiere acceso a la galería');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisos', 'Se requiere acceso a la cámara');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0].uri);
    }
  };

  // Calculate price based on real distance from Distance Matrix API
  const calculatePrice = () => {
    if (!pricing || !calculatedDistance) return;

    const distance = calculatedDistance;
    const pricePerKm = towType === 'light' ? pricing.price_per_km_light : pricing.price_per_km_heavy;
    const extraKm = Math.max(0, distance - pricing.included_km);
    const total = pricing.base_exit_fee + extraKm * pricePerKm;

    console.log('=== PRICE CALCULATION ===');
    console.log('Distance (km):', distance);
    console.log('Tow type:', towType);
    console.log('Price per km:', pricePerKm);
    console.log('Included km:', pricing.included_km);
    console.log('Extra km:', extraKm);
    console.log('Base fee:', pricing.base_exit_fee);
    console.log('Formula: $' + pricing.base_exit_fee + ' + (' + extraKm + ' km * $' + pricePerKm + ') = $' + total);

    setEstimatedPrice(Math.round(total * 100) / 100);
  };

  // Recalculate price when distance or tow type changes
  useEffect(() => {
    if (calculatedDistance && pricing) {
      calculatePrice();
    }
  }, [calculatedDistance, towType, pricing]);

  const handleSubmit = async () => {
    if (!pickupAddress || !dropoffAddress || !incidentType) {
      Alert.alert('Error', 'Por favor completa todos los campos requeridos');
      return;
    }

    setSubmitting(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        Alert.alert('Error', 'Debes iniciar sesión');
        router.replace('/(auth)/login');
        return;
      }

      // Upload photo if available
      let vehiclePhotoUrl: string | null = null;
      if (photo) {
        try {
          console.log('=== PHOTO UPLOAD STARTED ===');
          console.log('Photo URI:', photo);

          // Verify that the file exists
          const fileInfo = await FileSystem.getInfoAsync(photo);
          console.log('File info:', fileInfo);

          if (!fileInfo.exists) {
            console.error('File does not exist at URI:', photo);
            throw new Error('El archivo de foto no existe');
          }

          // Read file as base64
          console.log('Reading file as base64...');
          const base64 = await FileSystem.readAsStringAsync(photo, {
            encoding: FileSystem.EncodingType.Base64,
          });

          console.log('Base64 length:', base64.length);

          if (!base64 || base64.length === 0) {
            console.error('Failed to read file - base64 is empty');
            throw new Error('No se pudo leer el archivo');
          }

          // Generate unique filename
          const fileExt = photo.split('.').pop()?.toLowerCase() || 'jpg';
          const fileName = `${user.id}/${Date.now()}.${fileExt}`;
          console.log('Uploading to:', fileName);

          // Convert base64 to ArrayBuffer and upload
          const { error: uploadError } = await supabase.storage
            .from('service-photos')
            .upload(fileName, decode(base64), {
              contentType: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`,
              upsert: false,
            });

          if (uploadError) {
            console.error('Supabase upload error:', uploadError);
            throw uploadError;
          }

          // Get public URL
          const { data: urlData } = supabase.storage
            .from('service-photos')
            .getPublicUrl(fileName);

          vehiclePhotoUrl = urlData.publicUrl;
          console.log('=== PHOTO UPLOAD SUCCESS ===');
          console.log('Photo URL:', vehiclePhotoUrl);
        } catch (uploadErr) {
          console.error('=== PHOTO UPLOAD FAILED ===');
          console.error('Error:', uploadErr);
          // Continue without photo if upload fails
          Alert.alert(
            'Aviso',
            'No se pudo subir la foto, pero la solicitud continuará sin ella.'
          );
        }
      }

      // Combine vehicle description with notes if provided
      const combinedNotes = [
        vehicleDescription ? `Vehículo: ${vehicleDescription}` : '',
        notes || '',
      ].filter(Boolean).join('\n') || null;

      // Create the service request
      const { data, error } = await supabase.rpc('create_service_request', {
        p_tow_type: towType,
        p_incident_type: incidentType,
        p_pickup_lat: pickupCoords?.lat || 13.6929, // Default to San Salvador
        p_pickup_lng: pickupCoords?.lng || -89.2182,
        p_pickup_address: pickupAddress,
        p_dropoff_lat: dropoffCoords?.lat || 13.6929, // Default to San Salvador
        p_dropoff_lng: dropoffCoords?.lng || -89.2182,
        p_dropoff_address: dropoffAddress,
        p_notes: combinedNotes,
        p_vehicle_photo_url: vehiclePhotoUrl,
      });

      if (error) {
        console.error('Error creating request:', JSON.stringify(error));
        Alert.alert(
          'Error al crear solicitud',
          error.message || 'Ocurrió un error inesperado. Por favor intenta de nuevo.',
          [{ text: 'Reintentar', style: 'default' }]
        );
        setSubmitting(false);
        return;
      }

      // Verify the response indicates success
      if (!data || data.success !== true) {
        console.error('Request creation failed:', JSON.stringify(data));
        Alert.alert(
          'Error',
          'No se pudo crear la solicitud. Por favor intenta de nuevo.',
          [{ text: 'Reintentar', style: 'default' }]
        );
        setSubmitting(false);
        return;
      }

      // Save PIN to local storage for later access
      try {
        const requestPins = await AsyncStorage.getItem('request_pins');
        const pins = requestPins ? JSON.parse(requestPins) : {};
        pins[data.request_id] = data.pin;
        await AsyncStorage.setItem('request_pins', JSON.stringify(pins));
      } catch (storageError) {
        console.error('Error saving PIN:', storageError);
      }

      // Success - show confirmation with PIN
      Alert.alert(
        'Solicitud Enviada',
        `Tu solicitud ha sido registrada.\n\nPIN de verificación: ${data.pin}\n\nGuarda este PIN. Lo necesitarás cuando llegue la grúa.`,
        [
          {
            text: 'Ver Estado',
            onPress: () => router.replace('/(user)'),
          },
        ]
      );
      setSubmitting(false);
    } catch (error) {
      console.error('Error:', error);
      Alert.alert(
        'Error de conexión',
        'No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.',
        [{ text: 'Reintentar', style: 'default' }]
      );
      setSubmitting(false);
    }
  };

  const renderStep1 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Ubicaciones</Text>

      {/* Pickup Location Selector */}
      <Text style={styles.label}>Punto de Recogida</Text>
      <TouchableOpacity
        style={styles.locationSelector}
        onPress={() => setShowPickupPicker(true)}
      >
        <Text style={styles.locationSelectorIcon}>📍</Text>
        <View style={styles.locationSelectorContent}>
          <Text style={[
            styles.locationSelectorText,
            !pickupAddress && styles.locationSelectorPlaceholder
          ]}>
            {pickupAddress || 'Toca para seleccionar ubicación'}
          </Text>
        </View>
        <Text style={styles.locationSelectorArrow}>›</Text>
      </TouchableOpacity>

      {/* Quick GPS button */}
      <TouchableOpacity
        style={styles.quickGpsButton}
        onPress={getCurrentLocation}
        disabled={gettingLocation}
      >
        {gettingLocation ? (
          <ActivityIndicator color="#2563eb" size="small" />
        ) : (
          <Text style={styles.quickGpsText}>📡 Usar mi ubicación actual</Text>
        )}
      </TouchableOpacity>

      {/* Destination Location Selector */}
      <Text style={styles.label}>Destino</Text>
      <TouchableOpacity
        style={styles.locationSelector}
        onPress={() => setShowDestinationPicker(true)}
      >
        <Text style={styles.locationSelectorIcon}>🏁</Text>
        <View style={styles.locationSelectorContent}>
          <Text style={[
            styles.locationSelectorText,
            !dropoffAddress && styles.locationSelectorPlaceholder
          ]}>
            {dropoffAddress || 'Toca para seleccionar destino'}
          </Text>
        </View>
        <Text style={styles.locationSelectorArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.nextButton, (!pickupAddress || !dropoffAddress) && styles.buttonDisabled]}
        onPress={() => setStep(2)}
        disabled={!pickupAddress || !dropoffAddress}
      >
        <Text style={styles.nextButtonText}>Siguiente</Text>
      </TouchableOpacity>

      {/* Location Picker Modals */}
      <LocationPicker
        visible={showPickupPicker}
        title="Punto de Recogida"
        initialLocation={pickupCoords ? { latitude: pickupCoords.lat, longitude: pickupCoords.lng } : undefined}
        onLocationSelected={(loc) => {
          setPickupCoords({ lat: loc.latitude, lng: loc.longitude });
          setPickupAddress(loc.address);
          setShowPickupPicker(false);
        }}
        onClose={() => setShowPickupPicker(false)}
      />

      <LocationPicker
        visible={showDestinationPicker}
        title="Destino"
        initialLocation={pickupCoords ? { latitude: pickupCoords.lat, longitude: pickupCoords.lng } : undefined}
        onLocationSelected={(loc) => {
          setDropoffCoords({ lat: loc.latitude, lng: loc.longitude });
          setDropoffAddress(loc.address);
          setShowDestinationPicker(false);
        }}
        onClose={() => setShowDestinationPicker(false)}
      />
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Tipo de Servicio</Text>

      <Text style={styles.label}>Tipo de Grúa</Text>
      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[styles.toggleButton, towType === 'light' && styles.toggleActive]}
          onPress={() => setTowType('light')}
        >
          <Text style={[styles.toggleText, towType === 'light' && styles.toggleTextActive]}>
            Liviana
          </Text>
          <Text style={styles.toggleSubtext}>Autos, camionetas</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, towType === 'heavy' && styles.toggleActive]}
          onPress={() => setTowType('heavy')}
        >
          <Text style={[styles.toggleText, towType === 'heavy' && styles.toggleTextActive]}>
            Pesada
          </Text>
          <Text style={styles.toggleSubtext}>Camiones, buses</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Tipo de Incidente</Text>
      <View style={styles.incidentGrid}>
        {INCIDENT_TYPES.map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.incidentButton, incidentType === type && styles.incidentActive]}
            onPress={() => setIncidentType(type)}
          >
            <Text
              style={[styles.incidentText, incidentType === type && styles.incidentTextActive]}
            >
              {type}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.navButtons}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep(1)}>
          <Text style={styles.backButtonText}>Atrás</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.nextButton, !incidentType && styles.buttonDisabled]}
          onPress={() => setStep(3)}
          disabled={!incidentType}
        >
          <Text style={styles.nextButtonText}>Siguiente</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Detalles del Vehículo</Text>

      <Text style={styles.label}>Descripción del Vehículo (opcional)</Text>
      <TextInput
        style={styles.input}
        placeholder="Ej: Toyota Corolla 2020, color blanco"
        value={vehicleDescription}
        onChangeText={setVehicleDescription}
      />

      <Text style={styles.label}>Notas Adicionales (opcional)</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Información adicional para el operador..."
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={3}
      />

      <Text style={styles.label}>Foto del Vehículo (opcional)</Text>
      <View style={styles.photoButtons}>
        <TouchableOpacity style={styles.photoButton} onPress={takePhoto}>
          <Text style={styles.photoButtonText}>Tomar Foto</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.photoButton} onPress={pickImage}>
          <Text style={styles.photoButtonText}>Galería</Text>
        </TouchableOpacity>
      </View>

      {photo && (
        <Image source={{ uri: photo }} style={styles.photoPreview} resizeMode="cover" />
      )}

      <View style={styles.navButtons}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep(2)}>
          <Text style={styles.backButtonText}>Atrás</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.nextButton} onPress={() => setStep(4)}>
          <Text style={styles.nextButtonText}>Ver Resumen</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderStep4 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Resumen de Solicitud</Text>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Recogida:</Text>
          <Text style={styles.summaryValue}>{pickupAddress}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Destino:</Text>
          <Text style={styles.summaryValue}>{dropoffAddress}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Tipo de Grúa:</Text>
          <Text style={styles.summaryValue}>{towType === 'light' ? 'Liviana' : 'Pesada'}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Incidente:</Text>
          <Text style={styles.summaryValue}>{incidentType}</Text>
        </View>
        {vehicleDescription && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Vehículo:</Text>
            <Text style={styles.summaryValue}>{vehicleDescription}</Text>
          </View>
        )}
      </View>

      <View style={styles.priceCard}>
        <Text style={styles.priceLabel}>Precio Estimado</Text>

        {distanceLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.loadingText}>Calculando distancia...</Text>
          </View>
        ) : distanceError ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{distanceError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={refetchDistance}>
              <Text style={styles.retryButtonText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.priceValue}>
              {estimatedPrice ? `$${estimatedPrice.toFixed(2)}` : '--'}
            </Text>
            {calculatedDistance && (
              <>
                <Text style={styles.priceNote}>
                  Distancia: {distanceText || `${calculatedDistance.toFixed(1)} km`}
                </Text>
                {calculatedDuration && (
                  <Text style={styles.priceNote}>
                    Tiempo estimado: {durationText || `${calculatedDuration} min`}
                  </Text>
                )}
              </>
            )}
            {isDistanceFallback && (
              <Text style={styles.fallbackNote}>
                * Distancia aproximada (sin conexión a Google Maps)
              </Text>
            )}
          </>
        )}

        <Text style={styles.priceDisclaimer}>
          El precio final puede variar según la distancia real recorrida.
        </Text>
      </View>

      <View style={styles.navButtons}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep(3)}>
          <Text style={styles.backButtonText}>Atrás</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.submitButton, (submitting || distanceLoading || !calculatedDistance) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting || distanceLoading || !calculatedDistance}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>Confirmar Solicitud</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Progress indicator */}
      <View style={styles.progressContainer}>
        {[1, 2, 3, 4].map((s) => (
          <View
            key={s}
            style={[styles.progressDot, s <= step && styles.progressDotActive]}
          />
        ))}
      </View>

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
  },
  progressDotActive: {
    backgroundColor: '#2563eb',
  },
  stepContainer: {
    gap: 16,
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#111827',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#f9fafb',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  locationButton: {
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  locationButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  locationSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#f9fafb',
  },
  locationSelectorIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  locationSelectorContent: {
    flex: 1,
  },
  locationSelectorText: {
    fontSize: 15,
    color: '#111827',
  },
  locationSelectorPlaceholder: {
    color: '#9ca3af',
  },
  locationSelectorArrow: {
    fontSize: 24,
    color: '#9ca3af',
    marginLeft: 8,
  },
  quickGpsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  quickGpsText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '500',
  },
  orText: {
    textAlign: 'center',
    color: '#6b7280',
    marginVertical: 8,
  },
  toggleContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  toggleButton: {
    flex: 1,
    padding: 16,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    alignItems: 'center',
  },
  toggleActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  toggleText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  toggleTextActive: {
    color: '#2563eb',
  },
  toggleSubtext: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  incidentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  incidentButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 20,
    backgroundColor: '#f9fafb',
  },
  incidentActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  incidentText: {
    fontSize: 14,
    color: '#374151',
  },
  incidentTextActive: {
    color: '#2563eb',
    fontWeight: '600',
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  photoButton: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    alignItems: 'center',
  },
  photoButtonText: {
    color: '#2563eb',
    fontWeight: '600',
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginTop: 8,
  },
  navButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  backButton: {
    flex: 1,
    padding: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '600',
  },
  nextButton: {
    flex: 2,
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  summaryCard: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  summaryRow: {
    gap: 4,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 15,
    color: '#111827',
  },
  priceCard: {
    backgroundColor: '#eff6ff',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  priceLabel: {
    fontSize: 14,
    color: '#1e40af',
    fontWeight: '500',
  },
  priceValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1e40af',
    marginVertical: 8,
  },
  priceNote: {
    fontSize: 14,
    color: '#3b82f6',
  },
  priceDisclaimer: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
  },
  submitButton: {
    flex: 2,
    backgroundColor: '#16a34a',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: '#6b7280',
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#dc2626',
    textAlign: 'center',
    marginBottom: 8,
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#2563eb',
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  fallbackNote: {
    fontSize: 11,
    color: '#f59e0b',
    fontStyle: 'italic',
    marginTop: 4,
  },
});
