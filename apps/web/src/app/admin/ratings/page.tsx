'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

type Rating = {
  id: string;
  stars: number;
  comment: string | null;
  created_at: string;
  request_id: string;
  rater_name: string | null;
  operator_name: string | null;
  operator_id: string;
};

type OperatorSummary = {
  id: string;
  name: string;
  totalRatings: number;
  averageRating: number;
  completedServices: number;
};

export default function RatingsPage() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [operatorSummaries, setOperatorSummaries] = useState<OperatorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOperator, setSelectedOperator] = useState<string>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      // Fetch all ratings with related info
      const { data: ratingsData, error: ratingsError } = await supabase
        .from('ratings')
        .select(`
          id,
          stars,
          comment,
          created_at,
          request_id,
          rated_operator_id,
          rater:profiles!ratings_rater_user_id_fkey (full_name),
          operator:profiles!ratings_rated_operator_id_fkey (full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (ratingsError) {
        console.error('Error fetching ratings:', ratingsError);
      } else if (ratingsData) {
        const mappedRatings = ratingsData.map((r) => ({
          id: r.id,
          stars: r.stars,
          comment: r.comment,
          created_at: r.created_at,
          request_id: r.request_id,
          operator_id: r.rated_operator_id,
          rater_name: (r.rater as unknown as { full_name: string } | null)?.full_name || null,
          operator_name: (r.operator as unknown as { full_name: string } | null)?.full_name || null,
        }));
        setRatings(mappedRatings);
      }

      // Fetch operators with their stats
      const { data: operators } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'OPERATOR');

      if (operators) {
        const summaries: OperatorSummary[] = [];

        for (const op of operators) {
          // Get rating stats
          const { data: opRatings } = await supabase
            .from('ratings')
            .select('stars')
            .eq('rated_operator_id', op.id);

          // Get completed services count
          const { count: completedCount } = await supabase
            .from('service_requests')
            .select('*', { count: 'exact', head: true })
            .eq('operator_id', op.id)
            .eq('status', 'completed');

          const totalRatings = opRatings?.length || 0;
          const averageRating = totalRatings > 0
            ? opRatings!.reduce((sum, r) => sum + r.stars, 0) / totalRatings
            : 0;

          summaries.push({
            id: op.id,
            name: op.full_name || 'Sin nombre',
            totalRatings,
            averageRating,
            completedServices: completedCount || 0,
          });
        }

        // Sort by average rating descending
        summaries.sort((a, b) => b.averageRating - a.averageRating);
        setOperatorSummaries(summaries);
      }

      setLoading(false);
    };

    fetchData();
  }, [refreshKey]);

  const refetch = () => setRefreshKey((k) => k + 1);

  const renderStars = (count: number) => {
    return (
      <span className="text-yellow-500">
        {'★'.repeat(count)}
        <span className="text-zinc-300 dark:text-zinc-600">{'★'.repeat(5 - count)}</span>
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const filteredRatings = selectedOperator === 'all'
    ? ratings
    : ratings.filter((r) => r.operator_id === selectedOperator);

  const overallStats = {
    totalRatings: ratings.length,
    averageRating: ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.stars, 0) / ratings.length
      : 0,
    fiveStars: ratings.filter((r) => r.stars === 5).length,
    oneToThree: ratings.filter((r) => r.stars <= 3).length,
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            Calificaciones
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Resenas y calificaciones de los servicios
          </p>
        </div>
        <button
          onClick={refetch}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Actualizar
        </button>
      </div>

      {/* Overall Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Total Calificaciones</p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-white">{overallStats.totalRatings}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Promedio General</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-zinc-900 dark:text-white">
              {overallStats.averageRating > 0 ? overallStats.averageRating.toFixed(1) : '-'}
            </p>
            {overallStats.averageRating > 0 && (
              <span className="text-yellow-500">★</span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">5 Estrellas</p>
          <p className="text-2xl font-bold text-green-600">{overallStats.fiveStars}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">1-3 Estrellas</p>
          <p className="text-2xl font-bold text-red-600">{overallStats.oneToThree}</p>
        </div>
      </div>

      {/* Operator Rankings */}
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">
          Ranking de Operadores
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {operatorSummaries.slice(0, 6).map((op, index) => (
            <div
              key={op.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                    index === 0 ? 'bg-yellow-100 text-yellow-700' :
                    index === 1 ? 'bg-zinc-200 text-zinc-700' :
                    index === 2 ? 'bg-orange-100 text-orange-700' :
                    'bg-zinc-100 text-zinc-600'
                  }`}>
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-white">{op.name}</p>
                    <p className="text-sm text-zinc-500">{op.completedServices} servicios</p>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-lg">
                  {renderStars(Math.round(op.averageRating))}
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-zinc-900 dark:text-white">
                    {op.averageRating > 0 ? op.averageRating.toFixed(1) : '-'}
                  </p>
                  <p className="text-xs text-zinc-500">{op.totalRatings} resenas</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter */}
      <div className="mb-4 flex items-center gap-4">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Filtrar por operador:
        </label>
        <select
          value={selectedOperator}
          onChange={(e) => setSelectedOperator(e.target.value)}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        >
          <option value="all">Todos los operadores</option>
          {operatorSummaries.map((op) => (
            <option key={op.id} value={op.id}>
              {op.name} ({op.totalRatings} resenas)
            </option>
          ))}
        </select>
      </div>

      {/* Ratings Table */}
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Fecha
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Calificacion
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Operador
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Cliente
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Comentario
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
              ) : filteredRatings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-zinc-500">
                    No hay calificaciones
                  </td>
                </tr>
              ) : (
                filteredRatings.map((rating) => (
                  <tr key={rating.id}>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {formatDate(rating.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="text-lg">{renderStars(rating.stars)}</div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-zinc-900 dark:text-white">
                      {rating.operator_name || 'Sin nombre'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {rating.rater_name || 'Cliente'}
                    </td>
                    <td className="max-w-xs truncate px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {rating.comment || '-'}
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
