'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Landmark, MapPin, Plus, Trash2 } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useConfirm, useToast } from '@/shared/components/FeedbackProvider';
import { parsePolygon, polygonToText } from './mopt-zones';
import { accountUrl } from './account-360';
import { OrgMembersPanel } from './OrgMembersPanel';
import { ContractEditor } from '@/features/contracts/ContractEditor';

// Programas MOPT (migr. 00098/00099): el MOPT presta asistencia sin costo para el
// usuario con su propia flota. Acá se da de alta el programa, se fija la tarifa
// que le cobra Budi y se dibujan las zonas donde atiende. Las cuentas del portal
// y los operadores se vinculan desde Usuarios.

type Program = {
  id: string;
  name: string;
  is_active: boolean;
  contact_email: string | null;
  contact_phone: string | null;
};

type Zone = {
  id: string;
  provider_id: string;
  name: string;
  polygon: [number, number][];
  service_types: string[] | null;
  is_active: boolean;
  // 00107 (VID-03): horario de elegibilidad. Sin horario = todo el día.
  hours_from: string | null;
  hours_to: string | null;
  active_days: number[] | null;
};

type Org = { id: string; provider_id: string; sla_assignment_minutes: number | null; sla_arrival_minutes: number | null };

const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** "todo el día, todos los días" · "06:00–22:00, L M X J V" */
function scheduleLabel(z: Pick<Zone, 'hours_from' | 'hours_to' | 'active_days'>): string {
  const hours = z.hours_from && z.hours_to ? `${z.hours_from.slice(0, 5)}–${z.hours_to.slice(0, 5)}` : 'todo el día';
  const days =
    z.active_days?.length && z.active_days.length < 7
      ? z.active_days.slice().sort().map((d) => DAY_LABELS[d - 1]).join(' ')
      : 'todos los días';
  return `${hours}, ${days}`;
}

type Person = { id: string; full_name: string | null; email: string | null; role: string; provider_id: string | null };
type Service = { slug: string; name_es: string };

const inputClass =
  'mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

