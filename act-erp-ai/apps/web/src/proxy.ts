import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = [
  "/login",
  "/onboard",
  "/unauthorized",
  "/auth", // /auth/callback, /auth/reset-password
  "/api/auth",
];

function isPublic(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * The kiosk *terminal* endpoints are public (employees clock in via ID
 * without admin auth). The /kiosk index itself is admin-only and goes
 * through the standard auth guard. Match `/kiosk/<anything>` but not
 * `/kiosk` exactly.
 */
function isKiosk(path: string) {
  return /^\/kiosk\/[^/]+/.test(path);
}

/**
 * Edge-friendly proxy. Only handles auth (logged-in or not). Role-based
 * gating happens in (admin)/layout.tsx via requireAdmin() which reads
 * the active role straight from the User table — that's our single
 * source of truth and avoids JWT/app_metadata cache headaches.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always refresh the auth session cookie.
  const { response, user } = await updateSession(request);

  // Public + kiosk routes — let through.
  if (isPublic(pathname) || pathname === "/" || isKiosk(pathname)) {
    return response;
  }

  // All other routes require an authenticated user.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Skip static assets, image optimisation, and favicon.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
