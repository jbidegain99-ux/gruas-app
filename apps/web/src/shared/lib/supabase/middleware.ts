import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { CookieOptions } from '@supabase/ssr';
import type { Database } from '@gruas-app/shared';

type CookieToSet = {
  name: string;
  value: string;
  options?: CookieOptions;
};

type UserRole = Database['public']['Enums']['user_role'];

// Rutas protegidas y los roles autorizados para cada una. El prefijo más
// específico gana (no aplica aquí porque no se solapan, pero se evalúa en orden).
// `null` = basta con estar autenticado (cualquier rol).
const ROUTE_GUARDS: { prefix: string; allowedRoles: UserRole[] | null }[] = [
  { prefix: '/admin', allowedRoles: ['ADMIN'] },
  { prefix: '/dashboard', allowedRoles: null },
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Determinar si la ruta actual está protegida y qué roles admite.
  const pathname = request.nextUrl.pathname;
  const guard = ROUTE_GUARDS.find(({ prefix }) => pathname.startsWith(prefix));

  if (!guard) {
    return supabaseResponse;
  }

  // 1. Sin sesión → al login.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // 2. Con sesión pero la ruta exige un rol específico → validarlo.
  // auth_user_role() es SECURITY DEFINER y resuelve el rol vía auth.uid(),
  // evitando recursión de RLS sobre `profiles`.
  if (guard.allowedRoles) {
    const { data: role, error } = await supabase.rpc('auth_user_role');

    if (error || !role || !guard.allowedRoles.includes(role)) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