export default function AdminMoptPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [fees, setFees] = useState<Record<string, number>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingZone, setEditingZone] = useState<{ programId: string; zone: Zone | null } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const toast = useToast();
  const confirm = useConfirm();

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const [p, z, f, pe, s, o] = await Promise.all([
        supabase.from('providers').select('id, name, is_active, contact_email, contact_phone').eq('is_mopt', true).order('created_at'),
        supabase.from('mopt_zones').select('id, provider_id, name, polygon, service_types, is_active, hours_from, hours_to, active_days').order('created_at'),
        // Desde la 00102 devuelve la tarifa de plataforma vigente de cada programa
        // MOPT (0% si nunca se fijo), no el default de las empresas.
        supabase.rpc('admin_list_provider_commissions'),
        supabase.from('profiles').select('id, full_name, email, role, provider_id').not('provider_id', 'is', null),
        supabase.from('services').select('slug, name_es').eq('is_active', true).order('sort_order'),
        // 00106: el acceso al portal es la membresía a la organización del programa.
        supabase.from('organizations').select('id, provider_id, sla_assignment_minutes, sla_arrival_minutes').eq('type', 'MOPT'),
      ]);
      setPrograms((p.data as Program[]) ?? []);
      setZones((z.data as unknown as Zone[]) ?? []);
      const map: Record<string, number> = {};
      for (const row of (f.data as { provider_id: string; commission_rate: number }[] | null) ?? []) {
        map[row.provider_id] = Number(row.commission_rate);
      }
      setFees(map);
      setPeople((pe.data as Person[]) ?? []);
      setServices((s.data as Service[]) ?? []);
      setOrgs((o.data as Org[]) ?? []);
      setLoading(false);
    };
    load();
  }, [refreshKey]);

  const saveFee = async (programId: string, value: string) => {
    const rate = Number(value);
    const { error } = await createClient().rpc('admin_set_mopt_fee', { p_provider_id: programId, p_rate: rate });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Tarifa de plataforma: ${rate}%.`);
    refetch();
  };

  const toggleProgram = async (program: Program) => {
    const { error } = await createClient().from('providers').update({ is_active: !program.is_active }).eq('id', program.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(program.is_active ? 'Programa desactivado: deja de cubrir servicios nuevos.' : 'Programa activado.');
    refetch();
  };

  const deleteZone = async (zone: Zone) => {
    const ok = await confirm({
      title: `¿Eliminar la zona ${zone.name}?`,
      message: 'Los servicios nuevos dentro de esta zona dejarán de cubrirse por el MOPT. Los ya creados no cambian.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await createClient().from('mopt_zones').delete().eq('id', zone.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Zona eliminada.');
    refetch();
  };

  const serviceLabel = (slug: string) => services.find((s) => s.slug === slug)?.name_es ?? slug;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Programas MOPT</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Asistencia vial sin costo para el usuario, atendida por la flota del MOPT. Un pedido lo cubre el MOPT cuando
            la recogida cae dentro de una zona del programa y el seguro del usuario no cubre ese servicio (o
            no tiene seguro).
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600"
        >
          <Plus className="h-4 w-4" /> Nuevo programa
        </button>
      </div>

      {creating && <CreateProgramModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refetch(); }} />}
      {editingZone && (
        <ZoneModal
          programId={editingZone.programId}
          zone={editingZone.zone}
          services={services}
          onClose={() => setEditingZone(null)}
          onSaved={() => {
            setEditingZone(null);
            refetch();
          }}
        />
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Cargando...</p>
      ) : programs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          <Landmark className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
          Todavía no hay programas MOPT.
        </div>
      ) : (
        programs.map((program) => {
          const programZones = zones.filter((z) => z.provider_id === program.id);
          const org = orgs.find((x) => x.provider_id === program.id);
          const operators = people.filter((p) => p.provider_id === program.id && p.role === 'OPERATOR');
          return (
            <section key={program.id} className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 p-5 dark:border-zinc-800">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                      <Link href={accountUrl('mopt', program.id)} className="hover:underline">
                        {program.name}
                      </Link>
                    </h2>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${program.is_active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                      {program.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    {operators.length}{' '}
                    {operators.length === 1 ? 'socio operador' : 'socios operadores'} ·{' '}
                    <Link href="/admin/users" className="text-budi-primary-600 hover:underline dark:text-budi-primary-400">vincular en Usuarios</Link>
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  {org && <SlaEditor key={`${org.id}:${org.sla_assignment_minutes}:${org.sla_arrival_minutes}`} org={org} onSaved={refetch} />}
                  <FeeEditor key={`${program.id}:${fees[program.id] ?? 0}`} initial={fees[program.id] ?? 0} onSave={(v) => saveFee(program.id, v)} />
                  <button onClick={() => toggleProgram(program)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    {program.is_active ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </div>

              <div className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Zonas de atención</h3>
                  <button
                    onClick={() => setEditingZone({ programId: program.id, zone: null })}
                    className="flex items-center gap-1 text-sm font-medium text-budi-primary-600 hover:text-budi-primary-700 dark:text-budi-primary-400"
                  >
                    <Plus className="h-4 w-4" /> Agregar zona
                  </button>
                </div>
                {programZones.length === 0 ? (
                  <p className="text-sm text-zinc-500">Sin zonas: el programa no cubre ningún pedido todavía.</p>
                ) : (
                  <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {programZones.map((z) => (
                      <li key={z.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="flex items-start gap-3">
                          <MapPin className={`mt-0.5 h-4 w-4 ${z.is_active ? 'text-budi-primary-500' : 'text-zinc-400'}`} />
                          <div>
                            <p className="text-sm font-medium text-zinc-900 dark:text-white">
                              {z.name}
                              {!z.is_active && <span className="ml-2 text-xs font-normal text-zinc-500">(inactiva)</span>}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {z.polygon.length} vértices ·{' '}
                              {z.service_types?.length ? z.service_types.map(serviceLabel).join(', ') : 'todos los servicios'} ·{' '}
                              {scheduleLabel(z)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setEditingZone({ programId: program.id, zone: z })} className="text-sm font-medium text-budi-primary-600 hover:text-budi-primary-700 dark:text-budi-primary-400">
                            Editar
                          </button>
                          <button onClick={() => deleteZone(z)} aria-label={`Eliminar zona ${z.name}`} className="text-red-600 hover:text-red-700 dark:text-red-400">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {org && (
                <div className="border-t border-zinc-200 p-5 dark:border-zinc-800">
                  {/* MOPT-05 (00124): contrato, tope mensual y consumo. */}
                  <div className="mb-6">
                    <ContractEditor organizationId={org.id} />
                  </div>
                  <OrgMembersPanel organizationId={org.id} title="Equipo del portal MOPT" />
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

// SLA pactado con el programa (00107): lo usa el tablero de cumplimiento del
// portal MOPT (MOPT-01). Vacío = los 10/45 min por defecto.
function SlaEditor({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const initialAssign = org.sla_assignment_minutes == null ? '' : String(org.sla_assignment_minutes);
  const initialArrive = org.sla_arrival_minutes == null ? '' : String(org.sla_arrival_minutes);
  const [assign, setAssign] = useState(initialAssign);
  const [arrive, setArrive] = useState(initialArrive);
  const toast = useToast();
  const dirty = assign !== initialAssign || arrive !== initialArrive;
  const save = async () => {
    const { error } = await createClient().rpc('admin_set_org_sla', {
      p_organization_id: org.id,
      p_assignment: assign ? Number(assign) : null,
      p_arrival: arrive ? Number(arrive) : null,
    } as unknown as { p_organization_id: string; p_assignment: number; p_arrival: number });
    if (error) return toast.error(error.message);
    toast.success('SLA pactado actualizado.');
    onSaved();
  };
  return (
    <div className="flex items-end gap-2">
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        SLA asignar (min)
        <input type="number" min={1} value={assign} placeholder="10" onChange={(e) => setAssign(e.target.value)} className={`${inputClass} w-24`} />
      </label>
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        SLA llegar (min)
        <input type="number" min={1} value={arrive} placeholder="45" onChange={(e) => setArrive(e.target.value)} className={`${inputClass} w-24`} />
      </label>
      <button
        disabled={!dirty}
        onClick={save}
        className="rounded-lg bg-budi-primary-500 px-3 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-40"
      >
        Guardar
      </button>
    </div>
  );
}

function FeeEditor({ initial, onSave }: { initial: number; onSave: (value: string) => void }) {
  const [value, setValue] = useState(String(initial));
  const dirty = Number(value) !== initial;
  return (
    <div className="flex items-end gap-2">
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Tarifa Budi (%)
        <input type="number" min={0} max={100} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} w-24`} />
      </label>
      <button
        disabled={!dirty}
        onClick={() => onSave(value)}
        className="rounded-lg bg-budi-primary-500 px-3 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-40"
      >
        Guardar
      </button>
    </div>
  );
}

function ModalFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function FormButtons({ saving, onClose, label }: { saving: boolean; onClose: () => void; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
        Cancelar
      </button>
      <button type="submit" disabled={saving} className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50">
        {saving ? 'Guardando...' : label}
      </button>
    </div>
  );
}

function CreateProgramModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: insError } = await createClient()
      .from('providers')
      .insert({
        name: name.trim(),
        contact_email: email.trim() || null,
        contact_phone: phone.trim() || null,
        business_type: 'roadside',
        is_mopt: true,
        is_active: true,
      });
    setSaving(false);
    if (insError) {
      setError(insError.message);
      return;
    }
    toast.success('Programa creado. Agrégale zonas para que empiece a cubrir pedidos.');
    onSaved();
  };

  return (
    <ModalFrame title="Nuevo programa MOPT">
      {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Nombre
          <input id="mopt-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: MOPT — Asistencia Vial" className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Email de contacto
            <input id="mopt-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Teléfono
            <input id="mopt-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </label>
        </div>
        <p className="text-xs text-zinc-500">La tarifa de plataforma arranca en 0%. Se cambia en la tarjeta del programa.</p>
        <FormButtons saving={saving} onClose={onClose} label="Crear programa" />
      </form>
    </ModalFrame>
  );
}

function ZoneModal({
  programId,
  zone,
  services,
  onClose,
  onSaved,
}: {
  programId: string;
  zone: Zone | null;
  services: Service[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(zone?.name ?? '');
  const [coords, setCoords] = useState(zone ? polygonToText(zone.polygon) : '');
  const [types, setTypes] = useState<string[]>(zone?.service_types ?? []);
  const [active, setActive] = useState(zone?.is_active ?? true);
  const [hoursFrom, setHoursFrom] = useState(zone?.hours_from?.slice(0, 5) ?? '');
  const [hoursTo, setHoursTo] = useState(zone?.hours_to?.slice(0, 5) ?? '');
  const [days, setDays] = useState<number[]>(zone?.active_days ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const toggleType = (slug: string) =>
    setTypes((prev) => (prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parsePolygon(coords);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (Boolean(hoursFrom) !== Boolean(hoursTo)) {
      setError('Indica la hora de inicio y la de fin, o deja las dos vacías para todo el día.');
      return;
    }
    setSaving(true);
    setError(null);
    const row = {
      provider_id: programId,
      name: name.trim(),
      polygon: parsed.polygon,
      // Ninguno marcado = todos los servicios.
      service_types: types.length ? types : null,
      is_active: active,
      hours_from: hoursFrom || null,
      hours_to: hoursTo || null,
      // Ningún día marcado = todos los días.
      active_days: days.length ? days.slice().sort() : null,
    };
    const supabase = createClient();
    const { error: saveError } = zone
      ? await supabase.from('mopt_zones').update(row).eq('id', zone.id)
      : await supabase.from('mopt_zones').insert(row);
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    toast.success(zone ? 'Zona actualizada.' : 'Zona creada.');
    onSaved();
  };

  return (
    <ModalFrame title={zone ? `Editar zona ${zone.name}` : 'Nueva zona'}>
      {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Nombre
          <input id="zone-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Carretera del Litoral, tramo La Libertad" className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Vértices del polígono
          <textarea
            id="zone-coords"
            required
            rows={6}
            value={coords}
            onChange={(e) => setCoords(e.target.value)}
            placeholder={'13.5200, -89.3800\n13.5200, -89.2800\n13.6000, -89.2800\n13.6000, -89.3800'}
            className={`${inputClass} font-mono`}
          />
          <span className="mt-1 block text-xs font-normal text-zinc-500">
            Un punto por línea: latitud, longitud. Mínimo 3 puntos, en orden alrededor de la zona.
          </span>
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Servicios que cubre</legend>
          <p className="text-xs text-zinc-500">Ninguno marcado = todos.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {services.map((s) => (
              <label key={s.slug} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={types.includes(s.slug)} onChange={() => toggleType(s.slug)} />
                {s.name_es}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Horario de atención</legend>
          <p className="text-xs text-zinc-500">Vacío = todo el día. Un rango como 22:00–06:00 cruza la medianoche.</p>
          <div className="mt-2 flex items-center gap-2">
            <input type="time" value={hoursFrom} onChange={(e) => setHoursFrom(e.target.value)} className={`${inputClass} mt-0 w-32`} aria-label="Desde" />
            <span className="text-sm text-zinc-500">a</span>
            <input type="time" value={hoursTo} onChange={(e) => setHoursTo(e.target.value)} className={`${inputClass} mt-0 w-32`} aria-label="Hasta" />
          </div>
          <div className="mt-2 flex gap-1" role="group" aria-label="Días">
            {DAY_LABELS.map((d, i) => {
              const day = i + 1;
              const on = days.includes(day);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDays((prev) => (on ? prev.filter((x) => x !== day) : [...prev, day]))}
                  className={`h-8 w-8 rounded-full text-xs font-medium ${on ? 'bg-budi-primary-500 text-white' : 'border border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300'}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-zinc-500">Ningún día marcado = todos los días.</p>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input id="zone-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Zona activa
        </label>
        <FormButtons saving={saving} onClose={onClose} label={zone ? 'Guardar zona' : 'Crear zona'} />
      </form>
    </ModalFrame>
  );
}
