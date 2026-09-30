'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Users, Truck, ShieldCheck, Building2, Search } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { Pagination } from '@/shared/components/Pagination';
import { useCanConfigure } from './AdminRoleContext';
import { useInsurersEnabled } from '@/shared/lib/use-platform-features';
import type { UserRole } from '@gruas-app/shared';

const PAGE_SIZE = 15;

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  provider_id: string | null;
  provider_name?: string | null;
  insurer_name?: string | null;
  /** 00106 (POR-01): el portal al que entra, por su membresía (no por el rol). */
  org_name?: string | null;
  org_type?: string | null;
  /** 00107: la unidad (grúa/pipa) activa de un socio operador. */
  vehicle?: { plate: string; vehicle_type: string; capacity_m3: number | null } | null;
  verification_status: string;
  /** Comisión propia del operador independiente. NULL = default de plataforma. */
  commission_rate: number | null;
  created_at: string;
};

type Provider = {
  id: string;
  name: string;
  /** Programa MOPT (00098): paga el servicio y tiene flota propia. */
  is_mopt: boolean;
  is_active: boolean;
};

const ROLE_LABELS: Record<UserRole, string> = {
  USER: 'Usuario',
  OPERATOR: 'Socio operador',
  ADMIN: 'Administrador',
  INSURER: 'Aseguradora',
  MOPT: 'Portal MOPT',
  SUPPORT: 'Soporte',
};

