const STATUS_COLORS: Record<string, string> = {
  initiated: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  assigned: 'bg-budi-primary-100 text-budi-primary-800 dark:bg-budi-primary-900 dark:text-budi-primary-200',
  en_route: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  completed: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const STATUS_LABELS: Record<string, string> = {
  initiated: 'Pendiente',
  assigned: 'Asignada',
  en_route: 'En Camino',
  active: 'Activa',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[status] || STATUS_COLORS.initiated}`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}
