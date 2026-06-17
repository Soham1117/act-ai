import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/auth.config";

// Edge instance built from the base config only (no Node providers) so the
// Proxy stays edge-safe. This is an OPTIMISTIC check (JWT presence/decode) per
// Next.js guidance — real authorization happens in Server Components via
// requireAdmin()/requireUser(), which read the role + tokenVersion from the DB.
const { auth } = NextAuth(authConfig);

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
 * Kiosk *terminal* endpoints are public (employees clock in via ID without admin
 * auth). The /kiosk index itself is admin-only via the standard guard. Match
 * `/kiosk/<anything>` but not `/kiosk` exactly.
 */
function isKiosk(path: string) {
  return /^\/kiosk\/[^/]+/.test(path);
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname) || pathname === "/" || isKiosk(pathname)) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip static assets, image optimisation, and favicon.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
