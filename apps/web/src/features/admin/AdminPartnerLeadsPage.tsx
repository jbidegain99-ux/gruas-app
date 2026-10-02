'use client';

import { useEffect, useState } from 'react';
import { Mail, MessageCircle, UserPlus } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { formatDate } from '@/shared/lib/format';
import { PARTNER_SERVICES, PARTNER_VEHICLE_TYPES } from '@/features/partners/partner-options';
import { formatPhone } from '@gruas-app/shared';

// Interesados en ser socios (backlog AGT-01, migr. 00114): lo que entra por
// el pre-registro de /socios. La bienvenida queda lista en la bandeja; sin un
// proveedor de mensajería conectado, se envía con un clic (WhatsApp o correo)
// y se marca como enviada. Cuando la persona crea su cuenta de socio, el lead
// pasa solo a "registrado".

type Message = { id: string; channel: 'whatsapp' | 'email'; to: string; body: string; status: 'pending' | 'sent' | 'cancelled'; sent_at: string | null };
type Lead = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  service_types: string[];
  zone: string | null;
  vehicle_type: string | null;
  status: 'new' | 'contacted' | 'registered' | 'discarded';
  notes: string | null;
  profile_id: string | null;
  created_at: string;
  messages: Message[];
};

const STATUS_LABEL: Record<Lead['status'], string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  registered: 'Ya se registró',
  discarded: 'Descartado',
};
const STATUS_STYLE: Record<Lead['status'], string> = {
  new: 'bg-budi-primary-50 text-budi-primary-700 dark:bg-budi-primary-900/40 dark:text-budi-primary-300',
  contacted: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  registered: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  discarded: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

const svc = (s: string) => PARTNER_SERVICES.find((x) => x.value === s)?.label ?? s;
const veh = (v: string | null) => PARTNER_VEHICLE_TYPES.find((x) => x.value === v)?.label ?? v ?? '—';

export default function AdminPartnerLeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [filter, setFilter] = useState<'all' | Lead['status']>('new');
  const [refreshKey, setRefreshKey] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await createClient().rpc('admin_list_partner_leads', {});
      if (!alive) return;
      if (error) toast.error(error.message);
      setLeads((data as unknown as Lead[]) ?? []);
    };
    load();
    return () => {
      alive = false;
    };
  }, [refreshKey, toast]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const send = async (m: Message) => {
    const url =
      m.channel === 'whatsapp'
        ? `https://wa.me/${m.to.replace(/\D/g, '')}?text=${encodeURIComponent(m.body)}`
        : `mailto:${m.to}?subject=${encodeURIComponent('Bienvenido a Budi')}&body=${encodeURIComponent(m.body)}`;
    window.open(url, '_blank', 'noopener');
    const { error } = await createClient().rpc('admin_mark_message_sent', { p_id: m.id });
    if (error) return toast.error(error.message);
    toast.success('Bienvenida marcada como enviada.');
    refresh();
  };

  const setStatus = async (l: Lead, status: Lead['status']) => {
    const { error } = await createClient().rpc('admin_update_partner_lead', { p_id: l.id, p_status: status });
    if (error) return toast.error(error.message);
    refresh();
  };

  const shown = (leads ?? []).filter((l) => filter === 'all' || l.status === filter);
  const count = (s: Lead['status']) => (leads ?? []).filter((l) => l.status === s).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Socios interesados</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Pre-registros de la página <a href="/socios" target="_blank" className="underline">/socios</a>. Envía la bienvenida y
          acompáñalos hasta que completen su registro.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {(['new', 'contacted', 'registered', 'discarded', 'all'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              filter === k ? 'bg-budi-primary-500 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {k === 'all' ? 'Todos' : `${STATUS_LABEL[k]}${count(k) ? ` (${count(k)})` : ''}`}
          </button>
        ))}
      </div>

      {leads === null ? (
        <p className="text-sm text-zinc-500">Cargando…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          <UserPlus className="mx-auto mb-2 h-6 w-6 text-zinc-400" /> No hay interesados en este filtro.
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((l) => (
            <li key={l.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-white">
                    {l.full_name}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                  </p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {formatPhone(l.phone)}{l.email ? ` · ${l.email}` : ''} · {l.zone ?? 'Sin zona'} · {veh(l.vehicle_type)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {l.service_types.map(svc).join(', ')} · llegó el {formatDate(l.created_at)}
                  </p>
                </div>
                <select
                  value={l.status}
                  onChange={(e) => setStatus(l, e.target.value as Lead['status'])}
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  aria-label={`Estado de ${l.full_name}`}
                >
                  {(Object.keys(STATUS_LABEL) as Lead['status'][]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </div>
              {l.messages.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {l.messages.map((m) =>
                    m.status === 'pending' ? (
                      <button
                        key={m.id}
                        onClick={() => send(m)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                      >
                        {m.channel === 'whatsapp' ? <MessageCircle className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                        Enviar bienvenida por {m.channel === 'whatsapp' ? 'WhatsApp' : 'correo'}
                      </button>
                    ) : (
                      <span key={m.id} className="inline-flex items-center gap-1 text-xs text-zinc-500">
                        {m.channel === 'whatsapp' ? <MessageCircle className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                        Bienvenida enviada {m.sent_at ? formatDate(m.sent_at) : ''}
                      </span>
                    )
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
