import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Car, Trash2, Star, Plus } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { vehicleLabel, type Vehicle } from '@/lib/vehicles';
import { Button, Card, Input, LoadingSpinner, ErrorState, toast } from '@/shared/components/ui';
import { colors, typography, spacing, radii } from '@/theme';

export default function Vehicles() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [color, setColor] = useState('');
  // id del vehículo con una mutación en curso (default/eliminar), para
  // deshabilitar sus botones y evitar taps concurrentes.
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const fetchVehicles = useCallback(async () => {
    setLoadError(false);
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, make, model, plate, color, is_default')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching vehicles:', error);
      setLoadError(true);
      setLoading(false);
      return;
    }
    setVehicles(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  const resetForm = () => {
    setMake(''); setModel(''); setPlate(''); setColor(''); setShowForm(false);
  };

  const addVehicle = async () => {
    if (!make.trim() && !model.trim() && !plate.trim()) {
      toast.error('Ingresa al menos la marca, el modelo o la placa.', 'Datos incompletos');
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const { error } = await supabase.from('vehicles').insert({
      user_id: user.id,
      make: make.trim() || null,
      model: model.trim() || null,
      plate: plate.trim() || null,
      color: color.trim() || null,
      is_default: vehicles.length === 0, // el primero queda por defecto
    });
    setSaving(false);
    if (error) {
      toast.error('No se pudo guardar el vehículo.');
      return;
    }
    resetForm();
    fetchVehicles();
  };

  const makeDefault = async (id: string) => {
    if (mutatingId) return; // ya hay una mutación en curso: ignora el doble-tap
    setMutatingId(id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Quitar default a todos y ponerlo solo a este.
      const { error: unsetErr } = await supabase.from('vehicles').update({ is_default: false }).eq('user_id', user.id);
      const { error: setErr } = await supabase.from('vehicles').update({ is_default: true }).eq('id', id);
      if (unsetErr || setErr) {
        toast.error('No se pudo cambiar el vehículo predeterminado.');
      }
      await fetchVehicles();
    } finally {
      setMutatingId(null);
    }
  };

  const deleteVehicle = (id: string) => {
    Alert.alert('Eliminar vehículo', '¿Seguro que deseas eliminarlo?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (mutatingId) return;
          setMutatingId(id);
          try {
            const { error } = await supabase.from('vehicles').delete().eq('id', id);
            if (error) {
              toast.error('No se pudo eliminar el vehículo.');
            }
            await fetchVehicles();
          } finally {
            setMutatingId(null);
          }
        },
      },
    ]);
  };

  if (loading) return <LoadingSpinner fullScreen />;

  if (loadError) {
    return (
      <ErrorState
        fullScreen
        offline
        title="No pudimos cargar tus vehículos"
        message="Revisa tu conexión a internet e intenta de nuevo."
        onRetry={fetchVehicles}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.m }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ChevronLeft size={24} color={colors.text.primary} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Mis Vehículos</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {vehicles.length === 0 && !showForm && (
          <View style={styles.empty}>
            <Car size={48} color={colors.text.tertiary} strokeWidth={1.5} />
            <Text style={styles.emptyText}>Aún no tienes vehículos guardados.</Text>
          </View>
        )}

        {vehicles.map((v) => (
          <Card key={v.id} variant="default" padding="m">
            <View style={styles.vehicleRow}>
              <Car size={20} color={colors.primary[500]} strokeWidth={2} />
              <View style={styles.vehicleInfo}>
                <Text style={styles.vehicleName}>{vehicleLabel(v)}</Text>
                {v.is_default && <Text style={styles.defaultTag}>Predeterminado</Text>}
              </View>
              {!v.is_default && (
                <Pressable
                  onPress={() => makeDefault(v.id)}
                  hitSlop={8}
                  style={styles.iconBtn}
                  disabled={mutatingId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Marcar ${vehicleLabel(v)} como predeterminado`}
                >
                  <Star size={18} color={colors.accent[500]} strokeWidth={2} />
                </Pressable>
              )}
              <Pressable
                onPress={() => deleteVehicle(v.id)}
                hitSlop={8}
                style={styles.iconBtn}
                disabled={mutatingId !== null}
                accessibilityRole="button"
                accessibilityLabel={`Eliminar ${vehicleLabel(v)}`}
              >
                <Trash2 size={18} color={colors.error.main} strokeWidth={2} />
              </Pressable>
            </View>
          </Card>
        ))}

        {showForm ? (
          <Card variant="elevated" padding="l">
            <Text style={styles.formTitle}>Nuevo vehículo</Text>
            <View style={styles.formFields}>
              <Input label="Marca" placeholder="Toyota" value={make} onChangeText={setMake} />
              <Input label="Modelo" placeholder="Corolla" value={model} onChangeText={setModel} />
              <Input label="Placa" placeholder="P123-456" value={plate} onChangeText={setPlate} autoCapitalize="characters" />
              <Input label="Color" placeholder="Blanco" value={color} onChangeText={setColor} />
            </View>
            <View style={styles.formButtons}>
              <View style={styles.formBtnHalf}>
                <Button title="Cancelar" variant="secondary" size="medium" onPress={resetForm} disabled={saving} />
              </View>
              <View style={styles.formBtnHalf}>
                <Button title={saving ? 'Guardando...' : 'Guardar'} size="medium" onPress={addVehicle} loading={saving} disabled={saving} />
              </View>
            </View>
          </Card>
        ) : (
          <Button
            title="Agregar vehículo"
            onPress={() => setShowForm(true)}
            variant="secondary"
            size="large"
            icon={<Plus size={18} color={colors.primary[500]} strokeWidth={2} />}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.secondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.m,
    backgroundColor: colors.background.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  backBtn: { width: 32, alignItems: 'flex-start' },
  title: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h3,
    color: colors.text.primary,
  },
  content: { padding: spacing.l, gap: spacing.m },
  empty: { alignItems: 'center', gap: spacing.s, paddingVertical: spacing.xxl },
  emptyText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  vehicleInfo: { flex: 1 },
  vehicleName: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
  },
  defaultTag: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.caption,
    color: colors.accent[600],
    marginTop: 2,
  },
  iconBtn: { padding: spacing.xs },
  formTitle: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
    marginBottom: spacing.m,
  },
  formFields: { gap: spacing.m, marginBottom: spacing.m },
  formButtons: { flexDirection: 'row', gap: spacing.s },
  formBtnHalf: { flex: 1 },
});
