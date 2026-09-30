'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { svToday } from '@/shared/components/LedgerPaymentModals';
import { StatementList } from './StatementList';
import { monthRange } from './statement-types';
import { useInsurersEnabled } from '@/shared/lib/use-platform-features';

// Estados de cuenta del lado de Budi (migr. 00123): generar el borrador de un
// mes para el MOPT o una aseguradora, emitirlo, responder observaciones y
// registrar el pago. Solo ADMIN: es dinero.

type Org = { id: string; type: string; name: string; status: string };

function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export default function AdminStatementsPage() {
  const router = useRouter();
  const toast = useToast();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [org, setOrg] = useState('');
  const [month, setMonth] = useState(() => previousMonth(svToday()));
  const [busy, setBusy] = useState(false);
  // Aseguradoras en pausa (00153): solo se generan estados de cuenta del MOPT.
  const insurers = useInsurersEnabled();

  useEffect(() => {
    createClient()
      .rpc('admin_list_organizations')
      .then(({ data }) => {
        const list = ((data as Org[]) ?? []).filter(
          (o) => (o.type === 'MOPT' || (insurers && o.type === 'INSURER')) && o.status === 'active',
        );
        setOrgs(list);
        setOrg(list[0]?.id ?? '');
      });
  }, [insurers]);

  const generate = async () => {
    const { from, to } = monthRange(month);
    setBusy(true);
    const { data, error } = await createClient().rpc('admin_generate_statement', { p_org: org, p_from: from, p_to: to });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Borrador listo. Revísalo y emítelo.');
    router.push(`/admin/estados-de-cuenta/${data}`);
  };

  const input = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Estados de cuenta</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          El cierre de cada mes para el MOPT{insurers ? ' y las aseguradoras' : ''}. Al emitirlo, el cliente lo ve en su portal y los montos quedan
          congelados; ahí puede observar casos y aprobarlo.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="flex flex-col text-xs text-zinc-500">
          Cliente
          <select value={org} onChange={(e) => setOrg(e.target.value)} className={input}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.type === 'MOPT' ? 'MOPT' : 'Aseguradora'})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-zinc-500">
          Mes
          <input type="month" value={month} max={svToday().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className={input} />
        </label>
        <button
          onClick={generate}
          disabled={!org || busy}
          className="rounded-lg bg-budi-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-budi-primary-700 disabled:opacity-50"
        >
          {busy ? 'Generando…' : 'Generar borrador'}
        </button>
        <p className="w-full text-xs text-zinc-500">
          Toma los servicios completados en ese mes (hora de El Salvador) que no estén en otro estado de cuenta. Si ya hay un
          borrador del mismo mes, lo recalcula.
        </p>
      </div>

      <StatementList basePath="/admin/estados-de-cuenta" showOrg />
    </div>
  );
}