const ROLE_COLORS: Record<UserRole, string> = {
  USER: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200',
  OPERATOR: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ADMIN: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  INSURER: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
  MOPT: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  SUPPORT: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

export default function AdminUsersPage() {
  const [loadedProfiles, setProfiles] = useState<Profile[]>([]);
  // Aseguradoras en pausa (00153): la membresía a una aseguradora o
  // reaseguradora no da portal, así que no se muestra como tal.
  const insurers = useInsurersEnabled();
  const profiles = useMemo(
    () =>
      insurers
        ? loadedProfiles
        : loadedProfiles.map((p) =>
            p.org_type === 'INSURER' || p.org_type === 'REINSURER' ? { ...p, org_name: null, org_type: null } : p,
          ),
    [loadedProfiles, insurers],
  );
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  // Soporte ve la lista pero no cambia roles ni comisiones (la base igual lo rechaza).
  const canConfigure = useCanConfigure();
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'PORTAL' | UserRole>('all');
  const [page, setPage] = useState(0);
  // La base rechaza que un admin se cambie el rol a sí mismo (00093); acá solo
  // se evita ofrecer el botón.
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      const { data: { user: me } } = await supabase.auth.getUser();
      setMyId(me?.id ?? null);

      // Fetch profiles with provider names
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          full_name,
          phone,
          role,
          provider_id,
          verification_status,
          created_at,
          providers:provider_id (name),
          insurers:insurer_id (name)
        `)
        .order('created_at', { ascending: false });

      // La comision propia del independiente ya no vive en `profiles`: es una
      // tarifa versionada (00102). Aca solo importa la que rige hoy. Soporte no
      // ve tarifas (00104): ni se pide.
      const { data: tarifas } = canConfigure
        ? await supabase.rpc('admin_rate_overview')
        : { data: null };
      const comisionPropia = new Map(
        (tarifas ?? [])
          .filter((t) => t.kind === 'operator' && t.own_rate)
          .map((t) => [t.subject_id as string, Number(t.current_rate)])
      );

      // Membresías activas y unidades de los socios (solo el admin las lee; para
      // soporte vuelven vacías y la tabla simplemente no las muestra).
      const [{ data: memberships }, { data: vehicles }] = await Promise.all([
        supabase
          .from('organization_members')
          .select('profile_id, organizations(name, type)')
          .eq('status', 'active'),
        supabase.from('operator_vehicles').select('operator_id, plate, vehicle_type, capacity_m3').eq('is_active', true),
      ]);
      const orgByProfile = new Map(
        (memberships ?? []).map((m) => [
          m.profile_id,
          m.organizations as unknown as { name: string; type: string } | null,
        ])
      );
      const vehicleByOperator = new Map(
        (vehicles ?? []).map((v) => [v.operator_id, { plate: v.plate, vehicle_type: v.vehicle_type, capacity_m3: v.capacity_m3 }])
      );

      // Fetch providers for the dropdown
      const { data: providersData } = await supabase
        .from('providers')
        .select('id, name, is_mopt, is_active')
        // Activos, y los programas MOPT aunque esten inactivos: una cuenta del
        // portal puede seguir vinculada a uno, y sin el en la lista el modal
        // mostraba otro programa y lo re-vinculaba sin avisar.
        .or('is_active.eq.true,is_mopt.eq.true')
        .order('name');

      const mappedProfiles = (profilesData || []).map((p) => ({
        ...p,
        commission_rate: comisionPropia.get(p.id) ?? null,
        provider_name: (p.providers as unknown as { name: string } | null)?.name || null,
        insurer_name: (p.insurers as unknown as { name: string } | null)?.name || null,
        org_name: orgByProfile.get(p.id)?.name ?? null,
        org_type: orgByProfile.get(p.id)?.type ?? null,
        vehicle: vehicleByOperator.get(p.id) ?? null,
        providers: undefined,
        insurers: undefined,
      })) as Profile[];

      // Sin esto un fallo de la consulta (p. ej. una columna que no existe en esa
      // base por una migración sin aplicar) se veía como "No hay usuarios".
      if (profilesError) console.error('Error cargando usuarios:', profilesError);
      setLoadError(profilesError?.message ?? null);
      setProfiles(mappedProfiles);
      setProviders(providersData || []);
      setLoading(false);
    };
    fetchData();
  }, [refreshKey, canConfigure]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const VERIF_BADGE: Record<string, string> = {
    approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };
  const VERIF_LABEL: Record<string, string> = {
    approved: 'Aprobado',
    pending: 'En revisión',
    rejected: 'Rechazado',
  };

  const getRoleStats = () => {
    const stats: Record<UserRole, number> = { USER: 0, OPERATOR: 0, ADMIN: 0, INSURER: 0, MOPT: 0, SUPPORT: 0 };
    profiles.forEach((p) => {
      stats[p.role]++;
    });
    return stats;
  };

  const stats = getRoleStats();

  // Búsqueda (nombre/email/teléfono) + filtro por rol, sobre la lista cargada.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      if (roleFilter === 'PORTAL') {
        if (!p.org_name) return false;
      } else if (roleFilter !== 'all' && p.role !== roleFilter) return false;
      if (!q) return true;
      return (
        (p.full_name || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q)
      );
    });
  }, [profiles, search, roleFilter]);

  // Vuelve a la primera página si el filtro cambia y la página actual queda fuera.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

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

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total de usuarios', value: profiles.length, Icon: Users, tint: 'bg-budi-primary-50 text-budi-primary-600 dark:bg-budi-primary-900/40 dark:text-budi-primary-300' },
          { label: 'Socios operadores', value: stats.OPERATOR, Icon: Truck, tint: 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300' },
          { label: 'Admin y soporte', value: stats.ADMIN + stats.SUPPORT, Icon: ShieldCheck, tint: 'bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-300' },
          { label: 'Con acceso a un portal', value: profiles.filter((p) => p.org_name).length, Icon: Building2, tint: 'bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300' },
        ].map(({ label, value, Icon, tint }) => (
          <div
            key={label}
            className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{value}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tint}`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
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
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {/* Buscador + filtro por rol */}
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Buscar por nombre, email o teléfono..."
              className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value as 'all' | 'PORTAL' | UserRole);
              setPage(0);
            }}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-budi-primary-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <option value="all">Todos los roles</option>
            <option value="USER">Usuarios</option>
            <option value="OPERATOR">Socios operadores</option>
            <option value="ADMIN">Administradores</option>
            <option value="PORTAL">Con acceso a un portal</option>
            <option value="SUPPORT">Soporte</option>
          </select>
        </div>
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
                  Teléfono
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Rol
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Empresa
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
                    Cargando…
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-red-600 dark:text-red-400">
                    No se pudieron cargar los usuarios: {loadError}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-zinc-500">
                    {profiles.length === 0
                      ? 'No hay usuarios registrados'
                      : 'No se encontraron usuarios con esos criterios'}
                  </td>
                </tr>
              ) : (
                paged.map((profile) => (
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
                      {profile.org_name && (
                        <span className="ml-2 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900 dark:text-violet-200">
                          Portal · {profile.org_name}
                        </span>
                      )}
                      {profile.vehicle && (
                        <span className="ml-2 font-mono text-xs text-zinc-500">{profile.vehicle.plate}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      <div className="flex items-center justify-end gap-2">
                        {profile.role === 'OPERATOR' && (
                          <>
                            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${VERIF_BADGE[profile.verification_status] || VERIF_BADGE.pending}`}>
                              {VERIF_LABEL[profile.verification_status] || profile.verification_status}
                            </span>
                            {/* La aprobación/rechazo ahora vive en Verificaciones (con visor de documentos) */}
                            <Link
                              href="/admin/verifications"
                              className="text-budi-primary-500 hover:text-budi-primary-700 dark:text-budi-primary-400"
                            >
                              Ver verificación
                            </Link>
                          </>
                        )}
                        {profile.id === myId ? (
                          <span className="text-xs text-zinc-400">Tu cuenta</span>
                        ) : !canConfigure ? null : (
                          <button
                            onClick={() => setEditingUser(profile)}
                            className="text-budi-primary-500 hover:text-budi-primary-700 dark:text-budi-primary-400"
                          >
                            Editar Rol
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={currentPage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={setPage}
        />
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
  const insurers = useInsurersEnabled();
  const [providerId, setProviderId] = useState<string>(user.provider_id || '');
  // 00107: unidad del socio (placa, tipo y capacidad si es pipa).
  const [plate, setPlate] = useState(user.vehicle?.plate ?? '');
  const [vehicleType, setVehicleType] = useState(user.vehicle?.vehicle_type ?? 'tow_light');
  const [capacity, setCapacity] = useState(user.vehicle?.capacity_m3 == null ? '' : String(user.vehicle.capacity_m3));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo aplica al independiente: si pertenece a una empresa manda la de la
  // empresa, y la RPC rechaza guardarla (00080).
  const [commission, setCommission] = useState<string>(
    user.commission_rate == null ? '' : String(user.commission_rate)
  );
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();

    // Use RPC to update user role (handles validation and provider assignment)
    const { error: rpcError } = await supabase.rpc('admin_update_user_role', {
      p_user_id: user.id,
      p_new_role: role,
      // `undefined`, no `null`: al retirarse la sobrecarga de dos argumentos en
      // la migración 00045, el argumento quedó tipado como opcional por su
      // DEFAULT y ya no acepta null. La función limpia el provider por su cuenta
      // cuando el rol no es OPERATOR.
      p_provider_id: role === 'OPERATOR' && providerId ? providerId : undefined,
    });

    // La comisión propia va aparte y SOLO para el independiente: el cambio de
    // rol ya la limpia si entró a una empresa.
    if (!rpcError && role === 'OPERATOR' && !providerId) {
      // Omitir `p_rate` es como se expresa "sin comisión propia": la función lo
      // tiene con DEFAULT NULL y eso limpia la columna.
      const { error: comError } = await supabase.rpc('admin_set_operator_commission', {
        p_operator_id: user.id,
        ...(commission.trim() === '' ? {} : { p_rate: Number(commission) }),
      });
      if (comError) {
        setLoading(false);
        setError(comError.message);
        toast.error('No se pudo guardar la comisión.');
        return;
      }
    }

    // La unidad del socio (00107). Placa vacía = sin unidad activa.
    if (!rpcError && role === 'OPERATOR') {
      const samePlate = (user.vehicle?.plate ?? '') === plate.trim().toUpperCase();
      const sameType = (user.vehicle?.vehicle_type ?? 'tow_light') === vehicleType;
      const sameCap = String(user.vehicle?.capacity_m3 ?? '') === capacity;
      if (!(samePlate && sameType && sameCap)) {
        const { error: vehError } = await supabase.rpc('admin_set_operator_vehicle', {
          p_operator_id: user.id,
          p_plate: plate,
          p_vehicle_type: vehicleType,
          ...(vehicleType === 'water_truck' && capacity ? { p_capacity_m3: Number(capacity) } : {}),
        });
        if (vehError) {
          setLoading(false);
          setError(vehError.message);
          toast.error('No se pudo guardar la unidad.');
          return;
        }
      }
    }

    if (rpcError) {
      console.error('Error updating user:', rpcError);
      setError(rpcError.message);
      toast.error('No se pudo actualizar el rol.');
      setLoading(false);
      return;
    }

    setLoading(false);
    toast.success('Rol actualizado.');
    onSave();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-sm p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
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
              <option value="OPERATOR">Socio operador</option>
              <option value="ADMIN">Administrador</option>
              <option value="SUPPORT">Soporte (ve la operación, sin dinero ni configuración)</option>
            </select>
            {/* 00106 (POR-01): aseguradoras y MOPT no son roles. */}
            <p className="mt-1 text-xs text-zinc-500">
              {user.org_name
                ? `Tiene acceso al portal de ${user.org_name}. Eso se administra en el equipo de esa organización, no con el rol.`
                : insurers
                  ? 'El acceso al portal de una aseguradora o del MOPT se da en el equipo de cada organización (Aseguradoras / Programas MOPT), no con el rol.'
                  : 'El acceso al portal del MOPT se da en el equipo de cada programa (Programas MOPT), no con el rol.'}
            </p>
          </div>

          {role === 'OPERATOR' && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Proveedor Asignado
              </label>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              >
                <option value="">Independiente (sin empresa)</option>
                {providers.filter((p) => p.is_active).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.is_mopt ? ' (flota MOPT)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500">
                Si pertenece a una empresa, se le liquida a la empresa con la comisión de ella. Si es de la
                flota MOPT, solo atiende servicios del MOPT y le paga el MOPT.
              </p>
            </div>
          )}

          {role === 'OPERATOR' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Placa de la unidad
                <input
                  value={plate}
                  onChange={(e) => setPlate(e.target.value.toUpperCase())}
                  placeholder="P123456"
                  className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </label>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Tipo de unidad
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="tow_light">Grúa liviana</option>
                  <option value="tow_heavy">Grúa pesada</option>
                  <option value="water_truck">Pipa de agua</option>
                  <option value="service">Vehículo de servicio</option>
                </select>
              </label>
              {vehicleType === 'water_truck' && (
                <label className="col-span-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Capacidad (m³)
                  <input
                    type="number" min={0.5} step="0.5"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                </label>
              )}
              <p className="col-span-2 text-xs text-zinc-500">
                La placa identifica la grúa en los km por grúa del portal MOPT. Vacía = sin unidad registrada.
              </p>
            </div>
          )}

          {/* Un independiente cobra él, así que su comisión se configura acá. */}
          {role === 'OPERATOR' && !providerId && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Comisión de Budi (%)
              </label>
              <input
                type="number" min={0} max={100} step="0.01"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
                placeholder="Por defecto de la plataforma"
                className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Vacío = se usa el porcentaje por defecto de la plataforma.
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
              className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
