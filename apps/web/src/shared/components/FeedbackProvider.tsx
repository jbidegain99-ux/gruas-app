'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Feedback (toasts + confirmación) para el panel de administración.
//
// Reemplaza los `alert()` / `confirm()` nativos del navegador (sin estilo, sin
// acentos, inconsistentes) por toasts estilizados y un diálogo de confirmación
// que devuelve una promesa. Un solo provider expone `useToast()` y `useConfirm()`.
// ─────────────────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'info';

type Toast = {
  id: number;
  type: ToastType;
  message: string;
};

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Estilo de acción destructiva (rojo). */
  destructive?: boolean;
};

type ConfirmState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

const ToastContext = createContext<ToastApi | null>(null);
const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <FeedbackProvider>');
  return ctx;
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <FeedbackProvider>');
  return ctx;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, type, message }]);
      // Auto-descarta; los errores se quedan un poco más.
      const ttl = type === 'error' ? 6000 : 4000;
      setTimeout(() => dismiss(id), ttl);
    },
    [dismiss]
  );

  const toast = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push]
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ ...options, resolve });
      }),
    []
  );

  const closeConfirm = useCallback(
    (value: boolean) => {
      setConfirmState((current) => {
        current?.resolve(value);
        return null;
      });
    },
    []
  );

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}

        {/* Toasts */}
        <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg ${toastStyles[t.type]}`}
            >
              <span className="mt-0.5 shrink-0">{toastIcons[t.type]}</span>
              <p className="flex-1 text-sm font-medium">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Cerrar"
                className="shrink-0 text-current opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Diálogo de confirmación */}
        {confirmState && (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
            onClick={() => closeConfirm(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
                {confirmState.title}
              </h2>
              {confirmState.message && (
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {confirmState.message}
                </p>
              )}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => closeConfirm(false)}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {confirmState.cancelLabel || 'Cancelar'}
                </button>
                <button
                  type="button"
                  onClick={() => closeConfirm(true)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
                    confirmState.destructive
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-budi-primary-500 hover:bg-budi-primary-600'
                  }`}
                >
                  {confirmState.confirmLabel || 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

const toastStyles: Record<ToastType, string> = {
  success:
    'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200',
  error:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
  info:
    'border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100',
};

const toastIcons: Record<ToastType, string> = {
  success: '✓',
  error: '⚠',
  info: 'ℹ',
};
