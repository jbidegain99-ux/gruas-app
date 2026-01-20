'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

type UserRole = 'USER' | 'OPERATOR' | 'MOP' | 'ADMIN';

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  provider_id: string | null;
  provider_name?: string | null;
  created_at: string;
};

type Provider = {
  id: string;
  name: string;
};

const ROLE_LABELS: Record<UserRole, string> = {
  USER: 'Usuario',
  OPERATOR: 'Operador',
  MOP: 'MOP',
  ADMIN: 'Administrador',
};

const ROLE_COLORS: Record<UserRole, string> = {
  USER: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200',
  OPERATOR: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  MOP: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  ADMIN: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export default function UsersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      setError(null);

      // First, fetch profiles WITHOUT join to avoid RLS issues
      // The email column may not exist if migration 00014 wasn't run
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, phone, role, provider_id, created_at')
        .order('created_at', { ascending: false });

      if (profilesError) {
        console.error('Error fetching profiles:', profilesError);
        setError(`Error al cargar usuarios: ${profilesError.message}. Verifica que la migration de RLS este aplicada en /admin/system-check`);
        setLoading(false);
        return;
      }

      // Fetch providers for the dropdown and for mapping names
      const { data: providersData } = await supabase
        .from('providers')
        .select('id, name')
        .order('name');

      // Create a map of provider names
      const providerMap = new Map(
        (providersData || []).map((p) => [p.id, p.name])
      );

      // Try to get email column - may not exist
      let emailMap = new Map<string, string>();
      try {
        const { data: emailData } = await supabase
          .from('profiles')
          .select('id, email')
          .not('email', 'is', null);

        if (emailData) {
          emailMap = new Map(emailData.map((e) => [e.id, e.email || '']));
        }
      } catch {
        // Email column doesn't exist - that's ok
        console.log('Email column not available');
      }

      const mappedProfiles = (profilesData || []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        phone: p.phone,
        role: p.role as UserRole,
        provider_id: p.provider_id,
        created_at: p.created_at,
        email: emailMap.get(p.id) || '',
        provider_name: p.provider_id ? providerMap.get(p.provider_id) || null : null,
      })) as Profile[];

      // Filter to only active providers for dropdown
      const activeProviders = (providersData || []).filter(
        (p) => providerMap.has(p.id)
      );

      setProfiles(mappedProfiles);
      setProviders(activeProviders);
      setLoading(false);
    };
    fetchData();
  }, [refreshKey]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const getRoleStats = () => {
    const stats = { USER: 0, OPERATOR: 0, MOP: 0, ADMIN: 0 };
    profiles.forEach((p) => {
      stats[p.role]++;
    });
    return stats;
  };

  const stats = getRoleStats();

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            Usuarios
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Gestiona los usuarios y sus roles
          </p>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 flex-shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-medium text-red-800 dark:text-red-200">Error</p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
              <a
                href="/admin/system-check"
                className="mt-2 inline-block text-sm font-medium text-red-700 underline hover:text-red-800 dark:text-red-300"
              >
                Ir a System Check
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Total Usuarios</p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-white">{profiles.length}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Operadores</p>
          <p className="text-2xl font-bold text-blue-600">{stats.OPERATOR}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">MOP</p>
          <p className="text-2xl font-bold text-purple-600">{stats.MOP}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Administradores</p>
          <p className="text-2xl font-bold text-red-600">{stats.ADMIN}</p>
        </div>
      </div>

      {editingUser && (
        <EditUserModal
          user={editingUser}
          providers={providers}
          onClose={() => setEditingUser(null)}
          onSave={() => {
            setEditingUser(null);
            refetch();
          }}
        />
      )}

      {/* Users Table */}
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Usuario
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Telefono
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Rol
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Proveedor
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-zinc-500">
                    Cargando...
                  </td>
                </tr>
              ) : profiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-zinc-500">
                    No hay usuarios registrados
                  </td>
                </tr>
              ) : (
                profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                          {profile.full_name?.charAt(0).toUpperCase() || profile.email.charAt(0).toUpperCase()}
                        </div>
                        <p className="text-sm font-medium text-zinc-900 dark:text-white">
                          {profile.full_name || 'Sin nombre'}
                        </p>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {profile.email}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {profile.phone || '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${ROLE_COLORS[profile.role]}`}>
                        {ROLE_LABELS[profile.role]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {profile.provider_name || '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      <button
                        onClick={() => setEditingUser(profile)}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                      >
                        Editar Rol
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

function EditUserModal({
  user,
  providers,
  onClose,
  onSave,
}: {
  user: Profile;
  providers: Provider[];
  onClose: () => void;
  onSave: () => void;
}) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [providerId, setProviderId] = useState<string>(user.provider_id || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();

    // Use RPC to update user role (handles validation and provider assignment)
    const { error: rpcError } = await supabase.rpc('admin_update_user_role', {
      p_user_id: user.id,
      p_new_role: role,
      p_provider_id: role === 'OPERATOR' && providerId ? providerId : null,
    });

    if (rpcError) {
      console.error('Error updating user:', rpcError);
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    onSave();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">
          Editar Usuario
        </h2>

        <div className="mb-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-medium">{user.full_name || 'Sin nombre'}</span>
          </p>
          <p className="text-sm text-zinc-500">{user.email}</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Rol
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="USER">Usuario</option>
              <option value="OPERATOR">Operador</option>
              <option value="MOP">MOP</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </div>

          {role === 'OPERATOR' && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Proveedor Asignado
              </label>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              >
                <option value="">Seleccionar proveedor...</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500">
                Los operadores deben estar asignados a un proveedor
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
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
              {loading ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
