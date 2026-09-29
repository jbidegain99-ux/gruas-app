'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { safeNext } from './org-links';

// 2FA del portal (migr. 00113, backlog POR-02). El dueño y los administradores
// de una organización necesitan una sesión verificada con una app
// autenticadora (TOTP) para ver los datos: la base se los niega sin ella.
//   * Sin factor todavía: se vincula la app escaneando el QR.
//   * Con factor: se pide el código de 6 dígitos de esta sesión.

type Stage =
  | { kind: 'loading' }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string }
  | { kind: 'verify'; factorId: string }
  | { kind: 'error'; message: string };

const inputClass =
  'mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-center font-mono text-2xl tracking-[0.4em] text-zinc-900 focus:border-budi-primary-500 focus:outline-none focus:ring-1 focus:ring-budi-primary-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

function SecurityForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'), '/');
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Una sola vez: en desarrollo React monta dos veces y dos inscripciones en
  // paralelo chocaban (mismo nombre de factor) y dejaban la pantalla en error.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const supabase = createClient();
    const start = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace(`/login?redirect=${encodeURIComponent(`/seguridad?next=${next}`)}`);
        return;
      }
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        setStage({ kind: 'error', message: listError.message });
        return;
      }
      const verified = data.totp.find((f) => f.status === 'verified');
      if (verified) {
        setStage({ kind: 'verify', factorId: verified.id });
        return;
      }
      // Restos de un intento anterior sin terminar: se descartan para empezar limpio.
      for (const f of data.all.filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Budi ${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`,
      });
      if (enrollError || !enrolled) {
        setStage({ kind: 'error', message: enrollError?.message ?? 'No se pudo iniciar la vinculación' });
        return;
      }
      setStage({ kind: 'enroll', factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    };
    start();
  }, [next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stage.kind !== 'enroll' && stage.kind !== 'verify') return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
      factorId: stage.factorId,
      code: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      setError('Código incorrecto o vencido. Revisa la hora de tu teléfono e intenta con el código nuevo.');
      setCode('');
      return;
    }
    router.replace(next);
    router.refresh();
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-6 text-center">
        <Link href="/" className="inline-flex items-center gap-2">
          <BudiLogo />
          <span className="font-heading text-xl font-bold text-zinc-900 dark:text-white">Budi</span>
        </Link>
        <div className="mx-auto mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-budi-primary-50 dark:bg-budi-primary-900/40">
          <ShieldCheck className="h-6 w-6 text-budi-primary-600 dark:text-budi-primary-300" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-zinc-900 dark:text-white">Verificación en dos pasos</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {stage.kind === 'enroll'
            ? 'Como administras el portal de tu organización, protegemos tu cuenta con una app autenticadora (Google Authenticator, Microsoft Authenticator, 1Password…).'
            : 'Ingresa el código de 6 dígitos de tu app autenticadora.'}
        </p>
      </div>

      {stage.kind === 'loading' && (
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-budi-primary-500 border-t-transparent" />
        </div>
      )}

      {stage.kind === 'error' && (
        <p className="rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{stage.message}</p>
      )}

      {stage.kind === 'enroll' && (
        <div className="mb-6 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
          <p><strong>1.</strong> Escanea este código con tu app autenticadora:</p>
          <div className="flex justify-center rounded-lg bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URI SVG generado por Supabase */}
            <img src={stage.qr} alt="Código QR para vincular tu app autenticadora" className="h-44 w-44" />
          </div>
          <p className="text-xs text-zinc-500">
            ¿No puedes escanear? Escribe esta clave en la app:{' '}
            <code className="select-all break-all rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">{stage.secret}</code>
          </p>
          <p><strong>2.</strong> Ingresa el código de 6 dígitos que te muestra:</p>
        </div>
      )}

      {(stage.kind === 'enroll' || stage.kind === 'verify') && (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{error}</div>}
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Código
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder="000000"
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full rounded-lg bg-budi-primary-500 px-4 py-2 font-medium text-white hover:bg-budi-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Verificando…' : stage.kind === 'enroll' ? 'Activar y continuar' : 'Verificar y continuar'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function SecurityPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <Suspense fallback={null}>
          <SecurityForm />
        </Suspense>
      </div>
    </div>
  );
}
