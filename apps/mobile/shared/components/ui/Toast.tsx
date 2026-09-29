import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react-native';
import { colors, typography, spacing, radii, shadows, durations } from '@/theme';

/**
 * Toast / Banner del Design System.
 *
 * Para mensajes INFORMATIVOS (éxito, error, aviso sin decisión). Las
 * confirmaciones con botones de decisión siguen usando el Alert nativo.
 *
 * - <ToastProvider> se monta una sola vez en app/_layout.tsx, por encima del
 *   <Stack>: el mensaje sigue visible aunque la pantalla navegue justo después.
 * - Un <Modal> nativo se pinta por encima de todo. Para que el toast se vea
 *   mientras un Modal está abierto, pon un <ToastHost /> dentro del Modal: el
 *   host montado más recientemente es el que pinta los toasts.
 *
 * Uso en componentes:   const toast = useToast(); toast.success('Guardado');
 * Uso fuera de React:   import { toast } from '@/shared/components/ui'; toast.error('…');
 */

export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  type?: ToastType;
  /** Título corto opcional (en negrita). */
  title?: string;
  /** Texto principal. */
  message: string;
  /** Milisegundos visible. Por defecto depende del largo del texto. */
  duration?: number;
}

interface ToastItem {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Store a nivel de módulo (permite llamar a `toast.*` desde libs y hooks).
// ---------------------------------------------------------------------------

interface ToastState {
  items: ToastItem[];
  hosts: number[];
}

const MAX_VISIBLE = 3;
let state: ToastState = { items: [], hosts: [] };
const subscribers = new Set<() => void>();
let nextId = 1;
let nextHostId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function setState(next: ToastState) {
  state = next;
  subscribers.forEach((s) => s());
}

function subscribe(cb: () => void) {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot() {
  return state;
}

function dismiss(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  if (state.items.some((i) => i.id === id)) {
    setState({ ...state, items: state.items.filter((i) => i.id !== id) });
  }
}

function defaultDuration(type: ToastType, text: string): number {
  // ~60 ms por carácter, entre 3.5 s y 8 s; los errores duran un poco más.
  const base = Math.min(8000, Math.max(3500, text.length * 60));
  return type === 'error' ? base + 1000 : base;
}

function emit(options: ToastOptions) {
  const type = options.type ?? 'info';
  const item: ToastItem = { id: nextId++, type, title: options.title, message: options.message };

  // Evitar duplicados idénticos seguidos (p. ej. doble toque): se reemplaza.
  const dup = state.items.find(
    (p) => p.type === item.type && p.message === item.message && p.title === item.title,
  );
  if (dup) dismiss(dup.id);

  const items = [...state.items, item];
  // Si se pasa del máximo, se descartan los más viejos.
  while (items.length > MAX_VISIBLE) {
    const old = items.shift();
    if (old) {
      const t = timers.get(old.id);
      if (t) clearTimeout(t);
      timers.delete(old.id);
    }
  }
  setState({ ...state, items });

  const duration =
    options.duration ?? defaultDuration(type, `${options.title ?? ''} ${options.message}`);
  timers.set(item.id, setTimeout(() => dismiss(item.id), duration));

  // En Android lo anuncia el accessibilityLiveRegion; en iOS/web hay que anunciarlo.
  if (Platform.OS !== 'android') {
    AccessibilityInfo.announceForAccessibility(
      item.title ? `${item.title}. ${item.message}` : item.message,
    );
  }
}

/** API imperativa (sirve también fuera de componentes: libs, hooks, callbacks). */
export const toast = {
  show: (options: ToastOptions) => emit(options),
  success: (message: string, title?: string) => emit({ type: 'success', message, title }),
  error: (message: string, title?: string) => emit({ type: 'error', message, title }),
  info: (message: string, title?: string) => emit({ type: 'info', message, title }),
};

export type ToastApi = typeof toast;

const ToastContext = createContext<ToastApi>(toast);

/** Hook para mostrar toasts desde un componente. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------------------
// Provider + Host
// ---------------------------------------------------------------------------

/** Se monta una vez en la raíz (app/_layout.tsx). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastHost />
    </ToastContext.Provider>
  );
}

/**
 * Superficie donde se pintan los toasts. El de la raíz lo pone ToastProvider;
 * agrega otro dentro de un <Modal> para que los toasts se vean sobre él.
 */
export function ToastHost() {
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) idRef.current = nextHostId++;
  const hostId = idRef.current;
  const insets = useSafeAreaInsets();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    setState({ ...state, hosts: [...state.hosts, hostId] });
    return () => {
      setState({ ...state, hosts: state.hosts.filter((h) => h !== hostId) });
    };
  }, [hostId]);

  const isTop = snapshot.hosts[snapshot.hosts.length - 1] === hostId;
  if (!isTop || snapshot.items.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + spacing.xs }]}>
      {snapshot.items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </View>
  );
}

const variants: Record<
  ToastType,
  { bg: string; border: string; icon: string; Icon: typeof Info; label: string }
> = {
  success: {
    bg: colors.success.light,
    border: colors.success.dark,
    icon: colors.success.dark,
    Icon: CheckCircle2,
    label: 'Éxito',
  },
  error: {
    bg: colors.error.light,
    border: colors.error.dark,
    icon: colors.error.dark,
    Icon: AlertCircle,
    label: 'Error',
  },
  info: {
    bg: colors.info.light,
    border: colors.primary[500],
    icon: colors.primary[500],
    Icon: Info,
    label: 'Aviso',
  },
};

function ToastCard({ item }: { item: ToastItem }) {
  const anim = useRef(new Animated.Value(0)).current;
  const v = variants[item.type];
  const Icon = v.Icon;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: durations.normal,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [anim]);

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: v.bg, borderLeftColor: v.border },
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) },
          ],
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion={item.type === 'error' ? 'assertive' : 'polite'}
      testID={`toast-${item.type}`}
    >
      <Icon size={22} color={v.icon} strokeWidth={2} />
      <View style={styles.texts}>
        {item.title ? <Text style={styles.title}>{item.title}</Text> : null}
        <Text style={styles.message}>{item.message}</Text>
      </View>
      <Pressable
        onPress={() => dismiss(item.id)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={`Cerrar aviso: ${v.label}`}
        style={styles.close}
      >
        <X size={18} color={colors.text.secondary} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: spacing.m,
    right: spacing.m,
    zIndex: 1000,
    elevation: 1000,
    gap: spacing.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    borderRadius: radii.m,
    borderLeftWidth: 4,
    ...shadows.medium,
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: typography.fonts.bodySemiBold,
    fontSize: typography.sizes.bodySmall,
    lineHeight: typography.lineHeights.bodySmall,
    color: colors.text.primary,
  },
  message: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    lineHeight: typography.lineHeights.bodySmall,
    color: colors.text.primary,
  },
  close: {
    paddingTop: 2,
  },
});
