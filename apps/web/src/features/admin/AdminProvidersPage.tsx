'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { ServiceTypeBadge } from '@/shared/components/ServiceTypeBadge';
import { useToast, useConfirm } from '@/shared/components/FeedbackProvider';
import Link from 'next/link';
import { useCanConfigure } from './AdminRoleContext';
import { ProviderBankModal } from '@/features/payouts/ProviderBankModal';
import { accountUrl } from './account-360';

type Provider = {
  id: string;
  name: string;
  /** A que se dedica la empresa. NO es la lista de servicios: eso es provider_services. */
  business_type: string;
  /**
   * Porcentaje del bruto que retiene Budi por cada servicio de esta empresa.
   * NO viene en la fila de `providers`: es una tarifa versionada (00102) que
   * solo el admin puede leer. Se completa aparte, con admin_list_provider_commissions
   * (la que rige hoy, propia o heredada del default).
   */
  commission_rate: number;
  /** NULL cuando la empresa no remolca (una cerrajeria, un taller). */
  tow_type_supported: 'light' | 'heavy' | 'both' | null;
  is_active: boolean;
  contact_phone: string | null;
  contact_email: string | null;
  address: string | null;
  created_at: string;
  provider_services?: ProviderServiceRow[];
};


const BUSINESS_TYPES: { valor: string; etiqueta: string }[] = [
  { valor: 'tow', etiqueta: 'Operadora de grúas' },
  { valor: 'roadside', etiqueta: 'Asistencia vial (multiservicio)' },
  { valor: 'mechanic', etiqueta: 'Taller mecánico' },
  { valor: 'locksmith', etiqueta: 'Cerrajería' },
  { valor: 'fuel', etiqueta: 'Combustible' },
  { valor: 'other', etiqueta: 'Otro' },
];

const businessLabel = (v: string) =>
  BUSINESS_TYPES.find((b) => b.valor === v)?.etiqueta ?? v;

type ProviderServiceRow = {
  service_id: string;
  is_available: boolean;
  services: { slug: string; name_es: string } | null;
};

