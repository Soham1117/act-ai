import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Server-side Supabase client. Use in Server Components, Route Handlers,
 * and Server Actions. Reads/writes the auth session via Next.js cookies().
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll throws when called from a Server Component — safe to ignore
            // because middleware refreshes the session.
          }
        },
      },
    },
  );
}

/**
 * Service-role Supabase client. Bypasses RLS. Server-only — never expose
 * to the browser. Use sparingly (e.g. admin bulk imports, kiosk session
 * provisioning, custom-claims hook tests).
 */
import { createClient as createServiceClient } from "@supabase/supabase-js";

export function createServiceRoleClient() {
  return createServiceClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
