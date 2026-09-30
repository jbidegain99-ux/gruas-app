import { redirect } from 'next/navigation';
import { createClient } from '@/shared/lib/supabase/server';
import { getPlatformFeatures, type PlatformFeature } from './platform-features';

/**
 * Guard de server components/layouts: si el interruptor está apagado, redirige.
 * El proxy ya lo hace antes (middleware.ts); esto es la segunda línea, por si
 * una ruta se sirve sin pasar por él.
 */
export async function requireFeature(feature: PlatformFeature, redirectTo: string): Promise<void> {
  const features = await getPlatformFeatures(await createClient());
  if (!features[feature]) redirect(redirectTo);
}