type ServiceOption = {
  id: string;
  slug: string;
  name_es: string;
};

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // LAN-08 (00125): cuenta a la que Budi le paga a la empresa.
  const [bankFor, setBankFor] = useState<Provider | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  // Soporte ve las empresas y lo que prestan, pero no las edita ni ve comisiones.
  const canConfigure = useCanConfigure();

  useEffect(() => {
    const fetchProviders = async () => {
      const supabase = createClient();
      // Dos consultas porque son dos niveles de acceso distintos: `providers` la
      // lee cualquiera con sesion (la movil la necesita para el nombre de la
      // empresa) y las comisiones son solo del admin.
      const [{ data }, { data: comisiones }] = await Promise.all([
        supabase
          .from('providers')
          .select(`
            *,
            provider_services(service_id, is_available, services(slug, name_es))
          `)
          // Los programas MOPT se gestionan en su propia pantalla (tarifa, zonas).
          .eq('is_mopt', false)
          .order('created_at', { ascending: false }),
        canConfigure
          ? supabase.rpc('admin_list_provider_commissions')
          : Promise.resolve({ data: [] as { provider_id: string; commission_rate: number }[] }),
      ]);
      const porProveedor = new Map(
        (comisiones ?? []).map((c) => [c.provider_id, Number(c.commission_rate)])
      );
      // La fila de `providers` ya no trae la comision, asi que el cast va contra
      // el tipo sin ella y el campo se completa aca.
      setProviders(
        ((data as Omit<Provider, 'commission_rate'>[]) || []).map((p) => ({
          ...p,
          commission_rate: porProveedor.get(p.id) ?? 0,
        }))
      );
      setLoading(false);
    };
    fetchProviders();
  }, [refreshKey, canConfigure]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: '¿Eliminar este proveedor?',
      message: 'Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;

    const supabase = createClient();
    const { error } = await supabase.from('providers').delete().eq('id', id);
    if (error) {
      toast.error('No se pudo eliminar el proveedor.');
      return;
    }
    toast.success('Proveedor eliminado.');
    refetch();
  };

  const handleToggleActive = async (provider: Provider) => {
    const supabase = createClient();
    const { error } = await supabase
      .from('providers')
      .update({ is_active: !provider.is_active })
      .eq('id', provider.id);
    if (error) {
      toast.error('No se pudo actualizar el estado.');
      return;
    }
    toast.success(provider.is_active ? 'Proveedor desactivado.' : 'Proveedor activado.');
    refetch();
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">
            Proveedores
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Gestiona los proveedores de servicios
          </p>
        </div>
        {canConfigure && (
          <button
            onClick={() => {
              setEditingProvider(null);
              setShowForm(true);
            }}
            className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600"
          >
            Agregar Proveedor
          </button>
        )}
      </div>

      {bankFor && <ProviderBankModal providerId={bankFor.id} providerName={bankFor.name} onClose={() => setBankFor(null)} />}
      {showForm && (
        <ProviderForm
          provider={editingProvider}
          onClose={() => {
            setShowForm(false);
            setEditingProvider(null);
          }}
          onSave={() => {
            setShowForm(false);
            setEditingProvider(null);
            refetch();
          }}
        />
      )}

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Nombre
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Negocio
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Tipo Grúa
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Servicios
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Contacto
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Estado
                </th>
                {canConfigure && (
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Acciones
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-zinc-500">
                    Cargando…
                  </td>
                </tr>
              ) : providers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-zinc-500">
                    No hay proveedores registrados
                  </td>
                </tr>
              ) : (
                providers.map((provider) => (
                  <tr key={provider.id}>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div>
                        {/* La ficha 360 tiene dinero: solo el admin la abre. */}
                        {canConfigure ? (
                          <Link
                            href={accountUrl('provider', provider.id)}
                            className="text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
                          >
                            {provider.name}
                          </Link>
                        ) : (
                          <p className="text-sm font-medium text-zinc-900 dark:text-white">
                            {provider.name}
                          </p>
                        )}
                        {provider.address && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {provider.address}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {businessLabel(provider.business_type)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {provider.tow_type_supported === 'light' && 'Liviana'}
                      {provider.tow_type_supported === 'heavy' && 'Pesada'}
                      {provider.tow_type_supported === 'both' && 'Ambas'}
                      {!provider.tow_type_supported && (
                        <span className="text-zinc-400 dark:text-zinc-600">No remolca</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {provider.provider_services
                          ?.filter((ps) => ps.is_available)
                          .map((ps) => (
                            <ServiceTypeBadge
                              key={ps.service_id}
                              serviceType={ps.services?.slug || ''}
                            />
                          )) || <span className="text-xs text-zinc-400">-</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {provider.contact_phone || provider.contact_email || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <button
                        onClick={() => handleToggleActive(provider)}
                        disabled={!canConfigure}
                        className={`inline-flex disabled:cursor-default rounded-full px-2 py-1 text-xs font-medium ${
                          provider.is_active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200'
                        }`}
                      >
                        {provider.is_active ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    {canConfigure && (
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      <button
                        onClick={() => {
                          setEditingProvider(provider);
                          setShowForm(true);
                        }}
                        className="mr-2 text-budi-primary-500 hover:text-budi-primary-700 dark:text-budi-primary-400"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setBankFor(provider)}
                        className="mr-2 text-budi-primary-500 hover:text-budi-primary-700 dark:text-budi-primary-400"
                      >
                        Cuenta bancaria
                      </button>
                      <button
                        onClick={() => handleDelete(provider.id)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400"
                      >
                        Eliminar
                      </button>
                    </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProviderForm({
  provider,
  onClose,
  onSave,
}: {
  provider: Provider | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(provider?.name || '');
  const [businessType, setBusinessType] = useState<string>(provider?.business_type || 'tow');
  // Se negocia empresa por empresa. Una empresa nueva nace sin tarifa propia
  // (vacio = hereda el default de plataforma, y sigue sus cambios). Un numero
  // escrito aca queda fijo aunque el default cambie despues.
  const [commission, setCommission] = useState<string>(
    provider ? String(provider.commission_rate) : ''
  );
  // '' = no remolca -> se guarda NULL.
  const [towType, setTowType] = useState<'light' | 'heavy' | 'both' | ''>(
    provider ? provider.tow_type_supported ?? '' : 'both'
  );
  const [phone, setPhone] = useState(provider?.contact_phone || '');
  const [email, setEmail] = useState(provider?.contact_email || '');
  const [address, setAddress] = useState(provider?.address || '');
  const [loading, setLoading] = useState(false);

  // Service assignment
  const [allServices, setAllServices] = useState<ServiceOption[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchServices = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('services')
        .select('id, slug, name_es')
        .eq('is_active', true)
        .order('sort_order');
      setAllServices(data || []);

      // Pre-select assigned services
      if (provider?.provider_services) {
        const assigned = new Set(
          provider.provider_services
            .filter((ps) => ps.is_available)
            .map((ps) => ps.service_id)
        );
        setSelectedServiceIds(assigned);
      }
    };
    fetchServices();
  }, [provider]);

  const toggleService = (serviceId: string) => {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();

    // La comision no va aca: se guarda aparte, por RPC, en cuanto haya un id.
    const providerData = {
      name,
      business_type: businessType,
      // '' significa "no remolca": se guarda NULL, no la cadena vacia.
      tow_type_supported: towType || null,
      contact_phone: phone || null,
      contact_email: email || null,
      address: address || null,
    };

    let providerId = provider?.id;

    if (provider) {
      const { error } = await supabase
        .from('providers')
        .update(providerData)
        .eq('id', provider.id);
      if (error) {
        toast.error('No se pudo guardar el proveedor.');
        setLoading(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from('providers')
        .insert(providerData)
        .select('id')
        .single();
      if (error) {
        toast.error('No se pudo guardar el proveedor.');
        setLoading(false);
        return;
      }
      providerId = data?.id;
    }

    // La comision no va en la fila del proveedor: se registra como version nueva
    // desde ya (00102). Si no cambio, la RPC no crea nada.
    if (providerId && commission.trim() !== '') {
      const { error: comisionError } = await supabase.rpc('admin_set_provider_commission', {
        p_provider_id: providerId,
        p_rate: Number(commission),
      });
      if (comisionError) {
        toast.error('Se guardó el proveedor, pero no la comisión.');
        setLoading(false);
        return;
      }
    }

    // Sync provider_services
    if (providerId) {
      // Remove all existing
      const { error: deleteError } = await supabase
        .from('provider_services')
        .delete()
        .eq('provider_id', providerId);
      if (deleteError) {
        toast.error('No se pudo guardar el proveedor.');
        setLoading(false);
        return;
      }

      // Insert selected
      if (selectedServiceIds.size > 0) {
        const pid = providerId; // const para preservar el narrowing dentro del closure
        const rows = Array.from(selectedServiceIds).map((serviceId) => ({
          provider_id: pid,
          service_id: serviceId,
          is_available: true,
        }));
        const { error: insertError } = await supabase.from('provider_services').insert(rows);
        if (insertError) {
          toast.error('No se pudo guardar el proveedor.');
          setLoading(false);
          return;
        }
      }
    }

    toast.success('Proveedor guardado.');
    setLoading(false);
    onSave();
  };

  return (
    <div className="mb-8 rounded-xl border border-zinc-200 bg-white shadow-sm p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">
        {provider ? 'Editar Proveedor' : 'Nuevo Proveedor'}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Nombre
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Tipo de negocio
            </label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              {BUSINESS_TYPES.map((b) => (
                <option key={b.valor} value={b.valor}>
                  {b.etiqueta}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">
              A qué se dedica la empresa. Los servicios que presta se eligen más abajo.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Comisión de Budi (%)
            </label>
            <input
              type="number" min={0} max={100} step="0.01"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              placeholder={provider ? undefined : 'Default de plataforma'}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Porcentaje del bruto que retiene Budi. El resto se le liquida a la empresa.
              Cambia desde hoy: los servicios ya completados conservan su tasa. Para
              programarlo a futuro o ver la historia, abre{' '}
              <a href="/admin/tarifas" className="font-medium text-budi-primary-600 underline dark:text-budi-primary-400">Tarifas</a>.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Tipo de Grúa
            </label>
            <select
              value={towType}
              onChange={(e) => setTowType(e.target.value as 'light' | 'heavy' | 'both' | '')}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="">No remolca</option>
              <option value="light">Liviana</option>
              <option value="heavy">Pesada</option>
              <option value="both">Ambas</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Teléfono
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Dirección
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
        </div>

        {/* Service Assignment */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Servicios Asignados
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {allServices.map((svc) => (
              <label
                key={svc.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${
                  selectedServiceIds.has(svc.id)
                    ? 'border-budi-primary-500 bg-budi-primary-50 dark:bg-budi-primary-900/20'
                    : 'border-zinc-200 dark:border-zinc-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedServiceIds.has(svc.id)}
                  onChange={() => toggleService(svc.id)}
                  className="rounded border-zinc-300 text-budi-primary-500 focus:ring-budi-primary-500"
                />
                <ServiceTypeBadge serviceType={svc.slug} />
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
          >
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
