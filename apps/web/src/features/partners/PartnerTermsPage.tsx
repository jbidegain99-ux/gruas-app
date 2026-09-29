import Link from 'next/link';
import type { Metadata } from 'next';
import { createClient } from '@/shared/lib/supabase/server';
import { BudiLogo } from '@/shared/components/BudiLogo';
import { formatDate } from '@/shared/lib/format';

// Contrato para socios, público (migr. 00126, AGT-04): se puede leer antes de
// registrarse. La aceptación se hace dentro del registro, con sesión.

export const metadata: Metadata = {
  title: 'Contrato para socios operadores',
  description: 'Términos y condiciones para prestar servicios de asistencia vial con Budi.',
};

type Terms = { version: string; title: string; body: string; published_at: string };

export default async function PartnerTermsPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc('current_terms', { p_kind: 'partner' });
  const terms = data as unknown as Terms | null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/socios" className="mb-8 inline-flex items-center gap-2">
        <BudiLogo />
        <span className="font-heading text-lg font-bold text-zinc-900 dark:text-white">Budi</span>
      </Link>
      {!terms ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">El contrato todavía no está publicado.</p>
      ) : (
        <article>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">{terms.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Versión {terms.version} · publicada el {formatDate(terms.published_at)}
          </p>
          <div className="mt-6 whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">{terms.body}</div>
          <Link
            href="/socios/registro"
            className="mt-8 inline-block rounded-lg bg-budi-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-budi-primary-700"
          >
            Quiero ser socio
          </Link>
        </article>
      )}
    </main>
  );
}
