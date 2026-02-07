'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ServiceTypeBadge } from '@/components/ServiceTypeBadge';

type Service = {
  id: string;
  slug: string;
  name_es: string;
  name_en: string;
  description_es: string;
  description_en: string;
  icon: string;
  base_price: number;
  extra_fee: number;
  extra_fee_label: string | null;
  requires_destination: boolean;
  sort_order: number;
  is_active: boolean;
  currency: string;
  created_at: string;
};

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const fetchServices = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('services')
        .select('*')
        .order('sort_order', { ascending: true });
      setServices(data || []);
      setLoading(false);
    };
    fetchServices();
  }, [refreshKey]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const handleToggleActive = async (service: Service) => {
    const supabase = createClient();
    await supabase
      .from('services')
      .update({ is_active: !service.is_active })
      .eq('id', service.id);
    refetch();
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">
            Servicios
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Catalogo de servicios disponibles en la plataforma
          </p>
        </div>
        <button
          onClick={() => {
            setEditingService(null);
            setShowForm(true);
          }}
          className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600"
        >
          Nuevo Servicio
        </button>
      </div>

      {showForm && (
        <ServiceForm
          service={editingService}
          onClose={() => {
            setShowForm(false);
            setEditingService(null);
          }}
          onSave={() => {
            setShowForm(false);
            setEditingService(null);
            refetch();
          }}
        />
      )}

      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Orden
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Servicio
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Slug
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Precio Base
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Destino
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Estado
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-zinc-500">
                    Cargando...
                  </td>
                </tr>
              ) : services.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-zinc-500">
                    No hay servicios registrados
                  </td>
                </tr>
              ) : (
                services.map((service) => (
                  <tr
                    key={service.id}
                    className={!service.is_active ? 'opacity-50' : ''}
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {service.sort_order}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-3">
                        <ServiceTypeBadge serviceType={service.slug} />
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-white">
                            {service.name_es}
                          </p>
                          <p className="text-xs text-zinc-500">{service.name_en}</p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-mono text-zinc-600 dark:text-zinc-400">
                      {service.slug}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      ${service.base_price} {service.currency}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {service.requires_destination ? 'Si' : 'No'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <button
                        onClick={() => handleToggleActive(service)}
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          service.is_active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200'
                        }`}
                      >
                        {service.is_active ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      <button
                        onClick={() => {
                          setEditingService(service);
                          setShowForm(true);
                        }}
                        className="text-budi-primary-500 hover:text-budi-primary-700 dark:text-budi-primary-400"
                      >
                        Editar
                      </button>
                    </td>
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

function ServiceForm({
  service,
  onClose,
  onSave,
}: {
  service: Service | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [slug, setSlug] = useState(service?.slug || '');
  const [nameEs, setNameEs] = useState(service?.name_es || '');
  const [nameEn, setNameEn] = useState(service?.name_en || '');
  const [descEs, setDescEs] = useState(service?.description_es || '');
  const [descEn, setDescEn] = useState(service?.description_en || '');
  const [icon, setIcon] = useState(service?.icon || 'wrench');
  const [basePrice, setBasePrice] = useState(service?.base_price || 0);
  const [extraFee, setExtraFee] = useState(service?.extra_fee || 0);
  const [extraFeeLabel, setExtraFeeLabel] = useState(service?.extra_fee_label || '');
  const [requiresDestination, setRequiresDestination] = useState(service?.requires_destination || false);
  const [sortOrder, setSortOrder] = useState(service?.sort_order || 0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();

    const data = {
      slug,
      name_es: nameEs,
      name_en: nameEn,
      description_es: descEs,
      description_en: descEn,
      icon,
      base_price: basePrice,
      extra_fee: extraFee,
      extra_fee_label: extraFeeLabel || null,
      requires_destination: requiresDestination,
      sort_order: sortOrder,
    };

    if (service) {
      await supabase.from('services').update(data).eq('id', service.id);
    } else {
      await supabase.from('services').insert(data);
    }

    setLoading(false);
    onSave();
  };

  return (
    <div className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">
        {service ? 'Editar Servicio' : 'Nuevo Servicio'}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Slug (identificador)
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              disabled={!!service}
              pattern="[a-z0-9_-]+"
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 font-mono disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:disabled:bg-zinc-900"
              placeholder="mechanic"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Nombre (ES)
            </label>
            <input
              type="text"
              value={nameEs}
              onChange={(e) => setNameEs(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              placeholder="Mecanico"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Nombre (EN)
            </label>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              placeholder="Mechanic"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Descripcion (ES)
            </label>
            <textarea
              value={descEs}
              onChange={(e) => setDescEs(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Descripcion (EN)
            </label>
            <textarea
              value={descEn}
              onChange={(e) => setDescEn(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Icono (Lucide name)
            </label>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              placeholder="wrench"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Precio Base (USD)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={basePrice}
              onChange={(e) => setBasePrice(parseFloat(e.target.value))}
              required
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Cargo Extra (USD)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={extraFee}
              onChange={(e) => setExtraFee(parseFloat(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Orden
            </label>
            <input
              type="number"
              min="0"
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Etiqueta cargo extra
            </label>
            <input
              type="text"
              value={extraFeeLabel}
              onChange={(e) => setExtraFeeLabel(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              placeholder="Cargo por distancia"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <input
                type="checkbox"
                checked={requiresDestination}
                onChange={(e) => setRequiresDestination(e.target.checked)}
                className="rounded border-zinc-300 text-budi-primary-500 focus:ring-budi-primary-500"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                Requiere destino
              </span>
            </label>
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
