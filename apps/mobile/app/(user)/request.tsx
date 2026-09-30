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
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { friendlyError } from '@/lib/errorMessages';
import { getPositionFast, reverseGeocode, searchPlaces } from '@/lib/geocoding';
import { useDistanceCalculation } from '@/shared/hooks/useDistanceCalculation';
import { LocationPicker } from '@/features/tracking/components/LocationPicker';
import { vehicleLabel, type Vehicle } from '@/lib/vehicles';
import { isWithinCoverage, COVERAGE } from '@/config/coverage';
import { savePin } from '@/features/pin/lib/pinStorage';
import type { ServiceType, ServiceTypePricing, FuelType, CoverageResult } from '@gruas-app/shared';
import { SERVICE_TYPE_CONFIGS, requiresDropoff, setDropoffCatalog } from '@gruas-app/shared';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Truck, Battery, CircleDot, Fuel, KeyRound, Wrench, ChevronsUp, Droplets, MapPin, Flag, LocateFixed, Copy, CheckCircle2, X, Check } from 'lucide-react-native';
import { Button, Card, Input, ToastHost, toast } from '@/shared/components/ui';
import { MiniMap } from '@/shared/components/MiniMap';
import { colors, typography, spacing, radii } from '@/theme';
import { useCoverage } from '@/features/coverage/hooks/useCoverage';
import { CoverageBanner } from '@/features/coverage/components/CoverageBanner';
import { useCoveragePreview } from '@/features/coverage/hooks/useCoveragePreview';
import { CopayBreakdown } from '@/features/coverage/components/CopayBreakdown';
import { useMoptProgram } from '@/features/coverage/hooks/useMoptProgram';
import { MoptProgramBanner } from '@/features/coverage/components/MoptProgramBanner';

// Pasos del wizard, con etiqueta para el indicador de progreso.
const STEP_META = [
  { n: 1, label: 'Servicio' },
  { n: 2, label: 'Ubicación' },
  { n: 3, label: 'Detalles' },
  { n: 4, label: 'Vehículo' },
  { n: 5, label: 'Resumen' },
] as const;

type LucideIconComponent = React.ComponentType<{ size: number; color: string; strokeWidth: number }>;

const SERVICE_ICONS: Record<ServiceType, LucideIconComponent> = {
  tow: Truck,
  battery: Battery,
  tire: CircleDot,
  fuel: Fuel,
  locksmith: KeyRound,
  mechanic: Wrench,
  winch: ChevronsUp,
  water_truck: Droplets,
};

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

