import { type NextRequest } from 'next/server';
import { updateSession } from '@/shared/lib/supabase/middleware';

// Convención `proxy` de Next.js 16 (antes `middleware`). Debe vivir en src/ raíz.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
