'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/shared/lib/supabase/client';

/**
 * Refresca el dashboard (server component) en vivo: cuando cambian las
 * solicitudes vuelve a renderizar (debounced), y cada 30 s refresca para
 * reflejar operadores en línea, etc. No renderiza nada visible.
 */
export function DashboardLiveRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const debouncedRefresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 800);
    };

    const channel = supabase
      .channel('admin-dashboard')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_requests' },
        debouncedRefresh
      )
      .subscribe();

    const interval = setInterval(() => router.refresh(), 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  return null;
}
