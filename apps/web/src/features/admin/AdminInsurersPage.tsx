'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Building2, ChevronRight, Plus } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast, useConfirm } from '@/shared/components/FeedbackProvider';

// Alta y listado de aseguradoras (B-09). El detalle de cada una —sus planes,
// reglas y pólizas— vive en /admin/insurers/[id].

type Insurer = {
  id: string;
  name: string;
  tax_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  created_at: string;
  coverage_plans: { count: number }[];
  policies: { count: number }[];
};

export default function AdminInsurersPage() {
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Insurer | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      // `count` embebido: evita una consulta por fila solo para mostrar cuántos
      // planes y pólizas tiene cada aseguradora.
      const { data, error } = await supabase
        .from('insurers')
        .select('*, coverage_plans(count), policies(count)')
        .order('name');
      if (error) toast.error('No se pudieron cargar las aseguradoras.');
      setInsurers((data as unknown as Insurer[]) || []);
      setLoading(false);
    };
    load();
    // `toast` es estable (viene de un provider con useMemo); incluirlo dispararía
    // recargas en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const handleToggle = async (ins: Insurer) => {
    const supabase = createClient();
    const { error } = await supabase
      .from('insurers')
      .update({ is_active: !ins.is_active })
      .eq('id', ins.id);
    if (error) return toast.error('No se pudo actualizar el estado.');
    toast.success(ins.is_active ? 'Aseguradora desactivada.' : 'Aseguradora activada.');
    refetch();
  };

  const handleDelete = async (ins: Insurer) => {
    const polizas = ins.policies?.[0]?.count ?? 0;
    if (polizas > 0) {
      // `policies.insurer_id` es ON DELETE RESTRICT: la base lo impediría igual,
      // pero es mejor explicarlo antes que mostrar un error de constraint.
      return toast.error(
        `No se puede eliminar: tiene ${polizas} póliza${polizas === 1 ? '' : 's'}. Desactívala en su lugar.`
      );
    }
    const ok = await confirm({
      title: `¿Eliminar ${ins.name}?`,
      message: 'Se eliminarán también sus planes de cobertura. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;

    const supabase = createClient();
    const { error } = await supabase.from('insurers').delete().eq('id', ins.id);
    if (error) return toast.error('No se pudo eliminar la aseguradora.');
    toast.success('Aseguradora eliminada.');
    refetch();
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">
            Aseguradoras
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Aseguradoras, planes de cobertura, pólizas y afiliados
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600"
        >
          <Plus className="h-4 w-4" />
          Agregar aseguradora
        </button>
      </div>

      {showForm && (
        <InsurerForm
          insurer={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            refetch();
          }}
        />
      )}

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {loading ? (
          <p className="p-8 text-center text-sm text-zinc-500">Cargando…</p>
        ) : insurers.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-700" />
            <p className="mt-3 text-sm font-medium text-zinc-900 dark:text-white">
              Todavía no hay aseguradoras
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Agrega la primera para poder crear planes de cobertura y pólizas.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="px-6 py-3">Aseguradora</th>
                  <th className="px-6 py-3">NIT</th>
                  <th className="px-6 py-3">Contacto</th>
                  <th className="px-6 py-3">Planes</th>
                  <th className="px-6 py-3">Pólizas</th>
                  <th className="px-6 py-3">Estado</th>
                  <th className="px-6 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {insurers.map((ins) => (
                  <tr key={ins.id} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/insurers/${ins.id}`}
                        className="flex items-center gap-1 font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                      >
                        {ins.name}
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">{ins.tax_id || '—'}</td>
                    <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">
                      {ins.contact_name || '—'}
                      {ins.contact_email && (
                        <span className="block text-xs text-zinc-500">{ins.contact_email}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-zinc-900 dark:text-white">
                      {ins.coverage_plans?.[0]?.count ?? 0}
                    </td>
                    <td className="px-6 py-4 text-zinc-900 dark:text-white">
                      {ins.policies?.[0]?.count ?? 0}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          ins.is_active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {ins.is_active ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-3 text-xs font-medium">
                        <button
                          onClick={() => {
                            setEditing(ins);
                            setShowForm(true);
                          }}
                          className="text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleToggle(ins)}
                          className="text-zinc-600 hover:underline dark:text-zinc-400"
                        >
                          {ins.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                        <button
                          onClick={() => handleDelete(ins)}
                          className="text-red-600 hover:underline dark:text-red-400"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function InsurerForm({
  insurer,
  onClose,
  onSaved,
}: {
  insurer: Insurer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(insurer?.name || '');
  const [taxId, setTaxId] = useState(insurer?.tax_id || '');
  const [contactName, setContactName] = useState(insurer?.contact_name || '');
  const [contactEmail, setContactEmail] = useState(insurer?.contact_email || '');
  const [contactPhone, setContactPhone] = useState(insurer?.contact_phone || '');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      tax_id: taxId.trim() || null,
      contact_name: contactName.trim() || null,
      contact_email: contactEmail.trim() || null,
      contact_phone: contactPhone.trim() || null,
    };

    const { error } = insurer
      ? await supabase.from('insurers').update(payload).eq('id', insurer.id)
      : await supabase.from('insurers').insert(payload);

    setLoading(false);
    if (error) return toast.error('No se pudo guardar la aseguradora.');
    toast.success(insurer ? 'Aseguradora actualizada.' : 'Aseguradora creada.');
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-50 w-full max-w-lg space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
          {insurer ? 'Editar aseguradora' : 'Nueva aseguradora'}
        </h2>

        <Campo label="Nombre" required value={name} onChange={setName} placeholder="Seguros del Pacífico, S.A." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="NIT" value={taxId} onChange={setTaxId} placeholder="0614-010101-001-1" />
          <Campo label="Contacto" value={contactName} onChange={setContactName} placeholder="Nombre y apellido" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Correo" type="email" value={contactEmail} onChange={setContactEmail} placeholder="contacto@aseguradora.sv" />
          <Campo label="Teléfono" value={contactPhone} onChange={setContactPhone} placeholder="+503 2200-0000" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
          >
            {loading ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Campo({
  label,
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 text-zinc-900 placeholder-zinc-400 focus:border-budi-primary-500 focus:outline-none focus:ring-1 focus:ring-budi-primary-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
      />
    </div>
  );
}
