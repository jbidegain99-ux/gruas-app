'use client';

import { useEffect, useRef } from 'react';

/**
 * En pantallas angostas la barra de pestañas de un portal se desliza en
 * horizontal; al navegar, la pestaña activa puede quedar fuera de la vista.
 * Esto la trae a la vista moviendo solo el scroll horizontal del <nav> (no
 * scrollIntoView, que también movería la página en vertical).
 */
export function useActiveTabIntoView<T extends HTMLElement>(pathname: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const nav = ref.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    const left = active.offsetLeft - nav.offsetLeft;
    const right = left + active.offsetWidth;
    const pad = 16;
    if (left < nav.scrollLeft + pad) {
      nav.scrollTo({ left: Math.max(0, left - pad) });
    } else if (right > nav.scrollLeft + nav.clientWidth - pad) {
      nav.scrollTo({ left: right - nav.clientWidth + pad });
    }
  }, [pathname]);
  return ref;
}
