'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { getMyOrganization } from '@/shared/lib/organization';

const FALLBACK_MS = 60_000;

/**
 * Casos en vivo para los portales (migr. 00121, POR-03). La base avisa por un
 * canal privado `org:<id>` cuando se crea un caso de la organización o cambia
 * su estado; el aviso trae solo folio y estado, y aquí solo dispara una
 * recarga con la RPC del portal. Además se recarga cada minuto por si el
 * canal se cae. Devuelve un contador que cambia con cada aviso.
 */
export function useOrgLive(): { tick: number; live: boolean } {
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let alive = true;

    const bump = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => setTick((t) => t + 1), 400);
    };

    (async () => {
      const org = await getMyOrganization(supabase);
      if (!alive || !org) return;
      // Los canales privados necesitan el token de la sesión.
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`org:${org.id}`, { config: { private: true } })
        .on('broadcast', { event: 'case_changed' }, bump)
        .subscribe((status) => alive && setLive(status === 'SUBSCRIBED'));
    })();

    const poll = setInterval(bump, FALLBACK_MS);
    return () => {
      alive = false;
      clearInterval(poll);
      if (debounce.current) clearTimeout(debounce.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return { tick, live };
}

/** Indicador pequeño de "en vivo". */
export function liveLabel(live: boolean): string {
  return live ? 'En vivo' : 'Se actualiza cada minuto';
}
