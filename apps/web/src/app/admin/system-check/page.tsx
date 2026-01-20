'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

type CheckResult = {
  name: string;
  status: 'ok' | 'warning' | 'error' | 'checking';
  message: string;
  detail?: string;
};

export default function SystemCheckPage() {
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [supabaseUrl, setSupabaseUrl] = useState<string>('');

  useEffect(() => {
    runChecks();
  }, []);

  const runChecks = async () => {
    setLoading(true);
    const supabase = createClient();
    const results: CheckResult[] = [];

    // Get Supabase URL (safe to show host only)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    try {
      const parsed = new URL(url);
      setSupabaseUrl(parsed.host);
    } catch {
      setSupabaseUrl('Invalid URL');
    }

    // Check 1: Can connect to Supabase
    try {
      const { data: session } = await supabase.auth.getSession();
      if (session?.session) {
        results.push({
          name: 'Autenticacion',
          status: 'ok',
          message: 'Sesion activa',
          detail: `User ID: ${session.session.user.id.slice(0, 8)}...`,
        });
      } else {
        results.push({
          name: 'Autenticacion',
          status: 'error',
          message: 'Sin sesion',
          detail: 'Debes iniciar sesion como admin',
        });
      }
    } catch (e) {
      results.push({
        name: 'Autenticacion',
        status: 'error',
        message: 'Error de conexion',
        detail: String(e),
      });
    }

    // Check 2: Helper functions exist (is_admin, is_mop, etc.)
    try {
      const { data, error } = await supabase.rpc('is_admin');
      if (error) {
        if (error.message.includes('function') && error.message.includes('does not exist')) {
          results.push({
            name: 'Funcion is_admin()',
            status: 'error',
            message: 'NO EXISTE - Migration 00014 no ejecutada',
            detail: 'Ejecuta supabase/migrations/00014_fix_recursive_rls.sql en Supabase SQL Editor',
          });
        } else {
          results.push({
            name: 'Funcion is_admin()',
            status: 'warning',
            message: 'Error al verificar',
            detail: error.message,
          });
        }
      } else {
        results.push({
          name: 'Funcion is_admin()',
          status: 'ok',
          message: data ? 'Existe y retorna TRUE' : 'Existe pero retorna FALSE',
          detail: data ? 'Usuario actual es ADMIN' : 'Usuario actual NO es admin',
        });
      }
    } catch (e) {
      results.push({
        name: 'Funcion is_admin()',
        status: 'error',
        message: 'Error inesperado',
        detail: String(e),
      });
    }

    // Check 3: Profiles table - count
    try {
      const { count, error } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      if (error) {
        results.push({
          name: 'Tabla profiles',
          status: 'error',
          message: 'Error al consultar',
          detail: error.message,
        });
      } else {
        results.push({
          name: 'Tabla profiles',
          status: count && count > 0 ? 'ok' : 'warning',
          message: `${count || 0} registros visibles`,
          detail: count === 0 ? 'Puede ser problema de RLS o tabla vacia' : undefined,
        });
      }
    } catch (e) {
      results.push({
        name: 'Tabla profiles',
        status: 'error',
        message: 'Error inesperado',
        detail: String(e),
      });
    }

    // Check 4: Pricing rules - count and active
    try {
      const { data: rulesData, error: rulesError } = await supabase
        .from('pricing_rules')
        .select('id, is_active');

      if (rulesError) {
        results.push({
          name: 'Tabla pricing_rules',
          status: 'error',
          message: 'Error al consultar',
          detail: rulesError.message,
        });
      } else {
        const total = rulesData?.length || 0;
        const activeCount = rulesData?.filter((r) => r.is_active).length || 0;

        if (activeCount === 0) {
          results.push({
            name: 'Pricing Rules',
            status: 'warning',
            message: `${total} reglas, NINGUNA activa`,
            detail: 'Debes activar una regla de precios',
          });
        } else if (activeCount === 1) {
          results.push({
            name: 'Pricing Rules',
            status: 'ok',
            message: `${total} reglas, 1 activa`,
          });
        } else {
          results.push({
            name: 'Pricing Rules',
            status: 'error',
            message: `${total} reglas, ${activeCount} ACTIVAS (debe ser 1)`,
            detail: 'Inconsistencia de datos - usa el boton "Normalizar" abajo',
          });
        }
      }
    } catch (e) {
      results.push({
        name: 'Pricing Rules',
        status: 'error',
        message: 'Error inesperado',
        detail: String(e),
      });
    }

    // Check 5: Service requests - count
    try {
      const { count, error } = await supabase
        .from('service_requests')
        .select('*', { count: 'exact', head: true });

      if (error) {
        results.push({
          name: 'Tabla service_requests',
          status: 'error',
          message: 'Error al consultar',
          detail: error.message,
        });
      } else {
        results.push({
          name: 'Tabla service_requests',
          status: 'ok',
          message: `${count || 0} solicitudes visibles`,
        });
      }
    } catch (e) {
      results.push({
        name: 'Tabla service_requests',
        status: 'error',
        message: 'Error inesperado',
        detail: String(e),
      });
    }

    // Check 6: Providers - count
    try {
      const { count, error } = await supabase
        .from('providers')
        .select('*', { count: 'exact', head: true });

      if (error) {
        results.push({
          name: 'Tabla providers',
          status: 'error',
          message: 'Error al consultar',
          detail: error.message,
        });
      } else {
        results.push({
          name: 'Tabla providers',
          status: count && count > 0 ? 'ok' : 'warning',
          message: `${count || 0} proveedores visibles`,
        });
      }
    } catch (e) {
      results.push({
        name: 'Tabla providers',
        status: 'error',
        message: 'Error inesperado',
        detail: String(e),
      });
    }

    // Check 7: set_active_pricing_rule RPC exists
    try {
      // Test with a non-existent UUID to check if function exists
      const { error } = await supabase.rpc('set_active_pricing_rule', {
        p_rule_id: '00000000-0000-0000-0000-000000000000',
      });

      if (error) {
        if (error.message.includes('function') && error.message.includes('does not exist')) {
          results.push({
            name: 'RPC set_active_pricing_rule',
            status: 'error',
            message: 'NO EXISTE',
            detail: 'Ejecuta la migration correspondiente en Supabase',
          });
        } else if (error.message.includes('not found') || error.message.includes('No existe')) {
          results.push({
            name: 'RPC set_active_pricing_rule',
            status: 'ok',
            message: 'Existe y funciona',
            detail: 'Test con UUID invalido retorno error esperado',
          });
        } else {
          results.push({
            name: 'RPC set_active_pricing_rule',
            status: 'warning',
            message: 'Existe pero con error',
            detail: error.message,
          });
        }
      } else {
        results.push({
          name: 'RPC set_active_pricing_rule',
          status: 'ok',
          message: 'Existe y funciona',
        });
      }
    } catch (e) {
      results.push({
        name: 'RPC set_active_pricing_rule',
        status: 'error',
        message: 'Error inesperado',
        detail: String(e),
      });
    }

    setChecks(results);
    setLoading(false);
  };

  const handleNormalizePricing = async () => {
    const supabase = createClient();

    // Get all active rules, ordered by created_at desc
    const { data: activeRules } = await supabase
      .from('pricing_rules')
      .select('id, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (!activeRules || activeRules.length <= 1) {
      alert('No hay multiples reglas activas para normalizar');
      return;
    }

    // Keep the most recent, deactivate the rest
    const keepId = activeRules[0].id;
    const deactivateIds = activeRules.slice(1).map((r) => r.id);

    const { error } = await supabase
      .from('pricing_rules')
      .update({ is_active: false })
      .in('id', deactivateIds);

    if (error) {
      alert('Error al normalizar: ' + error.message);
    } else {
      alert(`Normalizado: mantenida regla ${keepId.slice(0, 8)}..., desactivadas ${deactivateIds.length} reglas`);
      runChecks();
    }
  };

  const getStatusIcon = (status: CheckResult['status']) => {
    switch (status) {
      case 'ok':
        return (
          <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="h-5 w-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'error':
        return (
          <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      default:
        return (
          <svg className="h-5 w-5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        );
    }
  };

  const hasErrors = checks.some((c) => c.status === 'error');
  const hasWarnings = checks.some((c) => c.status === 'warning');
  const hasPricingIssue = checks.find((c) => c.name === 'Pricing Rules' && c.status === 'error');

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          System Check
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Diagnostico del sistema y verificacion de configuracion
        </p>
      </div>

      {/* Overall Status */}
      <div
        className={`mb-6 rounded-lg p-4 ${
          hasErrors
            ? 'bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800'
            : hasWarnings
              ? 'bg-yellow-50 border border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800'
              : 'bg-green-50 border border-green-200 dark:bg-green-950 dark:border-green-800'
        }`}
      >
        <div className="flex items-center gap-3">
          {hasErrors ? (
            <>
              <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold text-red-800 dark:text-red-200">Problemas Detectados</p>
                <p className="text-sm text-red-600 dark:text-red-400">
                  Hay errores que requieren atencion
                </p>
              </div>
            </>
          ) : hasWarnings ? (
            <>
              <svg className="h-8 w-8 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-semibold text-yellow-800 dark:text-yellow-200">Advertencias</p>
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  Algunos items requieren revision
                </p>
              </div>
            </>
          ) : (
            <>
              <svg className="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold text-green-800 dark:text-green-200">Sistema OK</p>
                <p className="text-sm text-green-600 dark:text-green-400">
                  Todas las verificaciones pasaron
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Environment Info */}
      <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">Entorno</h2>
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-600 dark:text-zinc-400">Supabase Host:</span>
            <code className="rounded bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">{supabaseUrl}</code>
          </div>
        </div>
      </div>

      {/* Checks List */}
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Verificaciones</h2>
          <button
            onClick={runChecks}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Verificando...' : 'Re-verificar'}
          </button>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {checks.map((check, idx) => (
            <div key={idx} className="flex items-start gap-4 px-6 py-4">
              <div className="mt-0.5">{getStatusIcon(check.status)}</div>
              <div className="flex-1">
                <p className="font-medium text-zinc-900 dark:text-white">{check.name}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{check.message}</p>
                {check.detail && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">{check.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      {hasPricingIssue && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <h3 className="font-semibold text-red-800 dark:text-red-200">
            Accion Requerida: Multiples Reglas de Precio Activas
          </h3>
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            La base de datos tiene mas de una regla de precios activa. Esto puede causar
            comportamiento inconsistente.
          </p>
          <button
            onClick={handleNormalizePricing}
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Normalizar Ahora (mantener la mas reciente)
          </button>
        </div>
      )}

      {/* Migration Instructions */}
      {checks.some((c) => c.name.includes('is_admin') && c.status === 'error') && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h3 className="font-semibold text-amber-800 dark:text-amber-200">
            Migration Requerida
          </h3>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            Las funciones helper de RLS no existen. Debes ejecutar la migration:
          </p>
          <ol className="mt-2 ml-4 list-decimal text-sm text-amber-700 dark:text-amber-300">
            <li>Ve a tu proyecto en Supabase Dashboard</li>
            <li>Navega a SQL Editor</li>
            <li>Copia el contenido de <code className="rounded bg-amber-200 px-1 dark:bg-amber-800">supabase/migrations/00014_fix_recursive_rls.sql</code></li>
            <li>Ejecuta el script</li>
            <li>Vuelve aqui y haz clic en &quot;Re-verificar&quot;</li>
          </ol>
        </div>
      )}
    </div>
  );
}
