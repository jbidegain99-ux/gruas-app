'use client';

import { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { formatDateTime } from '@/shared/lib/format';

// Capacitación del socio en la app (migr. 00137, AGT-05): guía vista y
// servicio de práctica terminado.
type Training = { guide_seen_at: string | null; practice_done_at: string | null };

export function PartnerTrainingStatus({ operatorId }: { operatorId: string }) {
  const [t, setT] = useState<Training | null>(null);

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('admin_partner_training', { p_operator: operatorId })
      .then(({ data }) => alive && setT((data as unknown as Training) ?? null));
    return () => {
      alive = false;
    };
  }, [operatorId]);

  if (!t) return null;
  const line = (label: string, at: string | null) => (
    <li className={at ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-500'}>
      {at ? '✓' : '•'} {label}
      {at ? ` · ${formatDateTime(at)}` : ': pendiente'}
    </li>
  );

  return (
    <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
      <p className="mb-1 flex items-center gap-2 font-medium text-zinc-900 dark:text-white">
        <GraduationCap className="h-4 w-4" /> Capacitación en la app
      </p>
      <ul className="space-y-0.5 text-xs">
        {line('Vio la guía del socio', t.guide_seen_at)}
        {line('Terminó el servicio de práctica', t.practice_done_at)}
      </ul>
    </div>
  );
}
