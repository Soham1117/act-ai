"use server";

import { AuthError } from "next-auth";
import { signIn, signOut as naSignOut } from "@/lib/auth/auth";
import { getSessionUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";

export type LoginResult = { ok: true } | { ok: false; error: string };

/**
 * Verify credentials and set the session cookie. `redirect: false` keeps the
 * nice inline error UI in the login form (we route on the client on success).
 */
export async function loginAction(email: string, password: string): Promise<LoginResult> {
  try {
    await signIn("credentials", { email, password, redirect: false });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: "Invalid email or password." };
    }
    throw err;
  }
}

export async function signOut() {
  await naSignOut({ redirectTo: "/login" });
}

/**
 * Authenticated self-service password change. Verifies the current password,
 * sets the new hash, and revokes all sessions (so the user re-logs in).
 */
export async function changeMyPassword(
  current: string,
  next: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in" };
  if (next.length < 8) return { ok: false, error: "Min 8 characters" };

  const row = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row?.passwordHash || !(await verifyPassword(current, row.passwordHash))) {
    return { ok: false, error: "Current password is incorrect" };
  }
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), tokenVersion: { increment: 1 } },
  });
  return { ok: true };
}
