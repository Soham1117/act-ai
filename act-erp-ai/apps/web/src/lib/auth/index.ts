import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { db } from "@/lib/db";

export type AppRole = "ADMIN" | "EMPLOYEE";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  profileImage: string | null;
  role: AppRole;
  employeeId: string | null;
};

/**
 * Server-only. Returns the current session user, or null if not authenticated.
 * Cached per-request via React `cache`.
 *
 * Role is read from the User table (source of truth), not the JWT claim, so a
 * role change takes effect immediately. The `tv` (tokenVersion) claim is checked
 * against the DB to support instant session revocation — a mismatch means the
 * token was issued before a logout-everywhere / disable and is rejected.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return null;

  const profile = await db.user.findUnique({
    where: { id: uid },
    select: {
      id: true,
      email: true,
      name: true,
      profileImage: true,
      role: true,
      tokenVersion: true,
      employee: { select: { id: true } },
    },
  });
  if (!profile) return null;

  // Instant revocation: the token's tokenVersion must match the current one.
  if (typeof session.user.tv === "number" && session.user.tv !== profile.tokenVersion) {
    return null;
  }

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    profileImage: profile.profileImage,
    role: profile.role,
    employeeId: profile.employee?.id ?? null,
  };
});

/** Throws-redirect wrapper for protected pages. Both roles allowed. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Throws-redirect wrapper for admin-only pages. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/unauthorized");
  return user;
}

/**
 * Revoke every active session for a user (logout-everywhere). Call after a
 * forced password reset, role change, or account disable. Bumps tokenVersion so
 * all previously-issued JWTs fail the check in getSessionUser.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}
