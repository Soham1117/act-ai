import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { db } from "@/lib/db";
import { accessLevelFor, READ_ONLY_MESSAGE, type AccessLevel } from "@/lib/access";

export type AppRole = "ADMIN" | "EMPLOYEE";

export type SessionUser = {
  id: string;
  /// Login email — null for employees who sign in via username instead.
  email: string | null;
  name: string;
  profileImage: string | null;
  role: AppRole;
  employeeId: string | null;
  /** FULL, or READ_ONLY (terminated within grace window / pending review). */
  accessLevel: Exclude<AccessLevel, "NONE">;
  mustChangePassword: boolean;
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
      mustChangePassword: true,
      employee: {
        select: { id: true, employmentStatus: true, terminationDate: true, updatedAt: true },
      },
    },
  });
  if (!profile) return null;

  // Instant revocation: the token's tokenVersion must match the current one.
  if (typeof session.user.tv === "number" && session.user.tv !== profile.tokenVersion) {
    return null;
  }

  const accessLevel = accessLevelFor({ role: profile.role, employee: profile.employee });
  // Terminated past the grace window: session is dead even if the JWT is valid.
  if (accessLevel === "NONE") return null;

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    profileImage: profile.profileImage,
    role: profile.role,
    employeeId: profile.employee?.id ?? null,
    accessLevel,
    mustChangePassword: profile.mustChangePassword,
  };
});

/** Throws-redirect wrapper for protected pages. Both roles allowed. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * For any action that CREATES or CHANGES data on behalf of an employee.
 * Read-only accounts (terminated within the grace window, or pending review)
 * are rejected. Call instead of requireUser() in every self-service write.
 * Actions return `{ ok:false, error }` — catch ReadOnlyAccountError or use
 * `writeGuard()` below.
 */
export class ReadOnlyAccountError extends Error {
  constructor() {
    super(READ_ONLY_MESSAGE);
    this.name = "ReadOnlyAccountError";
  }
}

export async function requireWritableUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.accessLevel !== "FULL") throw new ReadOnlyAccountError();
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
