import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Truck, Battery, CircleDot, Fuel, KeyRound, Wrench, ChevronsUp, MapPin, Flag, LocateFixed } from 'lucide-react-native';
import { BudiLogo, Button, Card, Input } from '@/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

type LucideIconComponent = React.ComponentType<{ size: number; color: string; strokeWidth: number }>;

const SERVICE_ICONS: Record<ServiceType, LucideIconComponent> = {
  tow: Truck,
  battery: Battery,
  tire: CircleDot,
  fuel: Fuel,
  locksmith: KeyRound,
  mechanic: Wrench,
  winch: ChevronsUp,
};

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
  mechanic: 'Averia mecanica',
  winch: 'Vehiculo varado',
};

type PricingRule = {
  base_exit_fee: number;
  included_km: number;
  price_per_km_light: number;
  price_per_km_heavy: number;
};

export default function RequestService() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
        [{
          text: 'Ver Estado',
          onPress: () => {
            setStep(1);
            setServiceType('tow');
            setPickupCoords(null);
            setPickupAddress('');
            setDropoffCoords(null);
            setDropoffAddress('');
            setTowType('light');
            setIncidentType('');
            setVehicleDescription('');
            setNotes('');
            setPhoto(null);
            setEstimatedPrice(null);
            setHasSpare(null);
            setFuelType('regular');
            setFuelGallons(1);
            setSubmitting(false);
            router.replace('/(user)');
          },
        }]
      );
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
        <ActivityIndicator size="large" color={colors.primary[500]} style={{ marginTop: spacing.l }} />
      ) : (
        <View style={styles.serviceGrid}>
          {serviceTypePricing.map((stp) => {
            const config = SERVICE_TYPE_CONFIGS[stp.service_type as ServiceType];
            const isSelected = serviceType === stp.service_type;
            const ServiceIcon = SERVICE_ICONS[stp.service_type as ServiceType] || Truck;
            return (
              <Pressable
                key={stp.id}
                style={[
                  styles.serviceCard,
                  isSelected && { borderColor: colors.accent[500], backgroundColor: colors.accent[50] },
                ]}
                onPress={() => setServiceType(stp.service_type as ServiceType)}
              >
                <View style={[
                  styles.serviceIconContainer,
                  { backgroundColor: `${config?.color || colors.primary[500]}20` },
                  isSelected && { backgroundColor: `${colors.accent[500]}20` },
                ]}>
                  <ServiceIcon
                    size={36}
                    color={isSelected ? colors.accent[500] : (config?.color || colors.primary[500])}
                    strokeWidth={1.8}
                  />
                </View>
                <Text style={[styles.serviceCardName, isSelected && { color: colors.accent[600] }]}>
                  {stp.display_name}
                </Text>
                <Text style={styles.serviceCardDesc}>{stp.description}</Text>
                <Text style={styles.serviceCardPrice}>Desde ${stp.base_price.toFixed(2)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Button
        title="Siguiente"
        onPress={() => setStep(2)}
        disabled={!serviceType}
      />
    </View>
  );

  // ─── STEP 2: Location ───
  const renderStep2 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Ubicacion</Text>

      <Text style={styles.label}>Punto de Recogida</Text>
      <Pressable
        style={styles.locationSelector}
        onPress={() => setShowPickupPicker(true)}
      >
        <View style={styles.locationSelectorIconWrap}>
          <MapPin size={20} color={colors.primary[500]} strokeWidth={2} />
        </View>
        <View style={styles.locationSelectorContent}>
          <Text style={[styles.locationSelectorText, !pickupAddress && styles.locationSelectorPlaceholder]}>
            {pickupAddress || 'Toca para seleccionar ubicacion'}
          </Text>
        </View>
        <Text style={styles.locationSelectorArrow}>›</Text>
      </Pressable>

      <Pressable
        style={styles.quickGpsButton}
        onPress={getCurrentLocation}
        disabled={gettingLocation}
      >
        {gettingLocation ? (
          <ActivityIndicator color={colors.primary[500]} size="small" />
        ) : (
          <View style={styles.quickGpsContent}>
            <LocateFixed size={16} color={colors.primary[500]} strokeWidth={2} />
            <Text style={styles.quickGpsText}>Usar mi ubicacion actual</Text>
          </View>
        )}
      </Pressable>

      {requiresDestination && (
        <>
          <Text style={styles.label}>Destino</Text>
          <Pressable
            style={styles.locationSelector}
            onPress={() => setShowDestinationPicker(true)}
          >
            <View style={styles.locationSelectorIconWrap}>
              <Flag size={20} color={colors.error.main} strokeWidth={2} />
            </View>
            <View style={styles.locationSelectorContent}>
              <Text style={[styles.locationSelectorText, !dropoffAddress && styles.locationSelectorPlaceholder]}>
                {dropoffAddress || 'Toca para seleccionar destino'}
              </Text>
            </View>
            <Text style={styles.locationSelectorArrow}>›</Text>
          </Pressable>
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
        <View style={styles.navBack}>
          <Button title="Atras" onPress={() => setStep(1)} variant="secondary" size="medium" />
        </View>
        <View style={styles.navNext}>
          <Button
            title="Siguiente"
            onPress={() => setStep(3)}
            size="medium"
            disabled={!pickupAddress || (requiresDestination && !dropoffAddress)}
          />
        </View>
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
          <Pressable
            style={[styles.toggleButton, towType === 'light' && styles.toggleActive]}
            onPress={() => setTowType('light')}
          >
            <Text style={[styles.toggleText, towType === 'light' && styles.toggleTextActive]}>Liviana</Text>
            <Text style={styles.toggleSubtext}>Autos, camionetas</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleButton, towType === 'heavy' && styles.toggleActive]}
            onPress={() => setTowType('heavy')}
          >
            <Text style={[styles.toggleText, towType === 'heavy' && styles.toggleTextActive]}>Pesada</Text>
            <Text style={styles.toggleSubtext}>Camiones, buses</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Tipo de Incidente</Text>
        <View style={styles.incidentGrid}>
          {INCIDENT_TYPES.map((type) => (
            <Pressable
              key={type}
              style={[styles.incidentButton, incidentType === type && styles.incidentActive]}
              onPress={() => setIncidentType(type)}
            >
              <Text style={[styles.incidentText, incidentType === type && styles.incidentTextActive]}>
                {type}
              </Text>
            </Pressable>
          ))}
        </View>
      </>
    );

    const renderTireDetails = () => (
      <>
        <Text style={styles.label}>Tienes llanta de repuesto?</Text>
        <View style={styles.toggleContainer}>
          <Pressable
            style={[styles.toggleButton, hasSpare === true && styles.toggleActive]}
            onPress={() => setHasSpare(true)}
          >
            <Text style={[styles.toggleText, hasSpare === true && styles.toggleTextActive]}>Si tengo</Text>
            <Text style={styles.toggleSubtext}>Solo cambio</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleButton, hasSpare === false && styles.toggleActive]}
            onPress={() => setHasSpare(false)}
          >
            <Text style={[styles.toggleText, hasSpare === false && styles.toggleTextActive]}>No tengo</Text>
            <Text style={styles.toggleSubtext}>+${currentPricingType?.extra_fee?.toFixed(2) || '15.00'}</Text>
          </Pressable>
        </View>
      </>
    );

    const renderFuelDetails = () => (
      <>
        <Text style={styles.label}>Tipo de Combustible</Text>
        <View style={styles.toggleContainer}>
          {(['regular', 'premium', 'diesel'] as FuelType[]).map((ft) => (
            <Pressable
              key={ft}
              style={[styles.toggleButton, fuelType === ft && styles.toggleActive]}
              onPress={() => setFuelType(ft)}
            >
              <Text style={[styles.toggleText, fuelType === ft && styles.toggleTextActive]}>
                {ft === 'regular' ? 'Regular' : ft === 'premium' ? 'Premium' : 'Diesel'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Cantidad (galones)</Text>
        <View style={styles.gallonSelector}>
          <Pressable
            style={styles.gallonBtn}
            onPress={() => setFuelGallons(Math.max(1, fuelGallons - 1))}
          >
            <Text style={styles.gallonBtnText}>-</Text>
          </Pressable>
          <Text style={styles.gallonValue}>{fuelGallons}</Text>
          <Pressable
            style={styles.gallonBtn}
            onPress={() => setFuelGallons(Math.min(10, fuelGallons + 1))}
          >
            <Text style={styles.gallonBtnText}>+</Text>
          </Pressable>
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
        <View style={styles.stepTitleRow}>
          {(() => {
            const SvcIcon = SERVICE_ICONS[serviceType] || Truck;
            const cfg = SERVICE_TYPE_CONFIGS[serviceType];
            return <SvcIcon size={22} color={cfg?.color || colors.primary[500]} strokeWidth={2} />;
          })()}
          <Text style={styles.stepTitle}>Detalles del Servicio</Text>
        </View>

        {serviceType === 'tow' && renderTowDetails()}
        {serviceType === 'tire' && renderTireDetails()}
        {serviceType === 'fuel' && renderFuelDetails()}
        {(serviceType === 'battery' || serviceType === 'locksmith') && renderSimpleDetails()}

        <Input
          label="Notas Adicionales (opcional)"
          placeholder="Informacion adicional para el operador..."
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        <View style={styles.navButtons}>
          <View style={styles.navBack}>
            <Button title="Atras" onPress={() => setStep(2)} variant="secondary" size="medium" />
          </View>
          <View style={styles.navNext}>
            <Button title="Siguiente" onPress={() => setStep(4)} size="medium" disabled={!canProceed} />
          </View>
        </View>
      </View>
    );
  };

  // ─── STEP 4: Vehicle + Photo ───
  const renderStep4 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Detalles del Vehiculo</Text>

      <Input
        label="Descripcion del Vehiculo (opcional)"
        placeholder="Ej: Toyota Corolla 2020, color blanco"
        value={vehicleDescription}
        onChangeText={setVehicleDescription}
      />

      <Text style={styles.label}>Foto del Vehiculo (opcional)</Text>
      <View style={styles.photoButtons}>
        <View style={{ flex: 1 }}>
          <Button title="Tomar Foto" onPress={takePhoto} variant="secondary" size="medium" />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Galeria" onPress={pickImage} variant="secondary" size="medium" />
        </View>
      </View>

      {photo && (
        <Image source={{ uri: photo }} style={styles.photoPreview} resizeMode="cover" />
      )}

      <View style={styles.navButtons}>
        <View style={styles.navBack}>
          <Button title="Atras" onPress={() => setStep(3)} variant="secondary" size="medium" />
        </View>
        <View style={styles.navNext}>
          <Button title="Ver Resumen" onPress={() => setStep(5)} size="medium" />
        </View>
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

        <Card variant="outlined" padding="m">
          <View style={styles.summaryContent}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Servicio:</Text>
              <View style={styles.summaryServiceRow}>
                {(() => {
                  const SvcIcon = SERVICE_ICONS[serviceType] || Truck;
                  return <SvcIcon size={16} color={config.color || colors.primary[500]} strokeWidth={2} />;
                })()}
                <Text style={styles.summaryValue}>{config.name}</Text>
              </View>
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
        </Card>

        <View style={styles.priceCard}>
          <Text style={styles.priceLabelText}>Precio Estimado</Text>

          {requiresDestination ? (
            // Tow: depends on distance calculation
            distanceLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary[500]} />
                <Text style={styles.loadingText}>Calculando distancia...</Text>
              </View>
            ) : distanceError ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{distanceError}</Text>
                <Button title="Reintentar" onPress={refetchDistance} size="small" />
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
          <View style={styles.navBack}>
            <Button title="Atras" onPress={() => setStep(4)} variant="secondary" size="medium" />
          </View>
          <View style={styles.navNext}>
            <Button
              title="Confirmar Solicitud"
              onPress={handleSubmit}
              size="medium"
              loading={submitting}
              disabled={submitting || (requiresDestination && (distanceLoading || !calculatedDistance))}
            />
          </View>
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.l }]}>
      <View style={styles.wizardHeader}>
        <BudiLogo variant="icon" height={28} />
      </View>
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
  // Layout
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  content: {
    padding: spacing.l,
    paddingBottom: spacing.xxxxl,
  },

  // Wizard header
  wizardHeader: {
    marginBottom: spacing.s,
  },

  // Progress
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xl,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border.light,
  },
  progressDotActive: {
    backgroundColor: colors.primary[500],
  },

  // Step
  stepContainer: {
    gap: spacing.m,
  },
  stepTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    marginBottom: spacing.micro,
  },
  stepTitle: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },
  stepSubtitle: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  label: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
    marginTop: spacing.xs,
  },

  // Service Type Grid
  serviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s,
  },
  serviceCard: {
    width: '47%',
    borderWidth: 2,
    borderColor: colors.border.light,
    borderRadius: radii.l,
    padding: spacing.m,
    alignItems: 'center',
    gap: spacing.xs,
  },
  serviceIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  serviceCardName: {
    fontFamily: typography.fonts.bodyBold,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
  },
  serviceCardDesc: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  serviceCardPrice: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.accent[600],
    marginTop: spacing.micro,
  },

  // Location
  locationSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.light,
    borderRadius: radii.m,
    padding: spacing.s,
    backgroundColor: colors.background.secondary,
  },
  locationSelectorIconWrap: {
    marginRight: spacing.s,
  },
  locationSelectorContent: {
    flex: 1,
  },
  locationSelectorText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
  },
  locationSelectorPlaceholder: {
    color: colors.text.tertiary,
  },
  locationSelectorArrow: {
    fontSize: 24,
    color: colors.text.tertiary,
    marginLeft: spacing.xs,
  },
  quickGpsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  quickGpsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  quickGpsText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.primary[500],
  },
  infoBox: {
    backgroundColor: colors.info.light,
    borderRadius: radii.m,
    padding: spacing.m,
    borderWidth: 1,
    borderColor: colors.info.main,
  },
  infoBoxText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.info.dark,
    textAlign: 'center',
  },

  // Toggle / Incident
  toggleContainer: {
    flexDirection: 'row',
    gap: spacing.s,
  },
  toggleButton: {
    flex: 1,
    padding: spacing.m,
    borderWidth: 2,
    borderColor: colors.border.light,
    borderRadius: radii.m,
    alignItems: 'center',
  },
  toggleActive: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  toggleText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
  },
  toggleTextActive: {
    color: colors.primary[500],
  },
  toggleSubtext: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginTop: spacing.micro,
  },
  incidentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  incidentButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.s,
    borderWidth: 1,
    borderColor: colors.border.light,
    borderRadius: radii.full,
    backgroundColor: colors.background.secondary,
  },
  incidentActive: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  incidentText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
  },
  incidentTextActive: {
    color: colors.primary[500],
    fontFamily: typography.fonts.bodySemiBold,
  },

  // Gallon selector
  gallonSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  gallonBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  gallonBtnText: {
    color: colors.white,
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
  },
  gallonValue: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h1,
    color: colors.text.primary,
    minWidth: 40,
    textAlign: 'center',
  },
  extraFeeNote: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.warning.main,
    textAlign: 'center',
    marginTop: spacing.micro,
  },

  // Photo
  photoButtons: {
    flexDirection: 'row',
    gap: spacing.s,
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: radii.s,
    marginTop: spacing.xs,
  },

  // Navigation
  navButtons: {
    flexDirection: 'row',
    gap: spacing.s,
    marginTop: spacing.xl,
  },
  navBack: {
    flex: 1,
  },
  navNext: {
    flex: 2,
  },

  // Summary
  summaryContent: {
    gap: spacing.s,
  },
  summaryRow: {
    gap: spacing.micro,
  },
  summaryServiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  summaryLabel: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
  },
  summaryValue: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.primary,
  },

  // Price
  priceCard: {
    backgroundColor: colors.primary[50],
    padding: spacing.l,
    borderRadius: radii.m,
    alignItems: 'center',
    marginTop: spacing.m,
  },
  priceLabelText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.primary[500],
  },
  priceValue: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.hero,
    color: colors.accent[600],
    marginVertical: spacing.xs,
  },
  priceNote: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.primary[400],
  },
  priceDisclaimer: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  // Loading / Error
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacing.m,
  },
  loadingText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: spacing.s,
    gap: spacing.xs,
  },
  errorText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.error.main,
    textAlign: 'center',
  },
  fallbackNote: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.micro,
    color: colors.warning.main,
    fontStyle: 'italic',
    marginTop: spacing.micro,
  },
});