// Auto-assigned incident types for non-tow services
const SERVICE_INCIDENT_MAP: Record<ServiceType, string> = {
  tow: '',
  battery: 'Batería descargada',
  tire: 'Llantas ponchadas',
  fuel: 'Sin combustible',
  locksmith: 'Llaves dentro del vehículo',
  mechanic: 'Avería mecánica',
  winch: 'Vehículo varado',
  water_truck: 'Necesito agua potable',
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
  // VID-02: servicios que el MOPT cubre donde está la persona, para el badge
  // "Sin costo" del catálogo (00110). Con la última ubicación conocida y solo si
  // ya dio permiso: el catálogo no pide ubicación por su cuenta.
  const [moptServices, setMoptServices] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const last = await Location.getLastKnownPositionAsync();
        if (!last || !alive) return;
        const { data } = await supabase.rpc('preview_mopt_services', {
          p_lat: last.coords.latitude,
          p_lng: last.coords.longitude,
        });
        if (alive) setMoptServices((data as string[] | null) ?? []);
      } catch {
        // Sin badge: el veredicto real llega en el resumen y al crear.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const [submitting, setSubmitting] = useState(false);

  // Modal de éxito con el PIN (reemplaza el Alert efímero no copiable).
  const [successPin, setSuccessPin] = useState<string | null>(null);
  const [pinCopied, setPinCopied] = useState(false);

  // B-11. Dos cosas distintas a proposito:
  //  - `coverage` es la consulta previa, para que la persona sepa como va a
  //    quedar el servicio ANTES de confirmarlo.
  //  - `finalCoverage` es lo que dictamino el servidor al crear la solicitud, y
  //    es lo que manda. Pueden diferir (la poliza vencio entre un paso y otro, o
  //    la verificacion fallo justo al crear), y en ese caso se muestra la segunda.
  const { coverage, loading: loadingCoverage } = useCoverage();

  const [finalCoverage, setFinalCoverage] = useState<CoverageResult | null>(null);
  // 00098: el veredicto del servidor sobre si lo paga un programa MOPT.
  const [finalMopt, setFinalMopt] = useState<{ program_name?: string } | null>(null);

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
  const [savedVehicles, setSavedVehicles] = useState<Vehicle[]>([]);
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

  const requiresDestination = requiresDropoff(serviceType);
  // Solo la grúa se cobra por distancia (complete_service_request). El winche
  // también lleva destino pero cobra tarifa fija del catálogo: tomarlo como
  // grúa dejaba el resumen en "--" (o con el precio de una grúa elegida antes).
  const pricedByDistance = serviceType === 'tow';
  const currentPricingType = serviceTypePricing.find(p => p.service_type === serviceType);

  // Datos visuales del servicio, tomados de la DB con fallback seguro. Asi un
  // service_type nuevo (agregado en `services`) fluye por todo el
  // wizard sin romperse aunque no exista en SERVICE_TYPE_CONFIGS (7 fijos).
  const currentConfig = SERVICE_TYPE_CONFIGS[serviceType];
  const serviceName = currentPricingType?.display_name || currentConfig?.name || 'Servicio';
  const serviceColor = currentConfig?.color || colors.primary[500];

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

  // Catalogo de servicios. Lee de `services`, el catalogo unico desde la
  // migracion 00049 — antes habia dos tablas con los mismos campos y datos
  // distintos, y esta pantalla leia de la que nadie podia editar.
  // De paso alimenta el catalogo de destinos, asi no hacen falta dos consultas.
  useEffect(() => {
    const fetchServicePricing = async () => {
      setLoadingPricingTypes(true);
      const { data, error } = await supabase
        .from('services')
        .select('id, slug, name_es, description_es, icon, base_price, extra_fee, extra_fee_label, requires_destination, sort_order, is_active, currency')
        .eq('is_active', true)
        .order('sort_order');

      if (error) {
        console.error('Error fetching service catalog:', error);
      } else if (data) {
        setServiceTypePricing(
          data.map((s) => ({
            id: s.id,
            service_type: s.slug as ServiceType,
            display_name: s.name_es,
            description: s.description_es ?? '',
            icon: s.icon ?? '',
            base_price: Number(s.base_price ?? 0),
            extra_fee: Number(s.extra_fee ?? 0),
            extra_fee_label: s.extra_fee_label,
            requires_destination: !!s.requires_destination,
            sort_order: s.sort_order ?? 0,
            is_active: !!s.is_active,
            currency: s.currency ?? 'USD',
          }))
        );
        setDropoffCatalog(
          data.map((s) => ({
            service_type: s.slug,
            requires_destination: !!s.requires_destination,
          }))
        );
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

  // Cargar vehículos guardados para ofrecerlos como acceso rápido.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('id, make, model, plate, color, is_default')
        .order('is_default', { ascending: false });
      if (data && data.length > 0) {
        setSavedVehicles(data);
        const def = data.find((v) => v.is_default) || data[0];
        setVehicleDescription((prev) => prev || vehicleLabel(def));
      }
    })();
  }, []);

  const getCurrentLocation = async () => {
    setGettingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        toast.error('Permite el acceso a tu ubicación para continuar.', 'Permisos');
        setGettingLocation(false);
        return;
      }

      // Con límite de tiempo: sin fix en 10 s usa la última posición conocida
      // (antes la pantalla se quedaba esperando para siempre).
      const position = await getPositionFast();
      const coords = {
        lat: position.latitude,
        lng: position.longitude,
      };
      setPickupCoords(coords);

      // reverseGeocode nunca lanza y trae direccion legible via Expo -> Nominatim
      // (OSM, gratis) -> coords como ultimo recurso. Asi pickupAddress nunca
      // queda vacio (un valor vacio mantiene "Siguiente" deshabilitado aunque
      // haya coords GPS validas).
      const address = await reverseGeocode(coords.lat, coords.lng);
      setPickupAddress(address);
    } catch {
      toast.error('No se pudo obtener tu ubicación.');
    }
    setGettingLocation(false);
  };

  const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
    if (!address || address.length < 5) return null;
    try {
      // Solo El Salvador (el geocoder del teléfono busca en todo el mundo).
      const [first] = await searchPlaces(address);
      if (first) return { lat: first.lat, lng: first.lng };
    } catch (err) {
      logger.log('Geocoding error:', err);
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
      toast.error('Permite el acceso a la galería para elegir una foto.', 'Permisos');
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
      toast.error('Permite el acceso a la cámara para tomar la foto.', 'Permisos');
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

  // B-13: copago estimado. Solo cuando el usuario esta cubierto y ya en el
  // resumen (step 5), sobre el precio estimado. La logica vive en la base
  // (preview_my_coverage); si falla, el hook deja el preview en null y el
  // resumen muestra el precio a secas.
  const previewTotal = pricedByDistance ? estimatedPrice : calculateFlatPrice();
  const { preview: copayPreview } = useCoveragePreview({
    enabled: step === 5 && coverage?.status === 'covered',
    serviceType,
    total: previewTotal,
    km: pricedByDistance ? calculatedDistance : null,
    towType,
  });

  // 00098: ¿lo cubre un programa MOPT en este punto? Mismo criterio que
  // create_service_request (mopt_payer_for); aca solo se anticipa en el resumen.
  // Se pregunta tambien con seguro vigente: si el plan EXCLUYE este servicio (o
  // ya no le quedan servicios del año), la cortesia MOPT aplica igual. Decide
  // la base; aqui solo se espera a que termine la verificacion de cobertura.
  const { mopt } = useMoptProgram({
    enabled: step === 5 && !loadingCoverage,
    lat: pickupCoords?.lat,
    lng: pickupCoords?.lng,
    serviceType,
  });
  const moptApplies = mopt?.applies === true;

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
      toast.error('Selecciona el punto de recogida.');
      return;
    }
    if (requiresDestination && !dropoffAddress) {
      toast.error('Selecciona el destino.');
      return;
    }

    // Coordenadas obligatorias: sin ellas NO se envía (antes se caía en silencio
    // a DEFAULT_LOCATION y se podía despachar la grúa al lugar equivocado). Si la
    // geocodificación falló, pedimos re-seleccionar el punto en el mapa.
    if (!pickupCoords) {
      toast.error(
        'Vuelve al paso de Ubicación y selecciona el punto de recogida en el mapa para continuar.',
        'No pudimos ubicar la recogida'
      );
      return;
    }
    if (requiresDestination && !dropoffCoords) {
      toast.error(
        'Vuelve al paso de Ubicación y selecciona el destino en el mapa para continuar.',
        'No pudimos ubicar el destino'
      );
      return;
    }

    // Zona de cobertura: el punto de recogida debe estar dentro del área servida.
    if (!isWithinCoverage(pickupCoords.lat, pickupCoords.lng)) {
      toast.error(
        `Por ahora solo damos servicio en ${COVERAGE.areaName}. El punto de recogida está fuera de la zona de cobertura.`,
        'Fuera de cobertura'
      );
      return;
    }

    setSubmitting(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        toast.error('Debes iniciar sesión.');
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
          toast.info('No se pudo subir la foto, pero la solicitud continuará sin ella.', 'Aviso');
        }
      }

      // Combine notes
      const combinedNotes = [
        vehicleDescription ? `Vehículo: ${vehicleDescription}` : '',
        notes || '',
      ].filter(Boolean).join('\n') || null;

      // For non-tow: dropoff = pickup. Coords ya validadas arriba (no null).
      const effectiveDropoffLat = requiresDestination ? (dropoffCoords?.lat ?? pickupCoords.lat) : pickupCoords.lat;
      const effectiveDropoffLng = requiresDestination ? (dropoffCoords?.lng ?? pickupCoords.lng) : pickupCoords.lng;
      const effectiveDropoffAddress = requiresDestination ? dropoffAddress : pickupAddress;

      // Auto-assign incident for non-tow. Fallback al nombre del servicio (DB)
      // para tipos que no esten en SERVICE_INCIDENT_MAP.
      const effectiveIncident = serviceType === 'tow'
        ? incidentType
        : (SERVICE_INCIDENT_MAP[serviceType] || currentPricingType?.display_name || serviceName);

      const { data, error } = await supabase.rpc('create_service_request', {
        p_dropoff_address: effectiveDropoffAddress,
        p_dropoff_lat: effectiveDropoffLat,
        p_dropoff_lng: effectiveDropoffLng,
        p_incident_type: effectiveIncident,
        p_notes: combinedNotes,
        p_pickup_address: pickupAddress,
        p_pickup_lat: pickupCoords.lat,
        p_pickup_lng: pickupCoords.lng,
        p_service_details: buildServiceDetails(),
        p_service_type: serviceType,
        p_tow_type: towType,
        p_vehicle_photo_url: vehiclePhotoUrl,
      });

      if (error) {
        console.error('Error creating request:', JSON.stringify(error));
        toast.error(friendlyError(error, 'No se pudo crear la solicitud. Intenta de nuevo.'), 'Error al crear la solicitud');
        setSubmitting(false);
        return;
      }

      if (!data || data.success !== true) {
        toast.error('No se pudo crear la solicitud.');
        setSubmitting(false);
        return;
      }

      // Save PIN to SecureStore (encrypted) — see features/pin/lib/pinStorage.ts
      try {
        await savePin(data.request_id, data.pin);
      } catch (storageError) {
        console.error('Error saving PIN:', storageError);
      }

      // Éxito: mostramos el PIN en un modal in-app (copiable y persistente),
      // no en un Alert efímero. El reset del wizard ocurre al cerrar el modal.
      setSubmitting(false);
      setPinCopied(false);
      // B-11: lo que dictamino el servidor manda sobre la consulta previa.
      setFinalCoverage((data.coverage as CoverageResult) ?? null);
      setFinalMopt((data.mopt as { program_name?: string } | null) ?? null);
      setSuccessPin(data.pin);
    } catch {
      toast.error('No se pudo conectar con el servidor.', 'Error de conexión');
      setSubmitting(false);
    }
  };

  // Limpia el wizard para una próxima solicitud.
  const resetForm = () => {
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
  };

  const copyPin = async (pin: string) => {
    try {
      await Clipboard.setStringAsync(pin);
      setPinCopied(true);
    } catch {
      // Copiar es una comodidad; si falla, el PIN sigue visible en pantalla.
    }
  };

  const handleSuccessClose = () => {
    resetForm();
    setSuccessPin(null);
    setFinalCoverage(null);
    setFinalMopt(null);
    setPinCopied(false);
    router.replace('/(user)');
  };

  // Salir del wizard: si hay datos ingresados, confirma para no perderlos.
  const handleClose = () => {
    const hasData = !!(pickupAddress || dropoffAddress || incidentType || vehicleDescription || notes || photo) || step > 1;
    if (!hasData) {
      router.replace('/(user)');
      return;
    }
    Alert.alert(
      '¿Salir de la solicitud?',
      'Se perderá la información que ingresaste.',
      [
        { text: 'Seguir aquí', style: 'cancel' },
        { text: 'Salir', style: 'destructive', onPress: () => { resetForm(); router.replace('/(user)'); } },
      ]
    );
  };

  // Ir a un paso ya visitado (retroceder para editar desde el indicador o el resumen).
  const goToStep = (n: number) => {
    if (n >= 1 && n <= step) setStep(n);
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
                onPress={() => {
                  // Seleccionar el servicio y avanzar directo al paso 2
                  // (el usuario no tiene que buscar el boton "Siguiente").
                  setServiceType(stp.service_type as ServiceType);
                  setStep(2);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Servicio: ${stp.display_name}. Desde $${stp.base_price.toFixed(2)}`}
                accessibilityState={{ selected: isSelected }}
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
                {moptServices.includes(stp.service_type) ? (
                  <View style={styles.sinCostoBadge}>
                    <Text style={styles.sinCostoText}>Sin costo</Text>
                  </View>
                ) : (
                  <Text style={styles.serviceCardPrice}>Desde ${stp.base_price.toFixed(2)}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );

  // ─── STEP 2: Location ───
  const renderStep2 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Ubicación</Text>

      <Text style={styles.label}>Punto de Recogida</Text>
      <Pressable
        style={styles.locationSelector}
        onPress={() => setShowPickupPicker(true)}
        accessibilityRole="button"
        accessibilityLabel={pickupAddress ? `Punto de recogida: ${pickupAddress}. Toca para cambiar` : 'Seleccionar punto de recogida'}
      >
        <View style={styles.locationSelectorIconWrap}>
          <MapPin size={20} color={colors.primary[500]} strokeWidth={2} />
        </View>
        <View style={styles.locationSelectorContent}>
          <Text style={[styles.locationSelectorText, !pickupAddress && styles.locationSelectorPlaceholder]}>
            {pickupAddress || 'Toca para seleccionar ubicación'}
          </Text>
        </View>
        <Text style={styles.locationSelectorArrow}>›</Text>
      </Pressable>

      <Pressable
        style={styles.quickGpsButton}
        onPress={getCurrentLocation}
        disabled={gettingLocation}
        accessibilityRole="button"
        accessibilityLabel="Usar mi ubicación actual"
      >
        {gettingLocation ? (
          <ActivityIndicator color={colors.primary[500]} size="small" />
        ) : (
          <View style={styles.quickGpsContent}>
            <LocateFixed size={16} color={colors.primary[500]} strokeWidth={2} />
            <Text style={styles.quickGpsText}>Usar mi ubicación actual</Text>
          </View>
        )}
      </Pressable>

      {requiresDestination && (
        <>
          <Text style={styles.label}>Destino</Text>
          <Pressable
            style={styles.locationSelector}
            onPress={() => setShowDestinationPicker(true)}
            accessibilityRole="button"
            accessibilityLabel={dropoffAddress ? `Destino: ${dropoffAddress}. Toca para cambiar` : 'Seleccionar destino'}
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
          <Button title="Atrás" onPress={() => setStep(1)} variant="secondary" size="medium" />
        </View>
        <View style={styles.navNext}>
          <Button
            title="Siguiente"
            onPress={() => setStep(3)}
            size="medium"
            disabled={!pickupCoords || (requiresDestination && !dropoffCoords)}
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
          // Centra el mapa donde esta el vehiculo, pero SIN dejarlo
          // preseleccionado: si no, el destino salia confirmable igual al
          // punto de recogida (viaje de 0 km) con solo tocar "Confirmar".
          initialLocation={dropoffCoords ? { latitude: dropoffCoords.lat, longitude: dropoffCoords.lng } : undefined}
          initialRegion={pickupCoords ? { latitude: pickupCoords.lat, longitude: pickupCoords.lng } : undefined}
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
        <Text style={styles.label}>Tipo de Grúa</Text>
        <View style={styles.toggleContainer}>
          <Pressable
            style={[styles.toggleButton, towType === 'light' && styles.toggleActive]}
            onPress={() => setTowType('light')}
            accessibilityRole="button"
            accessibilityLabel="Grúa liviana, para autos y camionetas"
            accessibilityState={{ selected: towType === 'light' }}
          >
            <Text style={[styles.toggleText, towType === 'light' && styles.toggleTextActive]}>Liviana</Text>
            <Text style={styles.toggleSubtext}>Autos, camionetas</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleButton, towType === 'heavy' && styles.toggleActive]}
            onPress={() => setTowType('heavy')}
            accessibilityRole="button"
            accessibilityLabel="Grúa pesada, para camiones y buses"
            accessibilityState={{ selected: towType === 'heavy' }}
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
              accessibilityRole="button"
              accessibilityLabel={type}
              accessibilityState={{ selected: incidentType === type }}
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
        <Text style={styles.label}>¿Tienes llanta de repuesto?</Text>
        <View style={styles.toggleContainer}>
          <Pressable
            style={[styles.toggleButton, hasSpare === true && styles.toggleActive]}
            onPress={() => setHasSpare(true)}
            accessibilityRole="button"
            accessibilityLabel="Sí tengo llanta de repuesto"
            accessibilityState={{ selected: hasSpare === true }}
          >
            <Text style={[styles.toggleText, hasSpare === true && styles.toggleTextActive]}>Sí tengo</Text>
            <Text style={styles.toggleSubtext}>Solo cambio</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleButton, hasSpare === false && styles.toggleActive]}
            onPress={() => setHasSpare(false)}
            accessibilityRole="button"
            accessibilityLabel="No tengo llanta de repuesto"
            accessibilityState={{ selected: hasSpare === false }}
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
          {(['regular', 'premium', 'diesel'] as FuelType[]).map((ft) => {
            const ftLabel = ft === 'regular' ? 'Regular' : ft === 'premium' ? 'Premium' : 'Diésel';
            return (
              <Pressable
                key={ft}
                style={[styles.toggleButton, fuelType === ft && styles.toggleActive]}
                onPress={() => setFuelType(ft)}
                accessibilityRole="button"
                accessibilityLabel={`Combustible ${ftLabel}`}
                accessibilityState={{ selected: fuelType === ft }}
              >
                <Text style={[styles.toggleText, fuelType === ft && styles.toggleTextActive]}>
                  {ftLabel}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Cantidad (galones)</Text>
        <View style={styles.gallonSelector}>
          <Pressable
            style={styles.gallonBtn}
            onPress={() => setFuelGallons(Math.max(1, fuelGallons - 1))}
            accessibilityRole="button"
            accessibilityLabel="Quitar un galón"
          >
            <Text style={styles.gallonBtnText}>-</Text>
          </Pressable>
          <Text style={styles.gallonValue}>{fuelGallons}</Text>
          <Pressable
            style={styles.gallonBtn}
            onPress={() => setFuelGallons(Math.min(10, fuelGallons + 1))}
            accessibilityRole="button"
            accessibilityLabel="Agregar un galón"
          >
            <Text style={styles.gallonBtnText}>+</Text>
          </Pressable>
        </View>
        {fuelGallons > 1 && currentPricingType && (
          <Text style={styles.extraFeeNote}>
            +${(currentPricingType.extra_fee * (fuelGallons - 1)).toFixed(2)} por {fuelGallons - 1} {fuelGallons - 1 === 1 ? 'galón' : 'galones'} extra
          </Text>
        )}
      </>
    );

    // Detalle generico para servicios sin campos propios (bateria, cerrajeria,
    // mecanico, winche, o cualquier servicio nuevo de la DB). Usa la descripcion
    // del catalogo (`services`) para no quedar vacio.
    const renderSimpleDetails = () => (
      <View style={styles.infoBox}>
        <Text style={styles.infoBoxText}>
          {currentPricingType?.description
            ? `${currentPricingType.description}. Un socio operador llegará para atender tu solicitud en el lugar.`
            : 'Un socio operador llegará para atender tu solicitud en el lugar.'}
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
        {!(['tow', 'tire', 'fuel'] as ServiceType[]).includes(serviceType) && renderSimpleDetails()}

        <Input
          label="Notas Adicionales (opcional)"
          placeholder="Información adicional para el socio operador..."
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        <View style={styles.navButtons}>
          <View style={styles.navBack}>
            <Button title="Atrás" onPress={() => setStep(2)} variant="secondary" size="medium" />
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
      <Text style={styles.stepTitle}>Detalles del Vehículo</Text>

      {savedVehicles.length > 0 && (
        <View style={styles.vehicleChips}>
          <Text style={styles.label}>Tus vehículos</Text>
          <View style={styles.chipsRow}>
            {savedVehicles.map((v) => {
              const label = vehicleLabel(v);
              const selected = vehicleDescription === label;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => setVehicleDescription(label)}
                  style={[styles.chip, selected && styles.chipSelected]}
                  accessibilityRole="button"
                  accessibilityLabel={`Vehículo ${label}`}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <Input
        label="Descripción del Vehículo (opcional)"
        placeholder="Ej: Toyota Corolla 2020, color blanco"
        value={vehicleDescription}
        onChangeText={setVehicleDescription}
      />

      <Text style={styles.label}>Foto del Vehículo (opcional)</Text>
      <View style={styles.photoButtons}>
        <View style={{ flex: 1 }}>
          <Button title="Tomar Foto" onPress={takePhoto} variant="secondary" size="medium" />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Galería" onPress={pickImage} variant="secondary" size="medium" />
        </View>
      </View>

      {photo && (
        <Image source={{ uri: photo }} style={styles.photoPreview} resizeMode="cover" />
      )}

      <View style={styles.navButtons}>
        <View style={styles.navBack}>
          <Button title="Atrás" onPress={() => setStep(3)} variant="secondary" size="medium" />
        </View>
        <View style={styles.navNext}>
          <Button title="Ver Resumen" onPress={() => setStep(5)} size="medium" />
        </View>
      </View>
    </View>
  );

  // ─── STEP 5: Summary + Price ───
  const renderStep5 = () => {
    const flatPrice = !pricedByDistance ? calculateFlatPrice() : null;
    const displayPrice = pricedByDistance ? estimatedPrice : flatPrice;

    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Resumen de Solicitud</Text>

        {/* B-11: como queda el servicio respecto del seguro, ANTES de confirmar.
            `serviceCovered` viene de B-13: sin eso el banner anunciaba "Cubierto
            por tu seguro" aunque el plan excluyera justo este servicio, y se
            contradecia con el desglose de copago de mas abajo. */}
        {/* 00098: si lo cubre el MOPT, el banner de "Servicio particular" diria
            "pagas el servicio" y se contradiria: se reemplaza. */}
        {moptApplies ? (
          <MoptProgramBanner programName={mopt?.program_name} estimatedPrice={displayPrice} />
        ) : (
          <CoverageBanner
            coverage={coverage}
            loading={loadingCoverage}
            serviceCovered={copayPreview ? copayPreview.covered : null}
          />
        )}

        {pickupCoords && (
          <View style={styles.summaryMap}>
            <MiniMap
              pickup={pickupCoords}
              dropoff={requiresDestination ? dropoffCoords : null}
              height={160}
            />
          </View>
        )}

        <Card variant="outlined" padding="m">
          <View style={styles.summaryContent}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Servicio:</Text>
              <View style={styles.summaryServiceRow}>
                {(() => {
                  const SvcIcon = SERVICE_ICONS[serviceType] || Truck;
                  return <SvcIcon size={16} color={serviceColor} strokeWidth={2} />;
                })()}
                <Text style={styles.summaryValue}>{serviceName}</Text>
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
                <Text style={styles.summaryLabel}>Tipo de Grúa:</Text>
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
                <Text style={styles.summaryValue}>{hasSpare ? 'Sí' : 'No (+$' + (currentPricingType?.extra_fee?.toFixed(2) || '15.00') + ')'}</Text>
              </View>
            )}
            {serviceType === 'fuel' && (
              <>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Combustible:</Text>
                  <Text style={styles.summaryValue}>{fuelType === 'regular' ? 'Regular' : fuelType === 'premium' ? 'Premium' : 'Diésel'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Galones:</Text>
                  <Text style={styles.summaryValue}>{fuelGallons}</Text>
                </View>
              </>
            )}
            {/* `!!`: con && a secas, un string vacio se renderiza como nodo de texto
                suelto dentro del View y react-native-web tira un error de consola. */}
            {!!vehicleDescription && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Vehículo:</Text>
                <Text style={styles.summaryValue}>{vehicleDescription}</Text>
              </View>
            )}
          </View>
        </Card>

        <Text style={styles.editHint}>
          ¿Necesitas cambiar algo? Toca un paso arriba para editarlo.
        </Text>

        <View style={styles.priceCard}>
          <Text style={styles.priceLabelText}>Precio Estimado</Text>

          {pricedByDistance ? (
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
                {/* Comparar contra null y no con &&: una distancia de 0 pintaria
                    un "0" suelto en vez de la fila, y ocultarla con !! perderia
                    un valor legitimo. */}
                {calculatedDistance != null && (
                  <>
                    <Text style={styles.priceNote}>
                      Distancia: {distanceText || `${calculatedDistance.toFixed(1)} km`}
                    </Text>
                    {calculatedDuration != null && (
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
            )
          ) : (
            // Non-tow: flat fee
            <Text style={styles.priceValue}>
              {displayPrice ? `$${displayPrice.toFixed(2)}` : '--'}
            </Text>
          )}

          <Text style={styles.priceDisclaimer}>
            {moptApplies
              ? 'Lo paga el MOPT. Tú no pagas nada.'
              : pricedByDistance
                ? 'El precio final puede variar según la distancia real recorrida.'
                : serviceType === 'water_truck'
                  ? `Precio por viaje más $${(currentPricingType?.extra_fee ?? 0).toFixed(2)} por km que recorre el socio hasta ti.`
                  : 'Precio fijo por el servicio.'}
          </Text>
        </View>

        {/* B-13: cuanto cubre el seguro y cuanto queda de copago, antes de confirmar.
            Se muestra tambien cuando el afiliado esta cubierto pero ESTE servicio
            esta excluido del plan (copayPreview.covered === false): ahi el desglose
            aclara que paga todo, en vez de dejar solo el banner "cubierto". */}
        {/* Si lo paga el MOPT no hay copago que mostrar: el desglose diria "pagas". */}
        {!moptApplies && coverage?.status === 'covered' && copayPreview && (
          <CopayBreakdown preview={copayPreview} isEstimate={pricedByDistance} />
        )}

        <View style={styles.navButtons}>
          <View style={styles.navBack}>
            <Button title="Atrás" onPress={() => setStep(4)} variant="secondary" size="medium" />
          </View>
          <View style={styles.navNext}>
            <Button
              title="Confirmar Solicitud"
              onPress={handleSubmit}
              size="medium"
              loading={submitting}
              disabled={submitting || (pricedByDistance && (distanceLoading || !calculatedDistance))}
            />
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      {/* Barra superior: cerrar + título */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.s }]}>
        <Pressable
          onPress={handleClose}
          hitSlop={10}
          style={styles.topBarBtn}
          accessibilityRole="button"
          accessibilityLabel="Cerrar solicitud"
        >
          <X size={22} color={colors.text.primary} strokeWidth={2} />
        </Pressable>
        <Text style={styles.topBarTitle}>Solicitar servicio</Text>
        <View style={styles.topBarBtn} />
      </View>

      {/* Indicador de progreso con etiquetas (tocable para volver a un paso) */}
      <View style={styles.stepper}>
        {STEP_META.map((s) => {
          const active = s.n === step;
          const done = s.n < step;
          return (
            <Pressable
              key={s.n}
              style={styles.stepItem}
              onPress={() => goToStep(s.n)}
              disabled={s.n > step}
              accessibilityRole="button"
              accessibilityLabel={`Paso ${s.n} de 5: ${s.label}`}
              accessibilityState={{ selected: active, disabled: s.n > step }}
            >
              <View style={[styles.stepCircle, active && styles.stepCircleActive, done && styles.stepCircleDone]}>
                {done ? (
                  <Check size={14} color={colors.white} strokeWidth={3} />
                ) : (
                  <Text style={[styles.stepNum, active && styles.stepNumActive]}>{s.n}</Text>
                )}
              </View>
              <Text style={[styles.stepLabel, (active || done) && styles.stepLabelActive]} numberOfLines={1}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
      </ScrollView>

      {/* Modal de éxito: PIN grande, copiable y con recordatorio de dónde verlo */}
      <Modal visible={!!successPin} transparent animationType="fade" onRequestClose={handleSuccessClose}>
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <View style={styles.successIconWrap}>
              <CheckCircle2 size={40} color={colors.success.main} strokeWidth={2} />
            </View>
            <Text style={styles.successTitle}>¡Solicitud enviada!</Text>
            <Text style={styles.successSubtitle}>Tu PIN de confirmación es:</Text>
            <Text style={styles.successPin}>{successPin}</Text>

            <Pressable
              style={styles.copyBtn}
              onPress={() => successPin && copyPin(successPin)}
              accessibilityRole="button"
              accessibilityLabel="Copiar PIN"
            >
              {pinCopied ? (
                <CheckCircle2 size={16} color={colors.success.main} strokeWidth={2} />
              ) : (
                <Copy size={16} color={colors.primary[600]} strokeWidth={2} />
              )}
              <Text style={[styles.copyBtnText, pinCopied && { color: colors.success.main }]}>
                {pinCopied ? '¡Copiado!' : 'Copiar PIN'}
              </Text>
            </Pressable>

            <Text style={styles.successHint}>
              Muéstrale este PIN al socio operador cuando llegue para iniciar el servicio.
              Siempre estará disponible en tu pantalla de inicio.
            </Text>

            {/* B-11: el veredicto del servidor. Se muestra SIEMPRE, tambien cuando
                la verificacion fallo — que la solicitud se haya creado no puede
                dejar a la persona creyendo que su seguro la cubre. */}
            {finalMopt ? (
              <View style={styles.successCoverage}>
                <MoptProgramBanner programName={finalMopt.program_name} estimatedPrice={previewTotal} />
              </View>
            ) : finalCoverage ? (
              <View style={styles.successCoverage}>
                <CoverageBanner
                  coverage={finalCoverage}
                  serviceCovered={copayPreview ? copayPreview.covered : null}
                />
              </View>
            ) : null}

            <View style={styles.successButton}>
              <Button title="Ver estado del servicio" onPress={handleSuccessClose} size="medium" />
            </View>
          </View>
          {/* Los toasts (p. ej. "no se pudo subir la foto") se pintan sobre el Modal. */}
          <ToastHost />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  successCoverage: {
    alignSelf: 'stretch',
    marginTop: spacing.m,
    marginBottom: -spacing.s,
  },

  // Layout
  screen: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  content: {
    padding: spacing.l,
    paddingBottom: spacing.xxxxl,
  },

  // Barra superior
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
  },
  topBarBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },

  // Stepper con etiquetas
  stepper: {
    flexDirection: 'row',
    paddingHorizontal: spacing.m,
    paddingBottom: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  stepItem: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.micro,
  },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.tertiary,
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  stepCircleActive: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[500],
  },
  stepCircleDone: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[500],
  },
  stepNum: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.tertiary,
  },
  stepNumActive: {
    color: colors.primary[600],
  },
  stepLabel: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.micro,
    color: colors.text.tertiary,
  },
  stepLabelActive: {
    color: colors.text.primary,
    fontFamily: typography.fonts.bodyMedium,
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

  // Vehicle quick-pick chips
  vehicleChips: {
    marginBottom: spacing.s,
    gap: spacing.xs,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.m,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border.medium,
    backgroundColor: colors.background.primary,
  },
  chipSelected: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  chipText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
  },
  chipTextSelected: {
    color: colors.primary[600],
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
  sinCostoBadge: {
    marginTop: spacing.micro,
    alignSelf: 'center',
    paddingHorizontal: spacing.s,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.success.light,
  },
  sinCostoText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.caption,
    color: colors.success.dark,
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
  summaryMap: {
    borderRadius: radii.l,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  summaryContent: {
    gap: spacing.s,
  },
  editHint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.tertiary,
    textAlign: 'center',
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

  // Success modal (PIN)
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.l,
  },
  successCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.background.primary,
    borderRadius: radii.l,
    padding: spacing.xl,
    alignItems: 'center',
  },
  successIconWrap: {
    marginBottom: spacing.s,
  },
  successTitle: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h2,
    color: colors.text.primary,
    textAlign: 'center',
  },
  successSubtitle: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.s,
  },
  successPin: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.hero,
    color: colors.accent[600],
    letterSpacing: 8,
    marginTop: spacing.xs,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.m,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border.medium,
    marginTop: spacing.m,
  },
  copyBtnText: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    color: colors.primary[600],
  },
  successHint: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.m,
    lineHeight: 20,
  },
  successButton: {
    width: '100%',
    marginTop: spacing.l,
  },
});
