import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
 * Server-only. Returns the current session user, or null if not
 * authenticated. Cached per-request via React `cache`.
 *
 * Source of truth for `role` is the User table (not JWT claims) — keeps
 * gating reliable without an auth.jwt hook.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await db.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      name: true,
      profileImage: true,
      role: true,
      employee: { select: { id: true } },
    },
  });
  if (!profile) return null;

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
