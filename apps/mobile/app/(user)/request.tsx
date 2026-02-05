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
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useDistanceCalculation } from '@/hooks/useDistanceCalculation';
import { LocationPicker } from '@/components/LocationPicker';
import type { ServiceType, ServiceTypePricing, FuelType } from '@gruas-app/shared';
import { SERVICE_TYPE_CONFIGS } from '@gruas-app/shared';

type TowType = 'light' | 'heavy';

const INCIDENT_TYPES = [
  'Averia mecanica',
  'Accidente de transito',
  'Vehiculo varado',
  'Llantas ponchadas',
  'Sin combustible',
  'Bateria descargada',
  'Llaves dentro del vehiculo',
  'Otro',
];

// Auto-assigned incident types for non-tow services
const SERVICE_INCIDENT_MAP: Record<ServiceType, string> = {
  tow: '',
  battery: 'Bateria descargada',
  tire: 'Llantas ponchadas',
  fuel: 'Sin combustible',
  locksmith: 'Llaves dentro del vehiculo',
};

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

  // Service type
  const [serviceType, setServiceType] = useState<ServiceType>('tow');
  const [serviceTypePricing, setServiceTypePricing] = useState<ServiceTypePricing[]>([]);
  const [loadingPricingTypes, setLoadingPricingTypes] = useState(true);

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

  // Tire-specific
  const [hasSpare, setHasSpare] = useState<boolean | null>(null);

  // Fuel-specific
  const [fuelType, setFuelType] = useState<FuelType>('regular');
  const [fuelGallons, setFuelGallons] = useState(1);

  // Photo
  const [photo, setPhoto] = useState<string | null>(null);

  // Pricing (tow)
  const [pricing, setPricing] = useState<PricingRule | null>(null);
  const [estimatedPrice, setEstimatedPrice] = useState<number | null>(null);

  const requiresDestination = serviceType === 'tow';
  const currentPricingType = serviceTypePricing.find(p => p.service_type === serviceType);

  // Distance calculation (only for tow)
  const {
    distance: calculatedDistance,
    distanceText,
    duration: calculatedDuration,
    durationText,
    loading: distanceLoading,
    error: distanceError,
    isFallback: isDistanceFallback,
    refetch: refetchDistance,
  } = useDistanceCalculation(
    requiresDestination ? pickupCoords : null,
    requiresDestination ? dropoffCoords : null
  );

  // Fetch service type pricing
  useEffect(() => {
    const fetchServicePricing = async () => {
      setLoadingPricingTypes(true);
      const { data, error } = await supabase
        .from('service_type_pricing')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) {
        console.error('Error fetching service type pricing:', error);
      } else if (data) {
        setServiceTypePricing(data as ServiceTypePricing[]);
      }
      setLoadingPricingTypes(false);
    };
    fetchServicePricing();
  }, []);

  // Fetch tow pricing rules
  useEffect(() => {
    const fetchPricing = async () => {
      const { data, error } = await supabase
        .from('pricing_rules')
        .select('base_exit_fee, included_km, price_per_km_light, price_per_km_heavy')
        .eq('is_active', true)
        .single();

      if (!error && data) {
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
        Alert.alert('Permisos', 'Se requiere acceso a la ubicacion para continuar');
        setGettingLocation(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const coords = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      };
      setPickupCoords(coords);

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
    } catch {
      Alert.alert('Error', 'No se pudo obtener la ubicacion');
    }
    setGettingLocation(false);
  };

  const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
    if (!address || address.length < 5) return null;
    try {
      const results = await Location.geocodeAsync(address);
      if (results && results.length > 0) {
        return { lat: results[0].latitude, lng: results[0].longitude };
      }
    } catch (err) {
      console.log('Geocoding error:', err);
    }
    return null;
  };

  useEffect(() => {
    const geocodePickup = async () => {
      if (pickupAddress && !pickupCoords) {
        const coords = await geocodeAddress(pickupAddress);
        if (coords) setPickupCoords(coords);
      }
    };
    const timeoutId = setTimeout(geocodePickup, 1000);
    return () => clearTimeout(timeoutId);
  }, [pickupAddress, pickupCoords]);

  useEffect(() => {
    const geocodeDropoff = async () => {
      if (dropoffAddress && dropoffAddress.length >= 5) {
        const coords = await geocodeAddress(dropoffAddress);
        if (coords) setDropoffCoords(coords);
      }
    };
    const timeoutId = setTimeout(geocodeDropoff, 1000);
    return () => clearTimeout(timeoutId);
  }, [dropoffAddress]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisos', 'Se requiere acceso a la galeria');
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
      Alert.alert('Permisos', 'Se requiere acceso a la camara');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0].uri);
    }
  };

  // Calculate tow price
  const calculatePrice = () => {
    if (!pricing || !calculatedDistance) return;
    const distance = calculatedDistance;
    const pricePerKm = towType === 'light' ? pricing.price_per_km_light : pricing.price_per_km_heavy;
    const extraKm = Math.max(0, distance - pricing.included_km);
    const total = pricing.base_exit_fee + extraKm * pricePerKm;
    setEstimatedPrice(Math.round(total * 100) / 100);
  };

  // Calculate non-tow price
  const calculateFlatPrice = (): number | null => {
    if (!currentPricingType) return null;
    let extra = 0;
    if (serviceType === 'tire' && hasSpare === false) {
      extra = currentPricingType.extra_fee;
    }
    if (serviceType === 'fuel' && fuelGallons > 1) {
      extra = currentPricingType.extra_fee * (fuelGallons - 1);
    }
    return Math.round((currentPricingType.base_price + extra) * 100) / 100;
  };

  useEffect(() => {
    if (serviceType === 'tow' && calculatedDistance && pricing) {
      calculatePrice();
    }
  }, [calculatedDistance, towType, pricing, serviceType]);

  // Build service_details JSON
  const buildServiceDetails = (): Record<string, unknown> => {
    switch (serviceType) {
      case 'tire':
        return { has_spare: hasSpare ?? false };
      case 'fuel':
        return { fuel_type: fuelType, gallons: fuelGallons };
      default:
        return {};
    }
  };

  const handleSubmit = async () => {
    if (!pickupAddress) {
      Alert.alert('Error', 'Por favor selecciona el punto de recogida');
      return;
    }
    if (requiresDestination && !dropoffAddress) {
      Alert.alert('Error', 'Por favor selecciona el destino');
      return;
    }

    setSubmitting(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        Alert.alert('Error', 'Debes iniciar sesion');
        router.replace('/(auth)/login');
        return;
      }

      // Upload photo if available
      let vehiclePhotoUrl: string | null = null;
      if (photo) {
        try {
          const fileInfo = await FileSystem.getInfoAsync(photo);
          if (!fileInfo.exists) throw new Error('El archivo de foto no existe');

          const base64 = await FileSystem.readAsStringAsync(photo, {
            encoding: FileSystem.EncodingType.Base64,
          });
          if (!base64 || base64.length === 0) throw new Error('No se pudo leer el archivo');

          const fileExt = photo.split('.').pop()?.toLowerCase() || 'jpg';
          const fileName = `${user.id}/${Date.now()}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from('service-photos')
            .upload(fileName, decode(base64), {
              contentType: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`,
              upsert: false,
            });

          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from('service-photos')
            .getPublicUrl(fileName);

          vehiclePhotoUrl = urlData.publicUrl;
        } catch (uploadErr) {
          console.error('Photo upload failed:', uploadErr);
          Alert.alert('Aviso', 'No se pudo subir la foto, pero la solicitud continuara sin ella.');
        }
      }

      // Combine notes
      const combinedNotes = [
        vehicleDescription ? `Vehiculo: ${vehicleDescription}` : '',
        notes || '',
      ].filter(Boolean).join('\n') || null;

      // For non-tow: dropoff = pickup
      const effectiveDropoffLat = requiresDestination ? (dropoffCoords?.lat || 13.6929) : (pickupCoords?.lat || 13.6929);
      const effectiveDropoffLng = requiresDestination ? (dropoffCoords?.lng || -89.2182) : (pickupCoords?.lng || -89.2182);
      const effectiveDropoffAddress = requiresDestination ? dropoffAddress : pickupAddress;

      // Auto-assign incident for non-tow
      const effectiveIncident = serviceType === 'tow' ? incidentType : SERVICE_INCIDENT_MAP[serviceType];

      const { data, error } = await supabase.rpc('create_service_request', {
        p_dropoff_address: effectiveDropoffAddress,
        p_dropoff_lat: effectiveDropoffLat,
        p_dropoff_lng: effectiveDropoffLng,
        p_incident_type: effectiveIncident,
        p_notes: combinedNotes,
        p_pickup_address: pickupAddress,
        p_pickup_lat: pickupCoords?.lat || 13.6929,
        p_pickup_lng: pickupCoords?.lng || -89.2182,
        p_service_details: buildServiceDetails(),
        p_service_type: serviceType,
        p_tow_type: towType,
        p_vehicle_photo_url: vehiclePhotoUrl,
      });

      if (error) {
        console.error('Error creating request:', JSON.stringify(error));
        Alert.alert('Error al crear solicitud', error.message || 'Ocurrio un error inesperado.');
        setSubmitting(false);
        return;
      }

      if (!data || data.success !== true) {
        Alert.alert('Error', 'No se pudo crear la solicitud.');
        setSubmitting(false);
        return;
      }

      // Save PIN
      try {
        const requestPins = await AsyncStorage.getItem('request_pins');
        const pins = requestPins ? JSON.parse(requestPins) : {};
        pins[data.request_id] = data.pin;
        await AsyncStorage.setItem('request_pins', JSON.stringify(pins));
      } catch (storageError) {
        console.error('Error saving PIN:', storageError);
      }

      const svcName = SERVICE_TYPE_CONFIGS[serviceType].name;
      Alert.alert(
        'Solicitud Enviada',
        `Tu solicitud de ${svcName} ha sido registrada.\n\nPIN de verificacion: ${data.pin}\n\nGuarda este PIN. Lo necesitaras cuando llegue el operador.`,
        [{ text: 'Ver Estado', onPress: () => router.replace('/(user)') }]
      );
      setSubmitting(false);
    } catch {
      Alert.alert('Error de conexion', 'No se pudo conectar con el servidor.');
      setSubmitting(false);
    }
  };

  // ─── STEP 1: Service Type Selection ───
  const renderStep1 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Tipo de Servicio</Text>
      <Text style={styles.stepSubtitle}>Selecciona el servicio que necesitas</Text>

      {loadingPricingTypes ? (
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 20 }} />
      ) : (
        <View style={styles.serviceGrid}>
          {serviceTypePricing.map((stp) => {
            const config = SERVICE_TYPE_CONFIGS[stp.service_type as ServiceType];
            const isSelected = serviceType === stp.service_type;
            return (
              <TouchableOpacity
                key={stp.id}
                style={[
                  styles.serviceCard,
                  isSelected && { borderColor: config?.color || '#2563eb', backgroundColor: `${config?.color || '#2563eb'}10` },
                ]}
                onPress={() => setServiceType(stp.service_type as ServiceType)}
              >
                <Text style={styles.serviceCardIcon}>{stp.icon}</Text>
                <Text style={[styles.serviceCardName, isSelected && { color: config?.color || '#2563eb' }]}>
                  {stp.display_name}
                </Text>
                <Text style={styles.serviceCardDesc}>{stp.description}</Text>
                <Text style={styles.serviceCardPrice}>Desde ${stp.base_price.toFixed(2)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <TouchableOpacity
        style={[styles.nextButton, !serviceType && styles.buttonDisabled]}
        onPress={() => setStep(2)}
        disabled={!serviceType}
      >
        <Text style={styles.nextButtonText}>Siguiente</Text>
      </TouchableOpacity>
    </View>
  );

  // ─── STEP 2: Location ───
  const renderStep2 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Ubicacion</Text>

      <Text style={styles.label}>Punto de Recogida</Text>
      <TouchableOpacity
        style={styles.locationSelector}
        onPress={() => setShowPickupPicker(true)}
      >
        <Text style={styles.locationSelectorIcon}>📍</Text>
        <View style={styles.locationSelectorContent}>
          <Text style={[styles.locationSelectorText, !pickupAddress && styles.locationSelectorPlaceholder]}>
            {pickupAddress || 'Toca para seleccionar ubicacion'}
          </Text>
        </View>
        <Text style={styles.locationSelectorArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.quickGpsButton}
        onPress={getCurrentLocation}
        disabled={gettingLocation}
      >
        {gettingLocation ? (
          <ActivityIndicator color="#2563eb" size="small" />
        ) : (
          <Text style={styles.quickGpsText}>📡 Usar mi ubicacion actual</Text>
        )}
      </TouchableOpacity>

      {requiresDestination && (
        <>
          <Text style={styles.label}>Destino</Text>
          <TouchableOpacity
            style={styles.locationSelector}
            onPress={() => setShowDestinationPicker(true)}
          >
            <Text style={styles.locationSelectorIcon}>🏁</Text>
            <View style={styles.locationSelectorContent}>
              <Text style={[styles.locationSelectorText, !dropoffAddress && styles.locationSelectorPlaceholder]}>
                {dropoffAddress || 'Toca para seleccionar destino'}
              </Text>
            </View>
            <Text style={styles.locationSelectorArrow}>›</Text>
          </TouchableOpacity>
        </>
      )}

      {!requiresDestination && (
        <View style={styles.infoBox}>
          <Text style={styles.infoBoxText}>
            Este servicio se realiza en el lugar de recogida. No se necesita destino.
          </Text>
        </View>
      )}

      <View style={styles.navButtons}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep(1)}>
          <Text style={styles.backButtonText}>Atras</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.nextButton,
            (!pickupAddress || (requiresDestination && !dropoffAddress)) && styles.buttonDisabled,
          ]}
          onPress={() => setStep(3)}
          disabled={!pickupAddress || (requiresDestination && !dropoffAddress)}
        >
          <Text style={styles.nextButtonText}>Siguiente</Text>
        </TouchableOpacity>
      </View>

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

      {requiresDestination && (
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
      )}
    </View>
  );

  // ─── STEP 3: Service Details (dynamic per type) ───
  const renderStep3 = () => {
    const renderTowDetails = () => (
      <>
        <Text style={styles.label}>Tipo de Grua</Text>
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleButton, towType === 'light' && styles.toggleActive]}
            onPress={() => setTowType('light')}
          >
            <Text style={[styles.toggleText, towType === 'light' && styles.toggleTextActive]}>Liviana</Text>
            <Text style={styles.toggleSubtext}>Autos, camionetas</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, towType === 'heavy' && styles.toggleActive]}
            onPress={() => setTowType('heavy')}
          >
            <Text style={[styles.toggleText, towType === 'heavy' && styles.toggleTextActive]}>Pesada</Text>
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
              <Text style={[styles.incidentText, incidentType === type && styles.incidentTextActive]}>
                {type}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </>
    );

    const renderTireDetails = () => (
      <>
        <Text style={styles.label}>Tienes llanta de repuesto?</Text>
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleButton, hasSpare === true && styles.toggleActive]}
            onPress={() => setHasSpare(true)}
          >
            <Text style={[styles.toggleText, hasSpare === true && styles.toggleTextActive]}>Si tengo</Text>
            <Text style={styles.toggleSubtext}>Solo cambio</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, hasSpare === false && styles.toggleActive]}
            onPress={() => setHasSpare(false)}
          >
            <Text style={[styles.toggleText, hasSpare === false && styles.toggleTextActive]}>No tengo</Text>
            <Text style={styles.toggleSubtext}>+${currentPricingType?.extra_fee?.toFixed(2) || '15.00'}</Text>
          </TouchableOpacity>
        </View>
      </>
    );

    const renderFuelDetails = () => (
      <>
        <Text style={styles.label}>Tipo de Combustible</Text>
        <View style={styles.toggleContainer}>
          {(['regular', 'premium', 'diesel'] as FuelType[]).map((ft) => (
            <TouchableOpacity
              key={ft}
              style={[styles.toggleButton, fuelType === ft && styles.toggleActive]}
              onPress={() => setFuelType(ft)}
            >
              <Text style={[styles.toggleText, fuelType === ft && styles.toggleTextActive]}>
                {ft === 'regular' ? 'Regular' : ft === 'premium' ? 'Premium' : 'Diesel'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Cantidad (galones)</Text>
        <View style={styles.gallonSelector}>
          <TouchableOpacity
            style={styles.gallonBtn}
            onPress={() => setFuelGallons(Math.max(1, fuelGallons - 1))}
          >
            <Text style={styles.gallonBtnText}>-</Text>
          </TouchableOpacity>
          <Text style={styles.gallonValue}>{fuelGallons}</Text>
          <TouchableOpacity
            style={styles.gallonBtn}
            onPress={() => setFuelGallons(Math.min(10, fuelGallons + 1))}
          >
            <Text style={styles.gallonBtnText}>+</Text>
          </TouchableOpacity>
        </View>
        {fuelGallons > 1 && currentPricingType && (
          <Text style={styles.extraFeeNote}>
            +${(currentPricingType.extra_fee * (fuelGallons - 1)).toFixed(2)} por {fuelGallons - 1} galon(es) extra
          </Text>
        )}
      </>
    );

    const renderSimpleDetails = () => (
      <View style={styles.infoBox}>
        <Text style={styles.infoBoxText}>
          {serviceType === 'battery'
            ? 'Un operador llegara a diagnosticar y cargar o reemplazar tu bateria.'
            : 'Un cerrajero llegara para abrir tu vehiculo de forma segura.'}
        </Text>
      </View>
    );

    const canProceed = serviceType === 'tow' ? !!incidentType : serviceType === 'tire' ? hasSpare !== null : true;

    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>
          {SERVICE_TYPE_CONFIGS[serviceType].emoji} Detalles del Servicio
        </Text>

        {serviceType === 'tow' && renderTowDetails()}
        {serviceType === 'tire' && renderTireDetails()}
        {serviceType === 'fuel' && renderFuelDetails()}
        {(serviceType === 'battery' || serviceType === 'locksmith') && renderSimpleDetails()}

        <Text style={styles.label}>Notas Adicionales (opcional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Informacion adicional para el operador..."
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        <View style={styles.navButtons}>
          <TouchableOpacity style={styles.backButton} onPress={() => setStep(2)}>
            <Text style={styles.backButtonText}>Atras</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.nextButton, !canProceed && styles.buttonDisabled]}
            onPress={() => setStep(4)}
            disabled={!canProceed}
          >
            <Text style={styles.nextButtonText}>Siguiente</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ─── STEP 4: Vehicle + Photo ───
  const renderStep4 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Detalles del Vehiculo</Text>

      <Text style={styles.label}>Descripcion del Vehiculo (opcional)</Text>
      <TextInput
        style={styles.input}
        placeholder="Ej: Toyota Corolla 2020, color blanco"
        value={vehicleDescription}
        onChangeText={setVehicleDescription}
      />

      <Text style={styles.label}>Foto del Vehiculo (opcional)</Text>
      <View style={styles.photoButtons}>
        <TouchableOpacity style={styles.photoButton} onPress={takePhoto}>
          <Text style={styles.photoButtonText}>Tomar Foto</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.photoButton} onPress={pickImage}>
          <Text style={styles.photoButtonText}>Galeria</Text>
        </TouchableOpacity>
      </View>

      {photo && (
        <Image source={{ uri: photo }} style={styles.photoPreview} resizeMode="cover" />
      )}

      <View style={styles.navButtons}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep(3)}>
          <Text style={styles.backButtonText}>Atras</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.nextButton} onPress={() => setStep(5)}>
          <Text style={styles.nextButtonText}>Ver Resumen</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ─── STEP 5: Summary + Price ───
  const renderStep5 = () => {
    const flatPrice = !requiresDestination ? calculateFlatPrice() : null;
    const displayPrice = requiresDestination ? estimatedPrice : flatPrice;
    const config = SERVICE_TYPE_CONFIGS[serviceType];

    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Resumen de Solicitud</Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Servicio:</Text>
            <Text style={styles.summaryValue}>{config.emoji} {config.name}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Recogida:</Text>
            <Text style={styles.summaryValue}>{pickupAddress}</Text>
          </View>
          {requiresDestination && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Destino:</Text>
              <Text style={styles.summaryValue}>{dropoffAddress}</Text>
            </View>
          )}
          {serviceType === 'tow' && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tipo de Grua:</Text>
              <Text style={styles.summaryValue}>{towType === 'light' ? 'Liviana' : 'Pesada'}</Text>
            </View>
          )}
          {serviceType === 'tow' && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Incidente:</Text>
              <Text style={styles.summaryValue}>{incidentType}</Text>
            </View>
          )}
          {serviceType === 'tire' && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Repuesto:</Text>
              <Text style={styles.summaryValue}>{hasSpare ? 'Si' : 'No (+$' + (currentPricingType?.extra_fee?.toFixed(2) || '15.00') + ')'}</Text>
            </View>
          )}
          {serviceType === 'fuel' && (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Combustible:</Text>
                <Text style={styles.summaryValue}>{fuelType === 'regular' ? 'Regular' : fuelType === 'premium' ? 'Premium' : 'Diesel'}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Galones:</Text>
                <Text style={styles.summaryValue}>{fuelGallons}</Text>
              </View>
            </>
          )}
          {vehicleDescription && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Vehiculo:</Text>
              <Text style={styles.summaryValue}>{vehicleDescription}</Text>
            </View>
          )}
        </View>

        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>Precio Estimado</Text>

          {requiresDestination ? (
            // Tow: depends on distance calculation
            distanceLoading ? (
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
                  {displayPrice ? `$${displayPrice.toFixed(2)}` : '--'}
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
                    * Distancia aproximada (sin conexion a Google Maps)
                  </Text>
                )}
              </>
            )
          ) : (
            // Non-tow: flat fee
            <Text style={styles.priceValue}>
              {displayPrice ? `$${displayPrice.toFixed(2)}` : '--'}
            </Text>
          )}

          <Text style={styles.priceDisclaimer}>
            {requiresDestination
              ? 'El precio final puede variar segun la distancia real recorrida.'
              : 'Precio fijo por el servicio.'}
          </Text>
        </View>

        <View style={styles.navButtons}>
          <TouchableOpacity style={styles.backButton} onPress={() => setStep(4)}>
            <Text style={styles.backButtonText}>Atras</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.submitButton,
              (submitting || (requiresDestination && (distanceLoading || !calculatedDistance))) && styles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={submitting || (requiresDestination && (distanceLoading || !calculatedDistance))}
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
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.progressContainer}>
        {[1, 2, 3, 4, 5].map((s) => (
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
      {step === 5 && renderStep5()}
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
    marginBottom: 4,
    color: '#111827',
  },
  stepSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 8,
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
  // ─── Service Type Grid ───
  serviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  serviceCard: {
    width: '47%',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  serviceCardIcon: {
    fontSize: 32,
  },
  serviceCardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  serviceCardDesc: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  serviceCardPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563eb',
    marginTop: 4,
  },
  // ─── Location ───
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
  infoBox: {
    backgroundColor: '#f0f9ff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  infoBoxText: {
    fontSize: 14,
    color: '#0369a1',
    textAlign: 'center',
  },
  // ─── Toggle / Incident ───
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
  // ─── Gallon selector ───
  gallonSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginTop: 8,
  },
  gallonBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gallonBtnText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  gallonValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    minWidth: 40,
    textAlign: 'center',
  },
  extraFeeNote: {
    fontSize: 12,
    color: '#f59e0b',
    textAlign: 'center',
    marginTop: 4,
  },
  // ─── Photo ───
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
  // ─── Navigation ───
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
  // ─── Summary ───
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
  // ─── Price ───
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
