'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

type PricingRule = {
  id: string;
  name: string;
  base_exit_fee: number;
  included_km: number;
  price_per_km_light: number;
  price_per_km_heavy: number;
  currency: string;
  is_active: boolean;
  description: string | null;
  created_at: string;
};

export default function PricingPage() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activating, setActivating] = useState<string | null>(null);

  useEffect(() => {
    const fetchRules = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('pricing_rules')
        .select('*')
        .order('created_at', { ascending: false });
      setRules(data || []);
      setLoading(false);
    };
    fetchRules();
  }, [refreshKey]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const handleActivate = async (rule: PricingRule) => {
    setActivating(rule.id);
    const supabase = createClient();

    // Use RPC for atomic activation (deactivates others, activates this one)
    const { error } = await supabase.rpc('set_active_pricing_rule', {
      p_rule_id: rule.id
    });

    if (error) {
      console.error('Error activating rule:', error);
      alert('Error al activar la regla: ' + error.message);
    }

    setActivating(null);
    refetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Esta seguro de eliminar esta regla de precios?')) return;

    const supabase = createClient();
    await supabase.from('pricing_rules').delete().eq('id', id);
    refetch();
  };

  const activeRule = rules.find((r) => r.is_active);

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            Reglas de Precios
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Configura las tarifas dinamicas del servicio
          </p>
        </div>
        <button
          onClick={() => {
            setEditingRule(null);
            setShowForm(true);
          }}
          className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600"
        >
          Nueva Regla
        </button>
      </div>

      {/* Active Rule Display */}
      {activeRule && (
        <div className="mb-8 rounded-lg border-2 border-green-500 bg-green-50 p-6 dark:border-green-700 dark:bg-green-950">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-green-500 px-2 py-0.5 text-xs font-medium text-white">
              ACTIVA
            </span>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
              {activeRule.name}
            </h2>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Tarifa Base</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white">
                ${activeRule.base_exit_fee}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">KM Incluidos</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white">
                {activeRule.included_km} km
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Grua Liviana</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white">
                ${activeRule.price_per_km_light}/km
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Grua Pesada</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white">
                ${activeRule.price_per_km_heavy}/km
              </p>
            </div>
          </div>
          {activeRule.description && (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              {activeRule.description}
            </p>
          )}
        </div>
      )}

      {showForm && (
        <PricingForm
          rule={editingRule}
          onClose={() => {
            setShowForm(false);
            setEditingRule(null);
          }}
          onSave={() => {
            setShowForm(false);
            setEditingRule(null);
            refetch();
          }}
        />
      )}

      {/* All Rules Table */}
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Todas las Reglas
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Nombre
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Tarifa Base
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  KM Incluidos
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Liviana
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Pesada
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
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-zinc-500">
                    No hay reglas de precios
                  </td>
                </tr>
              ) : (
                rules.map((rule) => (
                  <tr key={rule.id} className={rule.is_active ? 'bg-green-50 dark:bg-green-950' : ''}>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-zinc-900 dark:text-white">
                      {rule.name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      ${rule.base_exit_fee}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {rule.included_km} km
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      ${rule.price_per_km_light}/km
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      ${rule.price_per_km_heavy}/km
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {rule.is_active ? (
                        <span className="inline-flex rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                          Activa
                        </span>
                      ) : (
                        <button
                          onClick={() => handleActivate(rule)}
                          disabled={activating === rule.id}
                          className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400"
                        >
                          {activating === rule.id ? 'Activando...' : 'Activar'}
                        </button>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      <button
                        onClick={() => {
                          setEditingRule(rule);
                          setShowForm(true);
                        }}
                        className="mr-2 text-budi-primary-500 hover:text-budi-primary-700 dark:text-budi-primary-400"
                      >
                        Editar
                      </button>
                      {!rule.is_active && (
                        <button
                          onClick={() => handleDelete(rule.id)}
                          className="text-red-600 hover:text-red-800 dark:text-red-400"
                        >
                          Eliminar
                        </button>
                      )}
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

function PricingForm({
  rule,
  onClose,
  onSave,
}: {
  rule: PricingRule | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(rule?.name || '');
  const [baseExitFee, setBaseExitFee] = useState(rule?.base_exit_fee || 60);
  const [includedKm, setIncludedKm] = useState(rule?.included_km || 25);
  const [pricePerKmLight, setPricePerKmLight] = useState(rule?.price_per_km_light || 2.5);
  const [pricePerKmHeavy, setPricePerKmHeavy] = useState(rule?.price_per_km_heavy || 4);
  const [description, setDescription] = useState(rule?.description || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();

    const data = {
      name,
      base_exit_fee: baseExitFee,
      included_km: includedKm,
      price_per_km_light: pricePerKmLight,
      price_per_km_heavy: pricePerKmHeavy,
      description: description || null,
      currency: 'USD',
    };

    if (rule) {
      await supabase.from('pricing_rules').update(data).eq('id', rule.id);
    } else {
      await supabase.from('pricing_rules').insert(data);
    }

    setLoading(false);
    onSave();
  };

  return (
    <div className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">
        {rule ? 'Editar Regla de Precios' : 'Nueva Regla de Precios'}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
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
            placeholder="Tarifa Estandar"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Tarifa Base (USD)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={baseExitFee}
              onChange={(e) => setBaseExitFee(parseFloat(e.target.value))}
              required
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              KM Incluidos
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={includedKm}
              onChange={(e) => setIncludedKm(parseFloat(e.target.value))}
              required
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Precio/KM Liviana (USD)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={pricePerKmLight}
              onChange={(e) => setPricePerKmLight(parseFloat(e.target.value))}
              required
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Precio/KM Pesada (USD)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={pricePerKmHeavy}
              onChange={(e) => setPricePerKmHeavy(parseFloat(e.target.value))}
              required
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Descripcion
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            placeholder="Descripcion de la tarifa..."
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
            className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
          >
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
