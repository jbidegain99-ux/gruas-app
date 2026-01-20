'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

type Provider = {
  id: string;
  name: string;
  tow_type_supported: 'light' | 'heavy' | 'both';
  is_active: boolean;
  contact_phone: string | null;
  contact_email: string | null;
  address: string | null;
  created_at: string;
};

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);

  const fetchProviders = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('providers')
      .select('*')
      .order('created_at', { ascending: false });
    setProviders(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleDelete = async (id: string) => {
    if (!confirm('Esta seguro de eliminar este proveedor?')) return;

    const supabase = createClient();
    await supabase.from('providers').delete().eq('id', id);
    fetchProviders();
  };

  const handleToggleActive = async (provider: Provider) => {
    const supabase = createClient();
    await supabase
      .from('providers')
      .update({ is_active: !provider.is_active })
      .eq('id', provider.id);
    fetchProviders();
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            Proveedores
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Gestiona los proveedores de servicios de grua
          </p>
        </div>
        <button
          onClick={() => {
            setEditingProvider(null);
            setShowForm(true);
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Agregar Proveedor
        </button>
      </div>

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
            fetchProviders();
          }}
        />
      )}

      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Nombre
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Tipo Grua
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Contacto
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
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-zinc-500">
                    Cargando...
                  </td>
                </tr>
              ) : providers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-zinc-500">
                    No hay proveedores registrados
                  </td>
                </tr>
              ) : (
                providers.map((provider) => (
                  <tr key={provider.id}>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-zinc-900 dark:text-white">
                          {provider.name}
                        </p>
                        {provider.address && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {provider.address}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {provider.tow_type_supported === 'light' && 'Liviana'}
                      {provider.tow_type_supported === 'heavy' && 'Pesada'}
                      {provider.tow_type_supported === 'both' && 'Ambas'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {provider.contact_phone || provider.contact_email || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <button
                        onClick={() => handleToggleActive(provider)}
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          provider.is_active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200'
                        }`}
                      >
                        {provider.is_active ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      <button
                        onClick={() => {
                          setEditingProvider(provider);
                          setShowForm(true);
                        }}
                        className="mr-2 text-blue-600 hover:text-blue-800 dark:text-blue-400"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(provider.id)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400"
                      >
                        Eliminar
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

function ProviderForm({
  provider,
  onClose,
  onSave,
}: {
  provider: Provider | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(provider?.name || '');
  const [towType, setTowType] = useState<'light' | 'heavy' | 'both'>(
    provider?.tow_type_supported || 'both'
  );
  const [phone, setPhone] = useState(provider?.contact_phone || '');
  const [email, setEmail] = useState(provider?.contact_email || '');
  const [address, setAddress] = useState(provider?.address || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();

    const data = {
      name,
      tow_type_supported: towType,
      contact_phone: phone || null,
      contact_email: email || null,
      address: address || null,
    };

    if (provider) {
      await supabase.from('providers').update(data).eq('id', provider.id);
    } else {
      await supabase.from('providers').insert(data);
    }

    setLoading(false);
    onSave();
  };

  return (
    <div className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
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
              Tipo de Grua
            </label>
            <select
              value={towType}
              onChange={(e) => setTowType(e.target.value as 'light' | 'heavy' | 'both')}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="light">Liviana</option>
              <option value="heavy">Pesada</option>
              <option value="both">Ambas</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Telefono
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
            Direccion
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
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
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
